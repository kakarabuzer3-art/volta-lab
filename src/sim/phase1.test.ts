// Regression tests for the "final engineering completion" engine fixes:
//   1.1 battery depletion INSIDE a step (thermal / timers / overstress use the active time only)
//   1.2 an empty battery never reports RUNNING
//   1.3 "no drive" is not a fake 0 V DC drive
//   1.4 strict, atomic runtime connection validation
//   1.5 deep immutability of configuration after construction
//   1.6 stricter chemistry-profile validation
// Expected values are computed HERE with closed-form arithmetic (Coulomb counting, exponential thermal
// solution), never by calling the engine's own helpers for the quantity under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Engine, STEP_S, defaultConfig, resistiveLoad, inductiveLoad, packModel, LI_ION_NMC, LEAD_ACID, CHEMISTRIES, validateChemistryProfile,
  OVERSTRESS_DWELL_S,
} from './index.ts';
import type { ChemistryProfile, EngineConfig, Load } from './index.ts';

const DT = STEP_S;
const steps = (e: Engine, n: number): void => { for (let k = 0; k < n; k++) e.step(); };
const json = (x: unknown): string => JSON.stringify(x);
/** Independent closed-form first-order thermal solution (Newton cooling). */
const thermal = (t0: number, heatW: number, amb: number, cth: number, rth: number, dt: number): number => {
  const tInf = amb + heatW * rth;
  return tInf + (t0 - tInf) * Math.exp(-dt / (cth * rth));
};
const close = (a: number, b: number, tol: number, msg: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (|Δ| = ${Math.abs(a - b)} > ${tol})`);

const LOAD_THERMAL = { cthJPerK: 50, rthKPerW: 2 };

function dcRig(soc: number, load: Load | null = resistiveLoad(40)): Engine {
  const cfg = defaultConfig(); cfg.initialSoc = soc;
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 });
  if (load) e.attachLoad(load);
  return e;
}
/** Fraction of the first step the battery can actually supply, from Coulomb counting only. */
function activeFraction(e: Engine): number {
  const s = e.snapshot();
  const chargeAs = s.battery.socFrac * s.battery.capacityAh * 3600;
  return Math.min(1, chargeAs / (s.battery.currentA * DT));
}
/** Find an initial SOC for which the 1st step is active for ≈ `target` of its length (bisection on Coulomb counting). */
function socForFraction(target: number, load: () => Load | null = () => resistiveLoad(40)): number {
  let lo = 1e-9, hi = 0.01;
  for (let k = 0; k < 80; k++) {
    const mid = 0.5 * (lo + hi);
    if (activeFraction(dcRig(mid, load())) < target) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ------------------------------------------------------------------------------------------ 1.1
for (const target of [1, 0.5, 0.05, 0.95]) {
  test(`1.1 depletion at ${(target * 100).toFixed(0)} % of a step: converter + load temperature use the active time, then cool`, () => {
    const soc = target === 1 ? 0.5 : socForFraction(target);
    const e = dcRig(soc);
    const before = e.snapshot();
    const f = activeFraction(e);
    if (target === 1) assert.equal(f, 1); else close(f, target, 1e-6, 'bisection reached the requested fraction');
    const cfg = e.config;
    const amb = cfg.ambientC;
    const convHeat = before.converter.lossW;
    const loadHeat = before.load!.op.heatW;
    assert.ok(convHeat > 10 && loadHeat > 500, 'precondition: both converter and load are dissipating');
    e.step();
    const after = e.snapshot();
    const activeS = DT * f, idleS = DT - activeS;
    // converter: heated for activeS, then cooled with zero dissipation for idleS
    let expC = thermal(amb, convHeat, amb, cfg.converter.cthJPerK, cfg.converter.rthKPerW, activeS);
    expC = thermal(expC, 0, amb, cfg.converter.cthJPerK, cfg.converter.rthKPerW, idleS);
    // tolerance 0.1 % of the temperature RISE: the engine re-solves the operating point for the shortened interval, so its heat
    // differs from the start-of-step value by a few 1e-6 relative; wrong timing would be off by (1−f) of the rise (≥ 5 %).
    close(after.converter.tempC, expC, 1e-3 * Math.max(expC - amb, 1e-9), 'converter temperature');
    // load: same, using the fixture load's own thermal pair
    let expL = thermal(amb, loadHeat, amb, LOAD_THERMAL.cthJPerK, LOAD_THERMAL.rthKPerW, activeS);
    expL = thermal(expL, 0, amb, LOAD_THERMAL.cthJPerK, LOAD_THERMAL.rthKPerW, idleS);
    close(after.load!.health.tempC, expL, 1e-3 * Math.max(expL - amb, 1e-9), 'load temperature');
    if (target < 1) {
      // The old behaviour (heating for the whole step) would give a measurably hotter result.
      const wrongC = thermal(amb, convHeat, amb, cfg.converter.cthJPerK, cfg.converter.rthKPerW, DT);
      assert.ok(wrongC - after.converter.tempC > 0.5 * (1 - f) * (wrongC - amb), 'differs from full-step heating');
      // Energy: only the active part was delivered (output = P · activeS), nothing after depletion.
      close(after.ledger.outputWh, (before.output.pRealW * activeS) / 3600, 1e-4 * after.ledger.outputWh, 'output energy = P · active time');
      assert.equal(after.battery.socFrac, 0);
      assert.equal(after.battery.currentA, 0);
      assert.equal(after.output.voltage, 0);
      assert.equal(after.output.currentA, 0);
      assert.equal(after.output.pRealW, 0);
      assert.equal(after.load!.op.currentA, 0);
    }
    assert.ok(Math.abs(after.ledger.batteryResidualWh) < 1e-9, 'battery ledger (A) closed');
    // (B) is exact for whole steps. In the depleting step the converter was solved with the battery's full-step
    // Thevenin source while the battery ran for a shorter time, a documented ≈1e-6 relative model approximation.
    const tolB = target === 1 ? 1e-6 : 1e-5;
    assert.ok(Math.abs(after.ledger.terminalResidualWh) < tolB * Math.max(after.ledger.batteryTerminalWh, 1e-9), 'converter ledger (B) closed');
    assert.equal(json(e.snapshot()), json(after), 'snapshot is stable (consistent, not a mix of two states)');
  });
}

test('1.1 after depletion there is no further output, no battery consumption, and everything only cools', () => {
  const e = dcRig(socForFraction(0.5));
  e.step();
  const s1 = e.snapshot();
  let prevC = s1.converter.tempC, prevL = s1.load!.health.tempC;
  steps(e, 200);
  const s2 = e.snapshot();
  assert.equal(s2.ledger.outputWh, s1.ledger.outputWh);
  assert.equal(s2.ledger.batteryTerminalWh, s1.ledger.batteryTerminalWh);
  assert.equal(s2.ledger.batteryChemicalWh, s1.ledger.batteryChemicalWh);
  assert.equal(s2.ledger.loadHeatWh, s1.ledger.loadHeatWh);
  assert.equal(s2.battery.dischargedWh, s1.battery.dischargedWh);
  assert.ok(s2.converter.tempC < prevC && s2.load!.health.tempC < prevL, 'converter and load cool');
  assert.ok(s2.load!.health.tempC >= 25 && s2.converter.tempC >= 25, 'never below ambient');
  prevC = s2.converter.tempC; prevL = s2.load!.health.tempC;
  steps(e, 50);
  assert.ok(e.snapshot().converter.tempC < prevC && e.snapshot().load!.health.tempC < prevL, 'monotonic cooling continues');
});

test('1.1 overstress is not extended by time after depletion', () => {
  // 200 V on a 40 Ω load whose absolute maximum is 150 V: stress accumulates only while really driven.
  const mk = (): Load => resistiveLoad(40, { vRatedMaxV: 100, vAbsMaxV: 150 }, LOAD_THERMAL);
  const e = dcRig(socForFraction(0.4, () => mk()), mk());
  const f = activeFraction(e);
  close(f, 0.4, 1e-6, 'fraction');
  e.step();
  const h = e.snapshot().load!.health;
  const activeS = DT * f;
  assert.ok(activeS < OVERSTRESS_DWELL_S, 'precondition: the active time alone is below the damage dwell');
  // active accumulation, then decay over the idle remainder — never more than the active time and never damage
  close(h.overstressS, Math.max(0, activeS - (DT - activeS)), 1e-12, 'overstress = max(0, active − idle)');
  assert.ok(h.overstressS <= activeS + 1e-15);
  assert.notEqual(h.state, 'damaged');
});

test('1.1 protection timers count the active time only', () => {
  // Short circuit at 415 V in DC mode is held in current limit: the overcurrent timer must advance by activeS only.
  const cfg = defaultConfig();
  const probe = new Engine({ ...cfg, initialSoc: 0.5 });
  probe.setInputs({ powerOn: true, mode: 'dc', setpointV: 415, connection: { kind: 'short' } });
  assert.equal(probe.snapshot().output.currentLimited, true, 'precondition: current-limited');
  const mk = (soc: number): Engine => { const e = new Engine({ ...cfg, initialSoc: soc }); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 415, connection: { kind: 'short' } }); return e; };
  let lo = 1e-9, hi = 0.01;
  for (let k = 0; k < 80; k++) { const mid = 0.5 * (lo + hi); if (activeFraction(mk(mid)) < 0.3) lo = mid; else hi = mid; }
  const e = mk(0.5 * (lo + hi));
  const f = activeFraction(e);
  close(f, 0.3, 1e-6, 'fraction');
  e.step();
  const s = e.snapshot();
  close(s.protection.overcurrentTimerS, DT * f, 1e-7, 'overcurrent timer = active time only');
  assert.equal(s.protection.trip, 'battery-empty');
});

test('1.1 ledger stays balanced across a depletion in AC mode with a reactive load', () => {
  const cfg = defaultConfig(); cfg.initialSoc = 2e-7;
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 20 }); // light load: empties before the low-voltage cutoff
  e.attachLoad(inductiveLoad(20, 0.1));
  steps(e, 4000);
  const s = e.snapshot();
  assert.equal(s.battery.socFrac, 0, 'battery really emptied during the run');
  assert.ok(s.ledger.outputWh > 0);
  assert.ok(Math.abs(s.ledger.batteryResidualWh) < 1e-9);
  assert.ok(Math.abs(s.ledger.terminalResidualWh) < 1e-5 * s.ledger.batteryTerminalWh);
  assert.ok(s.ledger.batteryChemicalWh >= s.ledger.batteryTerminalWh, 'no energy created');
  // reactive power is not consumed energy: everything the battery gave = real output + losses
  assert.ok(Math.abs(s.ledger.batteryTerminalWh - s.ledger.outputWh - s.ledger.conversionLossWh) < 1e-6 * s.ledger.batteryTerminalWh);
});

// ------------------------------------------------------------------------------------------ 1.2
test('1.2 initialSoc 0: OFF is "off", ON is "battery-empty", never running, all outputs zero', () => {
  const cfg = defaultConfig(); cfg.initialSoc = 0;
  const e = new Engine(cfg);
  assert.equal(e.snapshot().status, 'off');
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 });
  for (const phase of ['immediately', 'after stepping']) {
    if (phase === 'after stepping') steps(e, 50);
    const s = e.snapshot();
    assert.equal(s.status, 'battery-empty', phase);
    assert.notEqual(s.status, 'running');
    assert.match(s.protection.message ?? '', /empty/i);
    assert.equal(s.output.voltage, 0); assert.equal(s.output.currentA, 0); assert.equal(s.output.pRealW, 0);
    assert.equal(s.battery.currentA, 0); assert.equal(s.converter.iInA, 0);
    assert.ok(s.battery.limits.includes('empty'), 'battery limits agree with the status');
  }
});

test('1.2 empty battery: AC mode, connected load, short circuit — never running, nothing generated', () => {
  const cfg = defaultConfig(); cfg.initialSoc = 0;
  for (const conn of [{ kind: 'open' }, { kind: 'short' }, { kind: 'load', load: resistiveLoad(40), reversed: false }] as const) {
    for (const mode of ['ac', 'dc'] as const) {
      const e = new Engine(cfg);
      e.setInputs({ powerOn: true, mode, setpointV: 230, connection: conn });
      steps(e, 100);
      const s = e.snapshot();
      assert.equal(s.status, 'battery-empty', `${conn.kind}/${mode}`);
      assert.equal(s.output.currentA, 0); assert.equal(s.output.voltage, 0);
      assert.equal(s.ledger.outputWh, 0); assert.equal(s.ledger.batteryTerminalWh, 0); assert.equal(s.ledger.batteryChemicalWh, 0);
      assert.equal(s.battery.socFrac, 0); assert.equal(s.battery.chargedWh, 0);
    }
  }
});

test('1.2 power cycling an empty battery never produces a running state', () => {
  const cfg = defaultConfig(); cfg.initialSoc = 0;
  const e = new Engine(cfg);
  for (let k = 0; k < 4; k++) {
    e.setInputs({ powerOn: true, mode: 'dc', setpointV: 100 }); steps(e, 10);
    assert.equal(e.snapshot().status, 'battery-empty');
    e.setInputs({ powerOn: false }); steps(e, 10);
    assert.equal(e.snapshot().status, 'off');
  }
});

test('1.2 battery emptied by normal discharge: status stays battery-empty after the latched trip and after power cycling', () => {
  // A light load (5 V into 40 Ω) so the pack reaches exactly 0 % before the low-voltage cutoff trip could fire.
  const cfg = defaultConfig(); cfg.initialSoc = 1e-7;
  const e = new Engine(cfg); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 5 }); e.attachLoad(resistiveLoad(40));
  steps(e, 300);
  let s = e.snapshot();
  assert.equal(s.battery.socFrac, 0);
  assert.equal(s.protection.trip, 'battery-empty');
  assert.equal(s.status, 'battery-empty');
  assert.match(s.protection.message ?? '', /empty/i);
  const outWh = s.ledger.outputWh;
  e.setInputs({ powerOn: false }); steps(e, 5);
  assert.equal(e.snapshot().status, 'off');
  e.setInputs({ powerOn: true }); steps(e, 50);
  s = e.snapshot();
  assert.equal(s.status, 'battery-empty');
  assert.equal(s.protection.trip, null, 'power cycle cleared the latch, but the battery is still empty');
  assert.equal(s.output.currentA, 0);
  assert.equal(s.ledger.outputWh, outWh, 'no energy produced from an empty battery');
  assert.equal(s.battery.chargedWh, 0, 'no charging feature');
});

// ------------------------------------------------------------------------------------------ 1.3
const acRated = (): Load => resistiveLoad(40, { input: 'ac', vRatedMaxV: 250, tWarnC: 60, tMaxC: 120 }, LOAD_THERMAL);
const dcRated = (): Load => resistiveLoad(40, { input: 'dc', vRatedMaxV: 250, tWarnC: 60, tMaxC: 120 }, LOAD_THERMAL);
const noWarnings = (e: Engine, what: string): void => {
  const h = e.snapshot().load!.health;
  assert.equal(h.state, 'normal', what); assert.deepEqual(h.reasons, [], what);
};
for (const [name, mk, goodMode, badMode] of [['AC-rated', acRated, 'ac', 'dc'], ['DC-rated', dcRated, 'dc', 'ac']] as const) {
  test(`1.3 ${name} load: machine OFF → no unsupported-input / voltage / current warnings`, () => {
    const e = new Engine(); e.setInputs({ powerOn: false, mode: badMode, setpointV: 220 }); e.attachLoad(mk()); steps(e, 100);
    noWarnings(e, 'off, wrong mode selected');
    e.setInputs({ mode: goodMode }); steps(e, 50); noWarnings(e, 'off, right mode selected');
  });
  test(`1.3 ${name} load: ON with matching drive is normal; mismatched drive warns (existing behaviour kept)`, () => {
    const e = new Engine(); e.setInputs({ powerOn: true, mode: goodMode, setpointV: 20 }); e.attachLoad(mk()); steps(e, 100);
    noWarnings(e, 'matching');
    const w = new Engine(); w.setInputs({ powerOn: true, mode: badMode, setpointV: 20 }); w.attachLoad(mk()); steps(w, 100);
    assert.equal(w.snapshot().load!.health.state, 'warning');
    assert.ok(w.snapshot().load!.health.reasons.some((r) => /Unsupported input/.test(r)));
    // switching the machine off clears the transient warning
    w.setInputs({ powerOn: false }); steps(w, 5);
    noWarnings(w, 'warning cleared after power off');
  });
  test(`1.3 ${name} load: power-up with nothing attached, then attach while OFF — no false warning`, () => {
    const e = new Engine(); e.setInputs({ powerOn: true, mode: badMode, setpointV: 220 }); steps(e, 20);
    e.setInputs({ powerOn: false }); e.attachLoad(mk()); steps(e, 20);
    noWarnings(e, 'attached while off');
  });
}

test('1.3 a load that overheated cools toward ambient (closed form) once the machine is switched off', () => {
  const load = resistiveLoad(40, { tWarnC: 40, tMaxC: 400 }, LOAD_THERMAL);
  const e = new Engine(); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 60 }); e.attachLoad(load);
  steps(e, 1500); // 30 s at 90 W into Cth 50 / Rth 2 → above the warning level
  const hot = e.snapshot().load!.health;
  assert.equal(hot.state, 'overheating');
  e.setInputs({ powerOn: false });
  const n = 2000;
  steps(e, n);
  const h = e.snapshot().load!.health;
  close(h.tempC, thermal(hot.tempC, 0, 25, 50, 2, n * DT), 1e-9, 'closed-form cooling');
  assert.ok(h.tempC < hot.tempC);
  assert.equal(h.state, h.tempC >= 40 ? 'overheating' : 'normal');
  assert.ok(!h.reasons.some((r) => /Unsupported|Overvoltage|Overcurrent/.test(r)));
});

test('1.3 permanent damage and latched load protection survive switching the machine off', () => {
  const dead = resistiveLoad(40, { vRatedMaxV: 100, vAbsMaxV: 150 }, LOAD_THERMAL);
  const e = new Engine(); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 }); e.attachLoad(dead); steps(e, 20);
  assert.equal(e.snapshot().load!.health.state, 'damaged');
  e.setInputs({ powerOn: false }); steps(e, 50);
  assert.equal(e.snapshot().load!.health.state, 'damaged');
  const prot = resistiveLoad(40, { overcurrentTripA: 1 }, LOAD_THERMAL);
  const p = new Engine(); p.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 }); p.attachLoad(prot); steps(p, 5);
  assert.equal(p.snapshot().load!.health.state, 'protection');
  p.setInputs({ powerOn: false }); steps(p, 50);
  assert.equal(p.snapshot().load!.health.state, 'protection');
});

// ------------------------------------------------------------------------------------------ 1.4
const BAD_CONNECTIONS: Array<[string, unknown]> = [
  ['null', null], ['undefined', undefined], ['string', 'open'], ['number', 1], ['empty object', {}],
  ['unknown kind', { kind: 'bridge' }], ['load without load', { kind: 'load', reversed: false }],
  ['load with null load', { kind: 'load', load: null, reversed: false }],
  ['load with invalid load', { kind: 'load', load: { kind: 'resistive' }, reversed: false }],
  ['load missing reversed', { kind: 'load', load: resistiveLoad(10) }],
  ['load reversed = "yes"', { kind: 'load', load: resistiveLoad(10), reversed: 'yes' }],
  ['load reversed = 1', { kind: 'load', load: resistiveLoad(10), reversed: 1 }],
  ['load reversed = null', { kind: 'load', load: resistiveLoad(10), reversed: null }],
];
test('1.4 every malformed connection is rejected with a RangeError that names the field', () => {
  const e = new Engine();
  for (const [name, c] of BAD_CONNECTIONS) {
    assert.throws(() => e.setInputs({ connection: c as never }), (err: unknown) => err instanceof RangeError && /connection|load|reversed/.test(err.message), name);
  }
  for (const c of [{ kind: 'open' }, { kind: 'short' }, { kind: 'load', load: resistiveLoad(10), reversed: true }] as const) e.setInputs({ connection: c }); // valid ones accepted
});

test('1.4 a rejected input changes nothing: connection, timers, trips, load health and the previous snapshot', () => {
  const mk = (): Engine => {
    const e = new Engine(); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 415, connection: { kind: 'short' } });
    steps(e, 50); // overcurrent timer is running (current-limited short)
    return e;
  };
  const e = mk(), twin = mk();
  const before = json(e.snapshot()), inputsBefore = json(e.getInputs());
  assert.ok(e.snapshot().protection.overcurrentTimerS > 0, 'precondition: a timer is running');
  for (const [name, c] of BAD_CONNECTIONS) {
    assert.throws(() => e.setInputs({ connection: c as never, powerOn: false, setpointV: 1 }), RangeError, name);
    assert.equal(json(e.snapshot()), before, `${name}: snapshot untouched`);
    assert.equal(json(e.getInputs()), inputsBefore, `${name}: inputs untouched (including the other fields in the same call)`);
  }
  steps(e, 100); steps(twin, 100);
  assert.equal(json(e.snapshot()), json(twin.snapshot()), 'behaves exactly like an engine that never saw the bad inputs');
});

test('1.4 load health and a latched trip are untouched by a rejected call', () => {
  const mk = (): Engine => { const e = new Engine(); e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 }); e.attachLoad(resistiveLoad(40)); steps(e, 300); return e; };
  const e = mk(), twin = mk();
  const t = e.snapshot().load!.health.tempC;
  assert.ok(t > 26);
  assert.throws(() => e.setInputs({ connection: { kind: 'load', load: resistiveLoad(40), reversed: 'nope' as never } }), RangeError);
  assert.equal(e.snapshot().load!.health.tempC, t);
  assert.throws(() => e.attachLoad(resistiveLoad(40), 'true' as never), RangeError);
  assert.throws(() => e.attachLoad(resistiveLoad(40), null as never), RangeError);
  assert.throws(() => e.attachLoad({ kind: 'resistive' } as never), RangeError);
  assert.equal(e.snapshot().load!.health.tempC, t, 'attachLoad is atomic too: health was not reset');
  steps(e, 50); steps(twin, 50);
  assert.equal(json(e.snapshot()), json(twin.snapshot()));
  // a tripped machine stays tripped
  const s = new Engine(); s.setInputs({ powerOn: true, mode: 'dc', setpointV: 415, connection: { kind: 'short' } }); steps(s, 200);
  assert.equal(s.snapshot().protection.trip, 'overcurrent');
  assert.throws(() => s.setInputs({ connection: null as never }), RangeError);
  assert.equal(s.snapshot().protection.trip, 'overcurrent');
});

test('1.4 the engine keeps its own copy of an accepted connection', () => {
  const e = new Engine();
  const c = { kind: 'load', load: resistiveLoad(40), reversed: false } as { kind: 'load'; load: Load; reversed: boolean };
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 100, connection: c });
  (c as { reversed: boolean }).reversed = true; (c as { kind: string }).kind = 'short';
  steps(e, 10);
  assert.equal(e.getInputs().connection.kind, 'load');
  assert.equal(e.snapshot().inputs.reversed, false);
});

// ------------------------------------------------------------------------------------------ 1.5
test('1.5 mutating the EngineConfig after construction cannot change a running engine', () => {
  const cfg = defaultConfig();
  const e = new Engine(cfg), twin = new Engine(defaultConfig());
  for (const x of [e, twin]) { x.setInputs({ powerOn: true, mode: 'ac', setpointV: 230 }); x.attachLoad(resistiveLoad(60)); steps(x, 20); }
  cfg.pack.seriesCells = 3; cfg.pack.cell.capacityAh = 0.1; cfg.pack.cell.chemistry = 'lead-acid';
  cfg.converter.turnsRatio = 99; cfg.converter.pFixedW = 5000; cfg.converter.tShutdownC = 26;
  cfg.inverter.stage.rConductionOhm = 10; cfg.inverter.bridgeRohm = 10;
  cfg.ambientC = -40; cfg.initialSoc = 0; cfg.acFreqHz = 400; cfg.contactOhm = 100; cfg.tripDelayS = 0.001;
  for (const x of [e, twin]) steps(x, 500);
  assert.equal(json(e.snapshot()), json(twin.snapshot()));
  assert.equal(e.snapshot().status, 'running');
});

test('1.5 the engine exposes a frozen configuration and a frozen pack model', () => {
  const e = new Engine();
  assert.throws(() => { (e.config as EngineConfig).ambientC = 99; }, TypeError);
  assert.throws(() => { (e.config.pack as { seriesCells: number }).seriesCells = 1; }, TypeError);
  assert.throws(() => { (e.config.converter as { turnsRatio: number }).turnsRatio = 2; }, TypeError);
  assert.throws(() => { (e.pack as { cutoffV: number }).cutoffV = 0; }, TypeError);
  assert.throws(() => { (e.pack.config as { parallelStrings: number }).parallelStrings = 9; }, TypeError);
  assert.throws(() => { (LI_ION_NMC as { cutoffVPerCell: number }).cutoffVPerCell = 0; }, TypeError);
  assert.throws(() => { (LI_ION_NMC.ocvTable as unknown as number[][])[0][1] = 9; }, TypeError);
  assert.throws(() => { (CHEMISTRIES as { 'li-ion': ChemistryProfile })['li-ion'] = LEAD_ACID; }, TypeError);
});

test('1.5 packModel cache is keyed by values: mutating a PackConfig after use never serves a stale or corrupted model', () => {
  const p = { cell: { chemistry: 'li-ion' as const, capacityAh: 5 }, seriesCells: 100, parallelStrings: 2 };
  const m1 = packModel(p);
  assert.equal(m1.cells, 200);
  const v1 = m1.nominalVoltageV;
  p.seriesCells = 50; p.cell.capacityAh = 2;
  const m2 = packModel(p);
  assert.equal(m2.cells, 100);
  assert.equal(m1.cells, 200, 'earlier model untouched');
  assert.equal(m1.nominalVoltageV, v1);
  assert.equal(m1.config.seriesCells, 100);
  assert.ok(Math.abs(m2.nominalVoltageV - v1 / 2) < 1e-9);
  p.seriesCells = 100; p.cell.capacityAh = 5;
  assert.equal(packModel(p).cells, 200, 'restoring the values gives the matching model again');
});

// ------------------------------------------------------------------------------------------ 1.6
const edit = (f: (p: { -readonly [K in keyof ChemistryProfile]: ChemistryProfile[K] } & Record<string, unknown>) => void): ChemistryProfile => {
  const p = structuredClone(LI_ION_NMC) as unknown as Parameters<typeof f>[0];
  f(p); return p as unknown as ChemistryProfile;
};
test('1.6 the shipped chemistry profiles still validate', () => {
  validateChemistryProfile(LI_ION_NMC); validateChemistryProfile(LEAD_ACID);
  validateChemistryProfile(structuredClone(LI_ION_NMC)); validateChemistryProfile(structuredClone(LEAD_ACID));
});
test('1.6 cutoff / max-charge voltages: finite, positive, max > cutoff', () => {
  for (const v of [NaN, Infinity, 0, -1]) {
    assert.throws(() => validateChemistryProfile(edit((p) => { p.cutoffVPerCell = v; })), RangeError, `cutoff ${v}`);
    assert.throws(() => validateChemistryProfile(edit((p) => { p.maxChargeVPerCell = v; })), RangeError, `maxCharge ${v}`);
  }
  assert.throws(() => validateChemistryProfile(edit((p) => { p.maxChargeVPerCell = p.cutoffVPerCell; })), /greater than cutoffVPerCell/);
  assert.throws(() => validateChemistryProfile(edit((p) => { p.maxChargeVPerCell = p.cutoffVPerCell - 0.1; })), /greater than cutoffVPerCell/);
});
for (const table of ['ocvTable', 'r0SocFactor'] as const) {
  test(`1.6 ${table}: SOC coordinates finite, within 0–1, strictly increasing, covering 0…1`, () => {
    const t = (p: Record<string, unknown>): number[][] => p[table] as number[][];
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[1][0] = NaN; })), RangeError, 'NaN soc');
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[1][0] = Infinity; })), RangeError, 'Infinity soc');
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[0][0] = -0.1; })), /between 0 and 1/, 'soc < 0');
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[t(p).length - 1][0] = 1.2; })), /between 0 and 1/, 'soc > 1');
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[2][0] = t(p)[1][0]; })), /strictly increasing/, 'duplicate soc');
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[2][0] = 0.0001; })), /strictly increasing/, 'decreasing soc');
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[0][0] = 0.02; })), /exactly 0/, 'does not start at 0');
    assert.throws(() => validateChemistryProfile(edit((p) => { t(p)[t(p).length - 1][0] = 0.95; })), /exactly 1/, 'does not reach 1');
    assert.throws(() => validateChemistryProfile(edit((p) => { p[table] = [[0, 1]]; })), /≥ 2 points/, 'too few points');
    assert.throws(() => validateChemistryProfile(edit((p) => { p[table] = [[0, 1], [0.5]]; })), RangeError, 'malformed pair');
  });
}
test('1.6 OCV values: finite, positive, non-decreasing; resistance factors: finite and positive', () => {
  for (const v of [NaN, Infinity, 0, -3]) {
    assert.throws(() => validateChemistryProfile(edit((p) => { (p.ocvTable as unknown as number[][])[3][1] = v; })), RangeError, `ocv ${v}`);
    assert.throws(() => validateChemistryProfile(edit((p) => { (p.r0SocFactor as unknown as number[][])[1][1] = v; })), RangeError, `r0 factor ${v}`);
  }
  assert.throws(() => validateChemistryProfile(edit((p) => { (p.ocvTable as unknown as number[][])[5][1] = 3.0; })), /non-decreasing/);
});
test('1.6 an invalid profile can never reach a pack model', () => {
  assert.throws(() => validateChemistryProfile({ ...structuredClone(LI_ION_NMC), chemistry: 'nickel' as never }), RangeError);
});
