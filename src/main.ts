import './style.css';
import { evaluate, formatResult, labelOf, isSI, CalcError, type Token, type AngleMode, type OutputMode } from './calc';

type Action = 'shift' | 'left' | 'right' | 'del' | 'ac' | 'eq';
interface Key {
  label: string;            // face label
  ins?: Token[];            // tokens inserted
  sLabel?: string;          // shifted label (shown above key)
  sIns?: Token[];           // tokens inserted when shifted
  act?: Action;
  cls?: string;
}

const k = (label: string, ins: Token[], cls = '', sLabel?: string, sIns?: Token[]): Key => ({ label, ins, cls, sLabel, sIns });

const KEYS: Key[] = [
  { label: 'SHIFT', act: 'shift', cls: 'shift' }, { label: '◀', act: 'left', cls: 'op' }, { label: '▶', act: 'right', cls: 'op' },
  { label: 'DEL', act: 'del', cls: 'del' }, { label: 'AC', act: 'ac', cls: 'del' },

  k('x²', ['^', '2'], '', 'x⁻¹', ['^', '(', '-', '1', ')']),
  k('√', ['sqrt'], '', '∛', ['cbrt']),
  k('^', ['^'], '', '∥', ['par']),
  k('log', ['log'], '', '10ˣ', ['tenpow']),
  k('ln', ['ln'], '', 'eˣ', ['exp']),

  k('sin', ['sin'], '', 'sin⁻¹', ['asin']),
  k('cos', ['cos'], '', 'cos⁻¹', ['acos']),
  k('tan', ['tan'], '', 'tan⁻¹', ['atan']),
  k('π', ['pi'], '', 'e', ['e']),
  k('a┘b', ['frac'], '', 'Abs', ['abs']),

  k('k', ['k'], 'si'), k('M', ['M'], 'si'), k('G', ['G'], 'si'), k('T', ['T'], 'si'),
  k('Ans', ['ans'], 'op'),

  k('m', ['m'], 'si'), k('µ', ['u'], 'si'), k('n', ['n'], 'si'), k('p', ['p'], 'si', 'f', ['f']),
  k('×10ˣ', ['E'], 'op'),

  k('7', ['7'], 'num'), k('8', ['8'], 'num'), k('9', ['9'], 'num'), k('(', ['('], 'op'), k(')', [')'], 'op'),
  k('4', ['4'], 'num'), k('5', ['5'], 'num'), k('6', ['6'], 'num'), k('×', ['*'], 'op'), k('÷', ['/'], 'op'),
  k('1', ['1'], 'num'), k('2', ['2'], 'num'), k('3', ['3'], 'num'), k('+', ['+'], 'op'), k('−', ['-'], 'op'),
  k('0', ['0'], 'num'), k('.', ['.'], 'num'), { label: '=', act: 'eq', cls: 'eq' },
];

// ---------- state ----------
interface Settings { angle: AngleMode; out: OutputMode; }
const store = {
  get<T>(key: string, d: T): T { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } },
};

let settings: Settings = store.get('sicalc.settings', { angle: 'deg', out: 'norm' });
let ans: number = store.get('sicalc.ans', 0);
let tokens: Token[] = [];
let cursor = 0;
let shift = false;
let justEval = false;
let lastValue: number | null = null;
let errorMsg = '';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const exprEl = $('expr'), resultEl = $('result'), keysEl = $('keys');

// Tokens that make sense as a continuation of the previous answer.
const CONTINUES = new Set(['+', '-', '*', '/', '^', 'par', 'frac']);

function insert(ts: Token[]) {
  if (justEval) {
    if (CONTINUES.has(ts[0])) { tokens = ['ans']; cursor = 1; }
    else { tokens = []; cursor = 0; }
    justEval = false;
  }
  errorMsg = '';
  lastValue = null;
  tokens.splice(cursor, 0, ...ts);
  cursor += ts.length;
}

function evaluateNow() {
  try {
    const v = evaluate(tokens, { angle: settings.angle, ans });
    ans = v; lastValue = v; errorMsg = ''; justEval = true;
    store.set('sicalc.ans', ans);
  } catch (e) {
    lastValue = null;
    errorMsg = e instanceof CalcError ? e.kind : 'Math Error';
  }
}

function press(key: Key) {
  if (navigator.vibrate) navigator.vibrate(8);
  switch (key.act) {
    case 'shift': shift = !shift; break;
    case 'left': justEval = false; cursor = Math.max(0, cursor - 1); break;
    case 'right': justEval = false; cursor = Math.min(tokens.length, cursor + 1); break;
    case 'del':
      if (justEval) { justEval = false; cursor = tokens.length; }
      if (cursor > 0) { tokens.splice(cursor - 1, 1); cursor--; }
      errorMsg = ''; lastValue = null;
      break;
    case 'ac': tokens = []; cursor = 0; justEval = false; errorMsg = ''; lastValue = null; break;
    case 'eq': evaluateNow(); break;
    default: {
      const ins = shift && key.sIns ? key.sIns : key.ins!;
      insert(ins);
    }
  }
  if (key.act !== 'shift') shift = false;
  render();
}

// ---------- rendering ----------
function render() {
  exprEl.textContent = '';
  const mkCursor = () => { const c = document.createElement('span'); c.className = 'cur'; return c; };
  let inExp = false; // after ×10: digits and minus are superscripted
  tokens.forEach((t, idx) => {
    if (idx === cursor) exprEl.appendChild(mkCursor());
    const s = document.createElement('span');
    s.className = 't';
    s.textContent = labelOf(t);
    s.dataset.i = String(idx);
    if (t === 'E') inExp = true;
    else if (inExp && (/^[0-9]$/.test(t) || (t === '-' && tokens[idx - 1] === 'E'))) s.classList.add('exp');
    else inExp = false;
    if (isSI(t)) s.classList.add('si');
    else if (t === 'pi' || t === 'e' || t === 'ans') s.classList.add('const');
    else if (t === 'frac') s.classList.add('frac');
    else if (t.length > 1 && labelOf(t).endsWith('(')) s.classList.add('fn');
    exprEl.appendChild(s);
  });
  if (cursor >= tokens.length) exprEl.appendChild(mkCursor());
  const tail = document.createElement('span'); tail.className = 'tail'; exprEl.appendChild(tail);
  const cur = exprEl.querySelector('.cur'); if (cur) (cur as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });

  resultEl.className = errorMsg ? 'err' : '';
  resultEl.textContent = errorMsg || (lastValue !== null ? formatResult(lastValue, settings.out) : '');
  $('ind-shift').textContent = shift ? 'SHIFT' : '';
  $('ind-angle').textContent = settings.angle === 'deg' ? 'DEG' : 'RAD';
  keysEl.classList.toggle('shifted', shift);
}

function buildKeys() {
  for (const key of KEYS) {
    const b = document.createElement('button');
    b.className = `k ${key.cls ?? ''}`;
    if (key.sIns) b.dataset.sh = '1';
    if (key.sLabel) { const s = document.createElement('span'); s.className = 's'; s.textContent = key.sLabel; b.appendChild(s); }
    b.appendChild(document.createTextNode(key.label));
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); press(key); });
    b.addEventListener('click', (ev) => ev.preventDefault());
    if (key.act === 'shift') b.id = 'shift-key';
    keysEl.appendChild(b);
  }
}

// Tap on a token to put the cursor before/after it.
exprEl.addEventListener('pointerdown', (ev) => {
  const t = (ev.target as HTMLElement).closest('.t') as HTMLElement | null;
  justEval = false;
  if (t) {
    const r = t.getBoundingClientRect();
    const i = Number(t.dataset.i);
    cursor = ev.clientX > r.left + r.width / 2 ? i + 1 : i;
  } else cursor = tokens.length;
  render();
});

// Tap result to flip Norm <-> Eng.
resultEl.addEventListener('click', () => {
  if (lastValue === null) return;
  settings.out = settings.out === 'norm' ? 'eng' : 'norm';
  store.set('sicalc.settings', settings);
  render(); syncMenu();
});

// ---------- menu ----------
const menu = $('menu');
function syncMenu() {
  menu.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    const name = seg.dataset.setting as keyof Settings;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings[name]));
  });
}
menu.querySelectorAll<HTMLElement>('.seg button').forEach((b) => b.addEventListener('click', () => {
  const name = (b.parentElement as HTMLElement).dataset.setting as keyof Settings;
  (settings as unknown as Record<string, string>)[name] = b.dataset.v!;
  store.set('sicalc.settings', settings); syncMenu(); render();
}));
$('menu-btn').addEventListener('click', () => { syncMenu(); menu.hidden = false; });
$('menu-close').addEventListener('click', () => { menu.hidden = true; });
menu.addEventListener('click', (e) => { if (e.target === menu) menu.hidden = true; });

// Hardware keyboard (desktop use / testing)
const KB: Record<string, Token[]> = { '+': ['+'], '-': ['-'], '*': ['*'], '/': ['/'], '^': ['^'], '(': ['('], ')': [')'], '.': ['.'] };
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) press({ label: e.key, ins: [e.key] });
  else if (e.key in KB) press({ label: e.key, ins: KB[e.key] });
  else if (e.key === 'Enter' || e.key === '=') press({ label: '=', act: 'eq' });
  else if (e.key === 'Backspace') press({ label: 'DEL', act: 'del' });
  else if (e.key === 'Escape') press({ label: 'AC', act: 'ac' });
  else if (e.key === 'ArrowLeft') press({ label: '◀', act: 'left' });
  else if (e.key === 'ArrowRight') press({ label: '▶', act: 'right' });
  else if (e.key === 'p') press({ label: 'π', ins: ['pi'] });
  else if (['k', 'M', 'G', 'T', 'm', 'n', 'u'].includes(e.key)) press({ label: e.key, ins: [e.key] });
  else return;
  e.preventDefault();
});

buildKeys();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline cache is optional */ });
}
