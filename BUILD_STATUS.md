# Build / QA status

Last verified 2026-10-30 (AC/DC selector + electrical model).

| Check | Result |
|---|---|
| `npm test` (12 electrical-model tests) | PASS |
| `tsc --noEmit` (strict) against `three` r186.1 + `@types/three` 0.186 | PASS |
| Production bundle (bun, same `three` r186.1) | PASS |
| Real-browser run (Chromium, software WebGL): 3D AC/DC selector, rocker, open/short circuit, current limit, protection trip and reset, M / T / S / X / Space keys, 0–415 V range | PASS (24/24) |
| `npm run build` with Vite (`vite build`) | NOT RUN: the npm registry is blocked in the authoring sandbox, so Vite could not be installed. Run `npm install && npm run build` locally. |
| Real GPU / Windows / Safari / mobile touch | NOT RUN |
