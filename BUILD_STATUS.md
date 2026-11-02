# Build / QA status

Last verified 2026-11-02. Baseline commit before this pass: `4f19ce6`.

| Check | Result |
|---|---|
| `npm test` → `node --test "src/**/*.test.ts"` | PASS: 86/86 (12 legacy + 43 engine + 31 hardening tests: thermal shutdown, validation, profiles, ledger) |
| `tsc --noEmit` (strict) against `three` r186 sources + `@types/three` 0.187 typings | PASS (typings differ slightly from the lockfile's 0.186) |
| Production bundle with **bun** (not Vite) | PASS (a substitute, not the real build) |
| `npm ci` | **NOT RUN / BLOCKED**: sandbox DNS cannot resolve `registry.npmjs.org` (`ENOTFOUND`); the npm cache lacks the tarballs (`ENOTCACHED` offline). Lockfile untouched. |
| `npm run build` (`tsc --noEmit && vite build`) | **NOT RUN** (needs `npm ci`; Node 22.23.4 / npm 10.9.9 satisfy Vite 8's `^20.19.0 \|\| >=22.12.0`) |
| Vite production preview | **NOT RUN** |
| Committed browser check `scripts/browser-check.cjs` (Chromium, software WebGL, against the bun bundle) | PASS: 31/31 (needs Playwright installed separately; it is not a project dependency) |
| Real GPU / Windows / Safari / mobile touch | NOT RUN |

Run locally (Node ≥ 22.12): `npm ci && npm test && npm run build && npm run preview`, then
`BASE_URL=http://localhost:4173/ node scripts/browser-check.cjs`.

The earlier one-time “26 browser checks” were not committed; `scripts/browser-check.cjs` is their repeatable, extended replacement.
Browser checks do not cover: physical-selector mouse click, dragging cable tips with the mouse (keyboard T/S used), pixel-level comparison of the 3D design.
