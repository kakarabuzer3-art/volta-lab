// Run with:  npm test   (Node's built-in test runner; no extra dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AC_FREQUENCY_HZ, AC_SOURCE_RESISTANCE, CONTACT_RESISTANCE, CURRENT_LIMIT_A, DC_SOURCE_RESISTANCE,
  MAX_VOLTAGE, TRIP_DELAY_S, advanceProtection, instantaneousCurrent, instantaneousVoltage, peakFromRms, solveCircuit,
} from './electrical.ts';
import type { SourceInput } from './electrical.ts';

const base: SourceInput = { mode: 'AC', powered: true, setVoltage: 220, shorted: false, tripped: false };
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('voltage range is preserved (0..415 V) and out-of-range input is clamped', () => {
  assert.equal(MAX_VOLTAGE, 415);
  assert.equal(solveCircuit({ ...base, setVoltage: 9999 }).openCircuitVoltage, 415);
  assert.equal(solveCircuit({ ...base, setVoltage: -5 }).openCircuitVoltage, 0);
  assert.equal(solveCircuit({ ...base, setVoltage: NaN }).openCircuitVoltage, 0);
});

test('AC: 50 Hz default, RMS convention, peak = sqrt(2) * Vrms', () => {
  const s = solveCircuit(base);
  assert.equal(s.frequency, 50);
  assert.equal(AC_FREQUENCY_HZ, 50);
  near(s.peakVoltage, Math.SQRT2 * 220);
  near(peakFromRms(230), 325.2691193458119, 1e-9);
});

test('AC: v(t) is a sine of the right amplitude, frequency and phase', () => {
  const s = solveCircuit(base);
  near(instantaneousVoltage(s, 0), 0);
  near(instantaneousVoltage(s, 1 / 200), s.peakVoltage); // quarter period of 50 Hz
  near(instantaneousVoltage(s, 1 / 100), 0, 1e-9); // half period
  near(instantaneousVoltage(s, 3 / 200), -s.peakVoltage); // negative half cycle
  near(instantaneousVoltage(s, 0, Math.PI / 2), s.peakVoltage); // phase offset
  // numerical RMS over exactly one period equals Vrms
  const n = 4000; let sum = 0;
  for (let k = 0; k < n; k++) sum += instantaneousVoltage(s, (k / n) / 50) ** 2;
  near(Math.sqrt(sum / n), 220, 1e-6);
});

test('DC: fixed polarity, 0 Hz, peak = Vdc, no alternation', () => {
  const s = solveCircuit({ ...base, mode: 'DC' });
  assert.equal(s.frequency, 0);
  assert.equal(s.peakVoltage, 220);
  for (const t of [0, 0.001, 0.0033, 0.02, 1.7]) assert.equal(instantaneousVoltage(s, t), 220);
});

test('open circuit: terminal voltage = Voc, zero current and power', () => {
  for (const mode of ['AC', 'DC'] as const) {
    const s = solveCircuit({ ...base, mode });
    assert.equal(s.state, 'open');
    assert.equal(s.terminalVoltage, 220);
    assert.equal(s.current, 0);
    assert.equal(s.power, 0);
    assert.equal(instantaneousCurrent(s, 0.003), 0);
  }
});

test('machine OFF disables the source in both modes', () => {
  for (const mode of ['AC', 'DC'] as const) {
    for (const shorted of [false, true]) {
      const s = solveCircuit({ ...base, mode, powered: false, shorted });
      assert.equal(s.state, 'off');
      assert.deepEqual([s.terminalVoltage, s.current, s.power, s.frequency], [0, 0, 0, 0]);
    }
  }
});

test('short circuit: current follows Voc/(Rs+Rc) below the limit (no limiting)', () => {
  const v = 10; // 10 V -> 10 / (2.2 + 0.05) = 4.44 A (AC), 10 / 0.45 = 22 A would exceed in DC
  const ac = solveCircuit({ ...base, setVoltage: v, shorted: true });
  near(ac.prospectiveCurrent, v / (AC_SOURCE_RESISTANCE + CONTACT_RESISTANCE));
  assert.equal(ac.currentLimited, false);
  near(ac.current, ac.prospectiveCurrent);
  near(ac.terminalVoltage, ac.current * CONTACT_RESISTANCE); // V_load = I * R_load
  near(ac.power, ac.terminalVoltage * ac.current); // P = V*I
  near(ac.power, ac.current ** 2 * CONTACT_RESISTANCE); // P = I^2 R
});

test('short circuit: current limit applies, and V/I/P agree', () => {
  for (const mode of ['AC', 'DC'] as const) {
    const s = solveCircuit({ ...base, mode, setVoltage: 415, shorted: true });
    assert.equal(s.state, 'short');
    assert.equal(s.currentLimited, true);
    assert.equal(s.current, CURRENT_LIMIT_A);
    assert.ok(s.prospectiveCurrent > CURRENT_LIMIT_A);
    near(s.terminalVoltage, CURRENT_LIMIT_A * CONTACT_RESISTANCE);
    near(s.power, s.terminalVoltage * s.current);
  }
  // DC source resistance is lower, so its prospective fault current is higher.
  const ac = solveCircuit({ ...base, setVoltage: 220, shorted: true });
  const dc = solveCircuit({ ...base, mode: 'DC', setVoltage: 220, shorted: true });
  assert.ok(dc.prospectiveCurrent > ac.prospectiveCurrent);
  near(dc.prospectiveCurrent, 220 / (DC_SOURCE_RESISTANCE + CONTACT_RESISTANCE));
});

test('energy balance: source power = load power + internal loss, never negative', () => {
  for (const mode of ['AC', 'DC'] as const) {
    for (const v of [0, 1, 5, 24, 110, 220, 230, 400, 415]) {
      const s = solveCircuit({ ...base, mode, setVoltage: v, shorted: true });
      near(s.sourcePower, s.power + s.internalLoss, 1e-9);
      assert.ok(s.internalLoss >= -1e-12 && s.power >= 0);
      assert.ok(s.power <= s.sourcePower + 1e-12); // cannot deliver more than drawn
    }
  }
});

test('AC short: instantaneous current is consistent with RMS current (i = v/R)', () => {
  const s = solveCircuit({ ...base, setVoltage: 415, shorted: true });
  const n = 4000; let sum = 0;
  for (let k = 0; k < n; k++) sum += instantaneousCurrent(s, (k / n) / 50) ** 2;
  near(Math.sqrt(sum / n), s.current, 1e-6);
});

test('protection: sustained current limit trips after TRIP_DELAY_S, other states reset the timer', () => {
  const fault = solveCircuit({ ...base, shorted: true });
  let timer = 0; let tripped = false; const dt = 0.1;
  for (let k = 0; k < 1000 && !tripped; k++) {
    const r = advanceProtection(timer, fault, dt); timer = r.timer; tripped = r.trip;
  }
  assert.ok(tripped);
  assert.ok(timer >= TRIP_DELAY_S && timer < TRIP_DELAY_S + dt + 1e-9);
  // separating the wires (open) resets the timer before a trip
  assert.deepEqual(advanceProtection(1.5, solveCircuit(base), 0.1), { timer: 0, trip: false });
  // a short that stays under the limit never trips
  const mild = solveCircuit({ ...base, setVoltage: 5, shorted: true });
  assert.equal(mild.currentLimited, false);
  assert.deepEqual(advanceProtection(1.9, mild, 0.1), { timer: 0, trip: false });
  // once tripped, the output is dead until main power is cycled
  const dead = solveCircuit({ ...base, shorted: true, tripped: true });
  assert.equal(dead.state, 'protected');
  assert.deepEqual([dead.terminalVoltage, dead.current, dead.power, dead.frequency], [0, 0, 0, 0]);
});

test('switching AC <-> DC repeatedly leaves no stale state (pure function)', () => {
  const ref = { ac: solveCircuit(base), dc: solveCircuit({ ...base, mode: 'DC' }) };
  for (let k = 0; k < 50; k++) {
    assert.deepEqual(solveCircuit({ ...base, mode: 'DC' }), ref.dc);
    assert.deepEqual(solveCircuit(base), ref.ac);
  }
});
