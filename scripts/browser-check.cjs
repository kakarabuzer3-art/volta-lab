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

  // ---- initial state + drawer
  let s = await snap();
  ok('initial: power OFF, AC, 220 V set-point, SOC 90 %', s.status === 'off' && s.output.kind === 'ac' && s.inputs.setpointV === 220 && Math.abs(s.battery.socFrac - 0.9) < 1e-9);
  const drawer = () => page.evaluate(() => document.querySelector('.stage').classList.contains('panel-open'));
  ok('drawer starts closed', !(await drawer()));
  await page.click('#panelToggle'); ok('drawer opens (corner button)', await drawer());
  await page.keyboard.press('Escape'); ok('Escape closes the drawer', !(await drawer()));
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
