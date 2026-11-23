import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from './taxonomy.ts';
import { FAMILIES } from './data/families.ts';
import { TRANSFORMER_DEFINITIONS } from './data/transformers.ts';
import { createLegacyRegistry } from './adapters.ts';
import { createRegistry } from './registry.ts';
import { validateCatalogue } from './validate.ts';

const data = { categories: CATEGORIES, families: FAMILIES, definitions: TRANSFORMER_DEFINITIONS, parts: [] };
const reg = createRegistry(data, { adapterIds: [] });

test('the transformer catalogue is valid and holds the five generic definitions in one family', () => {
  assert.deepEqual(validateCatalogue(data, { adapterIds: [] }), []);
  assert.deepEqual(reg.definitionsInFamily('fam.transformers').map((d) => d.id), ['def.power-transformer', 'def.isolation-transformer', 'def.autotransformer', 'def.current-transformer', 'def.voltage-transformer']);
  assert.equal(reg.family('fam.transformers')!.categoryId, 'cat.passive');
});
test('no transformer is simulatable; each says so and the one-port limit', () => {
  for (const d of TRANSFORMER_DEFINITIONS) { assert.equal(d.simulation.status, 'reference-only'); assert.ok(d.simulation.limitations.some((l) => /cannot be placed in a circuit or simulated/.test(l))); }
});
test('no invented facts: illustrative/unverified evidence, no part numbers, no numeric ratings, no dimensions, no voltage-class limits', () => {
  for (const d of TRANSFORMER_DEFINITIONS) {
    assert.equal(d.evidence.origin, 'illustrative-educational'); assert.equal(d.evidence.review.status, 'unverified');
    assert.equal(d.physical, undefined);
    for (const f of d.formulas ?? []) { assert.equal(f.evidence.origin, 'engineering-reference'); assert.equal(f.evidence.review.status, 'unverified'); assert.match(f.appliesWhen ?? '', /Ideal transformer/); }
    for (const s of d.specifications) { assert.equal(s.usage, 'characteristic'); assert.equal(s.limits, undefined, `${d.id}.${s.key} must not carry invented limits`); }
    assert.equal(d.symbol?.origin, 'original-artwork');
  }
  assert.equal(reg.parts.length, 0);
});
test('instrument transformers carry the opposite safety rules, stated plainly', () => {
  assert.match(reg.definition('def.current-transformer')!.electricalPurpose, /never be left open/);
  assert.match(reg.definition('def.voltage-transformer')!.electricalPurpose, /must not be short-circuited/);
});
test('aliases find the right transformer, once; step-up and step-down are one power transformer, not two records', () => {
  assert.deepEqual(reg.findByAlias('Step-Up Transformer'), { status: 'found', definitionId: 'def.power-transformer' });
  assert.deepEqual(reg.findByAlias('step down transformer'), { status: 'found', definitionId: 'def.power-transformer' });
  assert.deepEqual(reg.findByAlias('PT'), { status: 'found', definitionId: 'def.voltage-transformer' });
  assert.deepEqual(reg.findByAlias('CT'), { status: 'found', definitionId: 'def.current-transformer' });
  assert.deepEqual(reg.findByAlias('auto-transformer'), { status: 'found', definitionId: 'def.autotransformer' });
});
test('terminal vocabulary: transformers use primary/secondary/tap roles, polarity left unspecified', () => {
  const roles = new Set(TRANSFORMER_DEFINITIONS.flatMap((d) => d.terminals.map((t) => t.role)));
  for (const r of ['primary', 'secondary', 'tap', 'common', 'input']) assert.ok(roles.has(r as never), r);
  for (const d of TRANSFORMER_DEFINITIONS) for (const t of d.terminals) assert.equal(t.polarity, 'unspecified');
});
test('adding the transformer family does not change the five legacy models or their registry', () => {
  const legacy = createLegacyRegistry();
  assert.deepEqual(legacy.definitions.map((d) => d.id), ['def.resistor', 'def.inductor', 'def.capacitor', 'def.series-rlc', 'def.dc-motor']);
  assert.deepEqual(legacy.definitionsInFamily('fam.transformers'), []);
});
