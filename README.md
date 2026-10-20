# SI Calc

Scientific calculator with FX-991MS-style SI prefix keys (k M G T m µ n p f), π, Ans, shift layer.
Token-based expression model (src/calc.ts), vanilla TS UI (src/main.ts), Capacitor wrapper.

- `npm run dev` / `npm test` / `npm run build`
- Web/PWA: deploy `dist/` (Cloudflare Pages). iOS: Safari > Share > Add to Home Screen.
- Android APK: `npm run cap:sync && npx cap open android` (needs JDK 17+ and Android Studio)
- iOS native: `npx cap open ios` (needs Mac + Xcode)

Parsing rules: SI suffix belongs to its number (1/2k = 1/2000). `a┘b` binds tighter than everything:
1┘2k = 1/(2k), 1┘2π = (1/2)π. Implicit multiplication (2π, 3(4), 2sin(30)) binds tighter than × and ÷
(Casio FX-991 style), so 1÷2π = 1/(2π) but 1┘2π = (1/2)π, and 6÷2(1+2) = 1.
×10ˣ works after digits, Ans, π, e and `)`: Ans×10² = Ans·100.
Shift: x²→x⁻¹, √→∛, ^→∥ (parallel), log→10ˣ, ln→eˣ, sin/cos/tan→inverse, π→e, a┘b→Abs, p→f.

## Limits (covered by tests/generated.test.ts)

- Range: IEEE double. Largest 1.797693135×10³⁰⁸; anything that overflows (1E309, 2^1024, 9^9^9, e^710, 1E308×10) is `Math Error`.
  Smallest 4.94×10⁻³²⁴ (5E-324); below that silently underflows to 0.
- Display: 10 significant digits; plain below 1×10¹⁰ and above 1×10⁻⁴, scientific otherwise.
- Expression length: no hard cap (1,000,000-term sum evaluates). Nesting depth (parens, chained ^, stacked minus) is
  fine to 1000+ and reports `Stack Error` beyond the JS call stack instead of crashing.
- Trig in degrees reduces the angle mod 360 first, so sin(3.6×10¹⁴+30) = 0.5.

## Tests

`npm test` runs ~1,270 tests: seeded random expressions (digits, symbols, SI, ×10ˣ, implied multiplication,
a┘b, ∥, functions, large and small numbers) checked against an independent AST oracle, hand-written precedence
and limit cases, and keypad-level (jsdom) cases.
