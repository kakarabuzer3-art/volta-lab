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

  // ---- Controls panel: five tabs, all content reachable inside it
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(SEEN_INIT);
    const pg = await ctx.newPage(); await gotoReady(pg);
    await pg.click('#panelToggle'); await pg.waitForTimeout(500);
    const names = await pg.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-label') || t.textContent.trim()));
    ok('Controls panel has the five sections as tabs', names.join('|') === 'Controls|Settings|Help|Learning Hub|Limitations & Safety', names.join('|'));
    ok('Controls tab holds Main Power, AC/DC, voltage, wire and camera controls', (await pg.evaluate(() => ['powerBtn', 'modeAcBtn', 'modeDcBtn', 'voltageSlider', 'touchWiresBtn', 'separateWiresBtn', 'resetCameraBtn'].every((i) => document.getElementById('pane-controls').contains(document.getElementById(i))))));
    await pg.focus('#tab-controls'); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(150);
    ok('ArrowRight on the tab list selects and focuses the next tab', (await pg.evaluate(() => document.activeElement.id)) === 'tab-settings' && (await attr(pg, '#tab-settings', 'aria-selected')) === 'true' && !(await pg.locator('#pane-settings').isHidden()));
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
  const real = errors.filter((e) => !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|fonts\.g/.test(e));
  ok('no JavaScript console/page errors (blocked external font requests ignored)', real.length === 0, real.slice(0, 3).join(' | '));
  console.log(results.join('\n')); console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} CHECKS PASSED`);
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error('SCRIPT ERROR', e.message); process.exit(2); });
