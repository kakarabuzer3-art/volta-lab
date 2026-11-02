import test from 'node:test';
import assert from 'node:assert/strict';
import { createRectifierState, meanFullWave, peakDetectorBusV, rectifierEnergyResidualJ, rippleEstimateVpp, stepRectifier, unfilteredBridgeVoltage } from './rectifier.ts';
import { MACHINE_CONVERTER, solveDcDc } from './dcdc.ts';
import type { DcDcSpec } from './dcdc.ts';
import { machineInverter, solveInverter } from './inverter.ts';
import { createBatteryState, packModel, stepBattery } from './battery.ts';
import { seriesRlcAc } from './ac.ts';

const near = (a: number, b: number, tol: number, msg?: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const bridge = { vfV: 0.7, rDiodeOhm: 0.05, sourceRohm: 1, capF: 470e-6 };
const resistor = (r: number) => ({ iOfV: (v: number) => v / r });

test('20. AC→DC full-wave rectification: |v|−2Vf, two diodes per half-cycle, output never negative', () => {
  assert.equal(unfilteredBridgeVoltage(325, 0.7), 325 - 1.4);
  assert.equal(unfilteredBridgeVoltage(-325, 0.7), 325 - 1.4, 'negative half-cycle gives the SAME output polarity');
  assert.equal(unfilteredBridgeVoltage(1, 0.7), 0, 'below 2·Vf no diode pair conducts');
  near(meanFullWave(325), (2 * 325) / Math.PI, 1e-12);
  // Time-domain with a tiny capacitor (effectively unfiltered): output follows |v| − 2Vf.
  let st = createRectifierState(0);
  const spec = { ...bridge, capF: 1e-9, sourceRohm: 0.1 };
  const T = 0.02, n = 400, h = T / n;
  let min = Infinity, max = -Infinity, neg = false;
  for (let c = 0; c < 6; c++) for (let k = 0; k < n; k++) {
    st = stepRectifier(spec, st, 230, 50, resistor(1000), h);
    if (c >= 3) { min = Math.min(min, st.vcV); max = Math.max(max, st.vcV); }
    if (st.vcV < -1e-9) neg = true;
  }
  assert.equal(neg, false);
  near(max, 230 * Math.SQRT2 - 1.4, 1.0);
  assert.ok(min < 1, 'unfiltered output returns to ~0 V each half-cycle (pulsating DC)');
  assert.ok(st.iSourceA !== undefined);
});

test('21. rectifier smoothing & ripple: ripple ≈ I/(2fC), ripple frequency is 2f, DC bus ≈ √2·Vrms − 2Vf (not Vrms)', () => {
  const spec = { ...bridge, capF: 470e-6 };
  const R = 500, T = 0.02, n = 400, h = T / n;
  let st = createRectifierState(0);
  const vc: number[] = [];
  for (let c = 0; c < 40; c++) for (let k = 0; k < n; k++) { st = stepRectifier(spec, st, 230, 50, resistor(R), h); if (c >= 30) vc.push(st.vcV); }
  const L = st.last!;
  const iLoad = L.vOutMeanV / R;
  const est = rippleEstimateVpp(iLoad, 50, spec.capF);
  near(L.rippleVpp, est, 0.3 * est, 'simulated ripple vs I/(2fC)');
  assert.ok(L.vOutMeanV > 230 * 1.2, 'DC bus far above the RMS input (peak detector)');
  assert.ok(L.vOutMaxV < 230 * Math.SQRT2 - 1.4 + 1e-6 && L.vOutMeanV < peakDetectorBusV(230, 0.7));
  // Count ripple peaks over the last 10 cycles: 2 per cycle (2f).
  let peaks = 0;
  for (let k = 1; k < vc.length - 1; k++) if (vc[k] > vc[k - 1] && vc[k] >= vc[k + 1] && vc[k] > L.vOutMeanV) peaks++;
  assert.equal(peaks, 20);
  // Light load → DC bus approaches the peak minus diode drops.
  let light = createRectifierState(0);
  for (let c = 0; c < 80; c++) light = stepRectifier(spec, light, 230, 50, resistor(1e6), h * 1);
  for (let k = 0; k < 400 * 60; k++) light = stepRectifier(spec, light, 230, 50, resistor(1e6), h);
  near(light.vcV, peakDetectorBusV(230, 0.7), 1.5);
  // A larger capacitor gives proportionally lower ripple.
  let big = createRectifierState(0);
  for (let c = 0; c < 60; c++) for (let k = 0; k < n; k++) big = stepRectifier({ ...spec, capF: 4700e-6 }, big, 230, 50, resistor(R), h);
  assert.ok(big.last!.rippleVpp < L.rippleVpp / 5);
  // Inrush: a discharged capacitor draws a much larger first-cycle peak than the steady state, bounded by Vpk/Rt.
  let fresh = createRectifierState(0), first = 0;
  for (let k = 0; k < n; k++) { fresh = stepRectifier(spec, fresh, 230, 50, resistor(R), h); first = Math.max(first, Math.abs(fresh.iSourceA)); }
  assert.ok(first > 3 * L.isrcPeakA, `inrush ${first} A vs steady ${L.isrcPeakA} A`);
  assert.ok(first <= (230 * Math.SQRT2 - 1.4) / (spec.sourceRohm + 2 * spec.rDiodeOhm) + 1e-6);
  // Source current is non-sinusoidal: true PF < 1 and crest factor > √2.
  assert.ok(L.powerFactor! < 0.9 && L.isrcPeakA / L.isrcRmsA > 2);
});

test('21b. rectifier energy ledger closes: input = losses + load + ΔE_C + numerical dissipation (small)', () => {
  let st = createRectifierState(0);
  for (let k = 0; k < 400 * 25; k++) st = stepRectifier({ ...bridge }, st, 230, 50, resistor(300), 0.02 / 400);
  const e = st.energy;
  near(rectifierEnergyResidualJ(e), 0, 1e-9 * e.inputJ);
  assert.ok(e.numericalJ < 0.01 * e.inputJ, 'backward-Euler dissipation is < 1 % of the input energy');
  assert.ok(e.diodeLossJ > 0 && e.sourceLossJ > 0 && e.loadJ > 0 && e.loadJ < e.inputJ);
  // DC source through the bridge: either polarity yields the same positive bus.
  const dcPos = stepRectifier(bridge, createRectifierState(0), 48, 0, resistor(100), 0.5);
  const dcNeg = stepRectifier(bridge, createRectifierState(0), -48, 0, resistor(100), 0.5);
  near(dcPos.vcV, dcNeg.vcV, 1e-9);
  assert.ok(dcPos.vcV > 40 && dcPos.vcV < 48 - 1.4 + 1e-6);
});

/** ENGINEERING TEST PROFILE ONLY: 6S2P lead-acid, 7 Ah cells (≈ 12 V, 14 Ah). NOT the default machine battery (100S2P NMC). */
const lead12 = () => packModel({ cell: { chemistry: 'lead-acid', capacityAh: 7 }, seriesCells: 6, parallelStrings: 2 });
/** Isolated boost-derived stage with an ASSUMED turns ratio of 4: a model assumption, not a hardware specification. */
const isolated: DcDcSpec = { ...MACHINE_CONVERTER, turnsRatio: 4 };

test('22. DC→AC inverter power balance: Pout ≤ η·Pin, losses ≥ 0, input current from the source', () => {
  const p = packModel({ cell: { chemistry: 'li-ion', capacityAh: 5 }, seriesCells: 100, parallelStrings: 2 });
  const st = createBatteryState(0.8);
  const src = { eV: p.ocv(st.soc, st.tempC), rOhm: p.r0(st.soc, st.tempC) };
  const inv = machineInverter(MACHINE_CONVERTER);
  const load = { respond: (v: number, f: number) => seriesRlcAc({ ohms: 52.9, henries: 0, farads: null }, v, f) };
  const s = solveInverter(inv, src, load, 230, 50);
  assert.equal(s.limited, null);
  near(s.vOutRms, 230, 1e-9);
  near(s.pOutW, 230 ** 2 / 52.9, 1e-6, 'real power follows V²/R');
  near(s.pInW, s.vInV * s.iInA, 1e-6, 'input power is V_in × I_in');
  assert.ok(s.pOutW < s.pInW, 'AC output real power is below the DC input power');
  near(s.efficiency!, s.pOutW / s.pInW, 1e-12);
  assert.ok(s.efficiency! > 0.8 && s.efficiency! < 1);
  near(s.lossW, s.pInW - s.pOutW, 1e-9);
  assert.ok(s.bridgeLossW > 0 && s.stage.lossW > 0);
  near(s.dcLinkV, (Math.SQRT2 * 230) / 0.95, 1e-6);
  assert.ok(s.modulation <= 0.95 + 1e-9);
  // Reactive loads: the battery supplies only real power + losses (not apparent power).
  const rl = { respond: (v: number, f: number) => seriesRlcAc({ ohms: 20, henries: 0.1, farads: null }, v, f) };
  const r = solveInverter(inv, src, rl, 230, 50);
  assert.ok(r.sOutVA > r.pOutW * 1.2 && r.pInW < r.sOutVA, 'DC input tracks real power, not VA');
  assert.ok(r.pOutW <= r.pInW);
});

test('23/24. [12 V ENGINEERING TEST PROFILE, not the machine battery] 12 V lead-acid pack → 415 V DC boost: power balance and required input current', () => {
  const p = lead12();
  const st = createBatteryState(0.9);
  const E = p.ocv(st.soc, st.tempC), R0 = p.r0(st.soc, st.tempC);
  const Rload = 415 ** 2 / 100; // 100 W at 415 V
  const s = solveDcDc(isolated, { eV: E, rOhm: R0 }, resistor(Rload), 415);
  assert.equal(s.limited, null);
  near(s.vOutV, 415, 1e-9);
  near(s.pOutW, 100, 1e-6);
  near(s.pInW, s.pOutW + s.lossW, 1e-9, 'Pin = Pout + losses');
  assert.ok(s.pOutW < s.pInW, 'no energy is created');
  near(s.iInA, s.pOutW / (s.efficiency! * s.vInV), 1e-9, 'Iin = Pout/(η·Vin)');
  assert.ok(s.iInA > 8 && s.iInA < 12, `a 100 W / 415 V output from ~12 V needs ~9–10 A, got ${s.iInA}`);
  assert.ok(s.vInV < E - 0.2, 'battery terminal voltage sags under that current');
  near(s.vInV, E - s.iInA * R0, 1e-9);
  assert.ok(s.duty > 0.8 && s.duty <= isolated.dMax);
  // The battery then loses charge accordingly: SOC and stored energy drop.
  const step = stepBattery(p, st, s.iInA, 600, 25);
  near(st.soc - step.state.soc, (s.iInA * 600) / 3600 / p.capacityAh, 1e-12);
  assert.ok(step.state.chemicalNetWh * 3600 >= 100 * 600, 'chemical energy released ≥ 100 W × 600 s delivered');
  // Same converter WITHOUT the isolation/turns-ratio assumption cannot do it: truthful duty limit, not a relabelled display.
  const single = solveDcDc({ ...MACHINE_CONVERTER, turnsRatio: 1 }, { eV: E, rOhm: R0 }, resistor(Rload), 415);
  assert.equal(single.limited, 'duty-limit');
  assert.ok(single.vOutV < 415 * 0.35, `single-stage boost is limited to ≈ Vin/(1−Dmax), got ${single.vOutV} V`);
  near(single.vOutV, single.maxOutputAtDutyLimitV, 1.5);
  // A load that cannot be supplied at all makes the source collapse (reported, not hidden).
  const heavy = solveDcDc(isolated, { eV: E, rOhm: R0 }, { iOfV: (v) => 5000 / Math.max(v, 1) }, 415);
  assert.notEqual(heavy.limited, null);
  assert.ok(heavy.pOutW < 5000);
});

test('24b. higher output voltage into a fixed load draws more input current (P = V²/R)', () => {
  const p = lead12(), st = createBatteryState(0.9);
  const src = { eV: p.ocv(st.soc, st.tempC), rOhm: p.r0(st.soc, st.tempC) };
  const a = solveDcDc(isolated, src, resistor(200), 100);
  const b = solveDcDc(isolated, src, resistor(200), 200);
  assert.equal(a.limited, null); assert.equal(b.limited, null);
  assert.ok(b.iInA / a.iInA > 3 && b.iInA / a.iInA < 4.6, `ratio ${b.iInA / a.iInA}`);
  assert.ok(b.pInW > b.pOutW);
});

test('25. conversion efficiency and losses follow the stated loss equation; light load is less efficient', () => {
  const src = { eV: 12.6, rOhm: 0.04 };
  const spec = isolated;
  const at = (watts: number) => solveDcDc(spec, src, { iOfV: (v) => watts / Math.max(v, 1) }, 200);
  const light = at(5), mid = at(100);
  for (const s of [light, mid]) {
    const expect = spec.pFixedW + spec.swLossFrac * s.pOutW + spec.rConductionOhm * s.iInA ** 2;
    near(s.lossW, expect, 1e-9, 'loss = P_fixed + k_sw·Pout + R_cond·Iin²');
    assert.ok(s.efficiency! > 0 && s.efficiency! < 1);
    near(s.pOutW, s.efficiency! * s.pInW, 1e-9, 'Pout = η·Pin');
  }
  assert.ok(light.efficiency! < mid.efficiency!);
  // Open circuit: output power 0, efficiency unavailable-ish (0), only quiescent draw.
  const open = solveDcDc(spec, src, { iOfV: () => 0 }, 200);
  near(open.pOutW, 0, 1e-12);
  near(open.pInW, spec.pFixedW + spec.rConductionOhm * open.iInA ** 2, 1e-9);
  // Ripple formulas: boost ΔVpp = Iout·D/(fsw·C).
  near(mid.ripple.outputVppV, (mid.iOutA * mid.duty) / (spec.fswHz * spec.outCapF), 1e-12);
  assert.ok(mid.ripple.inductorPpA > 0);
  // Buck mode when the target is below the source voltage.
  const buck = solveDcDc(MACHINE_CONVERTER, { eV: 100, rOhm: 0.1 }, resistor(10), 48);
  assert.equal(buck.topology, 'buck');
  near(buck.vOutV, 48, 1e-9);
  assert.ok(buck.duty < 0.6 && buck.pInW > buck.pOutW);
});
