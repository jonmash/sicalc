# SI Calc

Scientific calculator with FX-991MS-style SI prefix keys (k M G T m µ n p f), π, Ans, shift layer.
Token-based expression model (src/calc.ts), vanilla TS UI (src/main.ts), Capacitor wrapper.

- `npm run dev` / `npm test` / `npm run build`
- Web/PWA: deploy `dist/` (Cloudflare Pages). iOS: Safari > Share > Add to Home Screen.
- Android APK: `npm run cap:sync && npx cap open android` (needs JDK 17+ and Android Studio)
- iOS native: `npx cap open ios` (needs Mac + Xcode)

Parsing rules: SI suffix belongs to its number (1/2k = 1/2000). `a┘b` binds tighter than everything:
1┘2k = 1/(2k), 1┘2π = (1/2)π. Implicit multiplication (2π, 3(4)) is same precedence as ×, left to right.
Shift: x²→x⁻¹, √→∛, ^→∥ (parallel), log→10ˣ, ln→eˣ, sin/cos/tan→inverse, π→e, a┘b→Abs, p→f.
