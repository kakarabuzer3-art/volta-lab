# Build / QA status

Last verified production commit: `01126cc740b9c49c287648230bca59798f10e9d1` (previous: `ae6a652`). The section "Follow-up pass" below describes later work that is not part of that commit until it is committed and deployed. Status is split by **where** each check was run — do not read one row as proof of another.

| Check | Where | Result |
|---|---|---|
| `npm test` (`node --test "src/**/*.test.ts"`) | Claude authoring sandbox, Node 22.23.4 | PASS: 119/119 (86 previous + 33 new regression tests in `src/sim/phase1.test.ts`) |
| `tsc --noEmit` (strict) | Claude authoring sandbox, against three r186 sources + `@types/three` 0.187 typings | PASS (typings differ slightly from the lockfile's 0.186) |
| `npm ci` | Claude authoring sandbox | **NOT RUN / BLOCKED**: DNS cannot resolve `registry.npmjs.org` (`ENOTFOUND`); npm crashes mid-install. Lockfile untouched. |
| `npm run build` (`tsc --noEmit && vite build`) | Claude authoring sandbox | **NOT RUN** (needs `npm ci`). A bun bundle was used as a substitute (not the real build). |
| `npm run build` = `tsc --noEmit && vite build` | **Vercel**, commit `ae6a652` | PASS per Vercel build logs (19 modules, deployment READY); one chunk ≈ 638 kB raw / 165 kB gzip. |
| `npm run build` = `tsc --noEmit && vite build` | **Vercel**, commit `01126cc` | PASS: production build succeeded and the deployment reached READY on exactly this SHA (verified through the Vercel API). The log lines and the bundle sizes below were supplied from the Vercel build log by the project owner; the assistant's Vercel connector was refused access to the build-log endpoint (HTTP 403, scope authorization), so the assistant did not read the log text itself. |
| Bundle-size warning, commit `01126cc` | Vercel build log (as reported) | **Still present, not fixed**: Vite warns "Some chunks are larger than 500 kB after minification". JavaScript ≈ 662.21 kB uncompressed, ≈ 173.28 kB gzip. It is a warning, not a failure; the limit was not raised and no code-splitting was done. |
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

## Follow-up pass (after `01126cc`)
Changes: the wire-selection hint is cleared whenever a selection is cleared (T, S, TOUCH/SEPARATE buttons, connect, cancel); the "Output stage is …" text comes from the engine snapshot
(`outputStageDescription()`), so it can say battery empty / protective shutdown / converter thermal shutdown / disabled / running; attached loads are stored as private deep-frozen clones, `getInputs()` and
`snapshot()` return frozen objects (details in `ELECTRICAL_MODEL.md`); the cable-drag browser assertion now proves movement (old grip no longer selects, new position does);
touch emulation at 390 × 844 (tap-select, tap-connect, reverse order, cancel, wobble below the threshold, drag, one-finger rotate, two-finger pinch and pan in each of the four camera modes); mouse pan restrictions in each mode;
on narrow screens the rest position of the cable tips is pulled in so both tips stay on screen.
Node tests after this pass: 131 (119 before + 12 in `src/sim/phase2.test.ts`). Committed browser check: 111/111 PASS (74 before + 37 new) against the bun bundle in software-WebGL Chromium. Note: in ROTATE ONLY a two-finger gesture orbits like one finger (OrbitControls keeps its rotate state when zoom and pan are both off); it never zooms or pans.

**Automated emulation is not device testing.** The touch checks use Chromium touch events (via the DevTools protocol) in desktop Chromium with software WebGL. No physical phone or tablet, no real GPU, no Safari/Firefox and no real multitouch hardware was used.
