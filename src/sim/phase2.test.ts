// Regression tests for: (B) output-stage description derived from the snapshot, (D) external mutation of inputs / loads / snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, defaultConfig, resistiveLoad, outputStageDescription, validateLoad } from './index.ts';
import type { Load, Snapshot } from './index.ts';

const steps = (e: Engine, n: number): void => { for (let k = 0; k < n; k++) e.step(); };
const json = (x: unknown): string => JSON.stringify(x);
const rig = (soc = 0.9): Engine => { const c = defaultConfig(); c.initialSoc = soc; return new Engine(c); };

// ---------------------------------------------------------------- (B) output-stage description
test('B. description follows the snapshot: off → disabled, on → running, never "running" when nothing is delivered', () => {
  const e = rig();
  assert.equal(outputStageDescription(e.snapshot()), 'Output stage is disabled');
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 100 });
  assert.equal(e.snapshot().status, 'running');
  assert.equal(outputStageDescription(e.snapshot()), 'Output stage is running');
  e.setInputs({ powerOn: false });
  assert.equal(outputStageDescription(e.snapshot()), 'Output stage is disabled');
});

test('B. current limit is described as running at the limit', () => {
  const e = rig();
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 415, connection: { kind: 'short' } });
  assert.equal(e.snapshot().status, 'limited');
  assert.match(outputStageDescription(e.snapshot()), /current limit/);
});

test('B. after battery depletion the description says the battery is empty (also after power cycling) and readings are zero', () => {
  const e = rig(1.2e-8);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 5, connection: { kind: 'load', load: resistiveLoad(40), reversed: false } });
  steps(e, 3000);
  for (const phase of ['after depletion', 'after power cycle']) {
    if (phase === 'after power cycle') { e.setInputs({ powerOn: false }); steps(e, 3); e.setInputs({ powerOn: true }); steps(e, 3); }
    const s = e.snapshot();
    assert.equal(s.battery.socFrac, 0, phase);
    assert.match(outputStageDescription(s), /Battery is empty/, phase);
    assert.doesNotMatch(outputStageDescription(s), /is running/, phase);
    assert.equal(s.output.voltage, 0); assert.equal(s.output.currentA, 0); assert.equal(s.output.pRealW, 0); assert.equal(s.battery.currentA, 0);
  }
});

test('B. after a protective (overcurrent) shutdown the description says so; readings are zero; a power cycle clears it', () => {
  const e = rig();
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 415, connection: { kind: 'short' } });
  steps(e, 200);
  const s = e.snapshot();
  assert.equal(s.status, 'tripped'); assert.equal(s.protection.trip, 'overcurrent');
  assert.match(outputStageDescription(s), /Protective shutdown/);
  assert.equal(s.output.currentA, 0); assert.equal(s.output.voltage, 0); assert.equal(s.ledger.outputWh > 0, true, 'energy delivered before the trip stays booked');
  const before = s.ledger.outputWh;
  steps(e, 50);
  assert.equal(e.snapshot().ledger.outputWh, before, 'no energy after the shutdown');
  e.setInputs({ powerOn: false }); e.setInputs({ powerOn: true }); e.setInputs({ connection: { kind: 'open' } });
  assert.equal(outputStageDescription(e.snapshot()), 'Output stage is running');
});

test('B. converter thermal shutdown has its own description', () => {
  const c = defaultConfig();
  const e = new Engine({ ...c, converter: { ...c.converter, tShutdownC: 35, tRestartC: 30 } });
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200, connection: { kind: 'load', load: resistiveLoad(40), reversed: false } });
  let n = 0; while (!e.snapshot().protection.converterShutdown && n++ < 40000) e.step();
  assert.match(outputStageDescription(e.snapshot()), /thermal shutdown/);
  assert.equal(e.snapshot().output.currentA, 0);
});

// ---------------------------------------------------------------- (D) mutation safety
test('D. mutating a load AFTER it was attached cannot bypass validation or change the simulation', () => {
  const mk = (): Load => resistiveLoad(40, { vRatedMaxV: 250 });
  const load = mk();
  const e = rig(), twin = rig();
  for (const x of [e, twin]) x.setInputs({ powerOn: true, mode: 'dc', setpointV: 100 });
  e.attachLoad(load); twin.attachLoad(mk());
  steps(e, 20); steps(twin, 20);
  // hostile mutation of every nesting level of the caller's object
  (load as { rlc: { ohms: number } }).rlc.ohms = -5;
  (load as { dcRohm: number | null }).dcRohm = 0;
  (load.ratings as { vRatedMaxV: number | null }).vRatedMaxV = 1;
  (load.thermal as { rthKPerW: number }).rthKPerW = NaN;
  steps(e, 200); steps(twin, 200);
  assert.equal(json(e.snapshot()), json(twin.snapshot()), 'engine behaves exactly like the untouched twin');
  // re-sending the (now invalid) object IS validated, and rejected atomically
  assert.throws(() => e.setInputs({ connection: { kind: 'load', load, reversed: false } }), RangeError);
  assert.equal(json(e.snapshot()), json(twin.snapshot()));
});

test('D. the engine\'s stored load and inputs are frozen; getInputs() cannot be used to change the engine', () => {
  const e = rig();
  const load = resistiveLoad(40);
  e.attachLoad(load);
  const inp = e.getInputs();
  assert.notEqual((inp.connection as { load: Load }).load, load, 'a private copy, not the caller\'s object');
  assert.throws(() => { (inp as { powerOn: boolean }).powerOn = true; }, TypeError);
  assert.throws(() => { (inp as { setpointV: number }).setpointV = 1; }, TypeError);
  assert.throws(() => { (inp.connection as { kind: string }).kind = 'short'; }, TypeError);
  const stored = (inp.connection as { load: Load }).load;
  assert.throws(() => { (stored as { rlc: { ohms: number } }).rlc.ohms = 1; }, TypeError);
  assert.throws(() => { (stored.ratings as { tMaxC: number | null }).tMaxC = 1; }, TypeError);
  assert.throws(() => { (stored.thermal as { cthJPerK: number }).cthJPerK = 1; }, TypeError);
  validateLoad(stored); // the stored copy is still a valid load
  assert.equal(e.getInputs().connection.kind, 'load');
});

test('D. re-sending an unchanged load keeps its health; a changed one resets it; attachLoad always resets', () => {
  const load = resistiveLoad(40);
  const e = rig(); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 100 }); e.attachLoad(load); steps(e, 300);
  const t = e.snapshot().load!.health.tempC; assert.ok(t > 25.01);
  e.setInputs({ setpointV: 110, connection: { kind: 'load', load, reversed: false } });
  assert.ok(e.snapshot().load!.health.tempC >= t - 1e-9, 'same load re-sent: health kept');
  e.setInputs({ setpointV: 120 });
  assert.ok(e.snapshot().load!.health.tempC >= t - 1e-9, 'inputs without connection: health kept');
  e.setInputs({ connection: { kind: 'load', load: resistiveLoad(40), reversed: false } });
  assert.equal(e.snapshot().load!.health.tempC, 25, 'a different load object resets health');
  steps(e, 100);
  e.attachLoad(load);
  assert.equal(e.snapshot().load!.health.tempC, 25, 'attachLoad resets health');
});

test('D. snapshots are deeply frozen and cannot be used to mutate internal state', () => {
  const e = rig(); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 60, connection: { kind: 'load', load: resistiveLoad(40, { tWarnC: 25.001 }), reversed: false } });
  steps(e, 50);
  const s = e.snapshot() as Snapshot;
  assert.ok(s.load!.health.reasons.length > 0, 'precondition: a reasons array exists');
  const mutations: Array<() => void> = [
    () => { (s as { timeS: number }).timeS = -1; },
    () => { (s.battery as { socFrac: number }).socFrac = 5; },
    () => { s.battery.limits.push('empty'); },
    () => { (s.load!.health as { tempC: number }).tempC = 999; },
    () => { s.load!.health.reasons.push('x'); },
    () => { (s.load!.op as { currentA: number }).currentA = 99; },
    () => { (s.ledger as { outputWh: number }).outputWh = 1e9; },
    () => { (s.protection as { trip: string | null }).trip = 'overcurrent'; },
    () => { (s.inputs as { powerOn: boolean }).powerOn = false; },
  ];
  for (const m of mutations) assert.throws(m, TypeError);
  const before = json(e.snapshot());
  steps(e, 10);
  const twin = rig(); twin.setInputs({ powerOn: true, mode: 'dc', setpointV: 60, connection: { kind: 'load', load: resistiveLoad(40, { tWarnC: 25.001 }), reversed: false } }); steps(twin, 60);
  assert.equal(json(e.snapshot()), json(twin.snapshot()), 'internal state unaffected by the attempted mutations');
  assert.notEqual(before, json(e.snapshot()));
});

test('D. earlier snapshots stay valid after the simulation advances (no aliasing of later state into old snapshots)', () => {
  const e = rig(); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 100, connection: { kind: 'load', load: resistiveLoad(40), reversed: false } });
  steps(e, 5);
  const old = e.snapshot(), oldJson = json(old);
  steps(e, 500);
  assert.equal(json(old), oldJson);
});

test('D. a caller mutating the config object it passed in cannot change anything exposed by the engine', () => {
  const cfg = defaultConfig(); const e = new Engine(cfg);
  cfg.converter.dMax = 0.1; cfg.pack.seriesCells = 1;
  assert.equal(e.config.converter.dMax, 0.9); assert.equal(e.config.pack.seriesCells, 100);
});

test('D. factories do not share mutable defaults: mutating one load\'s thermal/ratings never alters another load', () => {
  const a = resistiveLoad(10), b = resistiveLoad(20);
  (a.thermal as { rthKPerW: number }).rthKPerW = 777; (a.ratings as { tMaxC: number | null }).tMaxC = 5;
  assert.equal(b.thermal.rthKPerW, 2); assert.equal(b.ratings.tMaxC, null);
  assert.equal(resistiveLoad(30).thermal.rthKPerW, 2);
});
