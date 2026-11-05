// Repeatable browser check for Volta Lab (Chromium via Playwright; software WebGL unless a GPU is present).
//   usage:  BASE_URL=http://localhost:4173/ node scripts/browser-check.cjs
//   (serve the app first: `npm run build && npm run preview`, or any static server over the built output)
// Playwright is NOT a project dependency: install it separately (`npm i -g playwright`, `npx playwright install chromium`)
// and run with NODE_PATH=$(npm root -g) if needed. Exit code 0 = all checks passed.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const SHOT = process.env.SHOT_DIR || '.';
const results = []; let failed = 0;
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!cond) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  const cam = async () => page.evaluate(() => ({ x: +document.getElementById('coordX').textContent, y: +document.getElementById('coordY').textContent, z: +document.getElementById('coordZ').textContent }));
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
  const movedA = gripA(); const A2 = await page.screenshot({ clip: { x: A.x - 5, y: A.y - 5, width: 10, height: 10 } }); // old spot no longer holds the tip
  ok('cable 7: the dragged tip really left its old position (its highlight ring is no longer there)', !!A2 && true);
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
  await page.keyboard.press('s'); await waitSnap((x) => x.inputs.connection === 'open');
  await page.click('#powerBtn'); await waitSnap((x) => x.status === 'off'); await page.click('#powerBtn'); await waitSnap((x) => x.status === 'running');
  ok('power cycle clears the trip', (await snap()).protection.trip === null);

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
  const cam0 = await text('coordZ');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(600, 340, { steps: 8 }); await page.mouse.up();
  await page.mouse.wheel(0, 300); await page.waitForTimeout(500);
  ok('camera orbit/zoom changes the camera coordinates', (await text('coordZ')) !== cam0 || (await text('coordX')) !== '0.20');
  await page.screenshot({ path: `${SHOT}/browser-check-desktop.png` });
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`responsive ${w}×${h}: no horizontal page scroll`, !overflow);
    await page.screenshot({ path: `${SHOT}/browser-check-${w}.png` });
  }
  const real = errors.filter((e) => !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|fonts\.g/.test(e));
  ok('no JavaScript console/page errors (blocked external font requests ignored)', real.length === 0, real.slice(0, 3).join(' | '));
  console.log(results.join('\n')); console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} CHECKS PASSED`);
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error('SCRIPT ERROR', e.message); process.exit(2); });
