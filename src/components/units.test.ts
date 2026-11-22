import test from 'node:test';
import assert from 'node:assert/strict';
import { UnitError, canonicalUnitOf, checkQuantity, checkRange, convert, findUnit, formatQuantity, fromSi, quantity, quantityRange, relativeTolerance, toSi, toUnit } from './units.ts';

const close = (a: number, b: number, rel = 1e-12): void => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('prefixes convert to canonical SI', () => {
  close(toSi(100, 'µF'), 1e-4); close(toSi(470, 'nF'), 4.7e-7); close(toSi(2.2, 'kΩ'), 2200); close(toSi(500, 'mΩ'), 0.5); close(toSi(10, 'µH'), 1e-5);
  close(fromSi(1e-4, 'µF'), 100);
});
test('both micro characters and the Ohm sign are accepted', () => {
  close(toSi(1, 'µF'), 1e-6); close(toSi(1, 'μF'), 1e-6); assert.equal(toSi(1, 'Ω'), 1); assert.equal(toSi(1, 'Ω'), 1);
});
test('units are case-sensitive: mΩ is not MΩ', () => { close(toSi(1, 'mΩ'), 1e-3); close(toSi(1, 'MΩ'), 1e6); });
test('different dimensions are never converted', () => { assert.throws(() => convert(1, 'Ω', 'F'), UnitError); close(convert(1, 'kΩ', 'mΩ'), 1e6); });
test('temperature uses an offset', () => { close(toSi(25, '°C'), 298.15); close(fromSi(273.15, '°C'), 0); });
test('unknown unit and non-finite values throw', () => {
  assert.throws(() => toSi(1, 'furlong'), UnitError);
  for (const v of [NaN, Infinity, -Infinity]) assert.throws(() => toSi(v, 'Ω'), UnitError);
});
test('quantity keeps SI, canonical unit and display unit separate', () => {
  const q = quantity(100, 'µF'); assert.equal(q.dimension, 'capacitance'); close(q.si, 1e-4); assert.equal(q.canonicalUnit, 'F'); assert.equal(q.displayUnit, 'µF');
  close(toUnit(q, 'nF'), 1e5); assert.equal(canonicalUnitOf('resistance'), 'Ω'); assert.deepEqual(checkQuantity(q, 'capacitance'), []);
  assert.ok(checkQuantity(q, 'resistance').length > 0);
  assert.equal(formatQuantity(quantity(2200, 'Ω'), 'kΩ'), '2.2 kΩ');
});
test('Load Lab motor units exist and agree', () => { assert.equal(findUnit('V·s/rad')?.dimension, 'motor-constant'); assert.equal(findUnit('N·m·s/rad')?.dimension, 'viscous-coefficient'); assert.equal(findUnit('N·m')?.dimension, 'torque'); });
test('ranges and tolerance are validated', () => {
  const r = quantityRange('Ω', { min: 99, nominal: 100, max: 101, tolerance: relativeTolerance(0.01) }); assert.deepEqual(checkRange(r, 'resistance'), []);
  // A genuine numeric boundary: min above max is reported with its own message; equal bounds are allowed.
  const bad = checkRange({ dimension: 'resistance', canonicalUnit: 'Ω', min: 101, max: 99 }, 'resistance');
  assert.ok(bad.some((m) => /min \(101\) is greater than max \(99\)/.test(m)), JSON.stringify(bad));
  assert.deepEqual(checkRange({ dimension: 'resistance', canonicalUnit: 'Ω', min: 100, max: 100 }, 'resistance'), []);
});
