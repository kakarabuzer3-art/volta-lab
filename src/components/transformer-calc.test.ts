import test from 'node:test';
import assert from 'node:assert/strict';
import { idealTransformer } from './transformer-calc.ts';

test('step-down: 1000:100 turns, 230 V, 2 A', () => {
  const r = idealTransformer({ turnsPrimary: 1000, turnsSecondary: 100, primaryVoltage: 230, primaryCurrent: 2 });
  assert.ok(r.ok && r.kind === 'step-down');
  if (r.ok) { assert.equal(r.ratio, 10); assert.equal(r.secondaryVoltage, 23); assert.equal(r.secondaryCurrent, 20); assert.equal(r.apparentPower, 460); }
});
test('step-up and one-to-one are classified by turns', () => {
  const up = idealTransformer({ turnsPrimary: 100, turnsSecondary: 400 });
  assert.ok(up.ok && up.kind === 'step-up' && up.ratio === 0.25);
  const one = idealTransformer({ turnsPrimary: 50, turnsSecondary: 50 });
  assert.ok(one.ok && one.kind === 'one-to-one');
});
test('power is equal on both sides (Vs·Is = Vp·Ip) for an ideal transformer', () => {
  const r = idealTransformer({ turnsPrimary: 300, turnsSecondary: 70, primaryVoltage: 120, primaryCurrent: 5 });
  assert.ok(r.ok);
  if (r.ok) assert.ok(Math.abs(r.secondaryVoltage! * r.secondaryCurrent! - r.apparentPower!) < 1e-9);
});
test('optional values stay absent when not given', () => {
  const r = idealTransformer({ turnsPrimary: 10, turnsSecondary: 5, primaryVoltage: 100 });
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.secondaryVoltage, 50); assert.equal(r.secondaryCurrent, undefined); assert.equal(r.apparentPower, undefined); }
});
test('invalid input is rejected with a reason, never computed', () => {
  for (const bad of [0, -3, NaN, Infinity]) assert.equal(idealTransformer({ turnsPrimary: bad, turnsSecondary: 10 }).ok, false);
  assert.equal(idealTransformer({ turnsPrimary: 10, turnsSecondary: 0 }).ok, false);
  assert.equal(idealTransformer({ turnsPrimary: 10, turnsSecondary: 5, primaryVoltage: -1 }).ok, false);
  assert.equal(idealTransformer({ turnsPrimary: 10, turnsSecondary: 5, primaryCurrent: NaN }).ok, false);
});
