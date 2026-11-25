import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from './taxonomy.ts';
import { FAMILIES } from './data/families.ts';
import { SECTION3_DEFINITIONS } from './data/section3.ts';
import { TRANSFORMER_DEFINITIONS } from './data/transformers.ts';
import { createLegacyRegistry } from './adapters.ts';
import { createRegistry } from './registry.ts';
import { validateCatalogue } from './validate.ts';

const data = { categories: CATEGORIES, families: FAMILIES, definitions: SECTION3_DEFINITIONS, parts: [] };
const reg = createRegistry(data, { adapterIds: [] });

test('the Section 3 catalogue is valid and sorted into resistors, capacitors and diodes', () => {
  assert.deepEqual(validateCatalogue(data, { adapterIds: [] }), []);
  assert.deepEqual(reg.definitionsInFamily('fam.resistors').map((d) => d.id), ['def.fixed-resistor', 'def.variable-resistor', 'def.thermistor', 'def.varistor']);
  assert.deepEqual(reg.definitionsInFamily('fam.capacitors').map((d) => d.id), ['def.ceramic-capacitor', 'def.electrolytic-capacitor', 'def.film-capacitor', 'def.variable-capacitor']);
  assert.deepEqual(reg.definitionsInFamily('fam.diodes').map((d) => d.id), ['def.rectifier-diode', 'def.zener-diode', 'def.schottky-diode', 'def.led']);
  assert.equal(reg.family('fam.diodes')!.categoryId, 'cat.semiconductors');
});
test('it can sit beside the transformer and the legacy catalogues without id clashes', () => {
  const all = { categories: CATEGORIES, families: FAMILIES, definitions: [...createLegacyRegistry().definitions, ...TRANSFORMER_DEFINITIONS, ...SECTION3_DEFINITIONS], parts: [] };
  assert.deepEqual(validateCatalogue(all, { adapterIds: ['legacy-load'] }).filter((i) => /duplicate|unique/i.test(JSON.stringify(i))), []);
  assert.equal(new Set(all.definitions.map((d) => d.id)).size, all.definitions.length);
});
test('nothing here is simulatable and each entry says so', () => {
  for (const d of SECTION3_DEFINITIONS) {
    assert.equal(d.simulation.status, 'reference-only', d.id);
    assert.ok(d.simulation.limitations.some((l) => /cannot be placed in a circuit or simulated/.test(l)), d.id);
  }
});
test('no invented facts: illustrative/unverified evidence, no part numbers, no limits, no dimensions, no numeric ratings in the text', () => {
  for (const d of SECTION3_DEFINITIONS) {
    assert.equal(d.evidence.origin, 'illustrative-educational'); assert.equal(d.evidence.review.status, 'unverified');
    assert.equal(d.physical, undefined);
    assert.equal(d.symbol?.origin, 'original-artwork');
    for (const s of d.specifications) { assert.equal(s.usage, 'characteristic'); assert.equal(s.limits, undefined, `${d.id}.${s.key} must not carry invented limits`); }
    for (const fm of d.formulas ?? []) { assert.equal(fm.evidence.origin, 'engineering-reference'); assert.equal(fm.evidence.review.status, 'unverified'); assert.ok((fm.appliesWhen ?? '').length > 10, `${d.id}.${fm.id} must say when it applies`); }
    const text = [d.beginnerSummary, d.electricalPurpose, ...(d.applications ?? [])].join(' ');
    assert.doesNotMatch(text, /\d\s?(V|mV|kV|A|mA|Ω|kΩ|µF|nF|pF|W|mW|°C)\b/, `${d.id} must not state numeric ratings or typical values`);
  }
  assert.equal(reg.parts.length, 0);
});
test('safety and polarity facts are stated plainly where they matter', () => {
  assert.match(reg.definition('def.electrolytic-capacitor')!.electricalPurpose, /reversed polarity/);
  assert.match(reg.definition('def.led')!.electricalPurpose, /current-limiting resistor/);
  assert.match(reg.definition('def.zener-diode')!.electricalPurpose, /series resistor/);
  assert.match(reg.definition('def.varistor')!.electricalPurpose, /never instead of one/);
});
test('terminals: diodes use anode/cathode, the potentiometer has a wiper, the electrolytic has positive/negative', () => {
  for (const id of ['def.rectifier-diode', 'def.zener-diode', 'def.schottky-diode', 'def.led']) assert.deepEqual(reg.definition(id)!.terminals.map((t) => t.role), ['anode', 'cathode'], id);
  assert.ok(reg.definition('def.variable-resistor')!.terminals.some((t) => t.role === 'wiper'));
  assert.deepEqual(reg.definition('def.electrolytic-capacitor')!.terminals.map((t) => t.polarity), ['positive', 'negative']);
});
test('aliases find the right kind of part', () => {
  assert.deepEqual(reg.findByAlias('potentiometer'), { status: 'found', definitionId: 'def.variable-resistor' });
  assert.deepEqual(reg.findByAlias('MOV'), { status: 'found', definitionId: 'def.varistor' });
  assert.deepEqual(reg.findByAlias('electrolytic'), { status: 'found', definitionId: 'def.electrolytic-capacitor' });
  assert.deepEqual(reg.findByAlias('LED'), { status: 'found', definitionId: 'def.led' });
});
test('the five legacy load models are unchanged', () => {
  assert.deepEqual(createLegacyRegistry().definitions.map((d) => d.id), ['def.resistor', 'def.inductor', 'def.capacitor', 'def.series-rlc', 'def.dc-motor']);
});
