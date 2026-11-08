# Build / QA status

Current main and production commit: `7664fa9e2df33c3b0e727e96e0f0aa3f8592ee86` (previous: `9273acf92ddad06aecec79fb8513a9a57f2208e6`, then `01126cc740b9c49c287648230bca59798f10e9d1`, then `ae6a652`). The "Follow-up pass" section describes the work in `9273acf`; the "QA correction pass" section describes `7664fa9`. Later commits that only change documentation do not change the application code of `7664fa9`. Status is split by **where** each check was run — do not read one row as proof of another.

| Check | Where | Result |
|---|---|---|
| `npm test` (`node --test "src/**/*.test.ts"`) | Claude authoring sandbox, Node 22.23.4 | **Claude-reported** PASS: 131/131 at `7664fa9` (119 before the follow-up pass + 12 in `src/sim/phase2.test.ts`). Not re-run by Vercel; not independently reproduced. |
| `tsc --noEmit` (strict) | Claude authoring sandbox, against three r186 sources + `@types/three` 0.187 typings | PASS (typings differ slightly from the lockfile's 0.186) |
| `npm ci` | Claude authoring sandbox | **NOT RUN / BLOCKED**: DNS cannot resolve `registry.npmjs.org` (`ENOTFOUND`); npm crashes mid-install. Lockfile untouched. |
| `npm run build` (`tsc --noEmit && vite build`) | Claude authoring sandbox | **NOT RUN** (needs `npm ci`). A bun bundle was used as a substitute (not the real build). |
| `npm run build` = `tsc --noEmit && vite build` | **Vercel**, commit `ae6a652` | PASS per Vercel build logs (19 modules, deployment READY); one chunk ≈ 638 kB raw / 165 kB gzip. |
| `npm run build` = `tsc --noEmit && vite build` | **Vercel**, commit `01126cc` | PASS: production build succeeded and the deployment reached READY on exactly this SHA (verified through the Vercel API). The log lines and the bundle sizes below were supplied from the Vercel build log by the project owner; the assistant's Vercel connector was refused access to the build-log endpoint (HTTP 403, scope authorization), so the assistant did not read the log text itself. |
| Vercel production build, commit `7664fa9` | **Vercel** (deployment READY verified through the Vercel API; build-log figures independently verified and supplied by the project owner) | **PASS.** Production deployment `READY` on exactly `7664fa9e2df33c3b0e727e96e0f0aa3f8592ee86`. Build command `tsc --noEmit && vite build`. Vite 8.3.5, 20 modules transformed. JavaScript **663.48 kB raw / 173.65 kB gzip**; CSS **17.79 kB raw / 4.77 kB gzip**; HTML **9.54 kB raw / 3.23 kB gzip**. Two warnings remain: the Vite chunk-size warning (some chunks larger than 500 kB after minification) and the npm `cache-dir` environment warning. The assistant's own connector could not read the build log (HTTP 403), so these log figures are recorded as supplied by the owner, not read by the assistant. |
| Live HTTP asset verification of production | — | **NOT PERFORMED by the assistant** (the sandbox cannot reach `vercel.app`; an earlier page fetch returned only the title/meta and was inconclusive). Not a substitute for the build or the browser checks. |
| Vercel deployment, commit `9273acf` (superseded) | **Vercel** (API) | `READY`, production, built from exactly `9273acf92ddad06aecec79fb8513a9a57f2208e6` (aliases `volta-lab-sable.vercel.app`, `volta-lab-abuzer-kakar.vercel.app`). The build log for this deployment was **not read** (the connector got HTTP 403), so the `tsc --noEmit && vite build` output and the bundle size for `9273acf` are **not recorded here**; only the READY state is verified. |
| Bundle-size warning, commit `01126cc` | Vercel build log (as reported) | **Still present, not fixed**: Vite warns "Some chunks are larger than 500 kB after minification". JavaScript ≈ 662.21 kB uncompressed, ≈ 173.28 kB gzip. It is a warning, not a failure; the limit was not raised and no code-splitting was done. |
| Vite production preview (`npm run preview`) | any | **NOT RUN** locally (needs the real build) |
| Committed browser check `scripts/browser-check.cjs` (Chromium, software WebGL ≈ 3.5 fps, bun bundle) | Claude authoring sandbox | **Claude-reported** PASS: 111/111 at `7664fa9` (74 at `01126cc`, +37 in the follow-up pass; the touch-camera checks were rewritten in the QA pass without changing the count). Emulation only; not run against production. |
| Production (Vercel URL) interactive browser test | — | NOT RUN |
| Physical mobile (phone/tablet) tests | — | **NOT PERFORMED**. Also not run: real GPU, Safari, Firefox, true multitouch hardware. |

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

## Follow-up pass (commit `9273acf`)
Changes: the wire-selection hint is cleared whenever a selection is cleared (T, S, TOUCH/SEPARATE buttons, connect, cancel); the "Output stage is …" text comes from the engine snapshot
(`outputStageDescription()`), so it can say battery empty / protective shutdown / converter thermal shutdown / disabled / running; attached loads are stored as private deep-frozen clones, `getInputs()` and
`snapshot()` return frozen objects (details in `ELECTRICAL_MODEL.md`); the cable-drag browser assertion now proves movement (old grip no longer selects, new position does);
touch emulation at 390 × 844 (tap-select, tap-connect, reverse order, cancel, wobble below the threshold, drag, one-finger rotate, two-finger pinch and pan in each of the four camera modes); mouse pan restrictions in each mode;
on narrow screens the rest position of the cable tips is pulled in so both tips stay on screen.
Node tests after this pass: 131 (119 before + 12 in `src/sim/phase2.test.ts`). Committed browser check: 111/111 PASS (74 before + 37 new; re-run after the QA correction pass, still 111) against the bun bundle in software-WebGL Chromium. Note: in ROTATE ONLY a two-finger gesture orbits like one finger (OrbitControls keeps its rotate state when zoom and pan are both off); it never zooms or pans.

**Automated emulation is not device testing.** The touch checks use Chromium touch events (via the DevTools protocol) in desktop Chromium with software WebGL. No physical phone or tablet, no real GPU, no Safari/Firefox and no real multitouch hardware was used.

## QA correction pass (after `9273acf`)
The touch-camera checks now classify each gesture from the real orbit target (a test-readable DOM diagnostic attribute, `data-camera-target`, on the canvas, written by the HUD loop each frame) plus the camera position:
`orbit` (direction from the target changed; distance and target unchanged), `zoom` (distance changed; direction and target unchanged), `pan` (target moved; distance and direction unchanged) or `none`.
Expected: FREE = orbit / zoom / pan for rotate / pinch / pan; LOCKED = none for all three; ZOOM ONLY = none / zoom / none; ROTATE ONLY = orbit for all three. In ROTATE ONLY the two-finger gestures **orbit** because of how the installed
OrbitControls (three.js r186, read from its source) handles a second finger when zoom and pan are both off (`onTouchStart`, two-pointer case returns without changing the one-finger rotate state). The checks assert that actual behaviour
(orbit occurred, no zoom, no pan, same distance, same target); a different three.js version could behave differently and the check would flag it. These are emulated touch events in desktop Chromium, not physical-device tests.

**About `data-camera-target`.** It is a diagnostic DOM attribute that the browser check reads. The application has no camera-control setter that uses it and no public camera API was added. It is **not** technically immutable or inherently read-only: it is an ordinary DOM attribute, so page JavaScript (or DevTools) can modify it, and the HUD loop simply overwrites it on the next frame. Camera behaviour is driven by OrbitControls and `cameraMode`, never by this attribute.

## Evidence levels at `7664fa9` (do not merge these)
1. Claude-reported Node tests: 131/131 (authoring sandbox).
2. Claude-reported browser tests: 111/111 (bun bundle, desktop Chromium, software WebGL, touch emulation).
3. Actual Vercel production build: PASS, figures above (supplied from the build log by the owner; READY state verified by API).
4. Live HTTP asset verification: not performed by the assistant.
5. Physical mobile tests: NOT PERFORMED.
Still open: `npm ci` / `npm run build` / `npm run preview` were never run in the authoring sandbox (registry unreachable); the >500 kB chunk warning is unfixed.
