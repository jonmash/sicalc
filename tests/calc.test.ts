import { describe, it, expect } from 'vitest';
import { evaluate, formatResult, CalcError, type Token } from '../src/calc';

// Build tokens from a compact string. Multi-char tokens in braces: {pi}{frac}
const tk = (s: string): Token[] => {
  const out: Token[] = [];
  const re = /\{(\w+)\}|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
  return out;
};
const ev = (s: string, angle: 'deg' | 'rad' = 'deg', ans = 0) => evaluate(tk(s), { angle, ans });
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('arithmetic', () => {
  it('basic', () => {
    expect(ev('1+2*3')).toBe(7);
    expect(ev('(1+2)*3')).toBe(9);
    expect(ev('10/4')).toBe(2.5);
    expect(ev('2^3^2')).toBe(512);
    expect(ev('-2^2')).toBe(-4);
    expect(ev('2^-2')).toBe(0.25);
    expect(ev('2*(3+4')).toBe(14); // auto-close
  });
  it('implicit multiplication', () => {
    close(ev('2{pi}'), 2 * Math.PI);
    expect(ev('3(4)')).toBe(12);
    close(ev('2{sin}90)'), 2);
  });
  it('errors', () => {
    expect(() => ev('1/0')).toThrow(CalcError);
    expect(() => ev('1+')).toThrow(CalcError);
    expect(() => ev('{sqrt}-1)')).toThrow(CalcError);
    expect(() => ev('1.2.3')).toThrow(CalcError);
    expect(() => ev('2)')).toThrow(CalcError);
  });
});

describe('SI suffixes', () => {
  it('basic', () => {
    expect(ev('1k')).toBe(1000);
    expect(ev('4.7k')).toBe(4700);
    expect(ev('2.2u')).toBe(2.2e-6);
    expect(ev('100n')).toBe(1e-7);
    expect(ev('1M+1k')).toBe(1001000);
    expect(ev('10m*5k')).toBe(50);
  });
  it('suffix is part of the number: 1/2k = 1/(2k)', () => {
    expect(ev('1/2k')).toBe(1 / 2000);
  });
  it('time constant', () => {
    close(ev('10k*100n'), 1e-3);
  });
  it('EXP', () => {
    expect(ev('1.5{E}3')).toBe(1500);
    expect(ev('1.5{E}-3')).toBe(0.0015);
  });
});

describe('fraction key', () => {
  it('1┘2k = 1/(2k)', () => {
    expect(ev('1{frac}2k')).toBe(1 / 2000);
  });
  it('binds tighter than division and multiplication', () => {
    expect(ev('1/1{frac}4')).toBe(4);       // 1 / (1/4)
    expect(ev('1{frac}2{pi}')).toBeCloseTo(Math.PI / 2, 9); // (1/2)*pi
    expect(ev('3*1{frac}2')).toBe(1.5);
  });
  it('power applies to whole fraction', () => {
    expect(ev('1{frac}2^2')).toBe(0.25);
  });
  it('parenthesised denominator', () => {
    expect(ev('1{frac}(2+3)')).toBe(0.2);
  });
  it('division by zero', () => {
    expect(() => ev('1{frac}0')).toThrow(CalcError);
  });
});

describe('functions', () => {
  it('trig deg', () => {
    expect(ev('{sin}180)')).toBe(0);
    expect(ev('{cos}90)')).toBe(0);
    expect(ev('{sin}30)')).toBeCloseTo(0.5, 12);
    expect(ev('{tan}45)')).toBeCloseTo(1, 12);
    expect(() => ev('{tan}90)')).toThrow(CalcError);
  });
  it('trig rad', () => {
    close(ev('{sin}{pi}{frac}2)', 'rad'), 1);
  });
  it('inverse', () => {
    close(ev('{asin}0.5)'), 30);
    close(ev('{atan}1)'), 45);
    close(ev('{acos}0)', 'rad'), Math.PI / 2);
  });
  it('log / ln / pow', () => {
    expect(ev('{log}1k)')).toBeCloseTo(3, 12);
    expect(ev('{ln}1)')).toBe(0);
    expect(ev('{tenpow}3)')).toBeCloseTo(1000, 9);
    expect(ev('{exp}1)')).toBeCloseTo(Math.E, 12);
    expect(() => ev('{ln}0)')).toThrow(CalcError);
  });
  it('sqrt', () => {
    expect(ev('{sqrt}16)')).toBe(4);
    expect(ev('{sqrt}16)+1')).toBe(5);
  });
  it('exp suffix after Ans, constants and groups', () => {
    expect(ev('{ans}E2', 'deg', 5)).toBe(500);
    expect(ev('{ans}E-2', 'deg', 5)).toBe(0.05);
    expect(ev('(1+2)E2')).toBe(300);
    close(ev('{pi}E1'), Math.PI * 10);
    expect(() => ev('{ans}E', 'deg', 5)).toThrow(CalcError);
  });

  it('ans', () => {
    expect(ev('{ans}*2', 'deg', 21)).toBe(42);
  });
  it('parallel', () => {
    expect(ev('10k{par}10k')).toBe(5000);
    close(ev('1k{par}2k{par}3k'), 1000 * 2000 * 3000 / (1000 * 2000 + 1000 * 3000 + 2000 * 3000));
  });
});

describe('formatting', () => {
  it('norm', () => {
    expect(formatResult(0.1 + 0.2, 'norm')).toBe('0.3');
    expect(formatResult(4700, 'norm')).toBe('4700');
    expect(formatResult(1 / 3, 'norm')).toBe('0.3333333333');
    expect(formatResult(1.5e-6, 'norm')).toBe('1.5×10⁻⁶');
    expect(formatResult(1.2345e12, 'norm')).toBe('1.2345×10¹²');
    expect(formatResult(-2e-7, 'norm')).toBe('-2×10⁻⁷');
    expect(formatResult(0, 'norm')).toBe('0');
  });
  it('eng', () => {
    expect(formatResult(4700, 'eng')).toBe('4.7 k');
    expect(formatResult(2.2e-3, 'eng')).toBe('2.2 m');
    expect(formatResult(1e-6, 'eng')).toBe('1 µ');
    expect(formatResult(0.5, 'eng')).toBe('500 m');
    expect(formatResult(15, 'eng')).toBe('15');
    expect(formatResult(999.99999999999, 'eng')).toBe('1 k');
    expect(formatResult(1e20, 'eng')).toBe('1×10²⁰');
  });
});
