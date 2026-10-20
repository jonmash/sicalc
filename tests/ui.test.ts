// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

function press(label: string, shifted = false) {
  const keys = [...document.querySelectorAll<HTMLElement>('.k')];
  const fire = (el: Element) => el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  if (shifted) fire(document.getElementById('shift-key')!);
  const b = keys.find((k) => k.textContent!.replace(k.querySelector('.s')?.textContent ?? '', '') === label);
  if (!b) throw new Error('no key ' + label);
  fire(b);
}
const run = (...items: (string | [string])[]) => items.forEach((i) => (Array.isArray(i) ? press(i[0], true) : press(i)));
const expr = () => document.getElementById('expr')!.textContent!;
const result = () => document.getElementById('result')!.textContent!;

beforeAll(async () => {
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = html.replace(/[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*/, '');
  await import('../src/main');
});

describe('keypad UI', () => {
  it('1┘2k', () => { run('1', 'a┘b', '2', 'k', '='); expect(expr()).toBe('1┘2k'); expect(result()).toBe('0.0005'); });
  it('SI parts', () => { run('AC', '4', '.', '7', 'k', '×', '2', '.', '2', 'µ', '='); expect(expr()).toBe('4.7k×2.2µ'); expect(result()).toBe('0.01034'); });
  it('Ans continues', () => { run('×', '2', '='); expect(expr()).toBe('Ans×2'); expect(result()).toBe('0.02068'); });
  it('pi shown', () => { run('AC', '2', 'π', '='); expect(expr()).toBe('2π'); expect(result()).toBe('6.283185307'); });
  it('EXP', () => { run('AC', '1', '.', '5', '×10ˣ', '−', '6', '×', '2', '='); expect(result()).toBe('3×10⁻⁶'); });
  it('shift: parallel', () => { run('AC', '1', '0', 'k', ['^'], '1', '0', 'k', '='); expect(expr()).toBe('10k∥10k'); expect(result()).toBe('5000'); });
  it('shift: asin', () => { run('AC', ['sin'], '0', '.', '5', '='); expect(expr()).toBe('sin⁻¹(0.5'); expect(result()).toBe('30'); });
  it('x² and sqrt', () => { run('AC', '1', '2', 'x²', '='); expect(result()).toBe('144'); run('AC', '√', '1', '6', '='); expect(result()).toBe('4'); });
  it('DEL removes whole symbol', () => { run('AC', '2', 'π', 'DEL'); expect(expr()).toBe('2'); });
  it('cursor editing', () => { run('AC', '1', '2', '◀', '5'); expect(expr()).toBe('152'); });
  it('error', () => { run('AC', '1', '÷', '0', '='); expect(result()).toBe('Math Error'); });
  it('tap result toggles eng', () => { run('AC', '4', '.', '7', 'k', '='); document.getElementById('result')!.click(); expect(result()).toBe('4.7 k'); });
});
