import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LOAD_CATALOGUE, buildLoad, loadTypeSpec } from '../sim/index.ts';
import type { LoadTypeId, RawForm } from '../sim/index.ts';
import { LegacyLoadAdapter, createLegacyRegistry, legacyAdapterId, legacyLoadAdapter } from './adapters.ts';
import { LEGACY_LOAD_META } from './data/legacy-load-meta.ts';
import { findUnit, toSi } from './units.ts';

const reg = createLegacyRegistry();
const presetForm = (id: LoadTypeId): RawForm => Object.fromEntries(Object.entries(loadTypeSpec(id).preset).map(([k, v]) => [k, { value: v, unitIndex: 0 }]));

test('the registry holds exactly the five legacy models and no manufacturer parts', () => {
  assert.deepEqual(reg.definitions.map((d) => d.id), ['def.resistor', 'def.inductor', 'def.capacitor', 'def.series-rlc', 'def.dc-motor']);
  assert.equal(reg.parts.length, 0);
});
test('classification: discrete / assembly / electromechanical', () => {
  const kinds = Object.fromEntries(reg.definitions.map((d) => [d.id, d.kind]));
  assert.deepEqual(kinds, { 'def.resistor': 'discrete', 'def.inductor': 'discrete', 'def.capacitor': 'discrete', 'def.series-rlc': 'assembly', 'def.dc-motor': 'electromechanical' });
  assert.equal(reg.definition('def.series-rlc')!.assemblyOf?.length, 3);
});
test('each definition is simulatable only through its adapter, as a one-port load, and says so', () => {
  for (const m of LEGACY_LOAD_META) {
    const d = reg.definition(m.definitionId)!;
    assert.equal(d.simulation.status, 'simulatable');
    if (d.simulation.status === 'simulatable') { assert.equal(d.simulation.adapterId, legacyAdapterId(m.loadId)); assert.equal(d.simulation.port, 'one-port-load'); assert.ok(d.simulation.limitations.some((l) => /one-port/.test(l))); }
    assert.ok(legacyLoadAdapter.has(legacyAdapterId(m.loadId)));
  }
  assert.equal(legacyLoadAdapter.has('legacy-load:ghost'), false); assert.equal(legacyLoadAdapter.has('other:resistor'), false);
});
test('specification keys, units and limits agree exactly with the Load Lab fields', () => {
  for (const m of LEGACY_LOAD_META) {
    const spec = loadTypeSpec(m.loadId); const d = reg.definition(m.definitionId)!;
    assert.deepEqual(d.specifications.map((s) => s.key), spec.params.map((p) => p.key));
    for (const p of spec.params) {
      const s = d.specifications.find((x) => x.key === p.key)!;
      assert.deepEqual(s.displayUnits, p.units.map((u) => u.label)); assert.deepEqual(s.limits, { minSi: p.min, maxSi: p.max });
      for (const u of p.units) { const def = findUnit(u.label, s.dimension)!; assert.ok(def, `${u.label} unknown`); assert.ok(Math.abs(toSi(1, u.label, s.dimension) - u.factor) <= 1e-12 * u.factor, `${p.key} ${u.label}: library ${toSi(1, u.label, s.dimension)} vs Load Lab ${u.factor}`); }
      assert.equal(s.usage, 'simulation-input');
    }
  }
});
test('formulas shown by the catalogue are text the Load Lab itself already shows (no new equation invented)', () => {
  for (const m of LEGACY_LOAD_META) {
    const t = loadTypeSpec(m.loadId); const text = [t.summary, t.role, t.acBehaviour, t.dcBehaviour, t.limitation].join(' ');
    const fs = reg.definition(m.definitionId)!.formulas ?? []; assert.ok(fs.length > 0);
    for (const f of fs) { assert.ok(text.includes(f.expression), `${f.expression} is not in the Load Lab text`); assert.equal(f.evidence.review.status, 'unverified'); }
  }
});
test('catalogue evidence is illustrative and unreviewed; it is not the simulator DataSource', () => {
  for (const d of reg.definitions) { assert.equal(d.evidence.origin, 'illustrative-educational'); assert.equal(d.evidence.review.status, 'unverified'); }
  assert.equal(JSON.stringify(reg.definitions).includes('illustrative-fixture'), false);
  assert.equal(JSON.stringify(reg.definitions).includes('user-specified'), false);
});
test('build() delegates to buildLoad: identical results, DataSource passed through untouched', () => {
  for (const l of LOAD_CATALOGUE) {
    const viaAdapter = legacyLoadAdapter.build(legacyAdapterId(l.id), presetForm(l.id));
    const direct = buildLoad(l.id, presetForm(l.id));
    assert.deepEqual(viaAdapter, direct);
    const fx = legacyLoadAdapter.build(legacyAdapterId(l.id), presetForm(l.id), 'illustrative-fixture');
    assert.deepEqual(fx, buildLoad(l.id, presetForm(l.id), 'illustrative-fixture'));
    assert.ok(fx.ok && fx.load.dataSource === 'illustrative-fixture'); assert.ok(viaAdapter.ok && viaAdapter.load.dataSource === 'user-specified');
  }
});
test('bad input is rejected by the existing validation, with the same field errors', () => {
  const bad = { ohms: { value: '-3', unitIndex: 0 } };
  assert.deepEqual(legacyLoadAdapter.build('legacy-load:resistor', bad), buildLoad('resistor', bad));
  assert.throws(() => legacyLoadAdapter.build('legacy-load:ghost', bad), RangeError);
});
test('aliases from the Load Lab names still resolve, uniquely', () => {
  assert.deepEqual(reg.findByAlias('Capacitor (in series)'), { status: 'found', definitionId: 'def.capacitor' });
  assert.deepEqual(reg.findByAlias('RLC'), { status: 'found', definitionId: 'def.series-rlc' });
  assert.deepEqual(reg.findByAlias('direct current motor'), { status: 'found', definitionId: 'def.dc-motor' });
  assert.equal(reg.findByAlias('choke').status, 'found');
});
test('the adapter refuses to start if sim and metadata ids drift', () => { assert.doesNotThrow(() => new LegacyLoadAdapter()); });

test('boundary: only adapters.ts imports the simulator; nothing outside src/components imports the library yet', () => {
  const dir = new URL('.', import.meta.url);
  const walk = (u: URL): URL[] => readdirSync(u, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(new URL(`${e.name}/`, u)) : [new URL(e.name, u)]);
  for (const f of walk(dir).filter((u) => /\.ts$/.test(u.pathname) && !/\.test\.ts$/.test(u.pathname))) {
    const src = readFileSync(f, 'utf8'); const name = f.pathname.split('/components/')[1];
    assert.equal(/^import .*from '(\.\.\/(sim|main|loadlab-ui|workbench-ui)[^']*|three[^']*)'/m.test(src), name === 'adapters.ts' ? true : false, `${name}: unexpected simulator/UI/three import state`);
  }
  const src = new URL('../', import.meta.url);
  for (const f of walk(src).filter((u) => /\.ts$/.test(u.pathname) && !u.pathname.includes('/components/'))) {
    assert.equal(/from '\.\/components|from '\.\.\/components/.test(readFileSync(f, 'utf8')), false, `${f.pathname} imports the component library`);
  }
});
test('no physics: library source contains no engine or equation code', () => {
  const src = readFileSync(new URL('./adapters.ts', import.meta.url), 'utf8');
  assert.equal(/Math\.(sqrt|hypot|PI)|new Engine|Engine\(/.test(src), false);
});
