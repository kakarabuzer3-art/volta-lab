# Build / QA status

Last verified 2026-11-01 (physics engine `src/sim/` integrated into the machine).

| Check | Result |
|---|---|
| `npm test`: `node --test "src/**/*.test.ts"` (12 legacy + 43 engine tests = 55) | PASS (55/55) |
| `tsc --noEmit` (strict) against `three` r186 sources + `@types/three` 0.187 typings | PASS |
| Production bundle (bun, `three` r186 sources) | PASS |
| Real-browser run (Chromium, software WebGL, bundled app): 26 checks: engine exposure, HUD = snapshot, AC/DC switch, 415 V, DC load current, SOC decrease, energy-ledger residual, short-circuit limit + trip + reset, power OFF, 12 V → 415 V cases | PASS (26/26; one blocked external font request ignored) |
| `npm run build` with Vite (`vite build`) | NOT RUN: npm registry blocked in the authoring sandbox. Run `npm install && npm run build` locally. |
| Vercel deployment of the pushed commit | see the commit status on GitHub (not verifiable from the sandbox) |
| Real GPU / Windows / Safari / mobile touch | NOT RUN |
