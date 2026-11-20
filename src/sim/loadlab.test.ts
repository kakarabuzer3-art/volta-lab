// Load Lab V1: catalogue, unit conversion, validation, connection coordinator and engine integration.
// Expected numbers are hand-calculated from the textbook equations (NOT read back from the implementation):
//   R-L (R=20 Ω, L=0.1 H) at 100 V / 50 Hz: XL = 2π·50·0.1 = 31.416 Ω, Z = √(20²+31.416²) = 37.24 Ω, I = 2.685 A, P = I²R = 144.2 W, PF = R/Z = 0.537
//   C (100 µF, ESR 0.1 Ω): XC = 1/(2π·50·1e-4) = 31.831 Ω, Z = √(0.1²+31.831²) = 31.831 Ω, I(100 V) = 3.1416 A
//   RLC (20 Ω, 0.1 H, 100 µF): X = 31.416 − 31.831 = −0.415 Ω, Z = 20.004 Ω, I(100 V) = 4.998 A
//   DC motor (Ra 2 Ω, K 0.5, T 0.2 N·m, b 0.001) at 100 V: ω = (V − Ra·T/K)/(Ra·b/K + K) = 99.2/0.504 = 196.83 rad/s, I = (T + b·ω)/K = 0.7937 A
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectionCoordinator, Engine, LOAD_CATALOGUE, buildLoad, defaultConfig, describeLoadResults, loadTypeSpec, parseField, resistiveLoad,
} from './index.ts';
import type { LoadTypeId, RawForm } from './index.ts';

const presetForm = (id: LoadTypeId): RawForm => Object.fromEntries(Object.entries(loadTypeSpec(id).preset).map(([k, v]) => [k, { value: v, unitIndex: 0 }]));
const seconds = (e: Engine, s: number): void => { for (let k = 0; k < Math.round(s / 0.02); k++) e.step(); };
const run = (id: LoadTypeId, mode: 'ac' | 'dc', v: number, form: RawForm = presetForm(id)) => {
  const b = buildLoad(id, form, 'user-specified'); assert.ok(b.ok, JSON.stringify(b));
  const e = new Engine(); const c = new ConnectionCoordinator();
  assert.ok(c.connectLoad(b.load, false).ok);
  e.setInputs({ powerOn: true, mode, setpointV: v, connection: c.resolve(false).connection });
  seconds(e, 1.0);
  return { e, c, s: e.snapshot() };
};

test('catalogue is exactly the five V1 loads (AC-input supply and DC module are deferred to V1.1)', () => {
  assert.deepEqual(LOAD_CATALOGUE.map((l) => l.id), ['resistor', 'inductor', 'capacitor', 'rlc', 'dc-motor']);
  for (const l of LOAD_CATALOGUE) { assert.ok(l.limitation.length > 10 && l.summary && l.dcBehaviour && l.acBehaviour); assert.ok(l.params.length >= 1); }
});

test('unit conversion to canonical SI', () => {
  const f = loadTypeSpec('capacitor').params[0];
  const ok = (v: string, u: number) => { const r = parseField(f, { value: v, unitIndex: u }); assert.ok(r.ok); return r.si as number; };
  assert.ok(Math.abs(ok('100', 0) - 1e-4) < 1e-18);           // µF
  assert.ok(Math.abs(ok('0.5', 1) - 5e-4) < 1e-18);           // mF
  assert.ok(Math.abs(ok('470', 2) - 4.7e-7) < 1e-18);        // nF
  const r = loadTypeSpec('resistor').params[0];
  assert.equal((parseField(r, { value: '2.2', unitIndex: 1 }) as { si: number }).si, 2200); // kΩ
  assert.equal((parseField(r, { value: '500', unitIndex: 2 }) as { si: number }).si, 0.5);  // mΩ
});

test('invalid text and out-of-range values are rejected with the field name; nothing reaches the engine', () => {
  const r = loadTypeSpec('resistor').params[0];
  for (const bad of ['', ' ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999', '0x10', '1,5', '--3', '5 6']) {
    const out = parseField(r, { value: bad, unitIndex: 0 }); assert.equal(out.ok, false, `“${bad}” must be rejected`);
    if (!out.ok) assert.match(out.error, /Resistance/);
  }
  for (const bad of ['-5', '0', '0.0001', '1e10']) assert.equal(parseField(r, { value: bad, unitIndex: 0 }).ok, false, bad);
  const form = { ohms: { value: '-3', unitIndex: 0 } };
  const b = buildLoad('resistor', form); assert.equal(b.ok, false);
  if (!b.ok) assert.match(b.errors.ohms, /cannot be negative/);
  // Capacitor ESR may be zero (the model allows it); capacitance may not.
  assert.equal(buildLoad('capacitor', { farads: { value: '100', unitIndex: 0 }, esrOhm: { value: '0', unitIndex: 0 } }).ok, true);
  assert.equal(buildLoad('capacitor', { farads: { value: '0', unitIndex: 0 }, esrOhm: { value: '0', unitIndex: 0 } }).ok, false);
  // Motor: torque and viscous may be 0; K and Ra may not.
  const m = { ...presetForm('dc-motor'), loadTorqueNm: { value: '0', unitIndex: 0 }, viscousNmsPerRad: { value: '0', unitIndex: 0 } };
  assert.equal(buildLoad('dc-motor', m).ok, true);
  assert.equal(buildLoad('dc-motor', { ...presetForm('dc-motor'), kVsPerRad: { value: '0', unitIndex: 0 } }).ok, false);
  assert.equal(buildLoad('dc-motor', { ...presetForm('dc-motor'), rArmOhm: { value: '-1', unitIndex: 0 } }).ok, false);
});

test('optional ratings: blank = unspecified (null), entered = applied; data source is recorded honestly', () => {
  const a = buildLoad('resistor', presetForm('resistor'), 'illustrative-fixture'); assert.ok(a.ok);
  if (a.ok) { assert.equal(a.load.ratings.ratedCurrentA, null); assert.equal(a.load.ratings.ratedPowerW, null); assert.equal(a.load.dataSource, 'illustrative-fixture'); }
  const b = buildLoad('resistor', { ohms: { value: '50', unitIndex: 0 }, ratedCurrentA: { value: '2', unitIndex: 0 }, ratedPowerW: { value: '300', unitIndex: 0 } }); assert.ok(b.ok);
  if (b.ok) { assert.equal(b.load.ratings.ratedCurrentA, 2); assert.equal(b.load.ratings.ratedPowerW, 300); assert.equal(b.load.dataSource, 'user-specified'); }
  assert.equal(buildLoad('resistor', { ohms: { value: '50', unitIndex: 0 }, ratedCurrentA: { value: '-1', unitIndex: 0 } }).ok, false);
});

test('engine integration: resistor, AC and DC (I = V/R, PF = 1)', () => {
  const a = run('resistor', 'ac', 100).s; // 50 Ω
  assert.equal(a.inputs.connection, 'load');
  assert.ok(Math.abs(a.output.currentA - 2) < 0.01 && Math.abs(a.output.pRealW - 200) < 2, `${a.output.currentA} A ${a.output.pRealW} W`);
  assert.ok(Math.abs((a.load?.op.powerFactor ?? 0) - 1) < 1e-6);
  const d = run('resistor', 'dc', 100).s;
  assert.ok(Math.abs(d.output.currentA - 2) < 0.01 && Math.abs(d.output.pRealW - 200) < 2);
});

test('engine integration: inductor AC lags (PF 0.537) and DC is limited by winding resistance only', () => {
  const f = { ohms: { value: '20', unitIndex: 0 }, henries: { value: '100', unitIndex: 1 } }; // 100 mH
  const a = run('inductor', 'ac', 100, f).s;
  assert.ok(Math.abs(a.output.currentA - 2.685) < 0.01, `${a.output.currentA}`);
  assert.ok(Math.abs(a.output.pRealW - 144.2) < 1.5, `${a.output.pRealW}`);
  assert.ok(Math.abs((a.load?.op.powerFactor ?? 0) - 0.537) < 0.005);
  assert.ok((a.load?.op.qVAr ?? 0) > 200, 'reactive power is reported separately from real power');
  const d = run('inductor', 'dc', 100, f).s;
  assert.ok(Math.abs(d.output.currentA - 5) < 0.02, `DC steady state I = V/R = 5 A, got ${d.output.currentA}`);
});

test('engine integration: capacitor blocks DC and conducts AC (XC = 31.83 Ω)', () => {
  const dc = run('capacitor', 'dc', 100).s;
  assert.equal(dc.output.currentA, 0, 'ideal series capacitor blocks steady DC');
  assert.equal(dc.output.pRealW, 0);
  const ac = run('capacitor', 'ac', 100).s;
  assert.ok(Math.abs(ac.output.currentA - 3.1416) < 0.02, `${ac.output.currentA}`);
  assert.ok((ac.load?.op.powerFactor ?? 1) < 0.01, 'almost purely reactive: PF ≈ ESR/Z');
});

test('engine integration: series RLC (near resonance) and DC blocking', () => {
  const ac = run('rlc', 'ac', 100).s;
  assert.ok(Math.abs(ac.output.currentA - 4.998) < 0.02, `${ac.output.currentA}`);
  assert.ok(Math.abs(ac.output.pRealW - 4.998 ** 2 * 20) < 2);
  assert.equal(run('rlc', 'dc', 100).s.output.currentA, 0);
});

test('engine integration: DC motor steady state; AC is flagged as unsupported', () => {
  const d = run('dc-motor', 'dc', 100).s;
  assert.ok(Math.abs(d.output.currentA - 0.7937) < 0.01, `${d.output.currentA}`);
  assert.equal(d.load?.health.state, 'normal');
  const ac = run('dc-motor', 'ac', 100).s;
  assert.ok(ac.load?.health.reasons.some((r) => /rated for DC but is driven with AC/.test(r)), JSON.stringify(ac.load?.health.reasons));
  assert.notEqual(ac.load?.health.state, 'normal');
});

test('rated current is enforced: overloaded with a causal reason; no stale state after disconnect', () => {
  const f = { ohms: { value: '50', unitIndex: 0 }, ratedCurrentA: { value: '1', unitIndex: 0 } };
  const { e, c, s } = run('resistor', 'ac', 100, f);
  assert.equal(s.load?.health.state, 'overloaded');
  assert.ok(s.load?.health.reasons.some((r) => /Overcurrent/.test(r)));
  c.disconnectLoad();
  e.setInputs({ connection: c.resolve(false).connection }); seconds(e, 0.2);
  const o = e.snapshot();
  assert.equal(o.inputs.connection, 'open'); assert.equal(o.load, null); assert.equal(o.output.currentA, 0);
});

test('results presenter copies the snapshot and never invents AC-only quantities for DC', () => {
  const d = describeLoadResults(run('resistor', 'dc', 100).s)!;
  assert.equal(d.inputMode, 'DC'); assert.equal(d.apparentVA, null); assert.equal(d.reactiveVAr, null); assert.equal(d.powerFactor, null);
  const a = describeLoadResults(run('inductor', 'ac', 100).s)!;
  assert.equal(a.inputMode, 'AC'); assert.ok(a.apparentVA! > a.realPowerW); assert.ok(a.driven);
  assert.equal(describeLoadResults(new Engine().snapshot()), null);
  const off = new Engine(); off.setInputs({ powerOn: false, connection: { kind: 'load', load: resistiveLoad(50), reversed: false } }); seconds(off, 0.2);
  const r = describeLoadResults(off.snapshot())!;
  assert.equal(r.driven, false); assert.match(r.status, /Machine OFF/); assert.equal(r.realPowerW, 0);
});

// ------------------------------------------------------------------ connection coordinator

test('coordinator: open / short / load are exclusive and a connected load is never replaced by touching the leads', () => {
  const c = new ConnectionCoordinator();
  assert.equal(c.resolve(false).kind, 'open');
  assert.equal(c.resolve(true).kind, 'short');
  assert.equal(c.canTouchLeads().ok, true);
  const load = resistiveLoad(50);
  assert.equal(c.connectLoad(load, false).ok, true);
  const r = c.resolve(false); assert.equal(r.kind, 'load'); assert.equal(r.conflict, false);
  const t = c.resolve(true);   assert.equal(t.kind, 'load', 'no silent load → short switch'); assert.equal(t.conflict, true);
  assert.equal(t.connection, r.connection, 'stable identity: the engine sees the same connection object every frame');
  assert.equal(c.canTouchLeads().ok, false);
  c.disconnectLoad();
  assert.equal(c.canTouchLeads().ok, true);
  assert.equal(c.resolve(true).kind, 'short', 'short-to-load transitions only after a deliberate disconnect');
});

test('coordinator: refuses to connect while the leads touch, rejects invalid loads atomically, copies the load', () => {
  const c = new ConnectionCoordinator();
  const refused = c.connectLoad(resistiveLoad(50), true);
  assert.equal(refused.ok, false); assert.equal(c.loadConnected, false); assert.equal(c.revision, 0);
  assert.throws(() => c.connectLoad({ kind: 'resistive', rlc: { ohms: -5 } } as never, false), RangeError);
  assert.throws(() => c.connectLoad(resistiveLoad(50), false, 'yes' as never), RangeError);
  assert.equal(c.loadConnected, false, 'a rejected connect changes nothing');
  const mine = resistiveLoad(50);
  c.connectLoad(mine, false);
  (mine.rlc as { ohms: number }).ohms = -1; // caller mutates their object afterwards
  assert.equal((c.connectedLoad as { rlc: { ohms: number } }).rlc.ohms, 50, 'coordinator holds its own frozen copy');
  assert.throws(() => { (c.connectedLoad as { rlc: { ohms: number } }).rlc.ohms = 1; });
});

test('AC ↔ DC switching with a load attached keeps the load, power, SOC and health continuity', () => {
  const b = buildLoad('inductor', presetForm('inductor')); assert.ok(b.ok);
  const c = new ConnectionCoordinator(); if (b.ok) c.connectLoad(b.load, false);
  const e = new Engine(defaultConfig());
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 100, connection: c.resolve(false).connection }); seconds(e, 1);
  let prev = e.snapshot();
  for (let i = 0; i < 20; i++) {
    e.setInputs({ mode: i % 2 ? 'ac' : 'dc', connection: c.resolve(false).connection }); seconds(e, 0.3);
    const s = e.snapshot();
    assert.equal(s.inputs.powerOn, true); assert.equal(s.inputs.connection, 'load'); assert.ok(s.load, 'load stays attached');
    assert.ok(s.battery.socFrac <= prev.battery.socFrac + 1e-12, 'SOC never rises (no charging, no reset)');
    assert.ok(s.output.currentA > 1, 'engine re-solves the operating point after every switch');
    assert.ok(Math.abs(s.ledger.batteryResidualWh) < 1e-9);
    prev = s;
  }
});

// ---- Phase 1B: beginner-readable metadata used by the Workbench (presentation only; no electrical behaviour changes)
test('catalogue metadata for the Workbench: plain-language role, AC/DC support and a beginner-readable unit name for every field', () => {
  for (const l of LOAD_CATALOGUE) {
    assert.ok(l.role.length > 30, `${l.id} role`);
    assert.match(l.inputSupport, /AC|DC/);
    assert.ok(l.symbol.startsWith('<'), 'symbol markup');
    for (const p of l.params) assert.ok(p.term.length > 3 && p.help.length > 10, `${l.id}.${p.key} term/help`);
  }
  const term = (id: LoadTypeId, key: string): string => (loadTypeSpec(id).params.find((p) => p.key === key) as { term: string }).term;
  assert.match(term('resistor', 'ohms'), /ohms \(Ω\)/);
  assert.match(term('inductor', 'henries'), /henries \(H\)/);
  assert.match(term('capacitor', 'farads'), /farads \(F\).*µF.*one-millionth/);
  assert.match(loadTypeSpec('rlc').summary, /RLC means resistor, inductor and capacitor/);
  assert.equal(loadTypeSpec('dc-motor').inputSupport, 'DC only');
});

test('the lead-touch refusal message points at the Workbench now that Load Lab moved out of Controls', () => {
  const c = new ConnectionCoordinator(); c.connectLoad(resistiveLoad(50), false);
  const r = c.canTouchLeads();
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /Workbench/.test(r.reason) && !/Controls → Load Lab/.test(r.reason));
});
