// @vitest-environment jsdom
// Drives the real keypad (jsdom) for the cases reported from the phone, plus key-mix combos.
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
const seq = (s: string) => {
  // space-separated key labels; "^s" = shifted variant written as "S:label"
  s.split(' ').forEach((w) => (w.startsWith('S:') ? press(w.slice(2), true) : press(w)));
};
const result = () => document.getElementById('result')!.textContent!;
const expr = () => document.getElementById('expr')!.textContent!;

beforeAll(async () => {
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = html.replace(/[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*/, '');
  await import('../src/main');
});

const T: [string, string, string][] = [
  // [keys, shown expression, result]
  ['1 ÷ 2 π =', '1÷2π', '0.1591549431'],
  ['1 a┘b 2 π =', '1┘2π', '1.570796327'],
  ['1 ÷ 2 k =', '1÷2k', '0.0005'],
  ['1 a┘b 2 k =', '1┘2k', '0.0005'],
  ['2 π =', '2π', '6.283185307'],
  ['2 π ÷ 3 =', '2π÷3', '2.094395102'],
  ['6 ÷ 2 ( 1 + 2 ) =', '6÷2(1+2)', '1'],
  ['( 1 + 2 ) ( 3 + 4 ) =', '(1+2)(3+4)', '21'],
  ['2 sin 3 0 ) =', '2sin(30)', '1'],
  ['1 ÷ 2 sin 3 0 ) =', '1÷2sin(30)', '1'],
  ['5 =', '5', '5'],
  ['Ans ×10ˣ 2 =', 'Ans×102', '500'],
  ['Ans ×10ˣ − 2 =', 'Ans×10−2', '5'],
  ['3 ×10ˣ 3 =', '3×103', '3000'],
  ['1 . 5 ×10ˣ 3 π =', '1.5×103π', '4712.38898'],
  ['π ×10ˣ 3 =', 'π×103', '3141.592654'],
  ['( 1 + 2 ) ×10ˣ 2 =', '(1+2)×102', '300'],
  ['9 9 9 9 9 9 9 9 9 9 × 9 9 9 9 9 9 9 9 9 9 =', '9999999999×9999999999', '9.999999998×10¹⁹'],
  ['1 ×10ˣ 3 0 8 =', '1×10308', '1×10³⁰⁸'],
  ['1 ×10ˣ 3 0 9 =', '1×10309', 'Math Error'],
  ['1 ×10ˣ − 3 2 3 =', '1×10−323', '9.881312917×10⁻³²⁴'],
  ['2 ^ 1 0 2 3 =', '2^1023', '8.988465674×10³⁰⁷'],
  ['2 ^ 1 0 2 4 =', '2^1024', 'Math Error'],
  ['1 ÷ 0 =', '1÷0', 'Math Error'],
  ['2 + =', '2+', 'Syntax Error'],
  ['2 ×10ˣ =', '2×10', 'Syntax Error'],
  ['4 . 7 k × 2 . 2 µ =', '4.7k×2.2µ', '0.01034'],
  ['1 0 k S:^ 1 0 k =', '10k∥10k', '5000'],
  ['S:sin 0 . 5 =', 'sin⁻¹(0.5', '30'],
  ['S:√ 2 7 =', '∛(27', '3'],
  ['S:log 2 =', '10^(2', '100'],
  ['S:ln 0 =', 'e^(0', '1'],
  ['1 2 x² =', '12^2', '144'],
  ['4 S:x² =', '4^(−1)', '0.25'],
  ['2 π x² =', '2π^2', '19.7392088'],
  ['( 2 + 3 ) x² =', '(2+3)^2', '25'],
  ['S:a┘b − 5 =', 'Abs(−5', '5'],
  ['1 0 ÷ 4 =', '10÷4', '2.5'],
  ['. 1 + . 2 =', '.1+.2', '0.3'],
  ['2 π k =', '2πk', 'Syntax Error'],
  ['2 k π =', '2kπ', '6283.185307'],
  ['1 ÷ 2 k π =', '1÷2kπ', '0.0001591549431'],
  ['1 a┘b 2 k π =', '1┘2kπ', '0.001570796327'],
  ['S:π 2 =', 'e2', '5.436563657'],
  ['2 S:π =', '2e', '5.436563657'],
];

describe('keypad: mixed digits, symbols and implied operators', () => {
  it.each(T)('%s', (keys, shown, want) => {
    press('AC');
    seq(keys);
    expect(expr()).toBe(shown);
    expect(result()).toBe(want);
  });
});
