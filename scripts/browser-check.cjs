// Repeatable browser check for Volta Lab (Chromium via Playwright; software WebGL unless a GPU is present).
//   usage:  BASE_URL=http://localhost:4173/ node scripts/browser-check.cjs
//   (serve the app first: `npm run build && npm run preview`, or any static server over the built output)
// Playwright is NOT a project dependency: install it separately (`npm i -g playwright`, `npx playwright install chromium`)
// and run with NODE_PATH=$(npm root -g) if needed. Exit code 0 = all checks passed.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOT = process.env.SHOT_DIR || '.';
const results = []; let failed = 0;
// The first-visit "Quick Start" toast is dismissed in every context except the one that tests it, so it cannot sit over the scene.
const SEEN_INIT = () => { try { localStorage.setItem('voltalab.intro.seen', '1'); } catch (e) { /* ignore */ } };
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!cond) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mainCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mainCtx.addInitScript(SEEN_INIT);
  const page = await mainCtx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.voltaLab, null, { timeout: 30000 });
  const snap = () => page.evaluate(() => JSON.parse(JSON.stringify(window.voltaLab.snapshot())));
  const text = (id) => page.evaluate((i) => document.getElementById(i).textContent, id);
  const waitSnap = (fn, t = 30000) => page.waitForFunction(`(${fn.toString()})(window.voltaLab.snapshot())`, null, { timeout: t });
  const setSlider = (v) => page.evaluate((x) => { const el = document.getElementById('voltageSlider'); el.value = String(x); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);


  // ---- geometry helpers (replicate the app's default camera so real pointer input can be aimed at projected tips) ----
  const DEFAULT_CAM = [0.2, 0.45, 7.5], DEFAULT_TARGET = [0, -0.12, 0], BASE_FOV = 34;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
  const project = (p, vw, vh) => {
    const aspect = vw / vh, minAspect = 1.45;
    const fov = aspect >= minAspect ? BASE_FOV : Math.min(66, (2 * Math.atan(Math.tan((BASE_FOV / 2) * Math.PI / 180) * minAspect / aspect)) * 180 / Math.PI);
    const f = norm(sub(DEFAULT_TARGET, DEFAULT_CAM)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), d = sub(p, DEFAULT_CAM);
    const t = Math.tan((fov / 2) * Math.PI / 180), z = dot(d, f);
    return { x: ((dot(d, r) / (z * t * aspect)) + 1) / 2 * vw, y: (1 - dot(d, u) / (z * t)) / 2 * vh };
  };
  // Tip hit centres (world): Lead A (-2.68,-1.09,1.32) grip is +0.17 along x; Lead B (2.68,…) grip is −0.17.
  const gripA = (vw = 1440, vh = 900) => project([-2.68 + 0.17, -1.09, 1.32], vw, vh);
  const gripB = (vw = 1440, vh = 900) => project([2.68 - 0.17, -1.09, 1.32], vw, vh);
  const fovFor = (vw, vh) => { const aspect = vw / vh; return aspect >= 1.45 ? BASE_FOV : Math.min(66, (2 * Math.atan(Math.tan((BASE_FOV / 2) * Math.PI / 180) * 1.45 / aspect)) * 180 / Math.PI); };
  // The app pulls the rest position of the cable tips in on narrow screens so both stay visible (see updateTipRestX in main.ts).
  const restX = (vw, vh) => vw / vh >= 1.45 ? 2.68 : Math.min(2.68, Math.max(0.9, Math.tan(fovFor(vw, vh) * Math.PI / 360) * (vw / vh) * Math.hypot(0.2, 0.45 + 1.09, 7.5 - 1.32) - 0.3));
  const gripAt = (vw, vh) => [project([-restX(vw, vh) + 0.17, -1.09, 1.32], vw, vh), project([restX(vw, vh) - 0.17, -1.09, 1.32], vw, vh)];
  const cam = async () => page.evaluate(() => (() => { const c = document.getElementById('sceneCanvas').dataset.cameraPosition.split(',').map(Number); return { x: c[0], y: c[1], z: c[2] }; })());
  const dist = (c, t = DEFAULT_TARGET) => Math.hypot(c.x - t[0], c.y - t[1], c.z - t[2]);
  const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const mode = () => page.evaluate(() => document.getElementById('sceneCanvas').dataset.cameraMode);
  const btnText = () => text('cameraModeLabel');
  const dragCanvas = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up(); };
  const conn = async () => (await snap()).inputs.connection;
  const selected = () => page.evaluate(() => document.getElementById('sceneCanvas').dataset.wireSelected);
  const click = async (p) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); };
  const resetView = async () => { await page.keyboard.press('r'); await settle(500); };

  // ---- initial state + drawer
  let s = await snap();
  ok('initial: power OFF, AC, 220 V set-point, SOC 90 %', s.status === 'off' && s.output.kind === 'ac' && s.inputs.setpointV === 220 && Math.abs(s.battery.socFrac - 0.9) < 1e-9);
  const drawer = () => page.evaluate(() => document.querySelector('.stage').classList.contains('panel-open'));
  ok('drawer starts closed', !(await drawer()));
  await page.click('#panelToggle'); ok('drawer opens (corner button)', await drawer());
  await page.keyboard.press('Escape'); ok('Escape closes the drawer', !(await drawer()));

  // =============================== camera modes, cable interaction (real pointer input) ===============================
  await page.keyboard.press('r'); await settle(600);
  const c0 = await cam();
  ok('camera button exists, shows VIEW FREE, has aria-label + title', (await btnText()) === 'VIEW FREE' && /Camera control: VIEW FREE/.test(await page.getAttribute('#cameraModeBtn', 'aria-label')) && !!(await page.getAttribute('#cameraModeBtn', 'title')));
  ok('default camera at the documented start position', Math.abs(c0.x - 0.2) < 0.01 && Math.abs(c0.y - 0.45) < 0.01 && Math.abs(c0.z - 7.5) < 0.01, JSON.stringify(c0));
  // 1. FREE rotates and zooms
  await dragCanvas(300, 250, 440, 250); await settle(900);
  const fRot = await cam();
  ok('cam 1: FREE — drag rotates the camera', moved(c0, fRot) > 0.3, `moved ${moved(c0, fRot).toFixed(2)}`);
  const dBefore = dist(fRot); await page.mouse.move(300, 250); await page.mouse.wheel(0, -300); await settle(900);
  ok('cam 1: FREE — wheel zooms (distance changes)', Math.abs(dist(await cam()) - dBefore) > 0.2, `${dBefore.toFixed(2)} → ${dist(await cam()).toFixed(2)}`);
  // 2. first click → LOCKED, even while damping is still running (rotate, then click immediately)
  await dragCanvas(300, 250, 400, 220);
  const preLock = await cam();
  await page.click('#cameraModeBtn');
  const postLock = await cam();
  // NOTE: damping is frame-based, so under slow software WebGL (≈3–4 fps) the camera is still coasting between the two reads
  // above; a numeric "jump" therefore includes ordinary inertia. What must NOT happen is a reset to the default view, and (cam 3)
  // any motion after the lock.
  ok('cam 2: first click → LOCKED (label, dataset)', (await btnText()) === 'VIEW LOCKED' && (await mode()) === 'locked');
  ok('cam 2: locking does not jump (no reset to the default view; only pre-lock inertia)', moved(preLock, postLock) < 2 && moved(postLock, { x: 0.2, y: 0.45, z: 7.5 }) > 0.5, `jump ${moved(preLock, postLock).toFixed(3)}`);
  await settle(1500);
  const lockedPos = await cam();
  ok('cam 3: LOCKED — camera stays exactly put after the damping time (no residual motion)', moved(postLock, lockedPos) < 0.02, `drift ${moved(postLock, lockedPos).toFixed(4)}`);
  await dragCanvas(300, 250, 520, 330); await page.mouse.move(300, 250); await page.mouse.wheel(0, -500); await settle(900);
  ok('cam 3/4: LOCKED — drag does not rotate and wheel does not zoom', moved(lockedPos, await cam()) < 0.01, `moved ${moved(lockedPos, await cam()).toFixed(4)}`);
  // 3. second click → ZOOM ONLY
  await page.click('#cameraModeBtn');
  ok('cam 5: second click → ZOOM ONLY', (await btnText()) === 'ZOOM ONLY' && (await mode()) === 'zoom-only');
  const z0 = await cam(); await dragCanvas(300, 250, 520, 330); await settle(700);
  ok('cam 6: ZOOM ONLY — drag does not rotate', moved(z0, await cam()) < 0.01);
  await page.mouse.move(300, 250); await page.mouse.wheel(0, -400); await settle(1000);
  const z1 = await cam();
  const dirA = norm(sub([z0.x, z0.y, z0.z], DEFAULT_TARGET)), dirB = norm(sub([z1.x, z1.y, z1.z], DEFAULT_TARGET));
  ok('cam 7: ZOOM ONLY — wheel zooms and keeps the viewing direction', Math.abs(dist(z1) - dist(z0)) > 0.2 && Math.hypot(dirA[0] - dirB[0], dirA[1] - dirB[1], dirA[2] - dirB[2]) < 0.01, `${dist(z0).toFixed(2)} → ${dist(z1).toFixed(2)}`);
  // 4. third click → ROTATE ONLY
  await page.click('#cameraModeBtn');
  ok('cam 8: third click → ROTATE ONLY', (await btnText()) === 'ROTATE ONLY' && (await mode()) === 'rotate-only');
  const r0 = await cam(); await page.mouse.move(300, 250); await page.mouse.wheel(0, -500); await settle(900);
  ok('cam 9: ROTATE ONLY — wheel does not change the distance', Math.abs(dist(await cam()) - dist(r0)) < 0.01 && moved(r0, await cam()) < 0.01);
  await dragCanvas(300, 250, 460, 250); await settle(1200);
  const r1 = await cam();
  ok('cam 10: ROTATE ONLY — drag rotates and the distance is preserved', moved(r0, r1) > 0.3 && Math.abs(dist(r1) - dist(r0)) < 0.02, `moved ${moved(r0, r1).toFixed(2)}, Δdist ${(dist(r1) - dist(r0)).toFixed(4)}`);
  // 5. fourth click → FREE (view not reset)
  await settle(600); const preFree = await cam();
  await page.click('#cameraModeBtn'); const postFree = await cam();
  ok('cam 11: fourth click → FREE without resetting the view', (await btnText()) === 'VIEW FREE' && (await mode()) === 'free' && moved(preFree, postFree) < 2 && moved(postFree, { x: 0.2, y: 0.45, z: 7.5 }) > 0.5, `jump ${moved(preFree, postFree).toFixed(3)}`);
  await settle(1500); const f1 = await cam(); // let any pre-click coasting finish being sampled, then test FREE interaction by polling
  const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(500); } return false; };
  await dragCanvas(300, 250, 380, 250);
  const rotatedAgain = await until(async () => moved(f1, await cam()) > 0.15);
  const f2 = await cam(); const d2 = dist(f2); await page.mouse.wheel(0, d2 > 6 ? -300 : 300); // away from whichever zoom limit the earlier steps approached
  const zoomedAgain = await until(async () => Math.abs(dist(await cam()) - d2) > 0.1);
  ok('cam 11: FREE restored — drag rotates and wheel zooms again', rotatedAgain && zoomedAgain, `rotated ${rotatedAgain}, zoomed ${zoomedAgain}`);
  for (const [want, label] of [['locked', 'VIEW LOCKED'], ['zoom-only', 'ZOOM ONLY'], ['rotate-only', 'ROTATE ONLY'], ['free', 'VIEW FREE']]) {
    await page.click('#cameraModeBtn');
    if ((await mode()) !== want || (await btnText()) !== label) ok(`cam 12: cycle continues (${want})`, false, `${await mode()} / ${await btnText()}`);
  }
  ok('cam 12: the cycle repeats FREE → LOCKED → ZOOM ONLY → ROTATE ONLY → FREE', (await mode()) === 'free');
  // 6. Detail View and R reset keep the selected mode
  await page.click('#cameraModeBtn'); // LOCKED
  await page.click('#explodeBtn'); await settle(500);
  const det = await cam();
  ok('cam 13: Detail View still repositions the camera while LOCKED, mode unchanged', Math.abs(det.z - 5.75) < 0.05 && (await mode()) === 'locked', JSON.stringify(det));
  await dragCanvas(300, 250, 460, 300); await page.mouse.wheel(0, -400); await settle(800);
  ok('cam 13: LOCKED still holds after Detail View', moved(det, await cam()) < 0.01);
  await page.keyboard.press('r'); await settle(500);
  const rs = await cam();
  ok('cam 14: R reset repositions the camera while LOCKED, mode unchanged', Math.abs(rs.z - 7.5) < 0.05 && (await mode()) === 'locked' && (await btnText()) === 'VIEW LOCKED');
  await dragCanvas(300, 250, 460, 300); await settle(700);
  ok('cam 14: LOCKED still holds after reset', moved(rs, await cam()) < 0.01);
  await page.click('#cameraModeBtn'); await page.click('#cameraModeBtn'); await page.click('#cameraModeBtn'); // → ZOOM, ROTATE, FREE
  ok('cam 14: cycle intact after presets', (await mode()) === 'free');
  // keyboard focus
  await page.focus('#cameraModeBtn'); await page.keyboard.press('Enter'); ok('camera button is operable from the keyboard (Enter)', (await mode()) === 'locked');
  await page.keyboard.press('Space'); await page.click('body', { position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => document.getElementById('cameraModeBtn').blur());
  // rotate-only / zoom-only / locked are re-entered below with wire interaction; start from FREE at the default view
  while ((await mode()) !== 'free') await page.click('#cameraModeBtn');
  await resetView();

  // ---------------------------- cable tips: two-click connect, cancel, drag, buttons (default view, FREE) ----------------------------
  const A = gripA(), B = gripB();
  const hoverRingBefore = await page.screenshot({ clip: { x: A.x - 60, y: A.y - 60, width: 120, height: 120 } });
  await page.mouse.move(A.x, A.y); await settle(500);
  const hoverRingAfter = await page.screenshot({ clip: { x: A.x - 60, y: A.y - 60, width: 120, height: 120 } });
  ok('cable 0: hovering a tip changes its highlight and shows the pointer cursor', !hoverRingBefore.equals(hoverRingAfter) && (await page.evaluate(() => document.getElementById('sceneCanvas').style.cursor)) === 'pointer');
  await click(A); await settle(300);
  const hint = await page.evaluate(() => document.getElementById('wireHint').textContent);
  ok('cable 1: clicking Lead A selects it and shows the instruction', (await selected()) === 'A' && /Lead A selected — click Lead B to connect/.test(hint), hint);
  ok('cable 1: a single click does not connect or move anything', (await conn()) === 'open');
  await click(B); await waitSnap((x) => x.inputs.connection === 'short');
  ok('cable 2: clicking Lead B afterwards connects the wires (engine = short) and clears the selection', (await conn()) === 'short' && (await selected()) === '');
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  await click(B); const selB = await selected(); await click(A); await waitSnap((x) => x.inputs.connection === 'short');
  ok('cable 3: reverse order (Lead B first, then Lead A) also connects', selB === 'B' && (await conn()) === 'short');
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  const gA = gripA(); // tips returned to the separated start
  await click(gA); const s1 = await selected(); await click(gA);
  ok('cable 4: clicking the selected lead again cancels the selection (no connection)', s1 === 'A' && (await selected()) === '' && (await conn()) === 'open');
  await click(gA); await page.keyboard.press('t'); await waitSnap((x) => x.inputs.connection === 'short');
  ok('cable 5: T key still connects and also clears a pending selection', (await selected()) === '');
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  // click with tiny movement is still a click; larger movement is a drag
  await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(A.x + 3, A.y + 2); await page.mouse.up();
  ok('cable 6: a 3 px wobble is still a click (selects, does not drag)', (await selected()) === 'A');
  await click(A); // deselect
  // drag
  const camBefore = await cam();
  await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(A.x + 60, A.y - 40, { steps: 8 }); await page.mouse.move(A.x + 120, A.y - 70, { steps: 8 }); await page.mouse.up(); await settle(500);
  ok('cable 7: dragging a tip does not select it / trigger click-to-connect', (await selected()) === '' && (await conn()) === 'open');
  ok('cable 7: the camera does not rotate while a cable is dragged', moved(camBefore, await cam()) < 0.005, `moved ${moved(camBefore, await cam()).toFixed(4)}`);
  // Proof of movement without pixel comparison: a press at the OLD grip position must no longer hit Lead A, while a press at the
  // NEW position (old + the drag delta; the grab offset keeps the tip under the pointer) must select it. Fails if the tip did not move.
  await click(A);
  ok('cable 7: after the drag, the OLD grip position no longer selects Lead A (the tip left it)', (await selected()) === '', `selected "${await selected()}"`);
  const A_new = { x: A.x + 120, y: A.y - 70 };
  await click(A_new);
  ok('cable 7: after the drag, the NEW position (old + drag delta) selects Lead A (the tip really moved there)', (await selected()) === 'A', `selected "${await selected()}"`);
  await click(A_new); // deselect
  // drag A until it touches B: engine must agree with the visible contact
  const targetPointer = project([2.68 - 0.34, -1.09, 1.32], 1440, 900); // pointer world x = B.pos.x − 0.34 → exposed ends 0.05 apart
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(A.x + 300, A.y, { steps: 12 }); await page.mouse.move(targetPointer.x, targetPointer.y, { steps: 20 }); await page.mouse.up();
  await waitSnap((x) => x.inputs.connection === 'short');
  ok('cable 8: dragging Lead A onto Lead B makes the engine report a short circuit (matches visible contact)', (await conn()) === 'short' && (await selected()) === '');
  const shotTouch = `${SHOT}/browser-check-wires-touching.png`; await page.screenshot({ path: shotTouch });
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  ok('cable 8: SEPARATE key moves both tips apart again (engine = open)', (await conn()) === 'open');
  // real buttons
  await page.click('#panelToggle'); await page.click('#touchWiresBtn'); await waitSnap((x) => x.inputs.connection === 'short');
  ok('cable 9: TOUCH WIRE ENDS button still works', (await conn()) === 'short');
  await page.click('#separateWiresBtn'); await waitSnap((x) => x.inputs.connection === 'open');
  ok('cable 9: SEPARATE button still works', (await conn()) === 'open');
  await page.click('#panelToggle');
  await settle(600);

  // ---------------------- Issue A: the persistent "Lead X selected" hint must never outlive the selection ----------------------
  await resetView();
  const wireHintState = () => page.evaluate(() => { const h = document.getElementById('wireHint'); return { shown: h.classList.contains('show'), text: h.textContent }; });
  const noStale = async (label) => { await page.waitForTimeout(200); const h = await wireHintState(); ok(`hint: ${label} — no stale "selected" hint`, (await selected()) === '' && !(h.shown && /selected —/.test(h.text)), JSON.stringify(h)); };
  const [HA, HB] = gripAt(1440, 900);
  await click(HA); const h1 = await wireHintState();
  ok('hint: selecting Lead A shows "Lead A selected — click Lead B …"', (await selected()) === 'A' && h1.shown && /Lead A selected — click Lead B/.test(h1.text), JSON.stringify(h1));
  await page.keyboard.press('t'); await waitSnap((x) => x.inputs.connection === 'short'); await noStale('T key clears the selection');
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  await click(HB); ok('hint: selecting Lead B shows its instruction', (await selected()) === 'B' && /Lead B selected — click Lead A/.test((await wireHintState()).text));
  await page.keyboard.press('s'); await noStale('S key clears the selection');
  await click(HA); await page.click('#panelToggle'); await page.click('#touchWiresBtn'); await waitSnap((x) => x.inputs.connection === 'short'); await noStale('TOUCH WIRE ENDS button');
  await page.click('#separateWiresBtn'); await waitSnap((x) => x.inputs.connection === 'open'); await page.click('#panelToggle'); await page.waitForTimeout(400);
  await click(HA); await page.click('#panelToggle'); await page.click('#separateWiresBtn'); await page.click('#panelToggle'); await noStale('SEPARATE button');
  await click(HA); await click(HA); const hc = await wireHintState();
  ok('hint: clicking the selected lead again cancels (message says "deselected", never "selected —")', (await selected()) === '' && !/selected —/.test(hc.text) && /deselected/.test(hc.text), JSON.stringify(hc));
  await click(HA); await click(HB); await waitSnap((x) => x.inputs.connection === 'short'); await noStale('two-click connect');
  ok('hint: two-click connect still works and says so', /connected/i.test((await wireHintState()).text));
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');

  // ---------------------- wire drag / pointer cancel must never override the selected camera mode ----------------------
  await resetView();
  for (const [steps, want] of [[1, 'locked'], [2, 'zoom-only'], [3, 'rotate-only']]) {
    while ((await mode()) !== 'free') await page.click('#cameraModeBtn');
    for (let k = 0; k < steps; k++) await page.click('#cameraModeBtn');
    await resetView();
    const base = await cam(); const gA2 = gripA();
    await page.mouse.move(gA2.x, gA2.y); await page.mouse.down(); await page.mouse.move(gA2.x + 80, gA2.y - 30, { steps: 8 });
    await page.evaluate(() => document.getElementById('sceneCanvas').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))); // pointer cancellation mid-drag
    await page.mouse.up();
    await dragCanvas(300, 250, 480, 300); await page.mouse.move(300, 250); await page.mouse.wheel(0, -500); await settle(900);
    const end = await cam();
    const expectRot = want === 'rotate-only', expectZoom = want === 'zoom-only';
    const rotated = Math.abs(dist(end) - dist(base)) < 0.02 && moved(base, end) > 0.15, zoomed = Math.abs(dist(end) - dist(base)) > 0.15;
    const good = want === 'locked' ? moved(base, end) < 0.01 : want === 'zoom-only' ? zoomed && Math.hypot(...norm(sub([end.x, end.y, end.z], DEFAULT_TARGET)).map((v, i) => v - norm(sub([base.x, base.y, base.z], DEFAULT_TARGET))[i])) < 0.01 : rotated;
    ok(`cam 16: after a wire drag + pointercancel the ${want.toUpperCase()} restrictions still apply`, good && (await mode()) === want, `moved ${moved(base, end).toFixed(3)}, Δdist ${(dist(end) - dist(base)).toFixed(3)}`);
    await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  }
  while ((await mode()) !== 'free') await page.click('#cameraModeBtn');
  await resetView();

  // ---------------------------- touch (single-finger tap) in its own context ----------------------------
  const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await tctx.addInitScript(SEEN_INIT);
  const tpage = await tctx.newPage();
  await tpage.goto(BASE); await tpage.waitForFunction(() => !!window.voltaLab, null, { timeout: 30000 }); await tpage.waitForTimeout(1200);
  const tA = gripA(), tB = gripB();
  await tpage.touchscreen.tap(tA.x, tA.y); await tpage.waitForTimeout(300);
  const tSel = await tpage.evaluate(() => document.getElementById('sceneCanvas').dataset.wireSelected);
  await tpage.touchscreen.tap(tB.x, tB.y);
  await tpage.waitForFunction(() => window.voltaLab.snapshot().inputs.connection === 'short', null, { timeout: 20000 });
  ok('touch: tapping Lead A then Lead B selects then connects (pointerType touch)', tSel === 'A');
  await tctx.close();

  await page.click('#panelToggle');

  // ---- power, voltage, presets, mode
  await page.click('#powerBtn'); await waitSnap((x) => x.status === 'running');
  s = await snap();
  ok('power ON: AC open circuit, 220 V RMS, 0 A, 50 Hz, peak = √2·Vrms', s.output.currentA === 0 && Math.abs(s.output.voltage - 220) < 0.5 && s.output.freqHz === 50 && Math.abs(s.output.vPeakV - 220 * Math.SQRT2) < 0.1);
  for (const v of [110, 400, 415]) {
    await page.click(`[data-voltage="${v}"]`);
    await page.waitForFunction((t) => Math.abs(window.voltaLab.snapshot().output.voltage - t) < 0.5, v, { timeout: 20000 });
    ok(`preset ${v} V reaches ${v} V (range 0–415 preserved)`, Math.abs((await snap()).output.voltage - v) < 0.5);
  }
  await setSlider(137); await page.waitForFunction(() => Math.abs(window.voltaLab.snapshot().output.voltage - 137) < 0.5);
  ok('voltage slider sets 137 V; HUD equals snapshot', (await text('metricVoltage')) === '137.0' || (await text('metricVoltage')) === (await snap()).output.voltage.toFixed(1));
  await page.keyboard.press('m'); await waitSnap((x) => x.output.kind === 'dc'); s = await snap();
  ok('AC→DC (selector shortcut): 0 Hz, AC-only fields unavailable (null), unit label DC', s.output.freqHz === 0 && s.output.sVA === null && s.output.powerFactor === null && (await text('metricVoltageUnit')) === 'V DC');
  await page.keyboard.press('m'); await waitSnap((x) => x.output.kind === 'ac');
  ok('DC→AC returns to 50 Hz', (await snap()).output.freqHz === 50);
  await page.keyboard.press('m'); await waitSnap((x) => x.output.kind === 'dc');

  // ---- battery + converter telemetry; load attach / under load
  await setSlider(100);
  await page.evaluate(() => window.voltaLab.attachLoad(window.voltaLab.loads.resistiveLoad(100)));
  await waitSnap((x) => x.inputs.connection === 'load' && Math.abs(x.output.voltage - 100) < 0.5); await page.waitForTimeout(400);
  s = await snap();
  ok('load attach (API): I = V/R = 1 A, P = 100 W', Math.abs(s.output.currentA - 1) < 0.01 && Math.abs(s.output.pRealW - 100) < 1);
  ok('battery telemetry visible and equals snapshot', (await text('batteryState')).startsWith((s.battery.socFrac * 100).toFixed(1).slice(0, 3)));
  ok('converter telemetry shows input current and efficiency', /A @/.test(await text('convInput')) && /%/.test(await text('convEff')), `${await text('convInput')} | ${await text('convEff')}`);
  ok('battery power > output power (losses, no free energy)', s.battery.powerW > s.output.pRealW && s.converter.efficiency > 0 && s.converter.efficiency < 1);
  ok('ledger residuals ≈ 0', Math.abs(s.ledger.batteryResidualWh) < 1e-9 && Math.abs(s.ledger.terminalResidualWh) < 1e-6);
  const soc0 = s.battery.socFrac; await page.waitForTimeout(1500);
  ok('SOC decreases while delivering', (await snap()).battery.socFrac < soc0);
  // load failure explained to the learner (reasons shown in the HUD note)
  await page.evaluate(() => window.voltaLab.attachLoad(window.voltaLab.loads.resistiveLoad(100, { input: 'ac', vRatedMinV: 100, vRatedMaxV: 240, vAbsMaxV: 300, polarized: false })));
  await waitSnap((x) => x.load && x.load.health.state !== 'normal', 20000); await page.waitForTimeout(300);
  const note = await page.evaluate(() => document.querySelector('#arcStatus small').textContent);
  ok('unsupported input is explained in the HUD', /Load .*Unsupported input/i.test(note), note.slice(0, 120));
  // invalid load rejected at the public API boundary
  const rejected = await page.evaluate(() => { try { window.voltaLab.attachLoad({ kind: 'resistive', rlc: { ohms: -5 } }); return 'accepted'; } catch (e) { return e.name + ': ' + e.message; } });
  ok('window.voltaLab.attachLoad rejects invalid loads', rejected !== 'accepted', rejected.slice(0, 100));
  const rej2 = await page.evaluate(() => { try { window.voltaLab.attachLoad(window.voltaLab.loads.resistiveLoad(NaN)); return 'accepted'; } catch (e) { return e.name; } });
  ok('NaN resistance rejected', rej2 === 'RangeError', rej2);
  await page.evaluate(() => window.voltaLab.detachLoad()); await waitSnap((x) => x.inputs.connection === 'open');
  ok('detach → 0 A', (await snap()).output.currentA === 0);

  // ---- cable movement + short circuit protection
  const tip0 = await page.evaluate(() => window.voltaLab.snapshot().inputs.connection);
  await page.keyboard.press('t'); await waitSnap((x) => x.inputs.connection === 'short'); s = await snap();
  ok('cable tips touching = short: held at the 10 A converter limit', s.output.currentLimited && s.output.currentA <= 10.001 && s.output.currentA > 5, `I=${s.output.currentA.toFixed(2)} was ${tip0}`);
  await waitSnap((x) => x.status === 'tripped', 90000); s = await snap();
  ok('sustained short trips; output zero; reason given', s.protection.trip === 'overcurrent' && s.output.currentA === 0 && !!s.protection.message);
  await page.waitForTimeout(300);
  ok('HUD shows PROTECTED SHUTDOWN', (await text('connectionPill')).includes('PROTECTED'));
  ok('power description says protective shutdown (never "running") while the engine is tripped', /Protective shutdown/.test(await text('powerDescription')) && !/is running/.test(await text('powerDescription')), await text('powerDescription'));
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  await page.click('#powerBtn'); await waitSnap((x) => x.status === 'off'); await page.click('#powerBtn'); await waitSnap((x) => x.status === 'running');
  ok('power cycle clears the trip', (await snap()).protection.trip === null);
  await page.waitForTimeout(300);
  ok('power description says "Output stage is running" again once the engine really runs', /Output stage is running/.test(await text('powerDescription')), await text('powerDescription'));

  // ---- thermal trip and recovery (separate engine instance with a low shutdown threshold; same code as the machine)
  const th = await page.evaluate(() => {
    const E = window.voltaLab.engine.constructor, base = window.voltaLab.engine.config;
    const e = new E({ ...base, converter: { ...base.converter, tShutdownC: 35, tRestartC: 30 } });
    e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 }); e.attachLoad(window.voltaLab.loads.resistiveLoad(40));
    let n = 0; while (!e.snapshot().protection.converterShutdown && n++ < 40000) e.step();
    const hit = JSON.parse(JSON.stringify(e.snapshot()));
    let m = 0; while (e.snapshot().protection.converterShutdown && m++ < 40000) e.step();
    return { hit, back: JSON.parse(JSON.stringify(e.snapshot())) };
  });
  ok('thermal shutdown snapshot is consistent (0 V / 0 A / 0 W, battery current 0)', th.hit.status === 'tripped' && th.hit.output.voltage === 0 && th.hit.output.currentA === 0 && th.hit.battery.currentA === 0 && /thermal/i.test(th.hit.protection.message));
  ok('thermal restart after cooling below restart temperature (hysteresis) with live readings', !th.back.protection.converterShutdown && th.back.converter.tempC <= 30 && th.back.output.voltage > 199);

  // ---- Touch emulation at a 390 × 844 phone viewport (Chromium touch events via CDP: real pointer events with pointerType "touch").
  // This is AUTOMATED EMULATION in desktop Chromium with software WebGL — it is NOT a physical-device test.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 1 });
    await ctx.addInitScript(SEEN_INIT);
    const tp = await ctx.newPage(); const cdp = await ctx.newCDPSession(tp);
    tp.on('pageerror', (e) => errors.push('pageerror(touch): ' + e.message));
    tp.on('console', (m) => { if (m.type() === 'error') errors.push('console(touch): ' + m.text()); });
    await tp.goto(BASE); await tp.waitForFunction(() => !!window.voltaLab, null, { timeout: 30000 }); await tp.waitForTimeout(2500);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i })) });
    const tap = async (q) => { await touch('touchStart', [q]); await touch('touchEnd', []); };
    const sel = () => tp.evaluate(() => document.getElementById('sceneCanvas').dataset.wireSelected);
    const tconn = () => tp.evaluate(() => window.voltaLab.snapshot().inputs.connection);
    const tcam = () => tp.evaluate(() => (() => { const c = document.getElementById('sceneCanvas').dataset.cameraPosition.split(',').map(Number); return { x: c[0], y: c[1], z: c[2] }; })());
    const tmode = () => tp.evaluate(() => document.getElementById('sceneCanvas').dataset.cameraMode);
    const thint = () => tp.evaluate(() => { const h = document.getElementById('wireHint'); return { shown: h.classList.contains('show'), text: h.textContent }; });
    const twait = (fn) => tp.waitForFunction(`(${fn.toString()})(window.voltaLab.snapshot())`, null, { timeout: 30000 });
    const [TA, TB] = gripAt(390, 844);
    ok('touch 390: both cable tips are inside the visible viewport (reachable by a finger)', TA.x > 25 && TA.x < 365 && TB.x > 25 && TB.x < 365 && TA.y > 0 && TA.y < 844, `A.x=${TA.x.toFixed(0)} B.x=${TB.x.toFixed(0)}`);
    await tap(TA); await tp.waitForTimeout(300);
    ok('touch 390: tapping Lead A selects it and shows the instruction', (await sel()) === 'A' && /Lead A selected/.test((await thint()).text));
    await tap(TB); await twait((x) => x.inputs.connection === 'short');
    ok('touch 390: tapping Lead B then connects the wires (engine = short)', (await tconn()) === 'short' && (await sel()) === '');
    await tp.keyboard.press('s'); await twait((x) => x.inputs.connection === 'open');
    await tap(TB); await tap(TA); await twait((x) => x.inputs.connection === 'short');
    ok('touch 390: reverse order (B then A) also connects', (await tconn()) === 'short');
    await tp.keyboard.press('s'); await twait((x) => x.inputs.connection === 'open');
    await tap(TA); await tap(TA); await tp.waitForTimeout(200);
    ok('touch 390: tapping the selected lead again cancels and clears the hint', (await sel()) === '' && !/selected —/.test((await thint()).text));
    // wobble below the touch threshold (10 px) is still a tap
    await touch('touchStart', [TA]); await touch('touchMove', [{ x: TA.x + 6, y: TA.y + 4 }]); await touch('touchEnd', []); await tp.waitForTimeout(250);
    ok('touch 390: a 7 px finger wobble is still a tap (selects, does not drag)', (await sel()) === 'A');
    await tap(TA);
    // deliberate drag
    const camB = await tcam();
    await touch('touchStart', [TA]); for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: TA.x + 8 * i, y: TA.y - 5 * i }]); await touch('touchEnd', []); await tp.waitForTimeout(400);
    ok('touch 390: dragging a tip does not select it or connect, and the camera does not rotate', (await sel()) === '' && (await tconn()) === 'open' && moved(camB, await tcam()) < 0.005);
    await tap(TA); await tp.waitForTimeout(250);
    ok('touch 390: after the drag, the OLD grip position no longer selects Lead A', (await sel()) === '');
    await tap({ x: TA.x + 80, y: TA.y - 50 }); await tp.waitForTimeout(250);
    ok('touch 390: after the drag, the NEW position selects Lead A (the tip really moved with the finger)', (await sel()) === 'A');
    await tap({ x: TA.x + 80, y: TA.y - 50 });
    await tp.keyboard.press('s'); await tp.waitForTimeout(300);

    // camera modes × gestures: one-finger rotate, two-finger pinch (zoom), two-finger parallel drag (pan)
    const EMPTY = { x: 300, y: 200 }, MID = { x: 195, y: 200 };
    const gestures = {
      rotate: async () => { await touch('touchStart', [EMPTY]); for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: EMPTY.x - 14 * i, y: EMPTY.y + 3 * i }]); await touch('touchEnd', []); },
      pinch: async () => { await touch('touchStart', [{ x: MID.x - 30, y: MID.y }, { x: MID.x + 30, y: MID.y }]); for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: MID.x - 30 - 8 * i, y: MID.y }, { x: MID.x + 30 + 8 * i, y: MID.y }]); await touch('touchEnd', []); },
      pan: async () => { await touch('touchStart', [{ x: MID.x - 30, y: MID.y }, { x: MID.x + 30, y: MID.y }]); for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: MID.x - 30 + 8 * i, y: MID.y + 6 * i }, { x: MID.x + 30 + 8 * i, y: MID.y + 6 * i }]); await touch('touchEnd', []); },
    };
    // Camera state is read from two READ-ONLY views the app already renders: the position string `data-camera-position` and `data-camera-target`
    // on the canvas (a plain string, written by the HUD loop; nothing can be set through it).
    const tstate = () => tp.evaluate(() => {
      const c = document.getElementById('sceneCanvas');
      const t = c.dataset.cameraTarget.split(',').map(Number);
      return { p: c.dataset.cameraPosition.split(',').map(Number), t };
    });
    const vsub = (a, b) => a.map((v, i) => v - b[i]), vlen = (a) => Math.hypot(...a);
    // Classify what a gesture did, using the REAL orbit target: orbit = direction from the target changed while the distance and the
    // target stayed; zoom = distance changed, direction and target stayed; pan = target moved, distance and direction stayed.
    const classify = (s0, s1) => {
      const r0 = vsub(s0.p, s0.t), r1 = vsub(s1.p, s1.t);
      const dDist = vlen(r1) - vlen(r0), tMove = vlen(vsub(s1.t, s0.t)), pMove = vlen(vsub(s1.p, s0.p));
      const cos = (r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2]) / (vlen(r0) * vlen(r1)), angle = Math.acos(Math.min(1, Math.max(-1, cos)));
      let kind = 'other';
      if (pMove < 0.01 && tMove < 0.01) kind = 'none';
      else if (tMove < 0.02 && Math.abs(dDist) < 0.05 && angle > 0.05) kind = 'orbit';
      else if (tMove < 0.02 && Math.abs(dDist) > 0.3 && angle < 0.02) kind = 'zoom';
      else if (tMove > 0.1 && Math.abs(dDist) < 0.05 && angle < 0.02) kind = 'pan';
      return { kind, detail: `Δpos ${pMove.toFixed(3)}, Δtarget ${tMove.toFixed(3)}, Δdist ${dDist.toFixed(3)}, angle ${angle.toFixed(3)} rad` };
    };
    // Expected outcome per mode and gesture. In ROTATE ONLY the two-finger gestures ORBIT: OrbitControls (the installed three.js r186,
    // `onTouchStart` case 2: `if (enableZoom === false && enablePan === false) return;` — it returns WITHOUT leaving the state set by the first
    // finger) keeps TOUCH_ROTATE, so the first finger keeps orbiting. This is asserted as the actual behaviour of the installed version, together with
    // "no zoom, no pan, same distance, same target"; a different three.js version may behave differently and this check would then flag it.
    const expectations = {
      free: { rotate: 'orbit', pinch: 'zoom', pan: 'pan' },
      locked: { rotate: 'none', pinch: 'none', pan: 'none' },
      'zoom-only': { rotate: 'none', pinch: 'zoom', pan: 'none' },
      'rotate-only': { rotate: 'orbit', pinch: 'orbit', pan: 'orbit' },
    };
    for (const m of ['free', 'locked', 'zoom-only', 'rotate-only']) {
      while ((await tmode()) !== m) await tp.click('#cameraModeBtn');
      for (const g of ['rotate', 'pinch', 'pan']) {
        await tp.keyboard.press('r'); await tp.waitForTimeout(1200); // reset view; the camera MODE must survive this
        const s0 = await tstate(); await gestures[g]();
        const want = expectations[m][g];
        let s1 = s0, res = classify(s0, s0); const t0 = Date.now();
        while (Date.now() - t0 < (want === 'none' ? 3500 : 30000)) { await tp.waitForTimeout(600); s1 = await tstate(); res = classify(s0, s1); if (want !== 'none' && res.kind === want) break; }
        if (want === 'none') { await tp.waitForTimeout(1500); s1 = await tstate(); res = classify(s0, s1); } // also nothing after residual damping
        ok(`touch camera [${m.toUpperCase()}] ${g}: ${want === 'none' ? 'no camera change' : want + ' (and nothing else)'}`, res.kind === want && (await tmode()) === m, `got ${res.kind}; ${res.detail}`);
      }
    }
    while ((await tmode()) !== 'free') await tp.click('#cameraModeBtn');
    await tp.screenshot({ path: `${SHOT}/browser-check-touch-390.png` });
    await ctx.close();
  }

  // ---- mouse: PAN restrictions in all four modes (right-button drag = OrbitControls pan; keys stay disabled by the app)
  {
    await resetView();
    while ((await mode()) !== 'free') await page.click('#cameraModeBtn');
    const wantPan = { free: 1, locked: 0, 'zoom-only': 0, 'rotate-only': 0 };
    for (const m of ['free', 'locked', 'zoom-only', 'rotate-only']) {
      while ((await mode()) !== m) await page.click('#cameraModeBtn');
      await resetView(); await settle(1500);
      const c0 = await cam();
      await page.mouse.move(300, 250); await page.mouse.down({ button: 'right' }); await page.mouse.move(420, 300, { steps: 8 }); await page.mouse.up({ button: 'right' });
      let c1 = c0; const t0 = Date.now();
      while (Date.now() - t0 < (wantPan[m] ? 30000 : 3000)) { await page.waitForTimeout(500); c1 = await cam(); if (wantPan[m] && moved(c0, c1) > 0.1) break; }
      ok(`mouse camera [${m.toUpperCase()}] pan (right-button drag): ${wantPan[m] ? 'works' : 'is disabled'}`, wantPan[m] ? moved(c0, c1) > 0.1 : moved(c0, c1) < 0.01, `moved ${moved(c0, c1).toFixed(3)}`);
    }
    while ((await mode()) !== 'free') await page.click('#cameraModeBtn');
    await resetView();
  }

  // ---- empty battery never shows RUNNING (separate engine instance, same code as the machine)
  const emp = await page.evaluate(() => {
    const E = window.voltaLab.engine.constructor, base = window.voltaLab.engine.config;
    const e = new E({ ...base, initialSoc: 0 });
    e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 });
    for (let k = 0; k < 50; k++) e.step();
    return JSON.parse(JSON.stringify(e.snapshot()));
  });
  ok('empty battery + power ON: status battery-empty (never running), outputs zero, message explains', emp.status === 'battery-empty' && emp.output.voltage === 0 && emp.output.currentA === 0 && emp.battery.currentA === 0 && /empty/i.test(emp.protection.message));

  // ---- camera, responsive, console
  const camPos = () => page.evaluate(() => document.getElementById('sceneCanvas').dataset.cameraPosition);
  const cam0 = await camPos();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(600, 340, { steps: 8 }); await page.mouse.up();
  await page.mouse.wheel(0, 300); await page.waitForTimeout(500);
  ok('camera orbit/zoom changes the camera coordinates', (await camPos()) !== cam0);
  await page.screenshot({ path: `${SHOT}/browser-check-desktop.png` });
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`responsive ${w}×${h}: no horizontal page scroll`, !overflow);
    await page.screenshot({ path: `${SHOT}/browser-check-${w}.png` });
  }

  // ================= Premium UX / accessibility / SEO pass =================
  // (Automated checks in desktop Chromium with software WebGL. They do not replace a screen-reader or physical-device audit.)
  const gotoReady = async (pg) => { await pg.goto(BASE); await pg.waitForFunction(() => !!window.voltaLab, null, { timeout: 40000 }); await pg.waitForTimeout(800); };
  const attr = (pg, sel, a) => pg.evaluate(([s2, a2]) => document.querySelector(s2).getAttribute(a2), [sel, a]);
const txt2 = (pg, sel) => pg.evaluate((q) => (document.querySelector(q) || {}).textContent || '', sel);
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push('pageerror(ux): ' + e.message));
    await gotoReady(pg);
    // loading placeholder is gone once the 3D chunk has started
    ok('3D chunk loaded: loading placeholder removed', (await pg.locator('#sceneLoading').count()) === 0);
    // AC / DC radio group is synchronised with the 3D lever state, the M key and aria
    const modeState = () => pg.evaluate(() => ({ canvas: document.getElementById('sceneCanvas').dataset.sourceMode, ac: document.getElementById('modeAcBtn').getAttribute('aria-checked'), dc: document.getElementById('modeDcBtn').getAttribute('aria-checked'), unit: document.getElementById('voltageUnit').textContent, desc: document.getElementById('modeDesc').textContent }));
    await pg.click('#panelToggle'); await pg.waitForTimeout(400);
    ok('opening the panel moves focus to the active tab inside it', (await pg.evaluate(() => document.activeElement && document.activeElement.id)) === 'tab-controls');
    await pg.click('#modeDcBtn');
    let m1 = await modeState();
    ok('AC/DC buttons: DC click switches mode (scene, aria-checked, unit text, description)', m1.canvas === 'DC' && m1.dc === 'true' && m1.ac === 'false' && /DC/.test(m1.unit) && /DC/.test(m1.desc), JSON.stringify(m1));
    await pg.keyboard.press('m'); m1 = await modeState();
    ok('M key stays synchronised with the AC/DC buttons', m1.canvas === 'AC' && m1.ac === 'true' && m1.dc === 'false');
    await pg.focus('#modeAcBtn'); await pg.keyboard.press('ArrowRight'); m1 = await modeState();
    const focusedId = await pg.evaluate(() => document.activeElement.id);
    ok('AC/DC radio group: arrow key switches mode and moves focus (roving tabindex)', m1.canvas === 'DC' && focusedId === 'modeDcBtn' && (await attr(pg, '#modeDcBtn', 'tabindex')) === '0' && (await attr(pg, '#modeAcBtn', 'tabindex')) === '-1');
    await pg.keyboard.press('ArrowLeft'); m1 = await modeState(); ok('AC/DC radio group: arrow back to AC', m1.canvas === 'AC' && m1.ac === 'true');
    // Main power switch semantic state + keyboard
    await pg.focus('#powerBtn'); await pg.keyboard.press('Space');
    // The ARIA state is synchronous; the engine input is applied on the next rendered frame, which can be seconds away under software WebGL, so poll for it.
    await pg.waitForFunction(() => window.voltaLab.snapshot().inputs.powerOn === true, null, { timeout: 30000 }).catch(() => {});
    ok('Main Power switch: Space on the focused switch turns power ON and exposes aria-checked=true', (await attr(pg, '#powerBtn', 'aria-checked')) === 'true' && (await pg.evaluate(() => window.voltaLab.snapshot().inputs.powerOn)));
    await pg.keyboard.press('Space');
    ok('Main Power switch: toggles back OFF', (await attr(pg, '#powerBtn', 'aria-checked')) === 'false');
    // Escape closes the panel and returns focus to its toggle
    await pg.focus('#voltageSlider'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    ok('Escape closes the panel and returns focus to the panel toggle', (await attr(pg, '#panelToggle', 'aria-expanded')) === 'false' && (await pg.evaluate(() => document.activeElement.id)) === 'panelToggle');
    // closed panel is not reachable by keyboard
    const hiddenReachable = await pg.evaluate(() => { const panel = document.getElementById('controlPanel'); return getComputedStyle(panel).visibility !== 'hidden'; });
    ok('closed panel is visibility:hidden (not tabbable)', !hiddenReachable);
    // Help lives inside the Controls panel: ? opens the panel on the Help tab, focus lands on that tab
    await pg.keyboard.press('?'); await pg.waitForTimeout(400);
    const hp = await pg.evaluate(() => ({ open: document.querySelector('.stage').classList.contains('panel-open'), tab: document.querySelector('[role=tab][aria-selected=true]')?.id, focus: document.activeElement.id, pane: !document.getElementById('pane-help').hidden }));
    ok('? opens the Controls panel on the Help tab and moves focus to that tab', hp.open && hp.tab === 'tab-help' && hp.focus === 'tab-help' && hp.pane, JSON.stringify(hp));
    ok('Help tab lists the shortcuts in a real table with header cells', (await pg.locator('#pane-help table th[scope="col"]').count()) === 2 && (await pg.locator('#pane-help kbd').count()) >= 10);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    ok('Escape closes the panel and returns focus to the Controls button', !(await pg.evaluate(() => document.querySelector('.stage').classList.contains('panel-open'))) && (await pg.evaluate(() => document.activeElement.id)) === 'panelToggle');
    // heading structure and accessible names
    const struct = await pg.evaluate(() => {
      const hs = [...document.querySelectorAll('h1,h2,h3')].map((h) => Number(h.tagName[1]));
      let skip = false; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skip = true;
      const unnamed = [...document.querySelectorAll('button, [role="switch"], [role="radio"], input')].filter((b) => { const n = (b.getAttribute('aria-label') || b.textContent || '').trim() || (b.id && document.querySelector(`label[for="${b.id}"]`)?.textContent.trim()) || b.getAttribute('aria-labelledby'); return !n; }).map((b) => b.id || b.className);
      return { h1: hs.filter((x) => x === 1).length, skip, unnamed, lang: document.documentElement.lang, title: document.title, canonical: document.querySelector('link[rel=canonical]')?.href, ld: !!document.querySelector('script[type="application/ld+json"]') };
    });
    ok('rendered DOM: exactly one H1 and no skipped heading levels', struct.h1 === 1 && !struct.skip, JSON.stringify(struct));
    ok('rendered DOM: every button, switch, radio and input has an accessible name', struct.unnamed.length === 0, struct.unnamed.join(','));
    ok('rendered DOM: lang, title, canonical and structured data present', struct.lang === 'en' && struct.title === 'Volta Lab | Interactive 3D Power Electronics Simulator' && /\/$/.test(struct.canonical) && struct.ld);
    await ctx.close();
  }
  // First visit: nothing pops up, the simulator screen stays clean
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage(); await gotoReady(pg); await pg.waitForTimeout(800);
    const stray = await pg.evaluate(() => ({ dialogs: document.querySelectorAll('dialog[open]').length, toast: !!document.getElementById('introToast'), panelOpen: document.querySelector('.stage').classList.contains('panel-open') }));
    ok('first visit: no popup, toast or open panel; the scene is clean', stray.dialogs === 0 && !stray.toast && !stray.panelOpen, JSON.stringify(stray));
    await ctx.close();
  }
  // Reduced motion: honoured by the 3D scene, not only by CSS
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    ok('prefers-reduced-motion: scene reports reduced motion', (await attr(pg, '#sceneCanvas', 'data-reduced-motion')) === 'true');
    const pos = () => pg.evaluate(() => document.getElementById('sceneCanvas').dataset.cameraPosition.split(',').map(Number));
    await pg.mouse.move(700, 300); await pg.mouse.down(); await pg.mouse.move(820, 330, { steps: 6 }); await pg.mouse.up();
    await pg.waitForTimeout(1500); const a = await pos(); await pg.waitForTimeout(2500); const b = await pos();
    ok('prefers-reduced-motion: no camera inertia after releasing a drag', Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.005, `drift ${Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(4)}`);
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx2.addInitScript(SEEN_INIT);
    const pg2 = await ctx2.newPage(); await gotoReady(pg2);
    ok('default motion setting: scene reports reduced motion = false', (await attr(pg2, '#sceneCanvas', 'data-reduced-motion')) === 'false');
    await ctx2.close();
  }
  // ---- Minimal header and clean scene (redesign): only Controls, Wide View and View Free, right-aligned; clutter removed
  for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    const hd = await pg.evaluate(() => {
      const bar = document.querySelector('.topbar');
      const btns = [...bar.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim().replace(/\s+/g, ' ').toUpperCase(), l: r.left, r: r.right, w: r.width, h: r.height }; });
      const extras = [...bar.querySelectorAll('a, h1, h2, h3, img, nav, [class*=badge], [class*=brand]')].map((e) => e.tagName + '.' + e.className);
      const group = { l: Math.min(...btns.map((b) => b.l)), r: Math.max(...btns.map((b) => b.r)) };
      return { btns, extras, group, vw: innerWidth };
    });
    ok(`header ${name}: exactly three buttons, in order Controls, Wide View, View Free`, hd.btns.length === 3 && hd.btns.map((b) => b.t).join('|') === 'CONTROLS|WIDE VIEW|VIEW FREE', JSON.stringify(hd.btns.map((b) => b.t)));
    ok(`header ${name}: no title, links, badge or other navigation`, hd.extras.length === 0, hd.extras.join(','));
    ok(`header ${name}: group is right-aligned and compact`, hd.group.r >= hd.vw - 24 && (hd.group.r - hd.group.l) <= hd.vw * (w < 900 ? 0.8 : 0.35) && hd.btns.every((b) => b.h <= 48 && b.h >= (w < 700 ? 44 : 40)), JSON.stringify({ group: hd.group, vw: hd.vw, h: hd.btns.map((b) => b.h) }));
    const gone = await pg.evaluate(() => {
      const ids = ['coordX', 'coordY', 'coordZ', 'floatingVoltage', 'sceneStatusText', 'flowText', 'powerFlow', 'helpBtn', 'helpDialog', 'introToast'].filter((i) => document.getElementById(i));
      const txt = document.querySelector('.stage').innerText;
      const found = ['LIVE LEAD', 'RETURN LEAD', 'OUTPUT STATUS', 'MACHINE STANDBY', '60 FPS', 'DRAG CABLE', 'DRAG FRONT', 'ORBIT VIEW', 'OUTPUT VOLTAGE', 'SIMULATION ONLY', 'LEARNING HUB'].filter((t) => txt.toUpperCase().includes(t));
      return { ids, found, coord: /\bX:\s*-?\d/.test(txt) };
    });
    ok(`scene ${name}: coordinates, lead labels, status badge, footer text, instructions and floating voltage card are removed`, gone.ids.length === 0 && gone.found.length === 0 && !gone.coord, JSON.stringify(gone));
    await pg.screenshot({ path: `${SHOT}/redesign-${name}.png` });
    await ctx.close();
  }

  // ---- Controls panel: five tabs (Load Lab moved to the Workbench in Phase 1B), all content reachable inside it
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    await pg.click('#panelToggle'); await pg.waitForTimeout(500);
    const names = await pg.evaluate(() => [...document.querySelectorAll('#controlPanel [role=tab]')].map((t) => t.getAttribute('aria-label') || t.textContent.trim()));
    ok('Controls panel has the five Control Room sections as tabs (no Load Lab)', names.join('|') === 'Controls|Settings|Help|Learning Hub|Limitations & Safety', names.join('|'));
    ok('Controls tab holds Main Power, AC/DC, voltage, wire and camera controls', (await pg.evaluate(() => ['powerBtn', 'modeAcBtn', 'modeDcBtn', 'voltageSlider', 'touchWiresBtn', 'separateWiresBtn', 'resetCameraBtn'].every((i) => document.getElementById('pane-controls').contains(document.getElementById(i))))));
    await pg.focus('#tab-controls'); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(150);
    ok('ArrowRight on the tab list selects and focuses the next tab (Settings)', (await pg.evaluate(() => document.activeElement.id)) === 'tab-settings' && (await attr(pg, '#tab-settings', 'aria-selected')) === 'true' && !(await pg.locator('#pane-settings').isHidden()));
    ok('Settings tab: camera radio group with four options and a motion note', (await pg.locator('#cameraModeRadios [role=radio]').count()) === 4 && /reduce/i.test(await pg.locator('#motionSetting').textContent()));
    await pg.click('#cameraModeRadios [data-camera-mode="zoom-only"]'); await pg.waitForTimeout(200);
    ok('Settings camera mode changes the scene and the header button', (await attr(pg, '#sceneCanvas', 'data-camera-mode')) === 'zoom-only' && /ZOOM/i.test(await pg.locator('#cameraModeLabel').textContent()));
    await pg.click('#cameraModeRadios [data-camera-mode="free"]');
    await pg.click('#tab-help'); await pg.waitForTimeout(150);
    ok('Help tab: operating instructions, wire instructions and a shortcut table', (await pg.locator('#pane-help h3').count()) >= 3 && (await pg.locator('#pane-help table').count()) === 1);
    await pg.click('#tab-learn'); await pg.waitForTimeout(150);
    const links = await pg.evaluate(() => [...document.querySelectorAll('#pane-learn a[href]')].map((a) => a.getAttribute('href')));
    const want = ['/learn/', '/learn/dc-dc-converter-fundamentals/', '/learn/single-phase-h-bridge-inverter/', '/learn/battery-equivalent-circuit-model/', '/learn/ac-vs-dc-output/', '/learn/model-limitations-and-safety/'];
    ok('Learning Hub tab: overview and the five lessons are real links', want.every((l) => links.includes(l)), links.join(','));
    await pg.click('#tab-safety'); await pg.waitForTimeout(150);
    ok('Limitations & Safety tab: assumptions, limitations and the full-lesson link', (await pg.locator('#pane-safety h3').count()) >= 2 && (await pg.locator('#pane-safety a[href="/learn/model-limitations-and-safety/"]').count()) === 1);
    await pg.click('#panelClose'); await pg.waitForTimeout(300);
    ok('closing the panel returns to the clean scene and focus to the Controls button', !(await pg.evaluate(() => document.querySelector('.stage').classList.contains('panel-open'))) && (await pg.evaluate(() => document.activeElement.id)) === 'panelToggle');
    await ctx.close();
  }

  // ---- Electrical state: AC/DC switching with Main Power ON must never blank the LCD or reset anything
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    await pg.click('#panelToggle'); await pg.waitForTimeout(500);
    const st = () => pg.evaluate(() => { const s = window.voltaLab.snapshot(), c = document.getElementById('sceneCanvas').dataset; return { on: s.inputs.powerOn, mode: s.inputs.mode, status: s.status, soc: s.battery.socFrac, cur: s.output.currentA, lit: c.displayLit, dstate: c.displayState, sw: document.getElementById('powerBtn').getAttribute('aria-checked'), conn: s.inputs.connection }; });
    await pg.click('#powerBtn'); await pg.waitForTimeout(600);
    let s0 = await st();
    ok('Main Power ON: engine on, LCD lit, switch reads ON', s0.on && s0.lit === 'true' && s0.sw === 'true', JSON.stringify(s0));
    let bad = [], prevSoc = s0.soc;
    for (let i = 0; i < 10; i++) {
      const target = i % 2 === 0 ? '#modeDcBtn' : '#modeAcBtn'; await pg.click(target); await pg.waitForTimeout(250);
      const s = await st();
      if (!(s.on && s.sw === 'true' && s.lit === 'true' && s.mode === (i % 2 === 0 ? 'dc' : 'ac') && s.dstate !== 'off' && s.soc <= prevSoc + 1e-9 && prevSoc - s.soc < 0.01)) bad.push({ i, s });
      prevSoc = s.soc;
    }
    ok('10 AC/DC switches with power ON (open circuit): power stays ON, LCD stays lit, mode follows, SOC never resets', bad.length === 0, JSON.stringify(bad.slice(0, 2)));
    await pg.click('#touchWiresBtn'); await pg.waitForTimeout(500);
    await pg.click('#modeDcBtn'); await pg.waitForTimeout(300);
    const sShort = await st();
    ok('wires touched in DC with power ON: short is detected, LCD lit', sShort.conn === 'short' && sShort.lit === 'true' && sShort.on, JSON.stringify(sShort));
    await pg.click('#modeAcBtn'); await pg.waitForTimeout(300);
    await pg.waitForFunction(() => window.voltaLab.snapshot().status === 'tripped', null, { timeout: 150000 }).catch(() => {});
    const tr = await st();
    ok('protective trip with power ON: LCD stays lit showing a fault, switch still ON, no current invented', tr.status === 'tripped' && tr.lit === 'true' && tr.dstate === 'protected' && tr.on && tr.sw === 'true' && tr.cur === 0, JSON.stringify(tr));
    let bad2 = [];
    for (const t of ['#modeDcBtn', '#modeAcBtn', '#modeDcBtn', '#modeAcBtn']) { await pg.click(t); await pg.waitForTimeout(250); const s = await st(); if (!(s.status === 'tripped' && s.lit === 'true' && s.on && s.sw === 'true' && s.mode === (t === '#modeDcBtn' ? 'dc' : 'ac'))) bad2.push({ t, s }); }
    ok('mode switches while tripped keep the LCD lit, keep the latch, and update the mode label', bad2.length === 0, JSON.stringify(bad2.slice(0, 2)));
    await pg.click('#powerBtn'); await pg.waitForTimeout(500);
    const off = await st();
    ok('Main Power OFF is the only state with the LCD unlit', !off.on && off.lit === 'false' && off.dstate === 'off' && off.sw === 'false', JSON.stringify(off));
    await pg.click('#separateWiresBtn'); await pg.click('#powerBtn'); await pg.waitForTimeout(800);
    const back = await st();
    ok('after a power cycle with the wires apart the machine runs normally again', back.on && back.status === 'running' && back.lit === 'true' && back.conn === 'open', JSON.stringify(back));
    await ctx.close();
  }

  // Layout at the four target viewports: no overflow, no overlapping controls, readable targets
  for (const [w, h, name] of [[1440, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'phone'], [320, 640, 'narrow']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    for (const open of [false, true]) {
      if (open) { await pg.click('#panelToggle'); await pg.waitForTimeout(700); }
      const lay = await pg.evaluate(() => {
        const vis = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { s, l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
        const ids = ['#cameraModeBtn', '#explodeBtn', '#panelToggle'].map(vis).filter(Boolean);
        const overlaps = [];
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = ids[i], b = ids[j]; if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) overlaps.push(a.s + '×' + b.s); }
        const bar = document.querySelector('.topbar').getBoundingClientRect(), panel = document.getElementById('controlPanel').getBoundingClientRect();
        const open = document.querySelector('.stage').classList.contains('panel-open');
        const offscreen = ids.filter((r) => r.l < -0.5 || r.r > innerWidth + 0.5).map((r) => r.s);
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, overlaps, offscreen, panelBelowBar: !open || panel.top >= bar.bottom - 1, topbarH: Math.round(bar.height), cssTopbarH: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h') };
      });
      ok(`layout ${name} ${w}×${h} panel ${open ? 'open' : 'closed'}: no horizontal overflow, no off-screen or overlapping top-bar controls, panel clear of the top bar`, !lay.overflow && !lay.overlaps.length && !lay.offscreen.length && lay.panelBelowBar, JSON.stringify(lay));
    }
    // touch-target sizes of primary controls (WCAG 2.2 AA minimum is 24 CSS px; this project aims for 44)
    const hdrMin = w < 700 ? 44 : 40; // header buttons on a wide mouse-first screen are 40 px tall (WCAG 2.2 AA minimum is 24 px)
    const small = await pg.evaluate((hdrMin2) => ['#powerBtn', '#modeAcBtn', '#modeDcBtn', '#touchWiresBtn', '#separateWiresBtn', '#panelToggle', '#cameraModeBtn', '#explodeBtn', '[data-voltage]'].flatMap((s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return { s, id: e.id, w: Math.round(r.width), h: Math.round(r.height) }; })).filter((r) => r.w < 44 || r.h < (['#panelToggle', '#cameraModeBtn', '#explodeBtn'].includes(r.s) ? hdrMin2 : 44)), hdrMin);
    ok(`touch targets ${name} ${w}×${h}: primary controls are at least 44 × 44 CSS px (header buttons 40 px tall on wide screens)`, small.length === 0, JSON.stringify(small));
    await pg.screenshot({ path: `${SHOT}/ux-${name}-${w}.png` });
    await ctx.close();
  }
  // Crawlable files and Learning Hub (served by the same static server)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage();
    const origin = new URL(BASE).origin;
    const getStatus = async (path) => { const r = await ctx.request.get(origin + path); return { status: r.status(), type: r.headers()['content-type'] || '', text: await r.text() }; };
    const robots = await getStatus('/robots.txt'); ok('GET /robots.txt → 200 with Sitemap line', robots.status === 200 && /Sitemap:/.test(robots.text));
    const sm = await getStatus('/sitemap.xml'); const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    ok('GET /sitemap.xml → 200 and lists 7 URLs', sm.status === 200 && locs.length === 7, `${locs.length} URLs`);
    for (const f of ['/favicon.svg', '/apple-touch-icon.png', '/og-image.png', '/site.webmanifest', '/learn/learn.css']) { const r = await getStatus(f); ok(`GET ${f} → 200`, r.status === 200, `${r.status} ${r.type}`); }
    const hubLinks = [];
    for (const loc of locs) {
      const path = new URL(loc).pathname; if (path === '/') continue;
      await pg.goto(origin + path); await pg.waitForTimeout(150);
      const info = await pg.evaluate(() => ({ h1: document.querySelectorAll('h1').length, title: document.title, overflow: document.documentElement.scrollWidth > innerWidth + 1, canonical: document.querySelector('link[rel=canonical]')?.href, links: [...document.querySelectorAll('main a[href^="/"]')].map((a) => a.getAttribute('href')), small: [...document.querySelectorAll('.site-nav a, .pager a, .cta')].filter((a) => { const r = a.getBoundingClientRect(); return r.height < 44; }).length }));
      ok(`Learning page ${path}: one H1, title, canonical = sitemap URL, no overflow at 390px, tap targets ≥ 44px`, info.h1 === 1 && /\| Volta Lab$/.test(info.title) && info.canonical === loc && !info.overflow && info.small === 0, JSON.stringify({ ...info, links: info.links.length }));
      hubLinks.push(...info.links);
    }
    const bad = []; for (const l of new Set(hubLinks)) { const r = await getStatus(l); if (r.status !== 200) bad.push(l + ':' + r.status); }
    ok('every internal link on the Learning Hub resolves with HTTP 200', bad.length === 0, bad.join(','));
    await pg.goto(origin + '/learn/dc-dc-converter-fundamentals/'); await pg.setViewportSize({ width: 320, height: 640 }); await pg.waitForTimeout(200);
    ok('Learning page at 320px: no horizontal overflow', !(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    await pg.screenshot({ path: `${SHOT}/ux-learn-320.png`, fullPage: false });
    await ctx.close();
  }

  // ---- Load Lab in the Component Workbench (Phase 1B): real UI interaction against the real engine
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    const lerrs = []; pg.on('pageerror', (e) => lerrs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|fonts\.g/.test(m.text())) lerrs.push(m.text()); });
    const sn = () => pg.evaluate(() => JSON.parse(JSON.stringify(window.voltaLab.snapshot())));
    const ws = (fn, t = 40000) => pg.waitForFunction(`(${fn.toString()})(window.voltaLab.snapshot())`, null, { timeout: t });
    const slider = (v) => pg.evaluate((x) => { const el = document.getElementById('voltageSlider'); el.value = String(x); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    const txt = (sel) => pg.evaluate((q) => (document.querySelector(q) || {}).textContent || '', sel);
    const setField = async (key, value) => { await pg.fill(`#ll-${key}`, value); };
    // The side panel shows one area at a time (Library / Work area / Properties) on every width, so real clicks and typing first switch to the area that holds the target.
    const rawClick = pg.click.bind(pg), rawFill = pg.fill.bind(pg);
    const areaFor = (sel) => /#llLibrary/.test(sel) ? 'library' : /#llConnectBtn|#llDisconnectBtn|#llReplaceBtn|#llPreset|#ll-|#llForm|\.ll-optional|\[data-field/.test(sel) ? 'properties' : null;
    const goArea = async (a) => { if (!(await pg.locator('#workbench').isVisible())) return; if ((await pg.getAttribute('.wb-body', 'data-area')) !== a) { await rawClick(`[data-wb-area=${a === 'work' ? 'workspace' : a}]`); await pg.waitForTimeout(120); } };
    pg.click = async (sel, o) => { const a = typeof sel === 'string' && areaFor(sel); if (a) await goArea(a); return rawClick(sel, o); };
    pg.fill = async (sel, v, o) => { const a = typeof sel === 'string' && areaFor(sel); if (a) await goArea(a); return rawFill(sel, v, o); };
    const openWb = async () => { await pg.click('#workbenchBtn'); await pg.waitForSelector('#workbench', { state: 'visible' }); await pg.waitForTimeout(450); };
    const closeWb = async () => { await pg.click('#wbClose'); await pg.waitForSelector('#workbench', { state: 'hidden' }); await pg.waitForTimeout(300); };
    const ensurePanel = async () => { if ((await attr(pg, '#panelToggle', 'aria-expanded')) !== 'true') { await pg.click('#panelToggle'); await pg.waitForTimeout(500); } };
    const resultText = () => txt('#llResults');
    const msgText = () => txt('#llMsg');
    const hdrButtons = await pg.evaluate(() => document.querySelectorAll('.topbar button, header button').length);
    ok('machine screen keeps exactly the three header buttons (nothing added outside Controls)', hdrButtons === 3, String(hdrButtons));
    await pg.click('#panelToggle'); await pg.waitForTimeout(500);
    const tabNames = await pg.evaluate(() => [...document.querySelectorAll('#controlPanel [role=tab]')].map((t) => t.getAttribute('aria-label') || t.textContent.trim()));
    ok('Control Room no longer has a Load Lab tab, pane or roadmap card', !tabNames.includes('Load Lab') && tabNames.length === 5 && (await pg.evaluate(() => !document.getElementById('tab-loadlab') && !document.getElementById('pane-loadlab') && !document.getElementById('controlPanel').querySelector('.ll-roadmap, #llLibrary, #llForm'))), tabNames.join('|'));
    ok('Load Lab UI is not visible on the machine screen while the Workbench is closed', !(await pg.locator('#llLibrary').isVisible()));
    await openWb();
    ok('Workbench is independently reachable and the Load Lab hosts live inside it', await pg.evaluate(() => ['llLibrary', 'llWork', 'llLive', 'llStatus', 'llResults', 'llForm', 'llConnect', 'llStatusPill'].every((i) => document.getElementById('workbench').contains(document.getElementById(i)))));
    ok('left area is titled “Available Load Models” and says it is not the complete component library', /Available Load Models/.test(await txt('#wbLibraryHeading')) && /not the complete electronics component library/.test(await txt('[data-wb-region=library]')));
    // ---- Library sections (Management & Control, Circuits & Components, Transformers): lazy-loaded, honest, no fake controls ----
    await pg.waitForSelector('#libSections .lib-section', { timeout: 10000 });
    ok('Components section shows two library sections (Management & Control, Circuits & Components); Transformers has its own tab', (await pg.evaluate(() => [...document.querySelectorAll('#libSections .lib-section-name')].map((e) => e.textContent.trim()).join('|'))) === 'Management & Control|Circuits & Components' && (await pg.evaluate(() => !document.getElementById('libSections').querySelector('.lib-item') && document.getElementById('wbpane-transformers').contains(document.getElementById('libTransformers')))));
    ok('the sections sit above the load models and every section has a symbol marked decorative', await pg.evaluate(() => { const h = document.getElementById('libSections'), l = document.getElementById('llLibrary'); return !!(h.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) && [...h.querySelectorAll('.lib-section > summary svg')].length === 2 && [...h.querySelectorAll('.lib-section > summary svg')].every((v) => v.getAttribute('aria-hidden') === 'true'); }));
    ok('five transformer entries, each labelled catalogue-only / not simulated, with a circuit symbol caption', await pg.evaluate(() => { const c = [...document.querySelectorAll('#libTransformers .lib-item')]; return c.length === 5 && c.every((x) => /Catalogue entry only, not simulated/.test(x.querySelector('summary').textContent) && /circuit symbol/.test(x.textContent)); }));
    ok('no fake controls: Management/Circuits sections have none; Transformers has only the real Place/Drag buttons (no inputs until an item is on the bench)', await pg.evaluate(() => { const t = document.getElementById('libTransformers'); return document.getElementById('libSections').querySelectorAll('input, select, button, textarea, a').length === 0 && t.querySelectorAll('input, select, textarea, a').length === 0 && [...t.querySelectorAll('button')].every((x) => x.hasAttribute('data-place') || x.hasAttribute('data-grip')) && t.querySelectorAll('button').length === 10; }));
    ok('Management lists what is available now and what is planned, honestly', await pg.evaluate(() => { const t = document.querySelector('#libSections .lib-section').textContent; return /Available now/.test(t) && /Planned, not available yet/.test(t); }));
    ok('the category tree shows 11 shelves and marks empty ones', await pg.evaluate(() => document.querySelectorAll('#libSections .lib-cat').length === 11 && /empty/.test(document.querySelector('#libSections').textContent)));
    await pg.evaluate(() => document.querySelector('#libTransformers .lib-item').setAttribute('open', ''));
    ok('an opened transformer explains itself: what it is, what it does, terminals, ideal relations, no invented values', await pg.evaluate(() => { const b = document.querySelector('#libTransformers .lib-item .lib-item-body').textContent; return /What it is/.test(b) && /What it does in a circuit/.test(b) && /Terminals/.test(b) && /Vp \/ Vs = Np \/ Ns/.test(b) && /No values are given here/.test(b) && !/\d+\s?(kV|kVA|MVA)\b/.test(b); }));
    ok('the load models below still render and no horizontal scroll is created', (await pg.evaluate(() => document.querySelectorAll('#llLibrary [role=radio]').length)) === 5 && (await pg.evaluate(() => { const r = document.querySelector('[data-wb-region=library]'); return r.scrollWidth <= r.clientWidth + 1; })));
    await pg.screenshot({ path: `${SHOT}/shot-library-sections-desktop.png` });
    const cards = await pg.evaluate(() => [...document.querySelectorAll('#llLibrary [role=radio]')].map((b) => b.dataset.load));
    ok('library shows exactly the five load models (no AC-input supply / DC module)', cards.join('|') === 'resistor|inductor|capacitor|rlc|dc-motor', cards.join('|'));
    ok('each card shows the full name, a plain explanation, AC/DC input support, a model limitation and a labelled circuit symbol', await pg.evaluate(() => [...document.querySelectorAll('#llLibrary .ll-card')].every((c) => c.querySelector('.ll-card-name').textContent.length > 4 && c.querySelector('.ll-card-sum').textContent.length > 20 && /Input/.test(c.textContent) && /(AC|DC)/.test(c.querySelector('.ll-card-meta').textContent) && /Limit/.test(c.textContent) && /circuit symbol/i.test(c.querySelector('.ll-symbol-tag').textContent) && c.querySelector('svg').getAttribute('aria-hidden') === 'true')));
    ok('library names Resistor, Inductor, Capacitor, Series RLC circuit and DC motor in full', await pg.evaluate(() => [...document.querySelectorAll('#llLibrary .ll-card-name')].map((e) => e.textContent).join('|')) === 'Resistor|Inductor (coil)|Capacitor (in series)|Series RLC circuit|DC motor');
    ok('the library explains that the drawings are circuit symbols, not pictures of parts', /circuit symbols/.test(await txt('[data-wb-region=library]')) && /not pictures of physical parts/.test(await txt('[data-wb-region=library]')));
    ok('roadmap is labelled planned and contains no interactive controls', await pg.evaluate(() => { const r = document.querySelector('.ll-roadmap'); return /planned, not available yet/i.test(r.textContent) && r.querySelectorAll('button, input, a, select').length === 0; }));

    // nothing selected: clean empty state
    ok('with no model selected the work area and properties show clean empty states', /No model selected/.test(await txt('#llWork')) && /Nothing selected/.test(await txt('#llForm')) && await (async () => { await goArea('workspace'); return pg.locator('#llLive').isHidden(); })() && (await pg.locator('#ll-ohms').count()) === 0);
    ok('no card is selected and Connect is disabled until a model is chosen', await pg.evaluate(() => [...document.querySelectorAll('#llLibrary [role=radio]')].every((b) => b.getAttribute('aria-checked') === 'false') && document.getElementById('llConnectBtn').disabled));

    // selection
    await pg.click('#llLibrary [data-load="resistor"]'); await pg.waitForTimeout(500);
    ok('choosing a card marks it selected (aria-checked and a visible “Selected” label)', (await attr(pg, '#llLibrary [data-load="resistor"]', 'aria-checked')) === 'true' && /Selected/.test(await txt('#llLibrary [data-load="resistor"] .ll-selected-tag')));
    const workTxt = await txt('#llWork');
    ok('work area shows the model name, explanation, what it does in a circuit and AC/DC compatibility', /Resistor/.test(workTxt) && /Ohm.s law/.test(workTxt) && /In a circuit/.test(workTxt) && /Limits the current/.test(workTxt) && /Works on/.test(workTxt) && /AC or DC/.test(workTxt) && /circuit symbol/.test(workTxt), workTxt.replace(/\s+/g, ' ').slice(0, 200));
    await goArea('workspace'); ok('work area shows the live connection status area once a model is chosen (no load yet)', (await pg.locator('#llLive').isVisible()) && /NO LOAD/.test(await txt('#llStatus')) && /No load connected/.test(await resultText()), await txt('#llStatus'));
    const lbl = await txt('[data-field=ohms] label'), help = await txt('[data-field=ohms] .ll-help');
    ok('properties explain notation: “Resistance (R)”, “measured in ohms (Ω)”, allowed range', /Resistance \(R\)/.test(lbl) && /Measured in ohms \(Ω\)/.test(help) && /Allowed/.test(help), `${lbl} | ${help}`);
    ok('example values are labelled illustrative and not a manufacturer rating', /ILLUSTRATIVE/.test(await txt('#llProvenance')) && /not a manufacturer rating/.test(await txt('#llProvenance')));
    ok('properties state that values are not manufacturer product ratings, and the glossary explains the terms', /not manufacturer product ratings/.test(await txt('[data-wb-region=properties]')) && await pg.evaluate(() => { const g = document.querySelector('.ll-glossary').textContent; return /microfarad\) is one-millionth of a farad/.test(g) && /RLC[\s\S]*Resistor, inductor and capacitor/.test(g) && /henries \(H\)/.test(g) && /ohms \(Ω\)/.test(g) && /farads \(F\)/.test(g); }));

    // invalid input feedback, nothing reaches the engine
    await setField('ohms', 'abc'); await pg.waitForTimeout(150);
    ok('invalid text shows an error and aria-invalid', /plain number/.test(await txt('[data-field=ohms] .ll-err')) && (await attr(pg, '#ll-ohms', 'aria-invalid')) === 'true');
    ok('typing a value switches provenance to user-specified', /user-specified/i.test(await txt('#llProvenance')));
    await pg.click('#llConnectBtn'); await pg.waitForTimeout(500);
    ok('Connect with invalid input is refused with a message and focus returns to the field', /Cannot connect/.test(await msgText()) && (await pg.evaluate(() => document.activeElement.id)) === 'll-ohms');
    ok('engine connection stays open after the refused connect', (await sn()).inputs.connection === 'open');
    for (const bad of ['-5', '0', 'Infinity', '1e999']) { await setField('ohms', bad); await pg.waitForTimeout(100); ok(`invalid resistance “${bad}” is rejected`, (await txt('[data-field=ohms] .ll-err')).length > 5); }
    await setField('ohms', '77'); await pg.click('#llLibrary [data-load="resistor"]'); await pg.waitForTimeout(250);
    ok('choosing the already-selected model again does not wipe typed values', (await pg.inputValue('#ll-ohms')) === '77');
    await pg.click('#llPreset'); await pg.waitForTimeout(200);
    ok('“Use example values” restores a valid form', (await pg.inputValue('#ll-ohms')) === '50' && (await txt('[data-field=ohms] .ll-err')) === '');
    ok('optional ratings are offered, blank by default and labelled as not manufacturer data', await pg.evaluate(() => { const d = document.querySelector('.ll-optional'); return /not manufacturer data/.test(d.querySelector('summary').textContent) && d.querySelector('#ll-ratedCurrentA').value === '' && d.querySelector('#ll-ratedPowerW').value === ''; }));

    // machine ON, AC 100 V, resistor 50 Ω through the real UI
    await closeWb();
    await ensurePanel(); await pg.click('#powerBtn'); await slider(100);
    await ws((x) => x.inputs.powerOn && Math.abs(x.output.targetV - 100) < 0.5);
    await openWb();
    ok('reopening the Workbench keeps the selected model and its form values', (await attr(pg, '#llLibrary [data-load="resistor"]', 'aria-checked')) === 'true' && (await pg.inputValue('#ll-ohms')) === '50');
    await pg.click('#llConnectBtn');
    await ws((x) => x.inputs.connection === 'load' && Math.abs(x.output.voltage - 100) < 0.6); await pg.waitForTimeout(700);
    let s = await sn();
    ok('Connect load creates a real engine load connection: 50 Ω at 100 V AC → 2 A, 200 W', s.inputs.connection === 'load' && Math.abs(s.output.currentA - 2) < 0.02 && Math.abs(s.output.pRealW - 200) < 3, `${s.output.currentA} A ${s.output.pRealW} W`);
    ok('status pill, connection status and Connect message agree with the engine', /LOAD CONNECTED/.test(await txt('#llStatusPill')) && /LOAD CONNECTED/.test(await txt('#llStatus')) && /Connected: Resistor/.test(await msgText()), `${await txt('#llStatusPill')} | ${await msgText()}`);
    const rt = await resultText();
    ok('results show values copied from the snapshot (AC, 2.00 A RMS, power factor 1.000)', /AC/.test(rt) && /2\.0\d A RMS/.test(rt) && /1\.000/.test(rt), rt.replace(/\s+/g, ' ').slice(0, 220));
    ok('data source is shown (illustrative example)', /Illustrative example/.test(rt));
    const shown = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#llResults .ll-results > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])));
    ok('displayed voltage, current and real power match the engine snapshot', Math.abs(parseFloat(shown['Terminal voltage (V)']) - s.output.voltage) < 0.2 && Math.abs(parseFloat(shown['Load current (I)']) - s.output.currentA) < 0.02 && Math.abs(parseFloat(shown['Real power (P)']) - s.output.pRealW) < 2, JSON.stringify(shown));
    const soc0 = s.battery.socFrac;

    // close and reopen with the load connected: experiment preserved, results synchronised
    await closeWb();
    ok('closing the Workbench keeps the load connected and the machine running', (await sn()).inputs.connection === 'load' && (await sn()).inputs.powerOn && /LOAD CONNECTED/.test(await txt('#llStatusPill')));
    await openWb();
    ok('reopening shows the same selection, the connected load and synchronised results', (await attr(pg, '#llLibrary [data-load="resistor"]', 'aria-checked')) === 'true' && /Replace connected load/.test(await txt('#llConnectBtn')) && /2\.0\d A RMS/.test(await resultText()));
    await closeWb();

    // AC → DC with the load attached: load, power and LCD stay; SOC does not reset
    await ensurePanel(); await pg.click('#modeDcBtn');
    await ws((x) => x.output.kind === 'dc' && x.inputs.connection === 'load' && Math.abs(x.output.voltage - 100) < 0.6); await pg.waitForTimeout(600);
    s = await sn();
    ok('AC→DC with a load: still connected, Main Power ON, 2 A DC, SOC not reset', s.inputs.connection === 'load' && s.inputs.powerOn && Math.abs(s.output.currentA - 2) < 0.02 && s.battery.socFrac <= soc0 && s.battery.socFrac > soc0 - 0.01, `${s.output.currentA} ${s.battery.socFrac}`);
    ok('LCD stays lit after the mode change', (await attr(pg, '#sceneCanvas', 'data-display-lit')) === 'true');
    await openWb(); await pg.waitForTimeout(500);
    const dcRt = await resultText();
    ok('DC results show “not defined” for apparent/reactive power and power factor (never invented)', /DC/.test(dcRt) && (dcRt.match(/not defined/g) || []).length === 3, dcRt.replace(/\s+/g, ' ').slice(0, 260));
    ok('the work area status line reports the new input mode for the selected model', /Input now:\s*DC/.test(await txt('#llStatus')), await txt('#llStatus'));
    await closeWb();

    // wire conflict rule: a connected load is never replaced by touching the leads
    await ensurePanel(); await pg.click('#tab-controls'); await pg.click('#touchWiresBtn'); await pg.waitForTimeout(500);
    ok('Touch wire ends is refused while a load is connected; engine stays on the load', (await sn()).inputs.connection === 'load' && /Disconnect it in the Workbench/.test(await txt('#wireHint')), await txt('#wireHint'));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    await pg.evaluate(() => document.activeElement && document.activeElement.blur());
    await pg.keyboard.press('t'); await pg.waitForTimeout(500);
    ok('keyboard T is refused the same way (still a load, no short)', (await sn()).inputs.connection === 'load');
    // Disconnect, then short test works, then connecting while touching is refused
    await openWb();
    await pg.click('#llDisconnectBtn'); await ws((x) => x.inputs.connection === 'open'); await pg.waitForTimeout(500);
    s = await sn();
    ok('Disconnect returns to an open circuit: 0 A, load gone from the snapshot', s.output.currentA === 0 && s.load === null && /NO LOAD/.test(await txt('#llStatusPill')) && /NO LOAD/.test(await txt('#llStatus')));
    ok('after Disconnect the results panel says nothing is connected and Disconnect is disabled', /No load connected/.test(await resultText()) && (await pg.locator('#llDisconnectBtn').isDisabled()));
    await closeWb();
    await ensurePanel(); await pg.click('#tab-controls'); await pg.click('#touchWiresBtn'); await ws((x) => x.inputs.connection === 'short');
    ok('after a deliberate disconnect, touching the leads is a short-circuit test again', (await sn()).inputs.connection === 'short');
    await openWb(); await pg.waitForTimeout(500);
    ok('while the leads touch, the Workbench status says SHORT-CIRCUIT TEST (a fault test, not a load)', /SHORT-CIRCUIT TEST/.test(await txt('#llStatus')));
    await pg.click('#llConnectBtn'); await pg.waitForTimeout(500);
    ok('Connect load while the leads touch is refused with an explanation (short is not turned into a load)', (await sn()).inputs.connection !== 'load' && /Separate the leads first/.test(await msgText()), await msgText());
    await closeWb();
    await ensurePanel(); await pg.click('#tab-controls'); await pg.click('#separateWiresBtn'); await ws((x) => x.inputs.connection === 'open');
    await pg.click('#powerBtn'); await pg.waitForTimeout(200); await pg.click('#powerBtn'); await slider(100); // reset any trip from the short test
    await ws((x) => x.inputs.powerOn && x.status !== 'tripped');

    // every load connects and behaves per its model, using the real form
    await openWb();
    const connectNow = async (id) => { await pg.click(`#llLibrary [data-load="${id}"]`); await pg.click('#llConnectBtn'); await ws((x) => x.inputs.connection === 'load'); await pg.waitForTimeout(800); return sn(); };
    s = await connectNow('capacitor');
    ok('capacitor in DC mode: blocks steady DC (0 A)', s.output.kind === 'dc' && s.output.currentA === 0 && /Capacitor/.test(s.load.label), `${s.output.currentA}`);
    ok('the capacitor card advertises that it blocks steady DC', /blocks steady DC/.test(await txt('#llLibrary [data-load="capacitor"] .ll-card-meta')));
    await closeWb(); await ensurePanel(); await pg.click('#modeAcBtn'); await ws((x) => x.output.kind === 'ac'); await pg.waitForTimeout(700);
    s = await sn();
    ok('capacitor in AC mode at 100 V: I = V/XC ≈ 3.14 A', Math.abs(s.output.currentA - 3.1416) < 0.05, `${s.output.currentA}`);
    await openWb();
    s = await connectNow('inductor');
    ok('inductor in AC: I ≈ 2.69 A, PF ≈ 0.537, reactive power reported', Math.abs(s.output.currentA - 2.685) < 0.03 && Math.abs(s.load.op.powerFactor - 0.537) < 0.01 && s.load.op.qVAr > 200, `${s.output.currentA} ${s.load.op.powerFactor}`);
    s = await connectNow('rlc');
    ok('series RLC in AC: I ≈ 5.0 A', Math.abs(s.output.currentA - 4.998) < 0.05, `${s.output.currentA}`);
    ok('the RLC work area explains the acronym', /resistor, inductor and capacitor/i.test(await txt('#llWork')), (await txt('#llWork')).slice(0, 160));
    s = await connectNow('dc-motor');
    ok('DC motor on AC is flagged unsupported with a causal reason', s.load.health.state !== 'normal' && s.load.health.reasons.some((r) => /rated for DC but is driven with AC/.test(r)), JSON.stringify(s.load.health.reasons));
    ok('the reason is shown to the learner in the results', /rated for DC but is driven with AC/.test(await resultText()));
    ok('the DC motor work area says it works on DC only', /DC only/.test(await txt('#llWork')));
    await closeWb(); await ensurePanel(); await pg.click('#modeDcBtn'); await ws((x) => x.output.kind === 'dc'); await pg.waitForTimeout(900);
    await openWb(); await pg.click('#llConnectBtn'); await pg.waitForTimeout(900); // re-connect a fresh motor (health of the AC-driven one is not reused)
    s = await sn();
    ok('DC motor on DC at 100 V: steady-state current ≈ 0.79 A', Math.abs(s.output.currentA - 0.7937) < 0.03, `${s.output.currentA}`);
    ok('Connect again replaces the load with an explicit message', /Replaced the previous load/.test(await msgText()), await msgText());

    // results follow the engine continuously while the Workbench stays open (a load attached through the existing coordinator API)
    await pg.evaluate(() => window.voltaLab.attachLoad(window.voltaLab.loads.resistiveLoad(100)));
    await pg.waitForFunction(() => /1\.00 A DC/.test(document.getElementById('llResults').textContent), null, { timeout: 30000 });
    ok('results refresh continuously from the engine snapshot while the Workbench is open (100 Ω at 100 V DC → 1.00 A)', /1\.00 A DC/.test(await resultText()), (await resultText()).replace(/\s+/g, ' ').slice(0, 140));

    // keyboard: radiogroup arrow navigation, focus management
    await goArea('library'); await pg.focus('#llLibrary [data-load="resistor"]'); await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(250);
    ok('ArrowDown in the library moves selection and focus to the next load', (await pg.evaluate(() => document.activeElement.dataset.load)) === 'inductor' && (await attr(pg, '#llLibrary [data-load="inductor"]', 'aria-checked')) === 'true');
    ok('exactly one library card is in the tab order (roving tabindex)', (await pg.evaluate(() => [...document.querySelectorAll('#llLibrary [role=radio]')].filter((b) => b.tabIndex === 0).length)) === 1);
    const unlabeled = await pg.evaluate(() => [...document.querySelectorAll('#workbench input, #workbench select')].filter((i) => !(i.labels && i.labels.length) && !i.getAttribute('aria-label')).length);
    ok('every Workbench input and select has an accessible name', unlabeled === 0, String(unlabeled));
    const dupIds = await pg.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); });
    ok('no duplicate DOM ids with a model selected, a load connected and the form rendered', dupIds.length === 0, dupIds.join(','));
    const geo = await pg.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('workbench').scrollWidth > innerWidth + 1, panel: (() => { const b = document.getElementById('workbench').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width), Math.round(b.height)]; })(), shown: ['library', 'workspace', 'properties'].filter((r) => getComputedStyle(document.querySelector(`[data-wb-region=${r}]`)).display !== 'none') }));
    ok('desktop 1440: side panel (≤441 px wide, left edge ≤12 px, shorter than the viewport) shows exactly one area with content, no horizontal overflow', !geo.overflow && geo.panel[1] <= 441 && geo.panel[0] <= 12 && geo.panel[2] < 900 && geo.shown.length === 1, JSON.stringify(geo));
    await pg.screenshot({ path: `${SHOT}/workbench-loadlab-desktop.png` });
    await closeWb();
    ok('closing the Workbench leaves only the machine screen (no Load Lab UI visible)', !(await pg.locator('#llLibrary').isVisible()));
    ok('no uncaught errors or console errors while using Load Lab in the Workbench', lerrs.length === 0, lerrs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ---- Load Lab in the Workbench on a 390 × 844 phone viewport (touch emulation, NOT a physical device)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    const sn = () => pg.evaluate(() => JSON.parse(JSON.stringify(window.voltaLab.snapshot())));
    const shownRegion = () => pg.evaluate(() => ['library', 'workspace', 'properties'].filter((r) => getComputedStyle(document.querySelector(`[data-wb-region=${r}]`)).display !== 'none'));
    await pg.tap('#workbenchBtn'); await pg.waitForTimeout(600);
    ok('phone: opens on the Library area showing all five models', (await shownRegion()).join() === 'library' && (await pg.locator('#llLibrary [role=radio]').count()) === 5);
    await pg.tap('#llLibrary [data-load="inductor"]'); await pg.waitForTimeout(500);
    ok('phone: choosing a model moves automatically to its Properties area and focuses it', (await shownRegion()).join() === 'properties' && (await attr(pg, '[data-wb-area=properties]', 'aria-pressed')) === 'true' && (await pg.evaluate(() => document.activeElement.id)) === 'wbPropertiesHeading');
    ok('phone: the Properties area shows the chosen model’s values with units explained', (await pg.locator('#ll-henries').count()) === 1 && /henries \(H\)/.test(await txt2(pg, '[data-field=henries] .ll-help')));
    await pg.fill('#ll-ohms', '33'); await pg.tap('[data-wb-area=workspace]'); await pg.waitForTimeout(300);
    ok('phone: switching to Work area shows the selected model and keeps the selection', (await shownRegion()).join() === 'workspace' && /Inductor/.test(await txt2(pg, '#llWork')));
    await pg.tap('[data-wb-area=properties]'); await pg.waitForTimeout(300);
    ok('phone: configuration is preserved when switching between areas', (await pg.inputValue('#ll-ohms')) === '33');
    const m = await pg.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const small = [...document.querySelectorAll('#workbench button, #workbench input, #workbench select, #workbench summary')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44 && e.getBoundingClientRect().height > 0).map((e) => e.id || e.className);
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('workbench').scrollWidth > innerWidth + 1, small, connectH: r('llConnectBtn').height };
    });
    ok('phone 390px: no horizontal overflow and Workbench touch targets ≥ 44px', !m.overflow && m.small.length === 0, JSON.stringify(m));
    await pg.tap('#llPreset'); await pg.tap('#llConnectBtn'); await pg.waitForFunction(() => window.voltaLab.snapshot().inputs.connection === 'load', null, { timeout: 30000 });
    ok('phone: tapping Connect load attaches a real engine load', (await sn()).inputs.connection === 'load');
    await pg.tap('[data-wb-area=workspace]'); await pg.waitForTimeout(900);
    ok('phone: Work area shows the connection status and live results', /LOAD CONNECTED/.test(await txt2(pg, '#llStatus')) && /Load current/.test(await txt2(pg, '#llResults')));
    await pg.screenshot({ path: `${SHOT}/workbench-loadlab-phone.png` });
    await pg.tap('#wbClose'); await pg.waitForTimeout(500); await pg.tap('#workbenchBtn'); await pg.waitForTimeout(600);
    ok('phone: closing and reopening keeps the selection, the area and the connected load', (await attr(pg, '#llLibrary [data-load="inductor"]', 'aria-checked')) === 'true' && (await sn()).inputs.connection === 'load' && (await shownRegion()).join() === 'workspace');
    await pg.tap('[data-wb-area=properties]'); await pg.waitForTimeout(300);
    await pg.tap('#llDisconnectBtn'); await pg.waitForFunction(() => window.voltaLab.snapshot().inputs.connection === 'open', null, { timeout: 30000 });
    ok('phone: tapping Disconnect returns to open circuit', (await sn()).inputs.connection === 'open');
    await ctx.close();
  }

  // ---- Component Workbench shell (side panel): non-modal left panel, machine state untouched and still usable while it is open
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    const werrs = []; pg.on('pageerror', (e) => werrs.push(e.message));
    const sn = () => pg.evaluate(() => JSON.parse(JSON.stringify(window.voltaLab.snapshot())));
    const ws = (fn, t = 40000) => pg.waitForFunction(`(${fn.toString()})(window.voltaLab.snapshot())`, null, { timeout: t });
    const box = (sel) => pg.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
    const wbBtn = await box('#workbenchBtn');
    const hdrBtns = await pg.evaluate(() => document.querySelectorAll('.topbar button, header button').length);
    ok('Workbench button sits at the TOP-LEFT of the machine screen, outside the three-button header', wbBtn.l < 60 && wbBtn.t < 40 && hdrBtns === 3 && (await pg.evaluate(() => !document.querySelector('.topbar').contains(document.getElementById('workbenchBtn')))), JSON.stringify(wbBtn));
    ok('Workbench is closed on load (hidden, aria-expanded=false)', (await pg.locator('#workbench').isHidden()) && (await attr(pg, '#workbenchBtn', 'aria-expanded')) === 'false');

    // machine state to preserve: power ON, 120 V, a connected resistor load, a non-default camera mode
    await pg.click('#cameraModeBtn'); await pg.waitForTimeout(300); await pg.click('#cameraModeBtn'); await pg.waitForTimeout(300); // FREE -> LOCKED -> ZOOM ONLY (so a leaked wheel event WOULD move the camera)
    const camMode = await attr(pg, '#sceneCanvas', 'data-camera-mode');
    await pg.click('#panelToggle'); await pg.waitForTimeout(500); await pg.click('#powerBtn');
    await pg.evaluate(() => { const el = document.getElementById('voltageSlider'); el.value = '120'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await ws((x) => x.inputs.powerOn && Math.abs(x.output.targetV - 120) < 0.5);
    await pg.evaluate(() => window.voltaLab.attachLoad(window.voltaLab.loads.resistiveLoad(50)));
    await ws((x) => x.inputs.connection === 'load' && Math.abs(x.output.currentA - 2.4) < 0.05); await pg.click('#panelClose'); await pg.waitForTimeout(400);
    const before = await sn(); const camPos0 = await attr(pg, '#sceneCanvas', 'data-camera-position');

    await pg.click('#workbenchBtn'); await pg.waitForTimeout(400);
    ok('clicking Workbench opens a visible side panel and sets aria-expanded', (await pg.locator('#workbench').isVisible()) && (await attr(pg, '#workbenchBtn', 'aria-expanded')) === 'true');
    const wbBox = await box('#workbench');
    ok('the panel is a left side panel, NOT full screen (≤ 441 px wide, shorter than the viewport, left of the Controls panel)', wbBox.w <= 441 && wbBox.h < 900 && wbBox.l >= 0 && wbBox.l <= 12 && (await pg.evaluate(() => document.getElementById('workbench').getBoundingClientRect().left < document.getElementById('controlPanel').getBoundingClientRect().left)), JSON.stringify(wbBox));
    ok('focus moves to the panel title', (await pg.evaluate(() => document.activeElement.id)) === 'wbTitle');
    ok('the machine page is NOT inert while the Workbench is open (non-modal) and the canvas stays visible; the scene docks beside the panel', await pg.evaluate(() => document.getElementById('app').inert === false && document.getElementById('sceneCanvas').getBoundingClientRect().width > 100 && Math.round(document.querySelector('.scene-section').getBoundingClientRect().left) === 464));
    ok('the panel is a labelled complementary landmark, not a dialog (no role=dialog / aria-modal)', await pg.evaluate(() => { const p = document.getElementById('workbench'); return p.tagName === 'ASIDE' && !p.hasAttribute('aria-modal') && p.getAttribute('role') === null && !!p.getAttribute('aria-labelledby'); }));
    const tabsInfo = await pg.evaluate(() => { const t = [...document.querySelectorAll('#workbench [role=tab]')]; return { names: t.map((x) => x.textContent.trim()).join('|'), sel: t.map((x) => x.getAttribute('aria-selected')).join(','), panes: t.map((x) => !document.getElementById(x.getAttribute('aria-controls')).hidden).join(','), tabbable: t.filter((x) => x.tabIndex === 0).length }; });
    ok('three section tabs (Components, Transformers, Section 3): Components selected and shown, one tab in the tab order', tabsInfo.names === 'Components|Transformers|Section 3' && tabsInfo.sel === 'true,false,false' && tabsInfo.panes === 'true,false,false' && tabsInfo.tabbable === 1, JSON.stringify(tabsInfo));
    const rg = await pg.evaluate(() => ['library', 'workspace', 'properties'].map((r) => { const e = document.querySelector(`[data-wb-region="${r}"]`); return { r, shown: getComputedStyle(e).display !== 'none', name: e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby')).textContent }; }));
    ok('Components section: the area switcher is always visible; only the Library area shows first; the three areas are labelled Available Load Models | Work area | Properties', (await pg.locator('.wb-switch').isVisible()) && rg[0].shown && !rg[1].shown && !rg[2].shown && rg.map((x) => x.name).join('|') === 'Available Load Models|Work area|Properties', JSON.stringify(rg));
    ok('the shell fakes no canvas (no inputs, selects or canvas exist until a load model is chosen)', (await pg.evaluate(() => document.querySelectorAll('#workbench canvas').length)) === 0);
    // the Transformers and Section 3 tabs
    await pg.click('#wbtab-transformers'); await pg.waitForTimeout(150);
    ok('Transformers tab shows the five transformer cards and hides Components', await pg.evaluate(() => !document.getElementById('wbpane-transformers').hidden && document.getElementById('wbpane-components').hidden && document.querySelectorAll('#libTransformers .lib-item').length === 5));
    await pg.click('#wbtab-third'); await pg.waitForTimeout(150);
    ok('Section 3 is an honest catalogue: 12 kinds of resistor, capacitor and diode, each marked not simulated, with symbols, and no controls', await pg.evaluate(() => { const p = document.getElementById('wbpane-third'); const cards = [...p.querySelectorAll('.lib-item')]; const groups = [...p.querySelectorAll('.lib-group h4')].map((h) => h.textContent.trim().split(' ')[0]).join('|'); return !p.hidden && cards.length === 12 && groups === 'Resistors|Capacitors|Diodes' && cards.every((c) => /not simulated/.test(c.textContent) && c.querySelector('svg.lib-symbol path')) && p.querySelectorAll('input, select, button, textarea, a').length === 0 && !/has not been decided/.test(p.textContent); }));
    await pg.focus('#wbtab-third'); await pg.keyboard.press('ArrowRight');
    ok('ArrowRight on the last tab wraps to Components and moves focus there', (await pg.evaluate(() => document.activeElement.id)) === 'wbtab-components' && (await pg.evaluate(() => !document.getElementById('wbpane-components').hidden)));
    await pg.keyboard.press('End'); await pg.keyboard.press('Home');
    ok('End then Home moves between the last and first tab', (await pg.evaluate(() => document.activeElement.id)) === 'wbtab-components');
    await pg.click('#wbtab-components'); await pg.waitForTimeout(100);

    // keyboard: keys typed INSIDE the panel (focus on a tab) must not act on the machine; the machine keeps running
    await pg.focus('#wbtab-components');
    for (const k of ['Space', 't', 's', 'm', 'x', 'r', 'p', 'ArrowUp', 'ArrowDown', '?']) { await pg.keyboard.press(k); }
    await pg.focus('#wbtab-components');
    await pg.waitForTimeout(1200);
    const during = await sn();
    ok('machine shortcuts (Space, T, S, M, X, R, P, arrows, ?) typed inside the Workbench do nothing', during.inputs.powerOn === before.inputs.powerOn && during.inputs.mode === before.inputs.mode && during.inputs.connection === 'load' && Math.abs(during.inputs.setpointV - before.inputs.setpointV) < 0.01 && (await pg.locator('#controlPanel').isHidden() || !(await pg.evaluate(() => document.querySelector('.stage').classList.contains('panel-open')))), JSON.stringify({ p: during.inputs.powerOn, m: during.inputs.mode, c: during.inputs.connection, v: during.inputs.setpointV }));
    ok('the engine is still alive: output current, battery SOC (not reset) and LCD are consistent', Math.abs(during.output.currentA - 2.4) < 0.05 && during.battery.socFrac <= before.battery.socFrac && during.battery.socFrac > before.battery.socFrac - 0.01 && (await attr(pg, '#sceneCanvas', 'data-display-lit')) === 'true', `${during.output.currentA} ${before.battery.socFrac}->${during.battery.socFrac}`);
    await pg.mouse.move(220, 450); await pg.mouse.wheel(0, -400); await pg.waitForTimeout(500);
    ok('wheel over the side panel does not move the camera (the machine view stays put)', (await attr(pg, '#sceneCanvas', 'data-camera-position')) === camPos0);

    // non-modal: there is no focus trap; Tab may leave the panel and reach the machine controls
    await pg.focus('#wbClose'); let leftPanel = false;
    for (let i = 0; i < 40 && !leftPanel; i++) { await pg.keyboard.press('Tab'); leftPanel = !(await pg.evaluate(() => document.getElementById('workbench').contains(document.activeElement))); }
    ok('non-modal: Tab can leave the panel (no focus trap), so the machine controls stay keyboard-reachable', leftPanel);
    await pg.focus('#wbtab-components');

    // Escape closes, focus returns to the opener, everything is restored
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    ok('Escape (with focus inside the panel) closes the Workbench and returns focus to the Workbench button', (await pg.locator('#workbench').isHidden()) && (await pg.evaluate(() => document.activeElement.id)) === 'workbenchBtn' && (await attr(pg, '#workbenchBtn', 'aria-expanded')) === 'false');
    ok('the machine page is still interactive (not inert) after closing', await pg.evaluate(() => document.getElementById('app').inert === false));
    const after = await sn();
    ok('after closing: Main Power, mode, 120 V set-point, connected load, camera mode and camera position are all unchanged', after.inputs.powerOn && after.inputs.mode === before.inputs.mode && after.inputs.connection === 'load' && Math.abs(after.inputs.setpointV - 120) < 0.01 && (await attr(pg, '#sceneCanvas', 'data-camera-mode')) === camMode && (await attr(pg, '#sceneCanvas', 'data-camera-position')) === camPos0 && /Resistive|Resistor/.test(after.load.label), `${after.load && after.load.label}`);
    await pg.keyboard.press('x'); await ws((x) => !x.inputs.powerOn);
    ok('machine shortcuts work again after closing (X = emergency power off)', !(await sn()).inputs.powerOn);
    ok('Load Lab now lives in the Workbench (Phase 1B), not in the Control Room', await pg.evaluate(() => !document.getElementById('tab-loadlab') && !document.getElementById('controlPanel').contains(document.getElementById('llLibrary')) && document.getElementById('workbench').contains(document.getElementById('llLibrary'))));

    // the Close button path
    await pg.click('#workbenchBtn'); await pg.waitForTimeout(300); await pg.click('#wbClose'); await pg.waitForTimeout(300);
    ok('the X close button also closes and returns focus', (await pg.locator('#workbench').isHidden()) && (await pg.evaluate(() => document.activeElement.id)) === 'workbenchBtn');
    await pg.screenshot({ path: `${SHOT}/workbench-closed-1440.png` });
    await pg.click('#workbenchBtn'); await pg.waitForTimeout(400); await pg.screenshot({ path: `${SHOT}/workbench-open-1440.png` });
    ok('no uncaught errors while opening and closing the Workbench on desktop', werrs.length === 0, werrs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  for (const [w, h, touch, label] of [[820, 1180, true, 'tablet 820'], [390, 844, true, 'phone 390'], [320, 640, true, 'narrow 320']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: w < 700, deviceScaleFactor: 2 }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    const m0 = await pg.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const wb = r(document.getElementById('workbenchBtn')); const others = [...document.querySelectorAll('.topbar button')].map(r);
      const overlap = others.some((o) => !(o.right <= wb.left || o.left >= wb.right || o.bottom <= wb.top || o.top >= wb.bottom));
      return { wb: { l: wb.left, t: wb.top, w: wb.width, h: wb.height }, overlap, overflow: document.documentElement.scrollWidth > innerWidth + 1, offscreen: wb.left < 0 || wb.right > innerWidth };
    });
    ok(`${label}: Workbench button is on screen, ≥44px, does not overlap the three header buttons, no overflow`, !m0.overlap && !m0.overflow && !m0.offscreen && m0.wb.h >= 44 && m0.wb.w >= 44, JSON.stringify(m0));
    await pg.tap('#workbenchBtn'); await pg.waitForTimeout(500);
    const m = await pg.evaluate(() => {
      const vis = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none'; };
      const small = [...document.querySelectorAll('#workbench button')].filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map((b) => b.id || b.textContent);
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('workbench').scrollWidth > innerWidth + 1, switcher: vis('.wb-switch'), lib: vis('[data-wb-region=library]'), ws: vis('[data-wb-region=workspace]'), props: vis('[data-wb-region=properties]'), small };
    });
    const sideBox = await pg.evaluate(() => { const r = document.getElementById('workbench').getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
    ok(`${label}: Workbench opens as a side panel (not full screen), no horizontal overflow, buttons ≥44px, one area at a time with a switcher`, m.overflow === false && m.small.length === 0 && m.switcher === true && m.lib && !m.ws && !m.props && sideBox.w < sideBox.vw && sideBox.h < sideBox.vh && sideBox.w <= 441, JSON.stringify({ m, sideBox }));
    await pg.tap('#wbtab-transformers'); await pg.waitForTimeout(250);
    const tr = await pg.evaluate(() => ({ cards: document.querySelectorAll('#libTransformers .lib-item').length, shown: !document.getElementById('wbpane-transformers').hidden, overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('workbench').scrollWidth > document.getElementById('workbench').clientWidth + 1, small: [...document.querySelectorAll('#libTransformers summary')].filter((e) => e.getBoundingClientRect().height < 44).length }));
    ok(`${label}: Transformers tab shows five cards that fit (no overflow, touch targets ≥44px)`, tr.cards === 5 && tr.shown && !tr.overflow && tr.small === 0, JSON.stringify(tr));
    await pg.tap('#wbtab-third'); await pg.waitForTimeout(200);
    ok(`${label}: Section 3 catalogue is reachable by touch`, await pg.evaluate(() => !document.getElementById('wbpane-third').hidden && document.querySelectorAll('#wbpane-third .lib-item').length === 12));
    await pg.tap('#wbtab-components'); await pg.waitForTimeout(200);
    await pg.tap('[data-wb-area=workspace]'); await pg.waitForTimeout(250);
    const a2 = await pg.evaluate(() => ({ ws: getComputedStyle(document.querySelector('[data-wb-region=workspace]')).display !== 'none', lib: getComputedStyle(document.querySelector('[data-wb-region=library]')).display !== 'none', pressed: document.querySelector('[data-wb-area=workspace]').getAttribute('aria-pressed') }));
    await pg.tap('[data-wb-area=properties]'); await pg.waitForTimeout(250);
    const a3 = await pg.evaluate(() => ({ props: getComputedStyle(document.querySelector('[data-wb-region=properties]')).display !== 'none', ws: getComputedStyle(document.querySelector('[data-wb-region=workspace]')).display !== 'none' }));
    ok(`${label}: switching areas shows each of Work area and Properties alone and updates aria-pressed`, a2.ws && !a2.lib && a2.pressed === 'true' && a3.props && !a3.ws, JSON.stringify({ a2, a3 }));
    // Phase 1B: with a model chosen the layout must still fit, and choosing a model moves to Properties on narrow screens
    await pg.tap('[data-wb-area=library]'); await pg.waitForTimeout(250);
    await pg.tap('#llLibrary [data-load="rlc"]'); await pg.waitForTimeout(600);
    const m2 = await pg.evaluate(() => {
      const vis = (r) => getComputedStyle(document.querySelector(`[data-wb-region=${r}]`)).display !== 'none';
      const small = [...document.querySelectorAll('#workbench button, #workbench input, #workbench select, #workbench summary')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map((e) => e.id || e.className);
      const wide = [...document.querySelectorAll('#workbench *')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.id || e.className).slice(0, 5);
      return { props: vis('properties'), lib: vis('library'), ws: vis('workspace'), focus: document.activeElement.id, overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('workbench').scrollWidth > innerWidth + 1, small, wide, fields: document.querySelectorAll('#llForm .ll-input').length };
    });
    ok(`${label}: choosing a model opens Properties automatically; its form fits (no overflow, targets ≥44px)`, m2.props && !m2.lib && !m2.ws && m2.focus === 'wbPropertiesHeading' && !m2.overflow && m2.small.length === 0 && m2.wide.length === 0 && m2.fields >= 5, JSON.stringify(m2));
    await pg.tap('[data-wb-area=workspace]'); await pg.waitForTimeout(300);
    const m3 = await pg.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('workbench').scrollWidth > innerWidth + 1, name: document.getElementById('llWork').textContent.slice(0, 40) }));
    ok(`${label}: the Work area for the chosen model fits and shows its name`, !m3.overflow && /Series RLC/.test(m3.name), JSON.stringify(m3));
    await pg.screenshot({ path: `${SHOT}/workbench-${w}.png` });
    await pg.tap('#wbClose'); await pg.waitForTimeout(400);
    ok(`${label}: closing returns to the machine screen with focus on the Workbench button`, (await pg.locator('#workbench').isHidden()) && (await pg.evaluate(() => document.activeElement.id)) === 'workbenchBtn');
    await ctx.close();
  }

  const real = errors.filter((e) => !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|fonts\.g/.test(e));
  ok('no JavaScript console/page errors (blocked external font requests ignored)', real.length === 0, real.slice(0, 3).join(' | '));
  console.log(results.join('\n')); console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} CHECKS PASSED`);
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error('SCRIPT ERROR', e.message); process.exit(2); });
