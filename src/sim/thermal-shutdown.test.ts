// Regression tests for the converter thermal-shutdown boundary (see Engine.step()).
// Definition under test: the converter is enabled for a whole 20 ms interval or not at all. The
// temperature is advanced at the END of the interval; if it reaches tShutdown the NEXT state
// (and the snapshot at that boundary) is disabled. Energy of the interval just simulated is real
// and stays in the ledger; no energy is consumed for any later disabled interval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, STEP_S, defaultConfig, resistiveLoad } from './index.ts';
import type { EngineConfig, Snapshot } from './index.ts';

const T_SHUT = 35, T_RESTART = 30;
function config(tShut = T_SHUT, tRestart = T_RESTART): EngineConfig {
  const c = defaultConfig();
  return { ...c, converter: { ...c.converter, tShutdownC: tShut, tRestartC: tRestart } };
}
/** 200 V DC into 40 Ω = 1 kW from the machine's default (100S2P) battery; converter loss ≈ 24 W. */
function rig(cfg: EngineConfig): Engine {
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 });
  e.attachLoad(resistiveLoad(40));
  return e;
}
const clone = (s: Snapshot): Snapshot => JSON.parse(JSON.stringify(s));

test('thermal 1. normal operation below the shutdown threshold never shuts down', () => {
  const e = rig(config(200, 150));
  for (let k = 0; k < 6000; k++) e.step(); // 120 s
  const s = e.snapshot();
  assert.equal(s.protection.converterShutdown, false);
  assert.equal(s.status, 'running');
  assert.ok(Math.abs(s.output.pRealW - 1000) < 1, `P = ${s.output.pRealW}`);
  assert.ok(s.converter.tempC > 25 && s.converter.tempC < 200);
});

test('thermal 2-5. shutdown boundary: output, battery current, power and ledger are consistent in the SAME snapshot', () => {
  const e = rig(config());
  let before = clone(e.snapshot());
  let hit: Snapshot | null = null;
  let enabledSteps = 0;
  for (let k = 0; k < 40000 && !hit; k++) {
    const wasEnabled = !e.snapshot().protection.converterShutdown && e.snapshot().inputs.powerOn;
    before = clone(e.snapshot());
    e.step();
    if (wasEnabled) enabledSteps++;
    if (e.snapshot().protection.converterShutdown) hit = clone(e.snapshot());
  }
  assert.ok(hit, 'thermal shutdown was reached');
  assert.ok(before.converter.tempC < T_SHUT, 'previous step was below the threshold');
  assert.ok(hit.converter.tempC >= T_SHUT, `threshold reached at the boundary (${hit.converter.tempC} °C)`);
  // Same snapshot: nothing energised is reported after the boundary.
  assert.equal(hit.status, 'tripped');
  assert.equal(hit.output.voltage, 0); assert.equal(hit.output.currentA, 0); assert.equal(hit.output.pRealW, 0);
  assert.equal(hit.converter.iInA, 0); assert.equal(hit.converter.pOutW, 0); assert.equal(hit.converter.lossW, 0);
  assert.equal(hit.battery.currentA, 0); assert.equal(hit.battery.powerW, 0);
  assert.equal(hit.load!.op.currentA, 0, 'load sees no current either');
  assert.match(hit.protection.message ?? '', /thermal shutdown/i);
  // Independent analytic energy: the load drew exactly V²/R = 1 kW for each ENABLED interval.
  const expectedOutWh = (200 ** 2 / 40) * enabledSteps * STEP_S / 3600;
  assert.ok(Math.abs(hit.ledger.outputWh - expectedOutWh) < 1e-6 * expectedOutWh, `outputWh ${hit.ledger.outputWh} vs analytic ${expectedOutWh}`);
  assert.ok(hit.ledger.outputWh > before.ledger.outputWh, 'the interval ending at the boundary WAS energised and is accounted');
  // Ledger residuals stay closed at the boundary.
  assert.ok(Math.abs(hit.ledger.batteryResidualWh) < 1e-9);
  assert.ok(Math.abs(hit.ledger.terminalResidualWh) < 1e-6 * hit.ledger.batteryTerminalWh + 1e-9);

  // 6. While shut down: no battery energy is consumed, output stays zero, converter cools exactly exponentially.
  const cfg = e.config.converter;
  const tau = cfg.cthJPerK * cfg.rthKPerW;
  const t0 = hit.converter.tempC, amb = e.config.ambientC;
  let prevT = t0, steps = 0;
  while (e.snapshot().protection.converterShutdown && steps < 40000) {
    e.step(); steps++;
    const s = e.snapshot();
    if (!s.protection.converterShutdown) break;
    assert.equal(s.output.currentA, 0); assert.equal(s.battery.currentA, 0);
    assert.equal(s.ledger.outputWh, hit.ledger.outputWh, 'no output energy while disabled');
    assert.equal(s.ledger.batteryTerminalWh, hit.ledger.batteryTerminalWh, 'no battery energy while disabled');
    assert.ok(s.converter.tempC < prevT, 'cooling is monotonic');
    const analytic = amb + (t0 - amb) * Math.exp(-(steps * STEP_S) / tau);
    assert.ok(Math.abs(s.converter.tempC - analytic) < 1e-9, `T=${s.converter.tempC} analytic=${analytic}`);
    prevT = s.converter.tempC;
  }
  // 7. Hysteresis restart: restarts only once T ≤ tRestart, and the restart snapshot is already energised.
  const back = e.snapshot();
  assert.equal(back.protection.converterShutdown, false, 'restarted');
  assert.ok(back.converter.tempC <= T_RESTART && prevT > T_RESTART, `restart at ${back.converter.tempC} °C, previous ${prevT} °C`);
  assert.equal(back.status, 'running');
  assert.ok(Math.abs(back.output.voltage - 200) < 0.5 && Math.abs(back.output.pRealW - 1000) < 1, 'no stale zero readings after restart');
  assert.ok(back.battery.currentA > 0);
  assert.ok(Math.abs(back.ledger.batteryResidualWh) < 1e-9);
});

test('thermal 8. no trip/restart chatter: every cycle respects the hysteresis band and a long dwell time', () => {
  const e = rig(config());
  const events: Array<{ step: number; shut: boolean; t: number }> = [];
  let prev = e.snapshot().protection.converterShutdown;
  for (let k = 1; k <= 60000; k++) { // 20 min
    e.step();
    const sh = e.snapshot().protection.converterShutdown;
    if (sh !== prev) { events.push({ step: k, shut: sh, t: e.snapshot().converter.tempC }); prev = sh; }
  }
  assert.ok(events.length >= 4, `several full cycles occurred (${events.length} events)`);
  for (let i = 1; i < events.length; i++) {
    const dwell = (events[i].step - events[i - 1].step) * STEP_S;
    assert.ok(dwell > 5, `dwell ${dwell} s between toggles ${i - 1}→${i}`);
    assert.notEqual(events[i].shut, events[i - 1].shut, 'events alternate');
  }
  for (const ev of events) ev.shut ? assert.ok(ev.t >= T_SHUT) : assert.ok(ev.t <= T_RESTART);
  const last = e.snapshot();
  assert.ok(Math.abs(last.ledger.batteryResidualWh) < 1e-9);
  assert.ok(last.ledger.batteryTerminalWh <= last.battery.nominalWh);
});

test('thermal 9. AC mode shutdown boundary is equally consistent (inverter + DC-DC heat)', () => {
  const e = new Engine(config(32, 28));
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 230 });
  e.attachLoad(resistiveLoad(30)); // ≈ 1.76 kW
  let hit: Snapshot | null = null;
  for (let k = 0; k < 60000 && !hit; k++) { e.step(); if (e.snapshot().protection.converterShutdown) hit = clone(e.snapshot()); }
  assert.ok(hit, 'AC shutdown reached');
  assert.equal(hit.output.voltage, 0); assert.equal(hit.output.currentA, 0); assert.equal(hit.output.sVA, 0);
  assert.equal(hit.battery.currentA, 0); assert.equal(hit.converter.dcLinkV, null);
});
