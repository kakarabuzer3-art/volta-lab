// Two DIFFERENT battery configurations must never be confused:
//   (A) DEFAULT MACHINE BATTERY  – defaultConfig(): illustrative 100S2P generic-NMC pack, 5 Ah cells.
//   (B) 12 V ENGINEERING TEST    – 6S2P lead-acid, 7 Ah cells + ASSUMED isolated boost stage (turns ratio 4).
// Expected values below are derived HERE from the equations (not read back from the implementation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine, STEP_S, defaultConfig, resistiveLoad, packModel, storedEnergyWh, LI_ION_NMC, LEAD_ACID, MACHINE_CONVERTER, machineInverter } from './index.ts';
import type { EngineConfig } from './index.ts';

const near = (a: number, b: number, tol: number, msg = ''): void => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const trapezoid = (t: ReadonlyArray<readonly [number, number]>, upTo: number): number => {
  let acc = 0;
  for (let k = 1; k < t.length; k++) {
    const [x0, y0] = t[k - 1], [x1, y1] = t[k];
    if (upTo <= x0) break;
    const x = Math.min(x1, upTo), y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    acc += 0.5 * (y0 + y) * (x - x0);
  }
  return acc;
};

test('profile A. default machine battery: values are CALCULATED from the model (100S2P, 5 Ah cells, SOC 90 %)', () => {
  const c = defaultConfig();
  assert.equal(c.pack.cell.chemistry, 'li-ion'); assert.equal(c.pack.seriesCells, 100); assert.equal(c.pack.parallelStrings, 2); assert.equal(c.pack.cell.capacityAh, 5); assert.equal(c.initialSoc, 0.9);
  const p = packModel(c.pack);
  const meanOcv = trapezoid(LI_ION_NMC.ocvTable, 1);               // mean cell voltage over the SOC range (independent integral)
  near(p.capacityAh, 10, 1e-12, 'pack Ah = Np·Ah_cell');
  near(p.nominalVoltageV, 100 * meanOcv, 1e-9, 'nominal V = Ns·mean OCV');
  near(p.nominalEnergyWh, 100 * 10 * meanOcv, 1e-6, 'nominal Wh = Ns·Ah_pack·mean OCV');
  assert.ok(p.nominalVoltageV > 355 && p.nominalVoltageV < 385, `≈ 370 V nominal, got ${p.nominalVoltageV}`);
  assert.ok(p.nominalEnergyWh > 3500 && p.nominalEnergyWh < 3900, `≈ 3.7 kWh, got ${p.nominalEnergyWh}`);
  near(p.ocv(1, 25), 100 * 4.15, 1e-9, 'full-charge pack OCV = 100 × 4.15 V (the 0–415 V range is reachable)');
  const s = new Engine(c).snapshot();
  near(s.battery.remainingWh, 100 * 10 * trapezoid(LI_ION_NMC.ocvTable, 0.9), 1e-6, 'remaining Wh at 90 % SOC');
  near(s.battery.nominalWh, p.nominalEnergyWh, 1e-9); near(s.battery.capacityAh, 10, 1e-12);
  assert.equal(s.battery.seriesCells, 100); assert.equal(s.battery.parallelStrings, 2);
  assert.ok(s.battery.ocvV > 380 && s.battery.ocvV < 415);
  assert.notEqual(s.battery.chemistry, 'lead-acid');
});

function lead12Config(): EngineConfig {
  const converter = { ...MACHINE_CONVERTER, turnsRatio: 4 };
  return { ...defaultConfig(), pack: { cell: { chemistry: 'lead-acid', capacityAh: 7 }, seriesCells: 6, parallelStrings: 2 }, converter, inverter: machineInverter(converter), initialSoc: 0.9 };
}

test('profile B. [12 V ENGINEERING TEST PROFILE] 12 V → 415 V / 100 W: every number follows from the equations', () => {
  const cfg = lead12Config();
  const e = new Engine(cfg);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 415 });
  e.attachLoad(resistiveLoad(415 ** 2 / 100));
  const s0 = e.snapshot();

  // ---- independent closed-form solution --------------------------------------------------------
  const p = packModel(cfg.pack);
  const ocv = 6 * trapezoidPoint(LEAD_ACID.ocvTable, 0.9) + 0;               // per-cell OCV at 90 % SOC × 6, 25 °C
  near(s0.battery.ocvV, ocv, 1e-9, 'pack OCV');
  const r0 = (6 * (LEAD_ACID.r0MohmAh / 1000 / 7) * trapezoidPoint(LEAD_ACID.r0SocFactor, 0.9)) / 2; // Rpack = Ns·Rcell/Np
  near(p.r0(0.9, 25), r0, 1e-12, 'R0 = Ns·Rcell/Np');
  const r1 = LEAD_ACID.r1Ratio * r0;
  const kappa = ((-LEAD_ACID.tau1S / STEP_S) * Math.expm1(-STEP_S / LEAD_ACID.tau1S));   // mean of the RC relaxation over one step
  const rEff = r0 + r1 * (1 - kappa);                                                       // V1 = 0 at t = 0
  const pOut = 100, ksw = cfg.converter.swLossFrac, pf = cfg.converter.pFixedW, rc = cfg.converter.rConductionOhm;
  const A = pOut * (1 + ksw) + pf;                                                           // Pin = A + Rc·Iin²
  const a = rEff + rc;
  const iIn = (ocv - Math.sqrt(ocv * ocv - 4 * a * A)) / (2 * a);                           // (R+Rc)I² − E·I + A = 0
  const vIn = ocv - iIn * rEff, pIn = vIn * iIn, eta = pOut / pIn;
  // Duty uses the conduction (voltage-drop) efficiency 1 − Rc·Iin/Vin: fixed and switching losses do not shift the CCM voltage ratio.
  const etaV = 1 - (rc * iIn) / vIn;
  const duty = 1 - (etaV * cfg.converter.turnsRatio * vIn) / 415;                           // ideal CCM boost, n = 4 (ASSUMED)

  near(s0.output.voltage, 415, 1e-9); near(s0.output.pRealW, 100, 1e-6);
  near(s0.battery.currentA, iIn, 1e-9, 'required battery input current');
  near(s0.battery.terminalV, vIn, 1e-9, 'terminal voltage sag');
  assert.ok(s0.battery.terminalV < s0.battery.ocvV - 0.2);
  near(s0.converter.pInW, pIn, 1e-6); near(s0.converter.efficiency!, eta, 1e-9, 'efficiency'); near(s0.converter.lossW, pIn - pOut, 1e-6, 'converter loss');
  near(s0.converter.duty!, duty, 1e-9, 'duty cycle');
  assert.ok(duty > 0 && duty < cfg.converter.dMax, `duty ${duty} inside (0, Dmax)`);
  assert.ok(iIn > 8 && iIn < 12, `≈ 100 W / (η·≈12 V) ≈ ${iIn} A`);

  // ---- 10 minutes of discharge: Coulomb counting and energy ----------------------------------------
  const N = Math.round(600 / STEP_S);
  let coulombAh = 0;                                   // independent Coulomb counter over the engine's own battery currents
  for (let k = 0; k < N; k++) { const i = e.snapshot().battery.currentA; e.step(); coulombAh += ((i + e.snapshot().battery.currentA) / 2) * STEP_S / 3600; }
  const s = e.snapshot();
  near(0.9 - s.battery.socFrac, coulombAh / 14, 0.002 * (coulombAh / 14), 'ΔSOC = ∫I dt/(3600·Ah) (current rises as the pack sags)');
  assert.ok(coulombAh > (iIn * 600) / 3600, 'the current rises above its initial value as the pack sags');
  near(s.ledger.outputWh, (100 * 600) / 3600, 1e-6, 'output energy = 100 W × 600 s');
  assert.ok(s.ledger.conversionLossWh > 0 && s.ledger.batteryTerminalWh > s.ledger.outputWh);
  const dStored = storedEnergyWh(p, 0.9) - s.battery.remainingWh;
  assert.ok(dStored >= s.ledger.outputWh, 'stored energy falls by at least the delivered energy');
  near(dStored, s.ledger.batteryChemicalWh, 0.01 * dStored, 'ΔE_stored (OCV integral) vs Σ OCV·I·Δt');
  assert.ok(Math.abs(s.ledger.batteryResidualWh) < 1e-9 && Math.abs(s.ledger.terminalResidualWh) < 1e-6 * s.ledger.batteryTerminalWh);
  // The single-stage (n = 1) boost cannot do it: reported, not hidden.
  const single = new Engine({ ...cfg, converter: { ...cfg.converter, turnsRatio: 1 }, inverter: machineInverter({ ...cfg.converter, turnsRatio: 1 }) });
  single.setInputs({ powerOn: true, mode: 'dc', setpointV: 415 }); single.attachLoad(resistiveLoad(415 ** 2 / 100)); single.step();
  assert.equal(single.snapshot().converter.limited, 'duty-limit');
  assert.ok(single.snapshot().output.voltage < 415 / 2);
});
/** Piecewise-linear value at x (written independently of battery.ts `interpolate`). */
function trapezoidPoint(t: ReadonlyArray<readonly [number, number]>, x: number): number {
  for (let k = 1; k < t.length; k++) if (x <= t[k][0]) { const [x0, y0] = t[k - 1], [x1, y1] = t[k]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return t[t.length - 1][1];
}

test('profile C. the two profiles are different configurations (the 12 V test is not the machine battery)', () => {
  const a = packModel(defaultConfig().pack), b = packModel(lead12Config().pack);
  assert.ok(a.nominalVoltageV > 30 * b.nominalVoltageV / 1.2 && b.nominalVoltageV < 14);
  assert.notEqual(defaultConfig().pack.cell.chemistry, lead12Config().pack.cell.chemistry);
  assert.equal(defaultConfig().converter.turnsRatio, 1, 'the DEFAULT machine converter has no assumed transformer');
});

test('415 V AC definition: single-phase, two-wire, RMS between the two terminals; Vpk = √2·Vrms; 50 Hz', () => {
  const e = new Engine();
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 415 });
  e.attachLoad(resistiveLoad(400, { input: 'ac' }));
  e.step();
  const o = e.snapshot().output;
  near(o.voltage, 415, 1e-6); near(o.vPeakV!, 415 * Math.SQRT2, 1e-6); near(o.vPpV!, 2 * 415 * Math.SQRT2, 1e-6); assert.equal(o.freqHz, 50);
  assert.equal(o.polarity, 'n/a');
});

test('labels: UI text never calls the two-wire output three-phase or a universal household voltage', () => {
  const ui = readFileSync(new URL('../../index.html', import.meta.url), 'utf8') + readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const stripped = ui.replace(/not a three-phase line-to-line voltage/gi, '');
  assert.ok(!/three.?phase|3.?phase|line.to.line|household|universal/i.test(stripped), 'no misleading three-phase / household wording');
  assert.match(ui, /single-phase, two-wire/i);
});
