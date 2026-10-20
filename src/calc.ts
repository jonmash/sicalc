// Pure calculator core: token model, parser/evaluator, result formatting.
// The expression is a list of string tokens (one per key press), never free text.

export type Token = string;
export type AngleMode = 'deg' | 'rad';
export type OutputMode = 'norm' | 'eng';

export const SI: Record<string, number> = {
  T: 12, G: 9, M: 6, k: 3, m: -3, u: -6, n: -9, p: -12, f: -15,
};
const SI_BY_EXP: Record<number, string> = {
  12: 'T', 9: 'G', 6: 'M', 3: 'k', 0: '', '-3': 'm', '-6': 'µ', '-9': 'n', '-12': 'p', '-15': 'f',
};

// Functions: token -> opens a "(" implicitly.
const FUNCS = new Set([
  'sqrt', 'cbrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'log', 'ln', 'tenpow', 'exp', 'abs',
]);

export class CalcError extends Error {
  constructor(public kind: 'Syntax Error' | 'Math Error' | 'Stack Error') { super(kind); }
}

export interface Ctx { angle: AngleMode; ans: number; }

const isDigit = (t: Token | undefined) => t !== undefined && /^[0-9]$/.test(t);

/** Evaluate a token list. Pathologically deep nesting reports 'Stack Error' instead of crashing. */
export function evaluate(tokens: Token[], ctx: Ctx): number {
  try {
    return evaluateTokens(tokens, ctx);
  } catch (e) {
    if (e instanceof RangeError) throw new CalcError('Stack Error');
    throw e;
  }
}

function evaluateTokens(tokens: Token[], ctx: Ctx): number {
  let i = 0;
  const peek = () => tokens[i];
  const syntax = () => new CalcError('Syntax Error');
  const math = () => new CalcError('Math Error');

  const toRad = (x: number) => (ctx.angle === 'deg' ? (x * Math.PI) / 180 : x);
  const fromRad = (x: number) => (ctx.angle === 'deg' ? (x * 180) / Math.PI : x);

  // Exact values at the quadrant points so sin(180) is 0, not 1.2e-16.
  function trig(kind: 'sin' | 'cos' | 'tan', x: number): number {
    if (ctx.angle === 'deg') {
      const r = ((x % 360) + 360) % 360;
      if (kind === 'sin') { if (r % 180 === 0) return 0; if (r === 90) return 1; if (r === 270) return -1; }
      if (kind === 'cos') { if (r === 90 || r === 270) return 0; if (r === 0) return 1; if (r === 180) return -1; }
      if (kind === 'tan') { if (r % 180 === 0) return 0; if (r % 180 === 90) throw math(); }
    }
    // Reduce first (fmod is exact) so large angles keep their precision: sin(1e15+30°) = 0.5.
    const a = ctx.angle === 'deg' ? (((x % 360) + 360) % 360 * Math.PI) / 180 : x;
    return kind === 'sin' ? Math.sin(a) : kind === 'cos' ? Math.cos(a) : Math.tan(a);
  }

  function expr(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const startsPrimary = (t: Token | undefined) =>
    t !== undefined && (isDigit(t) || t === '.' || t === 'pi' || t === 'e' || t === 'ans' || t === '(' || FUNCS.has(t));

  // implicit: 2pi, 3(4), 2sin(x), (1+2)(3+4). Binds tighter than * / and parallel,
  // so 1/2pi = 1/(2*pi) (Casio FX-991 behaviour).
  function implicit(): number {
    let v = unary();
    while (startsPrimary(peek())) v = v * unary();
    return v;
  }

  // term: * / and parallel, left-to-right; operands are implicit products.
  function term(): number {
    let v = implicit();
    for (;;) {
      const t = peek();
      if (t === '*') { i++; v = v * implicit(); }
      else if (t === '/') {
        i++;
        const d = implicit();
        if (d === 0) throw math();
        v = v / d;
      } else if (t === 'par') {
        i++;
        const r = implicit();
        if (v + r === 0) throw math();
        v = (v * r) / (v + r);
      } else return v;
    }
  }

  function unary(): number {
    if (peek() === '-') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }

  function power(): number {
    const base = fraction();
    if (peek() === '^') {
      i++;
      const ex = unary(); // right-assoc, allows 2^-3
      const r = Math.pow(base, ex);
      if (!Number.isFinite(r)) throw math();
      return r;
    }
    return base;
  }

  // a┘b : binds tighter than everything. Both sides are single atoms,
  // and an SI suffix belongs to its number, so 1┘2k = 1/(2k).
  function fraction(): number {
    const a = primary();
    if (peek() === 'frac') {
      i++;
      const b = atom();
      if (b === 0) throw math();
      return a / b;
    }
    return a;
  }

  function number(): number {
    let s = '';
    while (isDigit(peek()) || peek() === '.') s += tokens[i++];
    if ((s.match(/\./g) ?? []).length > 1 || s === '.') throw syntax();
    const t = peek();
    if (t !== undefined && t in SI) { i++; return parseFloat(`${s}e${SI[t]}`); }
    if (t === 'E') return parseFloat(`${s}e${expValue()}`);
    return parseFloat(s);
  }

  // ×10ˣ suffix: consumes E, optional minus, digits; returns the exponent.
  function expValue(): number {
    i++; // E
    let sign = '';
    if (peek() === '-') { sign = '-'; i++; }
    let d = '';
    while (isDigit(peek())) d += tokens[i++];
    if (d === '') throw syntax();
    return parseInt(`${sign}${d}`, 10);
  }

  // Constants, Ans and groups also accept a ×10ˣ suffix: Ans×10^2, π×10^3, (1+2)×10^2
  const withExp = (v: number) => (peek() === 'E' ? parseFloat(`${v}e${expValue()}`) : v);

  function group(): number {
    const v = expr();
    if (peek() === ')') i++; // missing close parens are auto-closed
    return v;
  }

  // atom: number, constant, ANS, or a parenthesised group (no functions)
  function atom(): number {
    const t = peek();
    if (t === undefined) throw syntax();
    if (isDigit(t) || t === '.') return number();
    if (t === 'pi') { i++; return withExp(Math.PI); }
    if (t === 'e') { i++; return withExp(Math.E); }
    if (t === 'ans') { i++; return withExp(ctx.ans); }
    if (t === '(') { i++; return withExp(group()); }
    if (t === '-') { i++; return -atom(); }
    throw syntax();
  }

  function primary(): number {
    const t = peek();
    if (t !== undefined && FUNCS.has(t)) {
      i++;
      const x = group();
      return applyFn(t, x);
    }
    return atom();
  }

  function applyFn(f: string, x: number): number {
    let r: number;
    switch (f) {
      case 'sqrt': r = Math.sqrt(x); break;
      case 'cbrt': r = Math.cbrt(x); break;
      case 'sin': case 'cos': case 'tan': r = trig(f, x); break;
      case 'asin': r = fromRad(Math.asin(x)); break;
      case 'acos': r = fromRad(Math.acos(x)); break;
      case 'atan': r = fromRad(Math.atan(x)); break;
      case 'log': r = Math.log10(x); break;
      case 'ln': r = Math.log(x); break;
      case 'tenpow': r = Math.pow(10, x); break;
      case 'exp': r = Math.exp(x); break;
      case 'abs': r = Math.abs(x); break;
      default: throw syntax();
    }
    if (!Number.isFinite(r)) throw math();
    return r;
  }

  if (tokens.length === 0) throw syntax();
  const v = expr();
  if (i < tokens.length) throw syntax(); // stray ')' or token
  if (!Number.isFinite(v)) throw math();
  return v;
}

// ---------- formatting ----------

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};
const sup = (s: string) => [...s].map((c) => SUP[c] ?? c).join('');

/** Round to 10 significant digits (what the Casio shows) to hide float noise. */
export const round10 = (x: number) => Number(x.toPrecision(10));

/** Split into mantissa digits string and decimal exponent after rounding. */
function sci(x: number): { mant: string; exp: number } {
  const [m, e] = x.toExponential(9).split('e');
  let mant = m;
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return { mant, exp: parseInt(e, 10) };
}

export function formatResult(x: number, mode: OutputMode): string {
  let v = round10(x);
  if (!Number.isFinite(v)) v = x; // x within rounding distance of Number.MAX_VALUE
  if (v === 0) return '0';
  const { exp } = sci(v);
  if (mode === 'eng') {
    const k = Math.floor(exp / 3) * 3;
    if (k in SI_BY_EXP) {
      const m = round10(v / Math.pow(10, k));
      return `${m}${SI_BY_EXP[k] ? ' ' + SI_BY_EXP[k] : ''}`.trim();
    }
    return sciString(v);
  }
  const a = Math.abs(v);
  if (a >= 1e10 || a < 1e-4) return sciString(v);
  return String(v);
}

function sciString(v: number): string {
  const { mant, exp } = sci(v);
  return `${mant}×10${sup(String(exp))}`;
}

// ---------- display labels ----------

export const LABEL: Record<string, string> = {
  '*': '×', '/': '÷', '-': '−', '+': '+', '^': '^', '(': '(', ')': ')',
  pi: 'π', e: 'e', ans: 'Ans', frac: '┘', par: '∥', E: '×10',
  u: 'µ', sqrt: '√(', cbrt: '∛(', sin: 'sin(', cos: 'cos(', tan: 'tan(',
  asin: 'sin⁻¹(', acos: 'cos⁻¹(', atan: 'tan⁻¹(', log: 'log(', ln: 'ln(',
  tenpow: '10^(', exp: 'e^(', abs: 'Abs(',
};
export const labelOf = (t: Token) => LABEL[t] ?? t;

export const isSI = (t: Token) => t in SI;
