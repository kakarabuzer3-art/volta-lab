// Boundary validation: every public constructor / configuration entry point rejects physically
// invalid values with a message that names the exact parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Engine, acInputSupplyLoad, capacitiveLoad, createBatteryState, dcModuleLoad, dcMotorLoad, defaultConfig, inductiveLoad, packModel,
  resistiveLoad, rlcLoad, solveDcDc, MACHINE_CONVERTER, NO_RATINGS, validateEngineConfig, validateLoad,
} from './index.ts';
import type { EngineConfig, Load } from './index.ts';

const BAD_NUMBERS = [NaN, Infinity, -Infinity];
const throwsNamed = (fn: () => unknown, name: RegExp): void => assert.throws(fn, (e: unknown) => e instanceof RangeError && name.test(e.message), `expected RangeError matching ${name}`);
const cfg = (patch: (c: EngineConfig) => void): EngineConfig => { const c = structuredClone(defaultConfig()); patch(c); return c; };

test('validation 1. NaN / Infinity are rejected everywhere, never converted to a valid-looking value', () => {
  for (const x of BAD_NUMBERS) {
    throwsNamed(() => resistiveLoad(x), /ohms/);
    throwsNamed(() => inductiveLoad(1, x), /henries/);
    throwsNamed(() => capacitiveLoad(x, 0), /farads/);
    throwsNamed(() => acInputSupplyLoad({ pOutW: 10, efficiency: x, busCapF: 1e-4 }), /efficiency/);
    throwsNamed(() => dcMotorLoad({ rArmOhm: x, kVsPerRad: 0.1, loadTorqueNm: 0, viscousNmsPerRad: 0 }), /rArmOhm/);
    throwsNamed(() => dcModuleLoad({ vForwardV: x, rDynOhm: 1 }), /vForwardV/);
    throwsNamed(() => new Engine().setInputs({ setpointV: x }), /setpointV/);
    throwsNamed(() => createBatteryState(x), /SOC/);
    throwsNamed(() => packModel({ cell: { chemistry: 'li-ion', capacityAh: x }, seriesCells: 2, parallelStrings: 1 }), /capacityAh/);
  }
});

test('validation 2. negative or zero resistance / reactances are rejected with the parameter name', () => {
  for (const x of [0, -1]) {
    throwsNamed(() => resistiveLoad(x), /ohms \(resistance\)/);
    throwsNamed(() => inductiveLoad(x, 0.1), /winding resistance/);
    throwsNamed(() => rlcLoad(1, 0.1, x), /farads/);
  }
  throwsNamed(() => capacitiveLoad(1e-6, -0.1), /ESR/);
  assert.doesNotThrow(() => capacitiveLoad(1e-6, 0), 'zero ESR is a valid ideal capacitor');
  assert.doesNotThrow(() => dcModuleLoad({ vForwardV: 0, rDynOhm: 1 }), 'zero knee voltage is a valid resistor-like module');
  throwsNamed(() => dcModuleLoad({ vForwardV: -0.1, rDynOhm: 1 }), /vForwardV/);
  throwsNamed(() => dcModuleLoad({ vForwardV: 2, rDynOhm: 0 }), /dynamic resistance/);
  throwsNamed(() => dcMotorLoad({ rArmOhm: 1, kVsPerRad: 0, loadTorqueNm: 0, viscousNmsPerRad: 0 }), /motor constant/);
  throwsNamed(() => dcMotorLoad({ rArmOhm: 1, kVsPerRad: 0.1, loadTorqueNm: -1, viscousNmsPerRad: 0 }), /loadTorqueNm/);
});

test('validation 3. efficiency must satisfy 0 < η ≤ 1 (a result of 150 % is rejected)', () => {
  for (const eta of [0, -0.1, 1.0000001, 1.5, 90]) throwsNamed(() => acInputSupplyLoad({ pOutW: 10, efficiency: eta, busCapF: 1e-4 }), /efficiency.*0 < η ≤ 1/);
  assert.doesNotThrow(() => acInputSupplyLoad({ pOutW: 10, efficiency: 1, busCapF: 1e-4 }));
  assert.doesNotThrow(() => acInputSupplyLoad({ pOutW: 10, efficiency: 0.0001, busCapF: 1e-4 }));
  // Computed converter efficiency never exceeds 1 across a sweep of operating points.
  const src = { eV: 370, rOhm: 0.1 };
  for (const v of [5, 50, 200, 415]) for (const r of [10, 100, 1000, 1e5]) {
    const s = solveDcDc(MACHINE_CONVERTER, src, { iOfV: (x) => x / r }, v);
    if (s.efficiency !== null) assert.ok(s.efficiency > 0 && s.efficiency <= 1, `η=${s.efficiency}`);
  }
});

test('validation 4. battery configuration', () => {
  const ok = { cell: { chemistry: 'li-ion' as const, capacityAh: 5 }, seriesCells: 4, parallelStrings: 2 };
  assert.doesNotThrow(() => packModel({ ...ok }));
  for (const cap of [0, -5]) throwsNamed(() => packModel({ ...ok, cell: { ...ok.cell, capacityAh: cap } }), /capacityAh/);
  for (const n of [0, -1, 1.5, 2.0000001]) { throwsNamed(() => packModel({ ...ok, seriesCells: n }), /seriesCells/); throwsNamed(() => packModel({ ...ok, parallelStrings: n }), /parallelStrings/); }
  throwsNamed(() => packModel({ ...ok, cell: { chemistry: 'nickel-cadmium' as never, capacityAh: 5 } }), /chemistry/);
  for (const soc of [-0.01, 1.01, 50]) throwsNamed(() => createBatteryState(soc), /initial SOC.*0 and 1/);
  throwsNamed(() => createBatteryState(NaN), /initial SOC.*finite/);
  throwsNamed(() => createBatteryState(0.5, NaN), /temperature/);
  throwsNamed(() => new Engine(cfg((c) => { c.initialSoc = 90; })), /initialSoc/);
  assert.doesNotThrow(() => createBatteryState(0)); assert.doesNotThrow(() => createBatteryState(1));
});

test('validation 5. converter configuration: duty, frequency, L, C, limits, turns ratio, thermal, protection temperatures', () => {
  const conv = (patch: (c: EngineConfig['converter']) => void): EngineConfig => cfg((c) => patch(c.converter));
  for (const d of [0, 1, 1.2, -0.1]) throwsNamed(() => validateEngineConfig(conv((s) => { s.dMax = d; })), /dMax.*strictly between 0 and 1/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.dMax = NaN; })), /dMax.*finite/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.fswHz = 0; })), /fswHz/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.inductorH = -1e-6; })), /inductorH/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.outCapF = 0; })), /outCapF/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.turnsRatio = 0; })), /turnsRatio/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.inCurrentLimitA = -1; })), /inCurrentLimitA/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.outCurrentLimitA = 0; })), /outCurrentLimitA/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.cthJPerK = 0; })), /thermal capacitance/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.rthKPerW = -1; })), /thermal resistance/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.swLossFrac = 1.2; })), /swLossFrac/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.pFixedW = -1; })), /pFixedW/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.tShutdownC = 80; s.tRestartC = 90; })), /tShutdownC.*hysteresis/);
  throwsNamed(() => validateEngineConfig(conv((s) => { s.tRestartC = 20; })), /tRestartC.*above ambientC/);
  throwsNamed(() => validateEngineConfig(cfg((c) => { c.inverter.modulationMax = 1.2; })), /modulationMax/);
  throwsNamed(() => validateEngineConfig(cfg((c) => { c.inverter.linkMaxV = c.inverter.linkMinV; })), /linkMaxV/);
  throwsNamed(() => validateEngineConfig(cfg((c) => { c.contactOhm = 0; })), /contactOhm/);
  assert.doesNotThrow(() => validateEngineConfig(defaultConfig()));
});

test('validation 6. thermal parameters of loads must be positive', () => {
  throwsNamed(() => resistiveLoad(10, {}, { cthJPerK: 0, rthKPerW: 1 }), /load\.thermal\.cthJPerK/);
  throwsNamed(() => resistiveLoad(10, {}, { cthJPerK: 1, rthKPerW: NaN }), /load\.thermal\.rthKPerW/);
});

test('validation 7. inconsistent rating intervals are rejected; null means unspecified and is accepted', () => {
  throwsNamed(() => resistiveLoad(10, { vRatedMinV: 250, vRatedMaxV: 100 }), /vRatedMinV.*inverted/);
  throwsNamed(() => resistiveLoad(10, { vRatedMaxV: 250, vAbsMaxV: 200 }), /vAbsMaxV.*below the rated maximum/);
  throwsNamed(() => resistiveLoad(10, { freqMinHz: 60, freqMaxHz: 50 }), /freqMinHz/);
  throwsNamed(() => resistiveLoad(10, { ratedCurrentA: 0 }), /ratedCurrentA/);
  throwsNamed(() => resistiveLoad(10, { ratedPowerW: -5 }), /ratedPowerW/);
  throwsNamed(() => resistiveLoad(10, { vReverseMaxV: -1 }), /vReverseMaxV/);
  throwsNamed(() => resistiveLoad(10, { tMaxC: 60, tWarnC: 80 }), /tMaxC/);
  throwsNamed(() => resistiveLoad(10, { vRatedMaxV: NaN }), /vRatedMaxV/);
  throwsNamed(() => resistiveLoad(10, { input: 'ac/dc' as never }), /input/);
  assert.doesNotThrow(() => resistiveLoad(10, { vRatedMinV: null, vRatedMaxV: null, vAbsMaxV: null, freqMinHz: null, ratedCurrentA: null, tMaxC: null }));
  assert.doesNotThrow(() => resistiveLoad(10, { vRatedMinV: 0, vRatedMaxV: 250, vAbsMaxV: 250, freqMinHz: 0, freqMaxHz: 60, vReverseMaxV: 0 }));
});

test('validation 8. public engine API: hand-built or tampered loads cannot enter the simulation', () => {
  const e = new Engine();
  const good = resistiveLoad(100);
  const tamper = (patch: (l: Load) => void): Load => { const l = structuredClone(good) as Load; patch(l); return l; };
  const bads: Load[] = [
    tamper((l) => { (l as { rlc: { ohms: number } }).rlc.ohms = -5; }),
    tamper((l) => { (l as { rlc: { ohms: number } }).rlc.ohms = NaN; }),
    tamper((l) => { l.thermal.rthKPerW = 0; }),
    tamper((l) => { l.ratings.vRatedMinV = 300; l.ratings.vRatedMaxV = 100; }),
    { ...good, kind: 'plasma-ball' } as unknown as Load,
    undefined as unknown as Load,
  ];
  for (const l of bads) {
    assert.throws(() => e.attachLoad(l), RangeError);
    assert.throws(() => validateLoad(l), RangeError);
  }
  assert.equal(e.snapshot().inputs.connection, 'open', 'a rejected load leaves the engine untouched');
  assert.doesNotThrow(() => e.attachLoad(good));
  throwsNamed(() => e.setInputs({ mode: 'three-phase' as never }), /mode/);
  throwsNamed(() => e.setInputs({ powerOn: 1 as never }), /powerOn/);
  // Finite out-of-range set-points are clamped to the documented 0–415 V range (documented behaviour).
  e.setInputs({ setpointV: 9999 }); assert.equal(e.getInputs().setpointV, 415);
  e.setInputs({ setpointV: -3 }); assert.equal(e.getInputs().setpointV, 0);
});

test('validation 9. hand-built loads with missing sections are rejected with a RangeError naming the section (not a TypeError)', () => {
  for (const [bad, name] of [[{ kind: 'resistive' }, /load\.ratings/], [{ kind: 'resistive', ratings: {}, rlc: { ohms: 5 } }, /load\.thermal|ratings/], [null, /load/], [{ kind: 'nope', ratings: NO_RATINGS, thermal: { cthJPerK: 1, rthKPerW: 1 } }, /load\.kind/]] as const) {
    throwsNamed(() => validateLoad(bad as unknown as Load), name);
  }
});
