import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogue } from './validate.ts';
import type { ValidationIssue } from './validate.ts';
import type { CatalogueData, ComponentDefinition, ManufacturerPart } from './types.ts';
import { CATEGORIES } from './taxonomy.ts';
import { FAMILIES } from './data/families.ts';
import { illustrativeEvidence } from './provenance.ts';

// A synthetic, clearly fictional fixture: no real product, no real values.
const def = (over: Partial<ComponentDefinition> = {}): ComponentDefinition => ({
  id: 'def.test-resistor', kind: 'discrete', categoryId: 'cat.passive', familyId: 'fam.resistors', name: 'Test resistor', aliases: ['testor'], roles: ['load'], tags: ['test'],
  beginnerSummary: 'A fictional test part.', electricalPurpose: 'Exists only in tests.',
  terminals: [
    { id: 'a', name: 'A', role: 'terminal', connectionType: 'passive', polarity: 'none' },
    { id: 'b', name: 'B', role: 'terminal', connectionType: 'passive', polarity: 'none' },
  ],
  specifications: [], simulation: { status: 'reference-only', limitations: ['Reference only.'] }, evidence: illustrativeEvidence('test fixture'), ...over,
});
const data = (defs: ComponentDefinition[], parts: ManufacturerPart[] = []): CatalogueData => ({ categories: CATEGORIES, families: FAMILIES, definitions: defs, parts });
const opts = { adapterIds: ['legacy-load:resistor'] };
const codes = (d: CatalogueData): ValidationIssue[] => validateCatalogue(d, opts);

test('a clean fixture has no issues', () => assert.deepEqual(codes(data([def()])), []));

test('duplicate ids are reported with record and field', () => {
  const issues = codes(data([def(), def({ name: 'Other', aliases: [] })]));
  const i = issues.find((x) => x.code === 'duplicate-id'); assert.ok(i); assert.match(i.record, /def\.test-resistor/); assert.ok(i.field.length > 0);
});
test('bad id pattern', () => assert.ok(codes(data([def({ id: 'Resistor 1' })])).some((i) => i.code === 'invalid-id')));
test('dangling family reference', () => assert.ok(codes(data([def({ familyId: 'fam.nope' })])).some((i) => i.code === 'missing-reference')));
test('family must belong to the stated category', () => assert.ok(codes(data([def({ categoryId: 'cat.semiconductors' })])).some((i) => i.code === 'family-category-mismatch')));
test('kind must fit the category (an assembly is not a passive part)', () => assert.ok(codes(data([def({ kind: 'assembly' })])).some((i) => i.code === 'kind-category-mismatch')));
test('alias collisions between definitions are detected, ignoring case and spacing', () => {
  const issues = codes(data([def(), def({ id: 'def.test-other', name: 'Other', aliases: ['  TESTOR '] })]));
  assert.ok(issues.some((i) => i.code === 'alias-collision'), JSON.stringify(issues));
});
test('terminals: duplicate ids and unknown vocabulary', () => {
  const t = def().terminals[0];
  assert.ok(codes(data([def({ terminals: [t, t] })])).some((i) => i.code === 'duplicate-terminal'));
  assert.ok(codes(data([def({ terminals: [{ ...t, role: 'bogus' as never }] })])).some((i) => i.code === 'invalid-terminal'));
});
test('a simulatable definition must name an adapter that exists, on the one-port-load port', () => {
  const sim = (adapterId: string) => def({ simulation: { status: 'simulatable', adapterId, port: 'one-port-load', limitations: ['x'] } });
  assert.deepEqual(codes(data([sim('legacy-load:resistor')])), []);
  assert.ok(codes(data([sim('legacy-load:ghost')])).some((i) => i.code === 'invalid-adapter'));
  assert.ok(codes(data([def({ simulation: { status: 'simulatable', adapterId: 'legacy-load:resistor', port: 'two-port' as never, limitations: ['x'] } })])).some((i) => i.code.startsWith('invalid-simulation')));
});
test('having a definition never makes it simulatable: reference-only needs no adapter', () => assert.deepEqual(codes(data([def({ simulation: { status: 'planned', limitations: ['Not built yet.'] } })])), []));
test('a generic definition cannot claim manufacturer-datasheet evidence', () => {
  const ev = { origin: 'manufacturer-datasheet' as const, review: { status: 'unverified' as const }, source: { kind: 'manufacturer-datasheet' as const, publisher: 'X', title: 'T', url: 'https://example.invalid/a.pdf', page: '1', revision: 'A' } };
  assert.ok(codes(data([def({ evidence: ev })])).some((i) => i.code === 'generic-with-manufacturer-evidence'));
});
test('representative 3D models must not carry dimensions', () => {
  const ev = illustrativeEvidence('t');
  const p = { id: 'phys.test', basis: 'representative-educational' as const, representation: 'parametric' as const, evidence: ev, dimensions: { diameter: { dimension: 'length' as const, si: 0.005, canonicalUnit: 'm' }, evidence: ev } };
  assert.ok(codes(data([def({ physical: p })])).some((i) => i.code === 'invalid-physical'));
});
test('third-party symbol artwork needs a licence', () => {
  const s = { id: 'sym.test', convention: 'generic' as const, viewBox: '0 0 64 24', markup: '<path d="M0 12H64"/>', origin: 'third-party' as const };
  assert.ok(codes(data([def({ symbol: s })])).some((i) => i.code === 'invalid-symbol'));
  assert.deepEqual(codes(data([def({ symbol: { ...s, licence: 'CC0 (test)' } })])), []);
});
test('a part must reference a definition and carry manufacturer-datasheet evidence', () => {
  const part: ManufacturerPart = { id: 'part.test-1', definitionId: 'def.ghost', manufacturer: 'ExampleCo (fixture)', partNumber: 'T-1', specs: [], evidence: illustrativeEvidence('x') };
  const issues = codes(data([def()], [part]));
  assert.ok(issues.some((i) => i.code === 'missing-reference'));
  assert.ok(issues.some((i) => i.code === 'invalid-evidence'));
});
test('every issue names a record and a field', () => {
  for (const i of codes(data([def({ id: 'bad id', familyId: 'fam.nope', name: ' ' })]))) { assert.ok(i.record.length > 0 && i.field.length > 0 && i.code.length > 0 && i.message.length > 0); }
});

// ---- Phase 2B.1: manufacturer-part specification values (synthetic fixture; fictional maker, reserved .invalid domain)
import type { SpecificationDefinition, SpecificationValue, SpecValue } from './types.ts';
import type { OperatingConditions, Quantity } from './units.ts';

const datasheetEv = { origin: 'manufacturer-datasheet' as const, review: { status: 'unverified' as const }, source: { kind: 'manufacturer-datasheet' as const, publisher: 'ExampleCo (fixture)', title: 'Fixture sheet', url: 'https://example.invalid/ds.pdf', page: '1', revision: 'A' } };
const rSpec: SpecificationDefinition = { key: 'resistance', label: 'Resistance', plain: 'x', usage: 'characteristic', valueType: 'range', dimension: 'resistance', limits: { minSi: 1, maxSi: 1000 } };
const specDef = def({ specifications: [rSpec] });
const partWith = (value: SpecValue, conditions?: OperatingConditions): ManufacturerPart => ({
  id: 'part.fixture-1', definitionId: 'def.test-resistor', manufacturer: 'ExampleCo (fixture)', partNumber: 'FIX-1',
  specs: [{ key: 'resistance', value, ...(conditions ? { conditions } : {}), evidence: datasheetEv } satisfies SpecificationValue], evidence: datasheetEv,
});
const range = (r: { min?: number; typical?: number; nominal?: number; max?: number }): SpecValue => ({ type: 'range', range: { dimension: 'resistance', canonicalUnit: 'Ω', ...r } });
const partIssues = (v: SpecValue, c?: OperatingConditions): ValidationIssue[] => codes(data([specDef], [partWith(v, c)]));
const q = (dimension: Quantity['dimension'], si: number, canonicalUnit: string): Quantity => ({ dimension, si, canonicalUnit });
const outside = (is: ValidationIssue[], what: string): boolean => is.some((i) => i.code === 'invalid-spec-value' && i.record.includes('part.fixture-1') && i.field === 'specs[0].value' && new RegExp(`${what} .* is outside`).test(i.message));

test('range spec: in-bounds values of every kind are accepted', () => assert.deepEqual(partIssues(range({ min: 10, typical: 50, nominal: 100, max: 500 })), []));
test('range spec: every provided value is checked against the limits', () => {
  assert.ok(outside(partIssues(range({ min: 0.5, max: 10 })), 'min'));
  assert.ok(outside(partIssues(range({ min: 10, max: 5000 })), 'max'));
  assert.ok(outside(partIssues(range({ typical: 5000 })), 'typical'), 'typical alone, no min or max');
  assert.ok(outside(partIssues(range({ nominal: 0.5 })), 'nominal'), 'nominal alone, no min or max');
  assert.ok(outside(partIssues(range({ typical: 2000, nominal: 100 })), 'typical'));
  assert.ok(outside(partIssues(range({ min: 10, typical: 20, nominal: 5000, max: 5000 })), 'nominal'));
  assert.equal(outside(partIssues(range({ typical: 50 })), 'typical'), false);
  assert.deepEqual(partIssues(range({ nominal: 1 })), [], 'the lower limit itself is allowed'); assert.deepEqual(partIssues(range({ typical: 1000 })), [], 'the upper limit itself is allowed');
});
test('top-level specification conditions: valid conditions pass', () => {
  assert.deepEqual(partIssues(range({ nominal: 100 }), { temperature: q('temperature', 298.15, 'K'), frequency: q('frequency', 1000, 'Hz'), dcBias: q('voltage', 5, 'V'), note: 'fixture' }), []);
  assert.deepEqual(partIssues(range({ nominal: 100 }), {}), []);
});
test('top-level specification conditions: wrong dimension, bad unit, non-finite and blank note are reported on specs[0].conditions', () => {
  const field = (c: OperatingConditions) => partIssues(range({ nominal: 100 }), c).filter((i) => i.field === 'specs[0].conditions');
  assert.ok(field({ temperature: q('voltage', 5, 'V') }).some((i) => /temperature/.test(i.message) && /expected temperature/.test(i.message)));
  assert.ok(field({ frequency: q('resistance', 5, 'Ω') }).some((i) => /frequency/.test(i.message)));
  assert.ok(field({ dcBias: q('current', 1, 'A') }).some((i) => /dcBias/.test(i.message) && /expected voltage/.test(i.message)));
  assert.ok(field({ frequency: q('frequency', 1000, 'kHz') }).some((i) => /canonicalUnit/.test(i.message)), 'canonical unit must be Hz');
  assert.ok(field({ temperature: q('temperature', NaN, 'K') }).some((i) => /finite/.test(i.message)));
  assert.ok(field({ frequency: q('frequency', -5, 'Hz') }).some((i) => /negative/.test(i.message)));
  assert.ok(field({ note: '  ' }).some((i) => /note/.test(i.message)));
  for (const i of field({ dcBias: q('current', 1, 'A') })) assert.equal(i.code, 'invalid-spec-value');
});
test('conditions are validated for quantity-valued specifications too', () => {
  const qSpec = def({ specifications: [{ ...rSpec, valueType: 'quantity' }] });
  const part = partWith({ type: 'quantity', quantity: q('resistance', 100, 'Ω') }, { temperature: q('current', 1, 'A') });
  assert.ok(codes(data([qSpec], [part])).some((i) => i.field === 'specs[0].conditions'));
});
