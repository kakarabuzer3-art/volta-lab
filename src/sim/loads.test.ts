import test from 'node:test';
import assert from 'node:assert/strict';
import { acInputSupplyLoad, acResponse, capacitiveLoad, createLoadHealth, dcCurrentA, dcMotorLoad, dcModuleLoad, inductiveLoad, loadOperatingPoint, resistiveLoad, stepLoadHealth } from './loads.ts';
import type { Load, LoadDrive, LoadHealth, LoadRatings } from './loads.ts';

const near = (a: number, b: number, tol: number, msg?: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const drive = (kind: 'ac' | 'dc', v: number, f = 50): LoadDrive => ({ kind, v, freqHz: kind === 'ac' ? f : 0 });
/** Drive a load for `seconds` at a fixed terminal voltage. */
function hold(load: Load, d: LoadDrive, seconds: number, h0: LoadHealth = createLoadHealth(25), dt = 0.02): LoadHealth {
  let h = h0;
  for (let k = 0; k < Math.round(seconds / dt); k++) h = stepLoadHealth(load, h, d, loadOperatingPoint(load, h, d), 25, dt);
  return h;
}

test('26. compatible AC loads follow their own electrical behaviour (not one resistance)', () => {
  const heater = resistiveLoad(52.9, { input: 'ac', vRatedMinV: 207, vRatedMaxV: 253, freqMinHz: 49, freqMaxHz: 61 });
  const op = loadOperatingPoint(heater, createLoadHealth(), drive('ac', 230));
  near(op.currentA, 230 / 52.9, 1e-12);
  near(op.pRealW, 230 ** 2 / 52.9, 1e-9);
  assert.equal(hold(heater, drive('ac', 230), 1).state, 'normal');
  // Inductive and capacitive loads have PF < 1 and draw different current from a resistor of the same R.
  const motorLike = loadOperatingPoint(inductiveLoad(20, 0.1), createLoadHealth(), drive('ac', 230));
  assert.ok(motorLike.powerFactor! < 0.8 && motorLike.sVA > motorLike.pRealW * 1.2);
  const cap = acResponse(capacitiveLoad(10e-6, 1), 230, 50);
  near(cap.irms, 230 / Math.hypot(1, 1 / (2 * Math.PI * 50 * 10e-6)), 1e-9);
  assert.ok(cap.realPowerW < 0.01 * cap.apparentVA, 'a capacitor draws reactive, not real, power');
  // AC-input supply (bridge + bulk capacitor + regulated output): non-linear, PF well below 1, high crest factor.
  const psu = acInputSupplyLoad({ pOutW: 60, efficiency: 0.88, busCapF: 100e-6 });
  const r = acResponse(psu, 230, 50);
  near(r.realPowerW, 60 / 0.88, 0.05 * (60 / 0.88), 'input real power ≈ Pout/η (+ bridge loss)');
  assert.ok(r.powerFactor < 0.8 && r.ipeak / r.irms > 2.5);
  assert.equal(r.kind, 'nonlinear');
  assert.ok(r.irms > r.realPowerW / 230, 'Irms exceeds P/V because PF < 1');
  const detail = loadOperatingPoint(psu, createLoadHealth(), drive('ac', 230));
  assert.ok(detail.heatW > 0 && detail.heatW < detail.pRealW, 'only the conversion loss heats the supply; Pout goes downstream');
});

test('27. compatible DC loads: motor back-EMF equation, polarized module I–V, supply through its bridge', () => {
  const m = dcMotorLoad({ rArmOhm: 1.2, kVsPerRad: 0.05, loadTorqueNm: 0.1, viscousNmsPerRad: 0.0005 }, { vRatedMinV: 6, vRatedMaxV: 30, vAbsMaxV: 40 });
  const v = 24;
  const i = dcCurrentA(m, v);
  const w = (i * 0.05 - 0.1) / 0.0005; // torque balance: Kt·I = T + b·ω
  near(v, 1.2 * i + 0.05 * w, 1e-9, 'V = Ra·I + Ke·ω holds at the steady-state solution');
  assert.ok(i > 0 && i < v / 1.2, 'back-EMF limits current below V/Ra');
  near(dcCurrentA(m, 1), 1 / 1.2, 1e-9, 'stalled below breakaway: I = V/Ra');
  near(dcCurrentA(m, -v), -i, 1e-9, 'reversed supply reverses the motor current');
  const led = dcModuleLoad({ vForwardV: 3, rDynOhm: 5 });
  near(dcCurrentA(led, 5), 0.4, 1e-12);
  assert.equal(dcCurrentA(led, 2.9), 0, 'below forward voltage: no current');
  assert.equal(dcCurrentA(led, -5), 0, 'reverse polarity: blocked');
  assert.equal(dcCurrentA(capacitiveLoad(1e-3, 0.1), 12), 0, 'a series capacitor blocks steady DC');
  const psu = acInputSupplyLoad({ pOutW: 60, efficiency: 0.88, busCapF: 100e-6 });
  const ip = dcCurrentA(psu, 300), in_ = dcCurrentA(psu, -300);
  near(ip, -in_, 1e-12);
  near(ip, 60 / 0.88 / (300 - 1.8), 0.02 * ip, 'DC through the bridge: I ≈ P/(V − 2Vf)');
  assert.equal(dcCurrentA(psu, 20), 0, 'below its under-voltage lock-out the supply does not run');
});

test('28. unsupported input is reported with its exact reason', () => {
  const acOnly = inductiveLoad(20, 0.1, { input: 'ac', vRatedMaxV: 250, ratedCurrentA: 15, freqMinHz: 49, freqMaxHz: 61 });
  const h = hold(acOnly, drive('dc', 100), 0.1);
  assert.notEqual(h.state, 'normal');
  assert.ok(h.reasons.some((s) => s.includes('Unsupported input') && s.includes('AC') && s.includes('DC')));
  near(dcCurrentA(acOnly, 100), 100 / 20, 1e-12, 'physics: DC sees only the winding resistance (5 A vs ≈ 3.5 A on AC)');
  assert.ok(5 > acResponse(acOnly, 100, 50).irms);
  const wrongHz = hold(acOnly, drive('ac', 230, 400), 0.1);
  assert.ok(wrongHz.reasons.some((s) => s.includes('Unsupported frequency')));
  const dcOnly = resistiveLoad(10, { input: 'dc' });
  assert.ok(hold(dcOnly, drive('ac', 12), 0.1).reasons.some((s) => s.includes('rated for DC')));
  // A supply with an internal bridge legitimately accepts either: no unsupported-input complaint.
  const psu = acInputSupplyLoad({ pOutW: 60, efficiency: 0.88, busCapF: 100e-6 }, { input: 'ac-or-dc', vRatedMinV: 100, vRatedMaxV: 300, vAbsMaxV: 450 });
  assert.equal(hold(psu, drive('dc', 200), 0.5).state, 'normal');
  assert.equal(hold(psu, drive('ac', 230), 0.5).state, 'normal');
  // Reverse polarity on a polarized module.
  const mod = dcModuleLoad({ vForwardV: 3, rDynOhm: 5 }, { vRatedMaxV: 14, vReverseMaxV: 5, vAbsMaxV: 20 });
  const rev = hold(mod, drive('dc', -12), 0.2);
  assert.equal(rev.state, 'damaged');
  assert.ok(rev.reasons.some((s) => s.includes('Reverse polarity')) && rev.reasons.some((s) => s.includes('reverse rating')));
  assert.equal(hold(mod, drive('dc', -4), 0.5).state, 'warning', 'small reverse voltage within rating: warning only');
});

test('29. overvoltage consequences follow the ratings, not a blanket rule', () => {
  const r: Partial<LoadRatings> = { input: 'dc', vRatedMinV: 10, vRatedMaxV: 14, vAbsMaxV: 20, polarized: true };
  const mod12 = dcModuleLoad({ vForwardV: 3, rDynOhm: 5 }, r);
  assert.equal(hold(mod12, drive('dc', 12), 1).state, 'normal');
  const mild = hold(mod12, drive('dc', 16), 1);
  assert.equal(mild.state, 'warning');
  assert.ok(mild.reasons[0].includes('Overvoltage'));
  const harsh = hold(mod12, drive('dc', 415), 0.2);
  assert.equal(harsh.state, 'damaged');
  assert.ok(harsh.reasons.some((s) => s.includes('Absolute maximum exceeded')) && harsh.reasons.some((s) => s.includes('open circuit')));
  // Needs a dwell: a single 20 ms step does not destroy it.
  assert.notEqual(hold(mod12, drive('dc', 415), 0.02).state, 'damaged');
  // Built-in overvoltage protection trips instead of damaging.
  const protectedLoad = dcModuleLoad({ vForwardV: 3, rDynOhm: 5 }, { ...r, overvoltageTripV: 18 });
  const p = hold(protectedLoad, drive('dc', 415), 0.5);
  assert.equal(p.state, 'protection');
  assert.ok(p.reasons.some((s) => s.includes('Overvoltage protection tripped')));
  assert.equal(loadOperatingPoint(protectedLoad, p, drive('dc', 415)).currentA, 0, 'tripped load is disconnected');
  // A 415 V-rated heater is fine at 415 V: voltage alone is not "damage".
  assert.equal(hold(resistiveLoad(100, { input: 'ac-or-dc', vRatedMaxV: 440, vAbsMaxV: 500, ratedPowerW: 1800 }), drive('ac', 415), 1).state, 'normal');
});

test('30. overcurrent: overloaded above rating, protection trip above the trip threshold', () => {
  const heater = resistiveLoad(23, { ratedCurrentA: 5 });
  const d = drive('ac', 230); // 10 A
  assert.equal(hold(heater, d, 0.1).state, 'overloaded');
  assert.ok(hold(heater, d, 0.1).reasons.some((s) => s.includes('Overcurrent') && s.includes('rated')));
  const guarded = resistiveLoad(23, { ratedCurrentA: 5, overcurrentTripA: 8 });
  const h = hold(guarded, d, 0.1);
  assert.equal(h.state, 'protection');
  assert.equal(loadOperatingPoint(guarded, h, d).currentA, 0);
  assert.equal(hold(resistiveLoad(23, { ratedPowerW: 1000 }), d, 0.1).state, 'overloaded', 'power rating exceeded (2.3 kW)');
});

test('31. thermal accumulation and cooling follow Cth·dT/dt = Ploss − (T−Ta)/Rth', () => {
  const heater = resistiveLoad(100, { tWarnC: 150, tMaxC: 400 }, { cthJPerK: 50, rthKPerW: 2 });
  const d = drive('dc', 100); // 100 W
  const tau = 50 * 2;
  const h = hold(heater, d, tau, createLoadHealth(25), 0.02);
  near(h.tempC, 25 + 200 * (1 - Math.exp(-1)), 0.05, 'after one time constant');
  assert.equal(h.state, 'overheating', '151 °C ≥ warning level');
  assert.ok(h.reasons.some((s) => s.includes('Overheating')));
  const hotter = hold(heater, d, 5 * tau, h);
  near(hotter.tempC, 25 + 200, 2, 'steady state T∞ = Ta + P·Rth');
  // Cooling with the load removed (voltage 0).
  const cooled = hold(heater, drive('dc', 0), 2 * tau, hotter);
  assert.ok(cooled.tempC < 25 + 200 * Math.exp(-2) + 3 && cooled.tempC > 25);
  assert.equal(cooled.state, 'normal');
});

test('32. device failure: thermal damage at Tmax is permanent and modelled as an open circuit', () => {
  const heater = resistiveLoad(100, { tWarnC: 80, tMaxC: 100 }, { cthJPerK: 50, rthKPerW: 2 });
  const d = drive('dc', 100);
  const tFail = -100 * Math.log(1 - (100 - 25) / 200); // analytic time to reach 100 °C ≈ 47 s
  const before = hold(heater, d, tFail - 2);
  assert.notEqual(before.state, 'damaged');
  const after = hold(heater, d, tFail + 1);
  assert.equal(after.state, 'damaged');
  assert.ok(after.reasons.some((s) => s.includes('Thermal damage')) && after.reasons.some((s) => s.includes('open circuit')));
  const op = loadOperatingPoint(heater, after, d);
  assert.equal(op.currentA, 0); assert.equal(op.connected, false);
  const rested = hold(heater, drive('dc', 0), 600, after);
  assert.equal(rested.state, 'damaged', 'damage is permanent even after cooling');
  assert.ok(rested.tempC < after.tempC);
  assert.throws(() => resistiveLoad(0), RangeError);
  assert.throws(() => resistiveLoad(NaN), RangeError);
});
