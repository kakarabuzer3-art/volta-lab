import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEMISTRIES, batteryLimits, batteryTerminalVoltage, createBatteryState, integrateTable, maxDischargePowerW, packModel, solveBatteryForPower, stepBattery, storedEnergyWh,
} from './battery.ts';
import type { BatteryState, PackConfig } from './battery.ts';

const near = (a: number, b: number, tol: number, msg?: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const pack = (chem: 'lead-acid' | 'li-ion', ns: number, np: number, ah: number): PackConfig => ({ cell: { chemistry: chem, capacityAh: ah }, seriesCells: ns, parallelStrings: np });
const run = (p: ReturnType<typeof packModel>, st: BatteryState, i: number, seconds: number, dt = 1, amb = 25): BatteryState => {
  for (let k = 0; k < seconds / dt; k++) st = stepBattery(p, st, i, dt, amb).state;
  return st;
};

test('13. series / parallel: Vpack = Ns·Vcell, Ah = Np·Ah_cell, Rpack = Ns·Rcell/Np', () => {
  const cell = packModel(pack('li-ion', 1, 1, 2));
  const p = packModel(pack('li-ion', 4, 3, 2));
  near(p.capacityAh, 3 * 2, 1e-12);
  near(p.ocv(0.5, 25), 4 * cell.ocv(0.5, 25), 1e-12);
  near(p.r0(0.5, 25), (4 * cell.r0(0.5, 25)) / 3, 1e-12);
  near(p.cutoffV, 4 * cell.cutoffV, 1e-12);
  near(p.maxDischargeA, 3 * cell.maxDischargeA, 1e-12);
  near(p.nominalEnergyWh, 12 * cell.nominalEnergyWh, 1e-9, 'energy scales with cell count');
  // Series-only keeps the Ah, parallel-only keeps the voltage.
  assert.equal(packModel(pack('lead-acid', 6, 1, 7)).capacityAh, 7);
  near(packModel(pack('lead-acid', 1, 5, 7)).ocv(1, 25), packModel(pack('lead-acid', 1, 1, 7)).ocv(1, 25), 1e-12);
  assert.throws(() => packModel(pack('li-ion', 0, 1, 2)), RangeError);
  assert.throws(() => packModel(pack('li-ion', 2.5, 1, 2)), RangeError);
});

test('14. SOC decreases during discharge exactly by I·t/(3600·Ah)', () => {
  const p = packModel(pack('li-ion', 4, 1, 10));
  const st = run(p, createBatteryState(0.8), 5, 3600 / 5 * 1); // 5 A for 720 s = 1 Ah
  near(st.soc, 0.8 - 1 / 10, 1e-12);
  assert.ok(st.dischargedWh > 0 && st.chargedWh === 0);
});

test('15. SOC increases during charging (scaled by coulombic efficiency)', () => {
  const p = packModel(pack('lead-acid', 6, 1, 20));
  const st = run(p, createBatteryState(0.5), -2, 3600); // 2 A for 1 h = 2 Ah delivered to terminals
  near(st.soc, 0.5 + (2 * p.profile.coulombicEfficiency) / 20, 1e-12);
  assert.ok(st.soc > 0.5 && st.chargedWh > 0);
  // Li-ion is more efficient than lead-acid, so it stores more of the same charge.
  const li = packModel(pack('li-ion', 4, 1, 20));
  near(run(li, createBatteryState(0.5), -2, 3600).soc - 0.5, (2 * CHEMISTRIES['li-ion'].coulombicEfficiency) / 20, 1e-12);
  // Charging is capped at full: no SOC > 1, and the surplus is heat, not stored energy.
  const full = run(li, createBatteryState(0.999), -10, 3600);
  assert.equal(full.soc, 1);
  assert.ok(full.sideLossWh > 0);
});

test('16. terminal voltage sags under load: Vt = OCV − I·R0 − V1', () => {
  const p = packModel(pack('lead-acid', 6, 1, 20));
  let st = createBatteryState(1);
  const ocv = p.ocv(1, 25);
  const first = stepBattery(p, st, 10, 0.001, 25);
  near(first.terminalV, ocv - 10 * p.r0(1, 25), 1e-2, 'instantaneous sag is I·R0');
  st = run(p, st, 10, 120);
  const vt = batteryTerminalVoltage(p, st, 10);
  assert.ok(vt < ocv - 10 * p.r0(1, 25) + 1e-9, 'polarization adds further sag');
  near(st.v1V, 10 * p.r1(1, 25), 0.05 * 10 * p.r1(1, 25), 'V1 approaches I·R1 after several τ');
  assert.ok(vt < p.ocv(st.soc, st.tempC));
  // Relaxation: voltage recovers toward OCV when the current is removed.
  const rest = run(p, st, 0, 200);
  assert.ok(Math.abs(rest.v1V) < 1e-3);
});

test('17. internal resistance effects: more parallel strings → lower R0 → less sag; chemistries differ', () => {
  const small = packModel(pack('li-ion', 4, 1, 5));
  const big = packModel(pack('li-ion', 4, 4, 5));
  const sagSmall = small.ocv(1, 25) - batteryTerminalVoltage(small, createBatteryState(1), 10);
  const sagBig = big.ocv(1, 25) - batteryTerminalVoltage(big, createBatteryState(1), 10);
  near(sagSmall / sagBig, 4, 1e-9);
  assert.ok(small.r0(0.02, 25) > small.r0(0.5, 25), 'R0 rises at low SOC');
  assert.ok(small.r0(0.5, -10) > small.r0(0.5, 40), 'R0 rises when cold');
  // Chemistry-specific: same SOC, very different per-cell OCV and cutoff — not one generic curve.
  const pb = packModel(pack('lead-acid', 1, 1, 10)), li = packModel(pack('li-ion', 1, 1, 10));
  assert.ok(li.ocv(0.5, 25) - pb.ocv(0.5, 25) > 1);
  assert.ok(li.cutoffV > pb.cutoffV);
  assert.ok(CHEMISTRIES['lead-acid'].coulombicEfficiency < CHEMISTRIES['li-ion'].coulombicEfficiency);
  // Maximum power transfer: Pmax = E²/(4R); asking for more is infeasible.
  const st = createBatteryState(1);
  const pmax = maxDischargePowerW(small, st);
  near(pmax, small.ocv(1, 25) ** 2 / (4 * small.r0(1, 25)), 1e-9);
  assert.equal(solveBatteryForPower(small, st, pmax * 1.01).feasible, false);
  const ok = solveBatteryForPower(small, st, pmax * 0.5);
  assert.equal(ok.feasible, true);
  near(ok.terminalV * ok.currentA, pmax * 0.5, 1e-6, 'solved operating point delivers the requested power');
});

test('18. cutoff behaviour: low-voltage, empty, over-current and over-temperature limits', () => {
  const p = packModel(pack('lead-acid', 6, 1, 7));
  let st = createBatteryState(0.5);
  assert.deepEqual(batteryLimits(p, st, 12.2, 1), []);
  assert.ok(batteryLimits(p, st, p.cutoffV - 0.01, 5).includes('low-voltage'));
  assert.ok(!batteryLimits(p, st, p.cutoffV - 0.01, 0).includes('low-voltage'), 'no cutoff while no discharge current flows');
  assert.ok(batteryLimits(p, st, 12, p.maxDischargeA * 1.5).includes('over-discharge-current'));
  assert.ok(batteryLimits(p, st, 12, -p.maxChargeA * 2).includes('over-charge-current'));
  assert.ok(batteryLimits(p, createBatteryState(0.5, p.maxTempC + 1), 12, 1).includes('over-temperature'));
  // A real heavy discharge reaches the cutoff voltage before the cell is "empty".
  const heavy = packModel(pack('lead-acid', 6, 1, 7));
  st = createBatteryState(0.3);
  let hit = false;
  for (let k = 0; k < 4000 && !hit; k++) { const r = stepBattery(heavy, st, 20, 1, 25); st = r.state; hit = batteryLimits(heavy, st, r.terminalV, 20).includes('low-voltage'); }
  assert.ok(hit, 'cutoff voltage reached under sustained 20 A');
  // Discharge cannot take SOC below 0.
  const drained = run(packModel(pack('li-ion', 2, 1, 1)), createBatteryState(0.05), 3, 600);
  assert.equal(drained.soc, 0);
});

test('19. energy accounting: chemical = terminal + R0 + R1 + C1 (exact), and stored energy falls by the chemical energy released', () => {
  const p = packModel(pack('li-ion', 20, 2, 5));
  let st = createBatteryState(0.9);
  const e0 = storedEnergyWh(p, st.soc);
  for (let k = 0; k < 1800; k++) st = stepBattery(p, st, 8 + 3 * Math.sin(k / 50), 1, 25).state; // varying current
  const resid = st.chemicalNetWh - (st.terminalNetWh + st.r0LossWh + st.r1LossWh + st.c1StoredWh);
  near(resid, 0, 1e-9, 'ledger residual (Wh)');
  const dStored = e0 - storedEnergyWh(p, st.soc);
  near(dStored, st.chemicalNetWh, 0.01 * st.chemicalNetWh, 'ΔE_stored (OCV integral) vs Σ OCV·I·dt');
  assert.ok(st.terminalNetWh < st.chemicalNetWh, 'delivered < released: losses are positive');
  near(integrateTable(CHEMISTRIES['li-ion'].ocvTable, 1) * 2 * 5 * 20, p.nominalEnergyWh, 1e-9);
  // Thermal accumulation from I²R and cooling when idle.
  const hot = run(p, createBatteryState(0.9), 40, 600);
  assert.ok(hot.tempC > 25 + 0.5, 'self-heating under load');
  const cool = run(p, { ...hot }, 0, 3600 * 6);
  assert.ok(cool.tempC < hot.tempC);
});

test('36. battery depletion cannot create energy', () => {
  const p = packModel(pack('li-ion', 4, 1, 2));
  const st0 = createBatteryState(0.2);
  const e0 = storedEnergyWh(p, st0.soc);
  const st = run(p, st0, 10, 3600, 1);
  assert.equal(st.soc, 0);
  assert.ok(st.dischargedWh <= e0 * 1.0001, `delivered ${st.dischargedWh} Wh ≤ stored ${e0} Wh`);
  assert.ok(st.chemicalNetWh <= e0 * 1.01);
  const more = stepBattery(p, st, 10, 10, 25);
  assert.equal(more.currentA, 0, 'no further charge can be extracted from an empty battery');
  assert.equal(more.state.dischargedWh, st.dischargedWh);
});
