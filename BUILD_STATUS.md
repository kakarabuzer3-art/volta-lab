# Build / QA status

Baseline commit before this pass: `ae6a652`. Status is split by **where** each check was run — do not read one row as proof of another.

| Check | Where | Result |
|---|---|---|
| `npm test` (`node --test "src/**/*.test.ts"`) | Claude authoring sandbox, Node 22.23.4 | PASS: 119/119 (86 previous + 33 new regression tests in `src/sim/phase1.test.ts`) |
| `tsc --noEmit` (strict) | Claude authoring sandbox, against three r186 sources + `@types/three` 0.187 typings | PASS (typings differ slightly from the lockfile's 0.186) |
| `npm ci` | Claude authoring sandbox | **NOT RUN / BLOCKED**: DNS cannot resolve `registry.npmjs.org` (`ENOTFOUND`); npm crashes mid-install. Lockfile untouched. |
| `npm run build` (`tsc --noEmit && vite build`) | Claude authoring sandbox | **NOT RUN** (needs `npm ci`). A bun bundle was used as a substitute (not the real build). |
| `npm run build` | **Vercel** (commit `ae6a652`) | PASS per Vercel build logs: `tsc --noEmit && vite build`, 19 modules, deployment READY. Vite warns that one chunk is > 500 kB (≈ 638 kB raw / 165 kB gzip) — a size warning, not a failure. Build status of the commit that contains this pass: see the release notes / Vercel dashboard. |
| Vite production preview (`npm run preview`) | any | **NOT RUN** locally (needs the real build) |
| Committed browser check `scripts/browser-check.cjs` (Chromium, software WebGL ≈ 3.5 fps, bun bundle) | Claude authoring sandbox | PASS: 74/74 (the 31 previous checks + 43 new: camera cycle/limits/damping/presets, cable select/connect/cancel/drag, wire drag vs camera restrictions, empty battery) |
| Production (Vercel URL) browser smoke test | — | NOT RUN unless stated below |
| Real GPU / Windows / Safari / true multitouch hardware | — | NOT RUN |

Run locally (Node ≥ 22.12): `npm ci && npm test && npm run build && npm run preview`, then
`BASE_URL=http://localhost:4173/ node scripts/browser-check.cjs` (Playwright is installed separately; it is not a project dependency).

What this pass changed: depletion-inside-a-step timing (converter/load heat, timers), empty-battery status, no-drive load state, strict atomic connection validation,
immutable configuration, stricter chemistry validation (see `ELECTRICAL_MODEL.md`); a flat rounded-rectangular industrial ground slab (11.4 × 7.6 units, 6 cm thick, top face
at the feet's underside so the four feet touch it; the old circular halo was removed); highlighted cable tips with hover / selected states and two-click connection (click vs drag
threshold 6 px mouse / 10 px touch, invisible hit spheres around the tips only); a four-state camera button (FREE → LOCKED → ZOOM ONLY → ROTATE ONLY → FREE) driven by one `cameraMode`
variable through one function; temporary pointer locks are separate and never restore a forbidden permission.

Limitations of the checks: real multitouch pinch/rotate on a phone was not run (Playwright mouse/touch emulation only); screenshots were reviewed by eye, not pixel-compared.

Camera damping is frame-based, so under slow software WebGL the camera coasts for many seconds; the camera checks therefore poll instead of using fixed waits, and the "no jump" checks only assert no reset to the default view plus zero motion after the lock.
On phones (≤ 620 px) the bottom hint line is hidden because it collided with the status chips.
