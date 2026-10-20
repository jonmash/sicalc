// Property-style suite: ~1300 seeded random expressions checked against an independent
// AST oracle, plus hand-written precedence / implicit-multiplication / limit cases.
// Oracle = a typed expression tree that renders BOTH key tokens and a fully
// parenthesised JS value, so it shares no parsing code with src/calc.ts.
import { describe, it, expect } from 'vitest';
import { evaluate, formatResult, CalcError, type Token } from '../src/calc';

// ---------- seeded PRNG ----------
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Err extends Error {}
const bad = () => new Err('math');
const SIEXP: Record<string, number> = { T: 12, G: 9, M: 6, k: 3, m: -3, u: -6, n: -9, p: -12, f: -15 };

interface N { tok: Token[]; val(): number; }
const ok = (x: number) => { if (!Number.isFinite(x)) throw bad(); return x; };

interface Cfg { angle: 'deg' | 'rad'; ans: number; }

function build(rnd: () => number, cfg: Cfg, o: { big: boolean; small: boolean; fns: boolean; depth: number }) {
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const chance = (p: number) => rnd() < p;
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  function digits(n: number) { let s = ''; for (let i = 0; i < n; i++) s += ri(0, 9); return s; }

  function number(): N {
    let s: string;
    const shape = ri(0, 5);
    if (shape === 0) s = String(ri(0, 9));
    else if (shape === 1) s = String(ri(1, 999));
    else if (shape === 2) s = `${ri(0, 99)}.${digits(ri(1, 4))}`;
    else if (shape === 3) s = `.${digits(ri(1, 3))}`;
    else if (shape === 4) s = `${ri(1, 9)}${digits(ri(5, 12))}`; // long integer
    else s = `${ri(1, 9)}.${digits(ri(6, 9))}`;
    const toks = [...s];
    const kind = chance(0.35) ? (chance(0.5) ? 'si' : 'E') : 'none';
    if (kind === 'si') {
      const sfx = pick(Object.keys(SIEXP));
      return { tok: [...toks, sfx], val: () => parseFloat(`${s}e${SIEXP[sfx]}`) };
    }
    if (kind === 'E') {
      const mag = o.big ? ri(0, 150) : o.small ? ri(0, 150) : ri(0, 6);
      const neg = o.small ? true : o.big ? false : chance(0.4);
      const ex = `${neg ? '-' : ''}${mag}`;
      return { tok: [...toks, 'E', ...(neg ? ['-'] : []), ...String(mag)], val: () => parseFloat(`${s}e${ex}`) };
    }
    return { tok: toks, val: () => parseFloat(s) };
  }

  function withE(n: N): N {
    if (!chance(0.15)) return n;
    const mag = ri(0, 8), neg = chance(0.4);
    return { tok: [...n.tok, 'E', ...(neg ? ['-'] : []), ...String(mag)], val: () => parseFloat(`${n.val()}e${neg ? '-' : ''}${mag}`) };
  }

  function atom(d: number): N {
    const r = rnd();
    if (r < 0.45 || d <= 0) return number();
    if (r < 0.6) return withE({ tok: ['pi'], val: () => Math.PI });
    if (r < 0.68) return withE({ tok: ['e'], val: () => Math.E });
    if (r < 0.76) return withE({ tok: ['ans'], val: () => cfg.ans });
    const inner = expr(d - 1);
    return withE({ tok: ['(', ...inner.tok, ')'], val: inner.val });
  }

  function fn(d: number): N {
    const name = pick(['sqrt', 'cbrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'ln', 'tenpow', 'exp', 'abs']);
    const inner = expr(d - 1);
    const rad = cfg.angle === 'rad';
    const toRad = (x: number) => (rad ? x : (x * Math.PI) / 180);
    const reduce = (x: number) => (rad ? x : ((x % 360) + 360) % 360);
    const val = () => {
      const x = inner.val();
      let y: number;
      switch (name) {
        case 'sqrt': y = Math.sqrt(x); break;
        case 'cbrt': y = Math.cbrt(x); break;
        case 'sin': { const r = reduce(x); y = !rad && r % 180 === 0 ? 0 : Math.sin(toRad(r)); break; }
        case 'cos': { const r = reduce(x); y = !rad && (r === 90 || r === 270) ? 0 : Math.cos(toRad(r)); break; }
        case 'tan': { const r = reduce(x); if (!rad && r % 180 === 90) throw bad(); y = !rad && r % 180 === 0 ? 0 : Math.tan(toRad(r)); break; }
        case 'asin': y = Math.asin(x); y = rad ? y : (y * 180) / Math.PI; break;
        case 'acos': y = Math.acos(x); y = rad ? y : (y * 180) / Math.PI; break;
        case 'atan': y = Math.atan(x); y = rad ? y : (y * 180) / Math.PI; break;
        case 'log': y = Math.log10(x); break;
        case 'ln': y = Math.log(x); break;
        case 'tenpow': y = Math.pow(10, x); break;
        case 'exp': y = Math.exp(x); break;
        default: y = Math.abs(x);
      }
      return ok(y);
    };
    return { tok: [name, ...inner.tok, ')'], val };
  }

  function primary(d: number): N { return o.fns && d > 0 && chance(0.25) ? fn(d) : atom(d); }

  // a┘b : a is primary, b is atom (no functions, no chain)
  function fraction(d: number): N {
    const a = primary(d);
    if (!chance(0.18)) return a;
    const b = chance(0.1)
      ? (() => { const x = atom(d); return { tok: ['-', ...x.tok], val: () => -x.val() } as N; })()
      : atom(d);
    return { tok: [...a.tok, 'frac', ...b.tok], val: () => { const bv = b.val(); if (bv === 0) throw bad(); return a.val() / bv; } };
  }

  function unaryN(d: number): N {
    const r = rnd();
    if (r < 0.1) { const x = unaryN(d); return { tok: ['-', ...x.tok], val: () => -x.val() }; }
    if (r < 0.14) { const x = unaryN(d); return { tok: ['+', ...x.tok], val: x.val }; }
    return power(d);
  }

  function power(d: number): N {
    const base = fraction(d);
    if (!chance(0.15)) return base;
    const ex = d > 0 && chance(0.2) ? unaryN(d - 1) : (chance(0.2) ? (() => { const x = number(); return { tok: ['-', ...x.tok], val: () => -x.val() } as N; })() : smallNum());
    return { tok: [...base.tok, '^', ...ex.tok], val: () => ok(Math.pow(base.val(), ex.val())) };
  }
  function smallNum(): N { const s = String(ri(0, 6)); return { tok: [s], val: () => parseFloat(s) }; }

  // token-level merge guard: bare digit/'.' followed by digit/'.' would fuse into one number
  const fuse = (a: Token[], b: Token[]) => /^[0-9.]$/.test(a[a.length - 1]) && /^[0-9.]$/.test(b[0]);

  // implicit product: first operand then primaries with no operator between
  function implicitN(d: number): N {
    const first = unaryN(d);
    if (!chance(0.3)) return first;
    const parts: N[] = [first];
    const n = ri(1, 3);
    for (let k = 0; k < n; k++) {
      let next = power(d - 1);
      const prev = parts[parts.length - 1];
      if (fuse(prev.tok, next.tok)) next = { tok: ['(', ...next.tok, ')'], val: next.val };
      parts.push(next);
    }
    return {
      tok: parts.flatMap((p) => p.tok),
      val: () => parts.reduce((acc, p, idx) => (idx === 0 ? p.val() : acc * p.val()), 1),
    };
  }

  function termN(d: number): N {
    let acc = implicitN(d);
    const n = chance(0.45) ? ri(1, 3) : 0;
    for (let k = 0; k < n; k++) {
      const op = pick(['*', '/', 'par']);
      const r = implicitN(d);
      const l = acc;
      const toks = [...l.tok, op, ...r.tok];
      acc = {
        tok: toks,
        val: () => {
          const a = l.val(), b = r.val();
          if (op === '*') return a * b;
          if (op === '/') { if (b === 0) throw bad(); return a / b; }
          if (a + b === 0) throw bad();
          return (a * b) / (a + b);
        },
      };
    }
    return acc;
  }

  function expr(d: number): N {
    let acc = termN(d);
    const n = chance(0.55) ? ri(1, 3) : 0;
    for (let k = 0; k < n; k++) {
      const op = pick(['+', '-']);
      const r = termN(d);
      const l = acc;
      acc = { tok: [...l.tok, op, ...r.tok], val: () => (op === '+' ? l.val() + r.val() : l.val() - r.val()) };
    }
    return acc;
  }

  return () => expr(o.depth);
}

const close = (got: number, want: number, loose = false, label = '') => {
  const rel = loose ? 1e-6 : 1e-9;
  const tol = Math.max(Math.abs(want) * rel, loose ? 1e-9 : 1e-12);
  expect(Math.abs(got - want) <= tol, `${label} => got ${got}, want ${want}`).toBe(true);
};

function check(tokens: Token[], oracle: () => number, cfg: Cfg, loose: boolean) {
  let want: number | 'ERR';
  try { want = ok(oracle()); } catch (e) { if (e instanceof Err) want = 'ERR'; else throw e; }
  let got: number | 'ERR';
  try { got = evaluate(tokens, { angle: cfg.angle, ans: cfg.ans }); } catch (e) { if (e instanceof CalcError) got = 'ERR'; else throw e; }
  const label = tokens.join(' ') + '  [' + cfg.angle + ' ans=' + cfg.ans + ']';
  if (want === 'ERR') { expect(got, label).toBe('ERR'); return; }
  expect(got, label).not.toBe('ERR');
  const w = want as number, g = got as number;
  // overflow-adjacent: oracle/impl may legitimately differ only by float noise
  close(g, w, loose, label);
  // display must never crash or print Infinity/NaN
  for (const m of ['norm', 'eng'] as const) expect(formatResult(g, m), label).not.toMatch(/Infinity|NaN|undefined/);
}

const CATS: { name: string; n: number; seed: number; o: { big: boolean; small: boolean; fns: boolean; depth: number }; loose?: boolean }[] = [
  { name: 'plain arithmetic', n: 280, seed: 11, o: { big: false, small: false, fns: false, depth: 1 } },
  { name: 'nested groups', n: 220, seed: 22, o: { big: false, small: false, fns: false, depth: 3 } },
  { name: 'functions', n: 280, seed: 33, o: { big: false, small: false, fns: true, depth: 2 }, loose: true },
  { name: 'large numbers', n: 220, seed: 44, o: { big: true, small: false, fns: false, depth: 2 } },
  { name: 'small numbers', n: 220, seed: 55, o: { big: false, small: true, fns: false, depth: 2 } },
  { name: 'everything, deep', n: 200, seed: 66, o: { big: true, small: true, fns: true, depth: 4 }, loose: true },
];

describe('generated: random expressions vs AST oracle', () => {
  for (const c of CATS) {
    for (const angle of ['deg', 'rad'] as const) {
      it(`${c.name} (${angle}) x${c.n / 2}`, () => {
        const rnd = mulberry32(c.seed + (angle === 'rad' ? 1000 : 0));
        for (let i = 0; i < c.n / 2; i++) {
          const cfg: Cfg = { angle, ans: pickAns(rnd) };
          const t = build(rnd, cfg, c.o)();
          if (t.tok.length > 400) continue; // keep cases human-sized
          check(t.tok, t.val, cfg, !!c.loose);
        }
      });
    }
  }
});

function pickAns(rnd: () => number) {
  const a = [0, 1, -1, 2.5, 42, -7.25, 1e6, 3e-5, 1e100, -1e-100, 123456.789];
  return a[Math.floor(rnd() * a.length)];
}

// Per-case visible tests so the count is real: ~1300 expressions each run independently.
describe('generated: individually enumerated cases', () => {
  const cases: { id: string; tok: Token[]; val: () => number; cfg: Cfg; loose: boolean }[] = [];
  for (const c of CATS) {
    const rnd = mulberry32(c.seed * 7919);
    for (let i = 0; i < c.n; i++) {
      const cfg: Cfg = { angle: i % 2 ? 'rad' : 'deg', ans: pickAns(rnd) };
      const t = build(rnd, cfg, c.o)();
      if (t.tok.length > 400) continue;
      cases.push({ id: `${c.name} #${i}`, tok: t.tok, val: t.val, cfg, loose: !!c.loose });
    }
  }
  it('enumerates >= 1000 cases', () => expect(cases.length).toBeGreaterThanOrEqual(1000));
  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => check(c.tok, c.val, c.cfg, c.loose));
});

// ---------- hand-written: implicit multiplication & fraction precedence ----------
const tk = (s: string): Token[] => {
  const out: Token[] = [];
  const re = /\{(\w+)\}|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
  return out;
};
const ev = (s: string, ans = 0, angle: 'deg' | 'rad' = 'deg') => evaluate(tk(s), { angle, ans });
const near = (a: number, b: number) => expect(Math.abs(a - b) <= Math.abs(b) * 1e-12 + 1e-300, `${a} vs ${b}`).toBe(true);
const PI = Math.PI;

describe('implicit multiplication and a┘b precedence', () => {
  it('1/2pi = 1/(2*pi)', () => near(ev('1/2{pi}'), 1 / (2 * PI)));
  it('1┘2pi = 0.5*pi', () => near(ev('1{frac}2{pi}'), 0.5 * PI));
  it('1┘2k = 1/(2k)', () => near(ev('1{frac}2k'), 1 / 2000));
  it('1/2k = 1/2000 (SI binds to number)', () => near(ev('1/2k'), 1 / 2000));
  it('6/2(1+2) = 1 (implicit first)', () => near(ev('6/2(1+2)'), 1));
  it('6*2(1+2) = 36', () => near(ev('6*2(1+2)'), 36));
  it('1/2pi*3 = 3/(2pi)', () => near(ev('1/2{pi}*3'), 3 / (2 * PI)));
  it('1/2pi/3 = 1/(2pi)/3', () => near(ev('1/2{pi}/3'), 1 / (2 * PI) / 3));
  it('2pi/3 = (2pi)/3', () => near(ev('2{pi}/3'), (2 * PI) / 3));
  it('2pi3 = 6pi', () => near(ev('2{pi}3'), 6 * PI));
  it('pi2 = 2pi', () => near(ev('{pi}2'), 2 * PI));
  it('pi pi = pi^2', () => near(ev('{pi}{pi}'), PI * PI));
  it('2pi^2 = 2*(pi^2)', () => near(ev('2{pi}^2'), 2 * PI * PI));
  it('3(4) = 12', () => near(ev('3(4)'), 12));
  it('(3)(4) = 12', () => near(ev('(3)(4)'), 12));
  it('(1+2)(3+4) = 21', () => near(ev('(1+2)(3+4)'), 21));
  it('2sin(30) = 1 (deg)', () => near(ev('2{sin}30)'), 1));
  it('1/2sin(30) = 1', () => near(ev('1/2{sin}30)'), 1));
  it('2e = 2*e', () => near(ev('2{e}'), 2 * Math.E));
  it('2Ans', () => near(ev('2{ans}', 21), 42));
  it('Ans2', () => near(ev('{ans}2', 21), 42));
  it('1/2Ans = 1/(2*Ans)', () => near(ev('1/2{ans}', 4), 1 / 8));
  it('2pi k? 2k pi = 2000pi', () => near(ev('2k{pi}'), 2000 * PI));
  it('1/2k pi = 1/(2000pi)', () => near(ev('1/2k{pi}'), 1 / (2000 * PI)));
  it('1┘2k pi = pi/2000', () => near(ev('1{frac}2k{pi}'), (1 / 2000) * PI));
  it('pi┘2 = pi/2', () => near(ev('{pi}{frac}2'), PI / 2));
  it('2pi┘4 = 2*pi/4 -> (2*(pi/4))', () => near(ev('2{pi}{frac}4'), 2 * (PI / 4)));
  it('1┘2^2 = (1/2)^2', () => near(ev('1{frac}2^2'), 0.25));
  it('1┘(2+3)pi', () => near(ev('1{frac}(2+3){pi}'), 0.2 * PI));
  it('1┘-2 = -0.5', () => near(ev('1{frac}-2'), -0.5));
  it('2┘3┘4 is a syntax error (no chain)', () => expect(() => ev('2{frac}3{frac}4')).toThrow(CalcError));
  it('1┘0 math error', () => expect(() => ev('1{frac}0')).toThrow(CalcError));
  it('1/2pi vs 1┘2pi differ', () => expect(ev('1/2{pi}')).not.toBeCloseTo(ev('1{frac}2{pi}'), 3));
  it('2pi∥3 parallel of 2pi and 3', () => near(ev('2{pi}{par}3'), (2 * PI * 3) / (2 * PI + 3)));
  it('1/2 3 = 1/6 (implicit digits via group)', () => near(ev('1/2(3)'), 1 / 6));
  it('-2pi = -(2pi)', () => near(ev('-2{pi}'), -2 * PI));
  it('2(-3) = -6', () => near(ev('2(-3)'), -6));
  it('2-3pi', () => near(ev('2-3{pi}'), 2 - 3 * PI));
  it('4.7k2.2u = 4700*2.2e-6', () => near(ev('4.7k2.2u'), 4700 * 2.2e-6));
  it('Ans x10^2', () => near(ev('{ans}E2', 5), 500));
  it('Ans x10^-2', () => near(ev('{ans}E-2', 5), 0.05));
  it('pi x10^3', () => near(ev('{pi}E3'), PI * 1000));
  it('(1+2)x10^2 = 300', () => near(ev('(1+2)E2'), 300));
  it('2x10^3pi = 2000pi', () => near(ev('2E3{pi}'), 2000 * PI));
  it('1/2x10^3 = 1/2000', () => near(ev('1/2E3'), 1 / 2000));
  it('x10^ with no digits = syntax error', () => expect(() => ev('2E')).toThrow(CalcError));
  it('Ans x10^ with no digits = syntax error', () => expect(() => ev('{ans}E', 5)).toThrow(CalcError));
  it('trailing operator is a syntax error', () => expect(() => ev('2+')).toThrow(CalcError));
  it('empty is a syntax error', () => expect(() => ev('')).toThrow(CalcError));
  it('stray ) is a syntax error', () => expect(() => ev('2)')).toThrow(CalcError));
  it('missing ) auto-closes', () => near(ev('(2+3'), 5));
  it('1..2 syntax error', () => expect(() => ev('1..2')).toThrow(CalcError));
  it('lone . syntax error', () => expect(() => ev('.')).toThrow(CalcError));
});

// ---------- operator-mix table: digits + symbols ----------
describe('mixed digits and symbols table', () => {
  const rows: [string, number][] = [
    ['2+3*4', 14], ['(2+3)*4', 20], ['2*3+4*5', 26], ['10-2-3', 5], ['100/10/2', 5], ['2^3^2', 512], ['-2^2', -4], ['(-2)^2', 4],
    ['2^-1', 0.5], ['1+2+3+4+5+6+7+8+9+10', 55], ['9*9*9*9', 6561], ['1/4+1/4', 0.5], ['0.1*3', 0.3], ['3.5*2', 7],
    ['1k+1', 1001], ['1M/1k', 1000], ['1G*1n', 1], ['1T*1p', 1], ['1m*1k', 1], ['5u*2M', 10], ['1f*1T', 0.001], ['2k*3k', 6e6],
    ['{sqrt}16)', 4], ['{sqrt}16)+1', 5], ['{cbrt}27)', 3], ['{cbrt}-8)', -2], ['{abs}-5)', 5], ['{log}1000)', 3], ['{ln}1)', 0],
    ['{tenpow}2)', 100], ['{exp}0)', 1], ['{sin}30)', 0.5], ['{cos}60)', 0.5], ['{tan}45)', 1], ['{sin}0)', 0], ['{cos}90)', 0],
    ['{sin}180)', 0], ['{sin}90)', 1], ['{cos}180)', -1], ['{cos}0)', 1], ['{tan}180)', 0], ['{asin}1)', 90], ['{acos}0)', 90], ['{atan}1)', 45],
    ['{sin}390)', 0.5], ['{sin}-30)', -0.5], ['{sin}720)', 0], ['{cos}360000)', 1],
    ['2{sqrt}9)', 6], ['{sqrt}4){sqrt}9)', 6], ['3{abs}-2)', 6], ['(1+1)(2+2)(3+3)', 48],
    ['1E3', 1000], ['1E-3', 0.001], ['2.5E2', 250], ['1E3+1E3', 2000], ['1E3*1E-3', 1], ['5E0', 5],
    ['1{par}1', 0.5], ['2{par}2{par}2', 2 / 3],
    ['0.5+0.25+0.125', 0.875], ['((((1))))', 1], ['((1+2)*(3+4))', 21], ['2*(3+(4*(5+6)))', 94],
  ];
  it.each(rows)('%s', (s, want) => near(ev(s), want === 0 ? 0 : want) );
});

// ---------- large / small numbers and computation limits ----------
describe('range limits (documented in README)', () => {
  it('large-angle trig keeps precision', () => { expect(Math.abs(ev('{sin}3.6E14+30)') - 0.5) < 1e-9).toBe(true); expect(Math.abs(ev('{cos}3.6E14+60)') - 0.5) < 1e-9).toBe(true); });
  it('1E308 ok', () => near(ev('1E308'), 1e308));
  it('largest double ok', () => near(ev('1.7976931348623157E308'), Number.MAX_VALUE));
  it('1E309 = Math Error', () => expect(() => ev('1E309')).toThrow(CalcError));
  it('9^9^9 overflow = Math Error', () => expect(() => ev('9^9^9')).toThrow(CalcError));
  it('1E308*10 = Math Error', () => expect(() => ev('1E308*10')).toThrow(CalcError));
  it('2^1023 ok / 2^1024 error', () => { near(ev('2^1023'), 2 ** 1023); expect(() => ev('2^1024')).toThrow(CalcError); });
  it('10^308 via tenpow ok / 309 error', () => { near(ev('{tenpow}308)'), 1e308); expect(() => ev('{tenpow}309)')).toThrow(CalcError); });
  it('e^709 ok / e^710 error', () => { expect(ev('{exp}709)')).toBeGreaterThan(1e307); expect(() => ev('{exp}710)')).toThrow(CalcError); });
  it('smallest subnormal 5E-324 ok', () => expect(ev('5E-324')).toBe(5e-324));
  it('below that underflows to 0', () => expect(ev('1E-324')).toBe(0));
  it('2^-1074 ok / 2^-1075 = 0', () => { expect(ev('2^-1074')).toBe(5e-324); expect(ev('2^-1075')).toBe(0); });
  it('1E308 formats', () => expect(formatResult(1e308, 'norm')).toBe('1×10³⁰⁸'));
  it('MAX_VALUE formats (was Infinity×10NaN)', () => expect(formatResult(Number.MAX_VALUE, 'norm')).toBe('1.797693135×10³⁰⁸'));
  it('MAX_VALUE eng formats', () => expect(formatResult(Number.MAX_VALUE, 'eng')).toBe('1.797693135×10³⁰⁸'));
  it('subnormal formats', () => expect(formatResult(5e-324, 'norm')).toBe('4.940656458×10⁻³²⁴'));
  it('1E308+1E308 = Math Error', () => expect(() => ev('1E308+1E308')).toThrow(CalcError));
  it('1E308-1E308 = 0', () => expect(ev('1E308-1E308')).toBe(0));
  it('308-digit integer ok, 309-digit error', () => {
    near(ev('1' + '0'.repeat(308)), 1e308);
    expect(() => ev('1' + '0'.repeat(309))).toThrow(CalcError);
  });
  it('1T^25 = 1e300 via 25 products', () => near(ev(Array(25).fill('1T').join('*')), 1e300));
  it('10000-term sum', () => near(ev(Array(10000).fill('1').join('+')), 10000));
  it('1,000,000-term sum', () => near(ev(Array(1_000_000).fill('1').join('+')), 1_000_000));
  it('1000 nested parens ok', () => near(ev('('.repeat(1000) + '1' + ')'.repeat(1000)), 1));
  it('50000 nested parens = Stack Error, not a crash', () => {
    try { ev('('.repeat(50000) + '1' + ')'.repeat(50000)); throw new Error('no throw'); }
    catch (e) { expect(e).toBeInstanceOf(CalcError); expect((e as CalcError).kind).toBe('Stack Error'); }
  });
  it('100000 stacked unary minus = Stack Error', () => expect(() => ev('-'.repeat(100000) + '1')).toThrow(CalcError));
  it('20000 chained powers = Stack Error', () => expect(() => ev('1^'.repeat(20000) + '1')).toThrow(CalcError));
  it('precision: 10 sig digits displayed', () => expect(formatResult(1 / 3, 'norm')).toBe('0.3333333333'));
  it('0.1+0.2 shows 0.3', () => expect(formatResult(ev('0.1+0.2'), 'norm')).toBe('0.3'));
  it('1E10 switches to scientific', () => expect(formatResult(1e10, 'norm')).toBe('1×10¹⁰'));
  it('9999999999 stays plain', () => expect(formatResult(9999999999, 'norm')).toBe('9999999999'));
  it('0.0001 plain, 0.00009 scientific', () => { expect(formatResult(0.0001, 'norm')).toBe('0.0001'); expect(formatResult(0.00009, 'norm')).toBe('9×10⁻⁵'); });
  it('eng: 4.7k', () => expect(formatResult(4700, 'eng')).toBe('4.7 k'));
  it('eng: 2.2u', () => expect(formatResult(2.2e-6, 'eng')).toBe('2.2 µ'));
  it('eng: beyond T falls back to scientific', () => expect(formatResult(1e15, 'eng')).toBe('1×10¹⁵'));
});
