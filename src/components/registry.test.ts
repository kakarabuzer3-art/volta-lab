import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogueError, createRegistry } from './registry.ts';
import type { CatalogueData, ComponentDefinition } from './types.ts';
import { CATEGORIES } from './taxonomy.ts';
import { FAMILIES } from './data/families.ts';
import { illustrativeEvidence } from './provenance.ts';

const def = (id: string, name: string, aliases: string[], familyId = 'fam.resistors'): ComponentDefinition => ({
  id, kind: 'discrete', categoryId: 'cat.passive', familyId, name, aliases, roles: ['load'], tags: [], beginnerSummary: 'fixture', electricalPurpose: 'fixture',
  terminals: [{ id: 'a', name: 'A', role: 'terminal', connectionType: 'passive', polarity: 'none' }, { id: 'b', name: 'B', role: 'terminal', connectionType: 'passive', polarity: 'none' }],
  specifications: [], simulation: { status: 'reference-only', limitations: ['x'] }, evidence: illustrativeEvidence('fixture'),
});
const mk = (defs: ComponentDefinition[]): CatalogueData => ({ categories: CATEGORIES, families: FAMILIES, definitions: defs, parts: [] });
const o = { adapterIds: [] };

test('lookups by id, category and family; unknown ids give undefined or empty', () => {
  const r = createRegistry(mk([def('def.a', 'Alpha', ['ay']), def('def.b', 'Beta', [], 'fam.capacitors')]), o);
  assert.equal(r.definition('def.a')?.name, 'Alpha'); assert.equal(r.definition('def.zzz'), undefined);
  assert.deepEqual(r.definitionsInCategory('cat.passive').map((d) => d.id), ['def.a', 'def.b']);
  assert.deepEqual(r.definitionsInFamily('fam.capacitors').map((d) => d.id), ['def.b']);
  assert.deepEqual(r.definitionsInFamily('fam.nope'), []); assert.equal(r.category('cat.passive')?.id, 'cat.passive'); assert.equal(r.family('fam.resistors')?.categoryId, 'cat.passive');
});
test('alias lookup normalises, and finds by name too', () => {
  const r = createRegistry(mk([def('def.a', 'Alpha part', ['A-lias'])]), o);
  assert.deepEqual(r.findByAlias('  a   LIAS '), { status: 'found', definitionId: 'def.a' });
  assert.deepEqual(r.findByAlias('alpha   PART'), { status: 'found', definitionId: 'def.a' });
  assert.deepEqual(r.findByAlias('nothing'), { status: 'none' }); assert.deepEqual(r.findByAlias('alias'), { status: 'none' }, 'a hyphen is a separator, not deleted'); assert.deepEqual(r.findByAlias('   '), { status: 'none' });
});
test('a catalogue with an alias collision is refused, never silently resolved', () => {
  assert.throws(() => createRegistry(mk([def('def.a', 'Alpha', ['same']), def('def.b', 'Beta', ['SAME'])]), o), (e: unknown) => e instanceof CatalogueError && e.issues.some((i) => i.code === 'alias-collision'));
});
test('duplicate ids are refused', () => assert.throws(() => createRegistry(mk([def('def.a', 'A', []), def('def.a', 'B', [])]), o), CatalogueError));
test('order is stable and results are frozen', () => {
  const r = createRegistry(mk([def('def.z', 'Zed', []), def('def.a', 'Alpha', [])]), o);
  assert.deepEqual(r.definitions.map((d) => d.id), ['def.z', 'def.a']); assert.ok(Object.isFrozen(r.definitions));
});
