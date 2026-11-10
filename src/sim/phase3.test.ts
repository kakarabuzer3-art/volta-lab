// Regression tests for the AC/DC switching report: "with Main Power ON, changing AC/DC leaves the LCD dark and the wire
// animation stopped while the power switch still reads ON".
// Root cause (traced in the browser and in the engine): switching the mode never touches Main Power, SOC or the engine
// state. A SHORTED output sits in current limit; after `tripDelayS` the overcurrent protection latches a trip, the output
// current drops to 0 (so the spark / wire effect stops) and the LCD painter used its dim "unlit" palette for the trip state,
// so a powered, tripped machine looked switched off. The fix is that the display is a pure function of the snapshot
// (`displayPresentation`): lit exactly when Main Power is ON, with a visible fault message for every fault state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, defaultConfig, resistiveLoad, displayPresentation } from './index.ts';
import type { OutputMode } from './index.ts';

const steps = (e: Engine, n: number): void => { for (let k = 0; k < n; k++) e.step(); };
const seconds = (e: Engine, s: number): void => steps(e, Math.round(s / 0.02));
const rig = (soc = 0.9): Engine => { const c = defaultConfig(); c.initialSoc = soc; return new Engine(c); };
const flip = (m: OutputMode): OutputMode => (m === 'ac' ? 'dc' : 'ac');

test('mode switch with Main Power ON (open circuit) keeps power, display and engine running, and does not reset SOC', () => {
  const e = rig(0.8);
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 220, connection: { kind: 'open' } });
  seconds(e, 1);
  let mode: OutputMode = 'ac';
  for (let i = 0; i < 60; i++) {
    const before = e.snapshot();
    mode = flip(mode);
    e.setInputs({ powerOn: true, mode });
    const right = e.snapshot();
    // Immediately after the switch (no time advanced): nothing but the mode changed.
    assert.equal(right.battery.socFrac, before.battery.socFrac, 'SOC is untouched by the switch itself');
    assert.equal(right.inputs.powerOn, true);
    seconds(e, 0.2);
    const s = e.snapshot();
    assert.equal(s.status, 'running', `status after switch ${i}`);
    assert.equal(s.output.kind, mode);
    assert.ok(s.output.voltage > 100, 'engine keeps delivering the set-point voltage');
    const p = displayPresentation(s);
    assert.equal(p.lit, true, 'LCD stays lit');
    assert.equal(p.mode, mode === 'ac' ? 'AC' : 'DC');
    assert.equal(p.faultLines, null);
    assert.ok(s.battery.socFrac <= before.battery.socFrac + 1e-9 && s.battery.socFrac > 0.79, 'SOC only ever decreases slowly');
  }
});

test('mode switch with a load attached keeps current flowing in both modes (wire effect follows real output)', () => {
  const e = rig();
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 100, connection: { kind: 'load', load: resistiveLoad(40), reversed: false } });
  seconds(e, 1);
  assert.ok(e.snapshot().output.currentA > 1, 'DC current flows');
  for (const m of ['ac', 'dc', 'ac', 'dc'] as OutputMode[]) {
    e.setInputs({ powerOn: true, mode: m });
    seconds(e, 0.6);
    const s = e.snapshot();
    assert.equal(s.output.kind, m);
    assert.ok(s.output.currentA > 1, `${m} current flows after the switch`);
    assert.equal(displayPresentation(s).lit, true);
  }
});

test('short circuit: switching mode neither trips early nor turns the display off; trip happens only after the trip delay', () => {
  const cfg = defaultConfig();
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 220, connection: { kind: 'short' } });
  seconds(e, cfg.tripDelayS * 0.4);
  assert.equal(e.snapshot().status, 'limited');
  e.setInputs({ powerOn: true, mode: 'dc' });
  const s = e.snapshot();
  assert.equal(s.status, 'limited', 'switch does not trip the output');
  assert.equal(s.protection.trip, null);
  assert.equal(displayPresentation(s).lit, true);
  seconds(e, cfg.tripDelayS * 0.4);
  assert.equal(e.snapshot().protection.trip, null, 'still within the delay measured from the switch');
  seconds(e, cfg.tripDelayS * 1.5);
  assert.equal(e.snapshot().status, 'tripped');
});

test('protective trip with Main Power ON: display stays LIT with a fault message; mode switches do not clear or blank it', () => {
  const cfg = defaultConfig();
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 220, connection: { kind: 'short' } });
  seconds(e, cfg.tripDelayS + 1);
  let s = e.snapshot();
  assert.equal(s.status, 'tripped');
  assert.equal(s.inputs.powerOn, true, 'Main Power is still ON');
  let p = displayPresentation(s);
  assert.equal(p.lit, true, 'a powered machine never shows a blank screen');
  assert.equal(p.tone, 'fault');
  assert.equal(p.chip, 'TRIP');
  assert.deepEqual(p.faultLines, ['OVERCURRENT TRIP', 'POWER OFF, THEN ON']);
  const soc = s.battery.socFrac;
  for (const m of ['dc', 'ac', 'dc', 'ac'] as OutputMode[]) {
    e.setInputs({ powerOn: true, mode: m });
    seconds(e, 0.3);
    s = e.snapshot();
    p = displayPresentation(s);
    assert.equal(s.status, 'tripped', 'latched trip is not cleared by a mode change');
    assert.equal(s.output.currentA, 0, 'no current is invented while tripped');
    assert.equal(p.lit, true);
    assert.equal(p.mode, m === 'ac' ? 'AC' : 'DC');
    assert.ok(p.faultLines !== null);
    assert.ok(s.battery.socFrac <= soc && soc - s.battery.socFrac < 1e-3, 'SOC does not reset');
  }
});

test('Main Power OFF is the only unlit state; power cycle after a trip restores normal running in either mode', () => {
  const cfg = defaultConfig();
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 220, connection: { kind: 'short' } });
  seconds(e, cfg.tripDelayS + 1);
  assert.equal(e.snapshot().status, 'tripped');
  e.setInputs({ powerOn: false });
  let p = displayPresentation(e.snapshot());
  assert.equal(p.lit, false);
  assert.equal(p.state, 'off');
  assert.equal(p.faultLines, null);
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 220, connection: { kind: 'open' } });
  seconds(e, 0.5);
  const s = e.snapshot();
  assert.equal(s.status, 'running');
  p = displayPresentation(s);
  assert.equal(p.lit, true);
  assert.equal(p.tone, 'ok');
  assert.equal(p.mode, 'AC');
});

test('empty battery: lit with an EMPTY message while Main Power is ON', () => {
  const e = rig(0.0005);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200, connection: { kind: 'load', load: resistiveLoad(20), reversed: false } });
  seconds(e, 30);
  const s = e.snapshot();
  assert.ok(s.status === 'battery-empty' || s.status === 'tripped', `got ${s.status}`);
  const p = displayPresentation(s);
  assert.equal(p.lit, true);
  assert.ok(p.faultLines !== null);
});

test('presentation: lit is exactly Main Power for every reachable status', () => {
  for (const on of [false, true]) for (const conn of ['open', 'short'] as const) for (const mode of ['ac', 'dc'] as OutputMode[]) {
    const e = rig();
    e.setInputs({ powerOn: on, mode, setpointV: 300, connection: { kind: conn } });
    for (let t = 0; t < 8; t++) {
      seconds(e, 0.5);
      const s = e.snapshot();
      assert.equal(displayPresentation(s).lit, on, `${on}/${conn}/${mode}/${s.status}`);
    }
  }
});
