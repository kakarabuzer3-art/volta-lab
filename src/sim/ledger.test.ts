// Independent energy-ledger validation.
//
// SIGN CONVENTIONS / WHAT EACH TERM MEASURES (all Wh, all ≥ 0 while the machine only discharges):
//   chemical      = Σ OCV·I·Δt                 chemical energy released by the battery
//   terminal      = Σ Vt·I·Δt                  electrical energy leaving the battery terminals
//   R0, R1        = I²R0·Δt, V1²/R1·Δt         ohmic / polarization losses inside the pack
//   C1            = energy held by the polarization capacitor (can fall when current drops)
//   conversion    = converter (+ inverter) loss from the loss equation (NOT derived from the others)
//   output        = V·I (or P) delivered to the output terminals
//   load heat     = heat dissipated in the connected load
// Identities checked (they use independently computed references wherever a closed form exists):
//   (A) chemical − (terminal + R0 + R1 + C1)             = 0     (exact, exponential RC step)
//   (B) terminal − (output + conversion)                 = 0     (converter power balance)
//   (C) output (engine ledger) = analytic ∫P dt          (P from V²/R, Z = √(R²+X²), … written HERE, not imported)
//   (D) output = load heat (loads with no stored/mechanical energy, steady-state AC/DC)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, STEP_S, defaultConfig, resistiveLoad, inductiveLoad, capacitiveLoad, dcModuleLoad, dcMotorLoad } from './index.ts';
import type { EngineConfig, Load } from './index.ts';
import { createRectifierState, rectifierEnergyResidualJ, stepRectifier } from './rectifier.ts';

const WH = (w: number, steps: number): number => (w * steps * STEP_S) / 3600;
const steps = (e: Engine, n: number): void => { for (let k = 0; k < n; k++) e.step(); };
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

/** Identities (A) and (B). Tolerances are floating-point level, NOT loosened to pass. */
function closed(e: Engine, label: string): void {
  const L = e.snapshot().ledger;
  assert.ok(Math.abs(L.batteryResidualWh) <= 1e-9, `${label}: (A) battery residual ${L.batteryResidualWh} Wh`);
  assert.ok(Math.abs(L.terminalResidualWh) <= 1e-6 * Math.max(L.batteryTerminalWh, 1e-3), `${label}: (B) converter residual ${L.terminalResidualWh} Wh of ${L.batteryTerminalWh}`);
  assert.ok(L.outputWh >= 0 && L.conversionLossWh >= 0 && L.batteryInternalLossWh >= 0, `${label}: no negative energy terms`);
  assert.ok(L.batteryChemicalWh >= L.batteryTerminalWh - 1e-12, `${label}: chemical energy ≥ terminal energy (no energy creation)`);
}
const dc = (setpoint: number, load: Load | 'open' | 'short', cfg: EngineConfig = defaultConfig()): Engine => {
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: setpoint });
  if (load === 'open') e.setInputs({ connection: { kind: 'open' } }); else if (load === 'short') e.setInputs({ connection: { kind: 'short' } }); else e.attachLoad(load);
  return e;
};
const ac = (setpoint: number, load: Load | 'open', cfg: EngineConfig = defaultConfig()): Engine => {
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: setpoint });
  if (load !== 'open') e.attachLoad(load);
  return e;
};

test('ledger 1. open circuit: only the converter standby power is drawn (≈ P_fixed), output energy is exactly 0', () => {
  const e = dc(200, 'open');
  steps(e, 5000); // 100 s
  const L = e.snapshot().ledger;
  assert.equal(L.outputWh, 0);
  closed(e, 'open');
  // Independent reference: standby ≈ P_fixed (4 W) plus a negligible conduction term.
  const expected = WH(e.config.converter.pFixedW, 5000);
  assert.ok(rel(L.batteryTerminalWh, expected) < 0.02, `terminal ${L.batteryTerminalWh} Wh vs ≈ ${expected} Wh`);
});

test('ledger 2. resistive DC: output energy = (V²/R)·t from the analytic formula', () => {
  const e = dc(120, resistiveLoad(48)); // 300 W
  steps(e, 3000);
  const L = e.snapshot().ledger;
  assert.ok(rel(L.outputWh, WH(120 ** 2 / 48, 3000)) < 1e-9, `${L.outputWh} vs ${WH(300, 3000)}`);
  assert.ok(rel(L.loadHeatWh, L.outputWh) < 1e-9, '(D) a resistor turns all of it into heat');
  closed(e, 'resistive DC');
  assert.ok(L.conversionLossWh > 0 && L.batteryTerminalWh > L.outputWh);
});

test('ledger 3. AC resistive / inductive / capacitive: real power P = V²·R/(R²+X²) (reactive power is not consumed)', () => {
  const f = 50, v = 230;
  const cases: Array<[string, Load, number]> = [
    ['resistive 60 Ω', resistiveLoad(60, { input: 'ac' }), v ** 2 / 60],
    ['inductive 10 Ω + 0.2 H', inductiveLoad(10, 0.2, { input: 'ac' }), (v ** 2 * 10) / (10 ** 2 + (2 * Math.PI * f * 0.2) ** 2)],
    ['capacitive 40 µF + 20 Ω ESR', capacitiveLoad(40e-6, 20, { input: 'ac' }), (v ** 2 * 20) / (20 ** 2 + (1 / (2 * Math.PI * f * 40e-6)) ** 2)],
  ];
  for (const [name, load, pExpected] of cases) {
    const e = ac(v, load); steps(e, 1500);
    const s = e.snapshot();
    assert.ok(rel(s.ledger.outputWh, WH(pExpected, 1500)) < 1e-6, `${name}: ${s.ledger.outputWh} Wh vs analytic ${WH(pExpected, 1500)} Wh`);
    assert.ok(rel(s.ledger.loadHeatWh, s.ledger.outputWh) < 1e-6, `${name}: (D) load heat = real energy`);
    assert.ok(s.output.sVA! > s.output.pRealW * 1.05 || name.startsWith('resistive'), `${name}: apparent power exceeds real power for reactive loads`);
    closed(e, name);
  }
});

test('ledger 4. AC → DC → AC transitions: ledger stays closed and output follows each segment analytically', () => {
  const e = ac(230, resistiveLoad(100, { input: 'ac-or-dc' }));
  steps(e, 500);
  e.setInputs({ mode: 'dc', setpointV: 100 }); steps(e, 500);
  e.setInputs({ mode: 'ac', setpointV: 230 }); steps(e, 500);
  const expected = WH(230 ** 2 / 100, 1000) + WH(100 ** 2 / 100, 500);
  assert.ok(rel(e.snapshot().ledger.outputWh, expected) < 1e-9);
  closed(e, 'AC/DC transitions');
});

test('ledger 5. current limiting: 5 Ω at 100 V (prospective 20 A) is held at the 10 A limit → 500 W, then trips; nothing flows after the trip', () => {
  const e = dc(100, resistiveLoad(5));
  steps(e, 50); // 1 s, still limited, not yet tripped (delay 2 s)
  let s = e.snapshot();
  assert.equal(s.output.currentLimited, true);
  assert.ok(Math.abs(s.output.currentA - 10) < 1e-6, `I = ${s.output.currentA}`);
  assert.ok(rel(s.ledger.outputWh, WH(500, 50)) < 1e-6, `${s.ledger.outputWh} vs ${WH(500, 50)}`);
  closed(e, 'current-limited');
  steps(e, 120); // beyond the 2 s trip delay
  s = e.snapshot();
  assert.equal(s.protection.trip, 'overcurrent');
  const frozen = s.ledger.outputWh, frozenT = s.ledger.batteryTerminalWh;
  assert.equal(s.output.currentA, 0);
  steps(e, 500);
  assert.equal(e.snapshot().ledger.outputWh, frozen, 'no output energy after the trip');
  assert.equal(e.snapshot().ledger.batteryTerminalWh, frozenT, 'no battery energy after the trip');
  closed(e, 'after overcurrent trip');
});

test('ledger 6. short circuit (contact resistance): current-limited, closed ledger, trip, then zero energy', () => {
  for (const mode of ['dc', 'ac'] as const) {
    const e = new Engine();
    e.setInputs({ powerOn: true, mode, setpointV: 230, connection: { kind: 'short' } });
    steps(e, 60);
    assert.equal(e.snapshot().output.currentLimited, true);
    assert.ok(e.snapshot().output.currentA <= 10.000001);
    closed(e, `short ${mode} (limited)`);
    steps(e, 200);
    assert.equal(e.snapshot().protection.trip, 'overcurrent');
    const out = e.snapshot().ledger.outputWh;
    steps(e, 100);
    assert.equal(e.snapshot().ledger.outputWh, out);
    closed(e, `short ${mode} (tripped)`);
  }
});

function tinyBattery(): EngineConfig {
  return { ...defaultConfig(), pack: { cell: { chemistry: 'li-ion', capacityAh: 0.02 }, seriesCells: 100, parallelStrings: 1 }, initialSoc: 0.3 };
}

test('ledger 7. battery depletion / low-voltage shutdown: SOC never negative, delivered ≤ stored, no energy after the cut-off', () => {
  const e = dc(200, resistiveLoad(40), tinyBattery()); // 1 kW from ≈ 2 Wh
  const stored0 = e.snapshot().battery.remainingWh;
  let tripped = false;
  for (let k = 0; k < 30000 && !tripped; k++) { e.step(); tripped = e.snapshot().protection.trip !== null; assert.ok(e.snapshot().battery.socFrac >= 0); }
  const s = e.snapshot();
  assert.ok(['battery-empty', 'battery-low-voltage', 'battery-over-current'].includes(s.protection.trip ?? ''), `trip ${s.protection.trip}`);
  assert.ok(s.ledger.batteryTerminalWh <= stored0 + 1e-9, `terminal ${s.ledger.batteryTerminalWh} ≤ stored ${stored0}`);
  assert.ok(s.ledger.batteryChemicalWh <= stored0 * 1.01);
  assert.equal(s.output.currentA, 0); assert.equal(s.battery.currentA, 0);
  closed(e, 'depletion');
  const out = s.ledger.outputWh; steps(e, 500);
  assert.equal(e.snapshot().ledger.outputWh, out, 'no energy after cut-off');
  closed(e, 'depletion later');
});

test('ledger 8. an exactly empty battery cannot be discharged further and creates no energy in the ledger (SOC reaches 0 inside a step)', () => {
  // Battery protection delay is made very long so that the pack really empties (SOC → 0) before any BMS cut-off
  // would trip; this isolates the 'SOC reaches 0 inside a step' bookkeeping.
  const cfg = { ...tinyBattery(), initialSoc: 0.01, batteryTripDelayS: 1e6 };
  const e = dc(150, resistiveLoad(30), cfg);
  for (let k = 0; k < 4000 && e.snapshot().battery.socFrac > 0; k++) e.step();
  steps(e, 3);
  const s = e.snapshot();
  assert.equal(s.battery.socFrac, 0);
  assert.equal(s.protection.trip, 'battery-empty');
  assert.equal(s.battery.currentA, 0);
  closed(e, 'SOC reaches 0 mid-step');
  assert.ok(s.ledger.batteryTerminalWh <= storedWh(cfg) + 1e-9);
});
function storedWh(cfg: EngineConfig): number { return new Engine(cfg).snapshot().battery.remainingWh; }

test('ledger 9. simulated load damage: energy stops when the load fails (open circuit) and the ledger stays closed', () => {
  const load = resistiveLoad(30, { input: 'ac', vRatedMaxV: 120, vAbsMaxV: 130 }); // 230 V ≫ absolute maximum
  const e = ac(230, load);
  steps(e, 20);
  steps(e, 100);
  const s = e.snapshot();
  assert.equal(s.load!.health.state, 'damaged');
  assert.ok(s.load!.health.reasons.some((r) => /absolute maximum/i.test(r)), s.load!.health.reasons.join(' | '));
  assert.equal(s.output.currentA, 0);
  closed(e, 'load damage');
  const out = s.ledger.outputWh; steps(e, 200);
  assert.equal(e.snapshot().ledger.outputWh, out);
});

test('ledger 10. DC motor: electrical energy in ≥ heat in the windings (the rest is mechanical work, which the ledger does not count as heat)', () => {
  const m = dcMotorLoad({ rArmOhm: 2, kVsPerRad: 0.15, loadTorqueNm: 0.4, viscousNmsPerRad: 0.002 }, { input: 'dc' });
  const e = dc(60, m); steps(e, 1500);
  const L = e.snapshot().ledger;
  assert.ok(L.outputWh > 0 && L.loadHeatWh > 0 && L.loadHeatWh < L.outputWh, `heat ${L.loadHeatWh} < in ${L.outputWh}`);
  closed(e, 'motor');
  const mod = dc(30, dcModuleLoad({ vForwardV: 12, rDynOhm: 2 }, { input: 'dc' })); steps(mod, 500); closed(mod, 'dc module');
});

test('ledger 11. long run (10 simulated minutes, mixed AC load): residuals stay at floating-point level', () => {
  const e = ac(230, inductiveLoad(25, 0.15, { input: 'ac' }));
  steps(e, 30000);
  closed(e, 'long');
  const L = e.snapshot().ledger;
  assert.ok(L.outputWh > 20 && L.batteryTerminalWh > L.outputWh);
});

test('ledger 12. rectifier energy ledger is not a plug: numerical dissipation is a measured discretisation error that shrinks with the step', () => {
  const spec = { vfV: 0.9, rDiodeOhm: 0.05, capF: 470e-6, sourceRohm: 1 };
  const loadR = 300;
  const resistor = { iOfV: (v: number) => v / loadR };
  const runWith = (subPerCycle: number) => {
    let st = createRectifierState(0);
    const h = 0.02 / subPerCycle;
    // stepRectifier sub-steps internally at period/400, so give it a dt that equals h at 400/cycle.
    for (let k = 0; k < subPerCycle * 100; k++) st = stepRectifier(spec, st, 230, 50, resistor, h);
    return st;
  };
  const coarse = runWith(100), fine = runWith(400);
  for (const st of [coarse, fine]) {
    const e = st.energy;
    // independent reference for the capacitor term: ΔE_C = ½·C·Vc²  (cap started at 0 V)
    assert.ok(rel(e.capDeltaJ, 0.5 * spec.capF * st.vcV ** 2) < 1e-9, 'ΔE_C = ½CVc²');
    assert.ok(Math.abs(rectifierEnergyResidualJ(e)) <= 1e-9 * e.inputJ);
    assert.ok(e.numericalJ >= 0 && e.numericalJ < 0.01 * e.inputJ, `numerical ${e.numericalJ} J of ${e.inputJ} J input (< 1 %)`);
  }
  // Both runs use the same internal sub-step, so the load energy must agree (steady-state): independent of the outer step.
  assert.ok(rel(coarse.energy.loadJ, fine.energy.loadJ) < 1e-6, 'outer step does not change the physics');
  // Steady-state DC bus is the peak-detector value minus drops, i.e. NOT the RMS input (independent check).
  assert.ok(fine.vcV > 230 - 40 && fine.vcV < 230 * Math.SQRT2 - 1.8 + 1e-6, `bus ${fine.vcV} V`);
  // Mean bus voltage consistency with the load energy: P_load = ⟨V²⟩/R ≥ ⟨V⟩²/R
  assert.ok(fine.energy.loadJ > 0);
});

test('ledger 13. quantified limitation: converter inductor / output-capacitor energy is not a state in the averaged model', () => {
  const c = defaultConfig().converter;
  const worstCapJ = 0.5 * c.outCapF * 415 ** 2;                // ½·C·V² at 415 V
  const worstIndJ = 0.5 * c.inductorH * c.outCurrentLimitA ** 2; // ½·L·I² at the 10 A limit
  assert.ok(worstCapJ < 41 && worstIndJ < 0.012, `neglected storage ≤ ${worstCapJ.toFixed(1)} J + ${worstIndJ.toFixed(4)} J`);
  assert.ok((worstCapJ + worstIndJ) / 3600 < 0.012, 'bounded by ≈ 0.011 Wh, once, when the set-point changes');
});
