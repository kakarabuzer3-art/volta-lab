// -----------------------------------------------------------------------------
// Catalogue integrity validation. Pure functions: no simulator, no UI, no three.js, no side effects.
//
// `validateCatalogue` returns EVERY problem it can find, each naming the record and the field, so a bad entry is easy to fix.
// An empty result means the catalogue is internally consistent. It does not mean the facts are correct: that is what evidence and
// review records describe. The registry refuses to be created from a catalogue that has any issue.
// -----------------------------------------------------------------------------
import type {
  CatalogueData, ComponentDefinition, ManufacturerPart, PhysicalModelDefinition, SchematicSymbol, SpecificationDefinition, SpecificationValue, TechnicalFormula,
} from './types.ts';
import { aliasCollisions, aliasKeys, buildAliasIndex } from './alias.ts';
import { checkEvidence } from './provenance.ts';
import { COMPONENT_KINDS, COMPONENT_ROLES, CONNECTION_TYPES, KIND_CATEGORY_RULES, TERMINAL_POLARITIES, TERMINAL_ROLES } from './taxonomy.ts';
import { DIMENSIONS, checkConditions, checkQuantity, checkRange, findUnit, isNonNegativeDimension } from './units.ts';

export interface ValidationIssue {
  /** Stable machine-readable code, for example 'duplicate-id'. */
  readonly code: string;
  /** The record, for example 'definition:def.resistor'. */
  readonly record: string;
  /** The field inside the record, for example 'terminals[1].id'. */
  readonly field: string;
  readonly message: string;
}
export interface ValidationOptions {
  /** Ids of the simulation adapters that exist. A 'simulatable' definition must name one of them. */
  readonly adapterIds: readonly string[];
}
export const formatIssue = (i: ValidationIssue): string => `[${i.code}] ${i.record} · ${i.field}: ${i.message}`;

const ID_PATTERN: Readonly<Record<'cat' | 'fam' | 'def' | 'part', RegExp>> = {
  cat: /^cat\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
  fam: /^fam\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
  def: /^def\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
  part: /^part\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
};
const TERMINAL_ID = /^[a-z0-9][a-z0-9_-]*$/;
const SPEC_KEY = /^[a-z][A-Za-z0-9]*$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VIEWBOX = /^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/;
const blank = (s: unknown): boolean => typeof s !== 'string' || s.trim() === '';
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateCatalogue(data: CatalogueData, options: ValidationOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, record: string, field: string, message: string): void => { issues.push({ code, record, field, message }); };
  const adapterIds = new Set(options.adapterIds);

  // ---- ids: format and uniqueness within each collection
  function checkIds(prefix: keyof typeof ID_PATTERN, label: string, records: readonly { id: string }[]): Set<string> {
    const seen = new Set<string>();
    for (const r of records) {
      const rec = `${label}:${String(r.id)}`;
      if (typeof r.id !== 'string' || !ID_PATTERN[prefix].test(r.id)) add('invalid-id', rec, 'id', `id must look like '${prefix}.some-name' (lower-case letters, digits, hyphens)`);
      if (seen.has(r.id)) add('duplicate-id', rec, 'id', `another ${label} already uses this id`);
      seen.add(r.id);
    }
    return seen;
  }
  const categoryIds = checkIds('cat', 'category', data.categories);
  const familyIds = checkIds('fam', 'family', data.families);
  const definitionIds = checkIds('def', 'definition', data.definitions);
  checkIds('part', 'part', data.parts);

  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const familyById = new Map(data.families.map((f) => [f.id, f]));
  const definitionById = new Map(data.definitions.map((d) => [d.id, d]));

  // ---- categories and families
  for (const c of data.categories) {
    const rec = `category:${c.id}`;
    if (blank(c.name)) add('missing-metadata', rec, 'name', 'name is required');
    if (blank(c.summary)) add('missing-metadata', rec, 'summary', 'summary is required');
  }
  for (const f of data.families) {
    const rec = `family:${f.id}`;
    if (blank(f.name)) add('missing-metadata', rec, 'name', 'name is required');
    if (blank(f.summary)) add('missing-metadata', rec, 'summary', 'summary is required');
    if (!categoryIds.has(f.categoryId)) add('missing-reference', rec, 'categoryId', `category '${String(f.categoryId)}' does not exist`);
  }

  // ---- reusable record checks
  function evidence(rec: string, field: string, e: Parameters<typeof checkEvidence>[0] | undefined): void {
    if (!e) { add('missing-evidence', rec, field, 'an evidence record is required'); return; }
    for (const m of checkEvidence(e)) add('invalid-evidence', rec, field, m);
  }
  function specDefinitions(rec: string, specs: readonly SpecificationDefinition[]): void {
    const seen = new Set<string>();
    specs.forEach((s, i) => {
      const f = `specifications[${i}]`;
      if (!SPEC_KEY.test(String(s.key))) add('invalid-spec', rec, `${f}.key`, `key '${String(s.key)}' must be camelCase starting with a lower-case letter`);
      if (seen.has(s.key)) add('invalid-spec', rec, `${f}.key`, `duplicate specification key '${s.key}'`);
      seen.add(s.key);
      if (blank(s.label)) add('missing-metadata', rec, `${f}.label`, 'label is required');
      if (blank(s.plain)) add('missing-metadata', rec, `${f}.plain`, 'a plain-language explanation is required');
      if (s.usage !== 'simulation-input' && s.usage !== 'characteristic') add('invalid-spec', rec, `${f}.usage`, "usage must be 'simulation-input' or 'characteristic'");
      if (s.valueType === 'quantity' || s.valueType === 'range') {
        if (!s.dimension || !DIMENSIONS.includes(s.dimension)) add('invalid-spec', rec, `${f}.dimension`, `a ${s.valueType} specification needs a known dimension`);
        else {
          for (const u of s.displayUnits ?? []) if (!findUnit(u, s.dimension)) add('invalid-spec', rec, `${f}.displayUnits`, `'${u}' is not a ${s.dimension} unit`);
          if (s.limits) {
            if (!finite(s.limits.minSi) || !finite(s.limits.maxSi) || s.limits.minSi > s.limits.maxSi) add('invalid-spec', rec, `${f}.limits`, 'limits must be finite with minSi ≤ maxSi');
            else if (isNonNegativeDimension(s.dimension) && s.limits.minSi < 0) add('invalid-spec', rec, `${f}.limits`, `a ${s.dimension} limit cannot be negative`);
          }
        }
      } else if (s.valueType === 'enum') {
        if (!s.options || s.options.length < 2 || new Set(s.options).size !== s.options.length || s.options.some(blank)) add('invalid-spec', rec, `${f}.options`, 'an enum needs at least two distinct, non-blank options');
      } else if (s.valueType === 'text' || s.valueType === 'boolean') {
        if (s.dimension !== undefined) add('invalid-spec', rec, `${f}.dimension`, `a ${s.valueType} specification has no dimension`);
      } else add('invalid-spec', rec, `${f}.valueType`, `valueType '${String(s.valueType)}' is not valid`);
    });
  }
  function specValue(rec: string, i: number, v: SpecificationValue, defs: ReadonlyMap<string, SpecificationDefinition>): void {
    const f = `specs[${i}]`;
    const def = defs.get(v.key);
    if (!def) { add('invalid-spec-value', rec, `${f}.key`, `'${String(v.key)}' is not a specification of the definition`); }
    evidence(rec, `${f}.evidence`, v.evidence);
    if (v.evidence?.origin === 'illustrative-educational') add('invalid-spec-value', rec, `${f}.evidence`, 'a manufacturer part cannot carry illustrative values');
    if (v.conditions) for (const m of checkConditions(v.conditions)) add('invalid-spec-value', rec, `${f}.conditions`, m);
    const val = v.value;
    if (def && val.type !== def.valueType) add('invalid-spec-value', rec, `${f}.value`, `value type '${val.type}' does not match the specification's '${def.valueType}'`);
    const within = (x: number | undefined, name: string): void => {
      if (def?.limits && finite(x) && (x < def.limits.minSi || x > def.limits.maxSi)) add('invalid-spec-value', rec, `${f}.value`, `${name} ${x} is outside the allowed ${def.limits.minSi} to ${def.limits.maxSi}`);
    };
    switch (val.type) {
      case 'quantity':
        for (const m of checkQuantity(val.quantity, def?.dimension)) add('invalid-quantity', rec, `${f}.value`, m);
        within(val.quantity.si, 'value');
        break;
      case 'range':
        for (const m of checkRange(val.range, def?.dimension)) add('invalid-quantity', rec, `${f}.value`, m);
        within(val.range.min, 'min'); within(val.range.typical, 'typical'); within(val.range.nominal, 'nominal'); within(val.range.max, 'max');
        break;
      case 'text': if (blank(val.text)) add('invalid-spec-value', rec, `${f}.value`, 'text must not be blank'); break;
      case 'enum': if (def?.options && !def.options.includes(val.value)) add('invalid-spec-value', rec, `${f}.value`, `'${val.value}' is not one of the allowed options`); break;
      case 'boolean': if (typeof val.value !== 'boolean') add('invalid-spec-value', rec, `${f}.value`, 'must be true or false'); break;
      default: add('invalid-spec-value', rec, `${f}.value`, 'unknown value type');
    }
  }
  function symbol(rec: string, s: SchematicSymbol): void {
    if (blank(s.id)) add('invalid-symbol', rec, 'symbol.id', 'id is required');
    if (!['iec-style', 'ansi-style', 'generic'].includes(s.convention)) add('invalid-symbol', rec, 'symbol.convention', `convention '${String(s.convention)}' is not valid`);
    if (!VIEWBOX.test(String(s.viewBox))) add('invalid-symbol', rec, 'symbol.viewBox', "viewBox must be four numbers, for example '0 0 64 24'");
    if (blank(s.markup)) add('invalid-symbol', rec, 'symbol.markup', 'markup is required');
    if (s.origin !== 'original-artwork' && s.origin !== 'third-party') add('invalid-symbol', rec, 'symbol.origin', "origin must be 'original-artwork' or 'third-party'");
    if (s.origin === 'third-party' && blank(s.licence)) add('invalid-symbol', rec, 'symbol.licence', 'third-party artwork needs its licence recorded');
  }
  function physical(rec: string, p: PhysicalModelDefinition, owner: 'definition' | 'part'): void {
    if (blank(p.id)) add('invalid-physical', rec, 'physical.id', 'id is required');
    if (p.basis !== 'representative-educational' && p.basis !== 'manufacturer-geometry') add('invalid-physical', rec, 'physical.basis', `basis '${String(p.basis)}' is not valid`);
    if (owner === 'definition' && p.basis === 'manufacturer-geometry') add('invalid-physical', rec, 'physical.basis', 'a generic definition can only have a representative educational model; exact geometry belongs to a manufacturer part');
    if (p.basis === 'representative-educational' && p.dimensions) add('invalid-physical', rec, 'physical.dimensions', 'a representative model must not carry dimensions: sizes are never derived from electrical values');
    if (p.representation !== 'parametric' && p.representation !== 'asset') add('invalid-physical', rec, 'physical.representation', "representation must be 'parametric' or 'asset'");
    if (p.representation === 'asset') {
      if (blank(p.assetUrl)) add('invalid-physical', rec, 'physical.assetUrl', 'an asset model needs assetUrl');
      if (blank(p.assetLicence)) add('invalid-physical', rec, 'physical.assetLicence', 'an asset model needs its licence recorded');
    } else if (p.assetUrl !== undefined) add('invalid-physical', rec, 'physical.assetUrl', 'a parametric model has no asset');
    if (p.polarityMarking !== undefined && !['band', 'plus-sign', 'notch', 'dot', 'none'].includes(p.polarityMarking)) add('invalid-physical', rec, 'physical.polarityMarking', `'${String(p.polarityMarking)}' is not valid`);
    evidence(rec, 'physical.evidence', p.evidence);
    if (p.basis === 'manufacturer-geometry' && p.evidence?.origin !== 'manufacturer-datasheet') add('invalid-physical', rec, 'physical.evidence', 'manufacturer geometry needs manufacturer-datasheet evidence');
    if (p.dimensions) {
      const d = p.dimensions;
      for (const k of ['length', 'width', 'height', 'diameter', 'leadPitch'] as const) {
        const q = d[k];
        if (q) for (const m of checkQuantity(q, 'length')) add('invalid-quantity', rec, `physical.dimensions.${k}`, m);
      }
      evidence(rec, 'physical.dimensions.evidence', d.evidence);
      if (d.evidence && d.evidence.origin !== 'manufacturer-datasheet') add('invalid-physical', rec, 'physical.dimensions.evidence', 'dimensions must come from manufacturer documentation');
    }
  }
  function formulas(rec: string, list: readonly TechnicalFormula[]): void {
    const seen = new Set<string>();
    list.forEach((fm, i) => {
      const f = `formulas[${i}]`;
      if (!KEBAB.test(String(fm.id))) add('invalid-formula', rec, `${f}.id`, 'id must be kebab-case');
      if (seen.has(fm.id)) add('invalid-formula', rec, `${f}.id`, `duplicate formula id '${fm.id}'`);
      seen.add(fm.id);
      if (blank(fm.label)) add('missing-metadata', rec, `${f}.label`, 'label is required');
      if (blank(fm.expression)) add('missing-metadata', rec, `${f}.expression`, 'expression is required');
      if (fm.variables.length === 0) add('invalid-formula', rec, `${f}.variables`, 'name the variables used');
      const syms = new Set<string>();
      fm.variables.forEach((v, k) => {
        if (blank(v.symbol) || blank(v.meaning)) add('invalid-formula', rec, `${f}.variables[${k}]`, 'symbol and meaning are required');
        if (syms.has(v.symbol)) add('invalid-formula', rec, `${f}.variables[${k}].symbol`, `duplicate symbol '${v.symbol}'`);
        syms.add(v.symbol);
        if (v.dimension !== undefined && !DIMENSIONS.includes(v.dimension)) add('invalid-formula', rec, `${f}.variables[${k}].dimension`, 'unknown dimension');
      });
      if (fm.audience !== 'beginner' && fm.audience !== 'advanced') add('invalid-formula', rec, `${f}.audience`, "audience must be 'beginner' or 'advanced'");
      evidence(rec, `${f}.evidence`, fm.evidence);
    });
  }

  // ---- definitions
  const aliasIndex = buildAliasIndex(data.definitions);
  const collisions = aliasCollisions(aliasIndex);
  for (const d of data.definitions) {
    const rec = `definition:${d.id}`;
    if (blank(d.name)) add('missing-metadata', rec, 'name', 'name is required');
    if (blank(d.beginnerSummary)) add('missing-metadata', rec, 'beginnerSummary', 'a beginner summary is required');
    if (blank(d.electricalPurpose)) add('missing-metadata', rec, 'electricalPurpose', 'the electrical purpose is required');

    if (!COMPONENT_KINDS.includes(d.kind)) add('invalid-kind', rec, 'kind', `kind '${String(d.kind)}' is not valid`);
    const family = familyById.get(d.familyId);
    if (!family) add('missing-reference', rec, 'familyId', `family '${String(d.familyId)}' does not exist`);
    if (!categoryById.has(d.categoryId)) add('missing-reference', rec, 'categoryId', `category '${String(d.categoryId)}' does not exist`);
    if (family && family.categoryId !== d.categoryId) add('family-category-mismatch', rec, 'categoryId', `family '${family.id}' belongs to '${family.categoryId}', not '${d.categoryId}'`);
    if (COMPONENT_KINDS.includes(d.kind) && categoryById.has(d.categoryId) && !KIND_CATEGORY_RULES[d.kind].includes(d.categoryId)) {
      add('kind-category-mismatch', rec, 'categoryId', `a ${d.kind} cannot be filed under '${d.categoryId}' (allowed: ${KIND_CATEGORY_RULES[d.kind].join(', ')})`);
    }

    // aliases, roles, tags
    const own = new Set<string>();
    for (const k of aliasKeys({ name: d.name, aliases: [] })) own.add(k);
    d.aliases.forEach((a, i) => {
      const k = a.normalize('NFKC').trim();
      if (k === '') { add('blank-alias', rec, `aliases[${i}]`, 'alias must not be blank'); return; }
      const key = aliasKeys({ name: a, aliases: [] })[0];
      if (key === undefined) { add('blank-alias', rec, `aliases[${i}]`, 'alias has no searchable characters'); return; }
      if (own.has(key)) add('duplicate-alias', rec, `aliases[${i}]`, `'${a}' repeats the name or another alias of this definition`);
      own.add(key);
    });
    const roleSeen = new Set<string>();
    d.roles.forEach((r, i) => {
      if (!COMPONENT_ROLES.includes(r)) add('invalid-role', rec, `roles[${i}]`, `role '${String(r)}' is not in the vocabulary`);
      if (roleSeen.has(r)) add('invalid-role', rec, `roles[${i}]`, `duplicate role '${r}'`);
      roleSeen.add(r);
    });
    const tagSeen = new Set<string>();
    d.tags.forEach((t, i) => {
      if (!KEBAB.test(String(t))) add('invalid-tag', rec, `tags[${i}]`, `tag '${String(t)}' must be kebab-case`);
      if (tagSeen.has(t)) add('invalid-tag', rec, `tags[${i}]`, `duplicate tag '${t}'`);
      tagSeen.add(t);
    });

    // terminals: description only
    const termSeen = new Set<string>();
    d.terminals.forEach((t, i) => {
      const f = `terminals[${i}]`;
      if (!TERMINAL_ID.test(String(t.id))) add('invalid-terminal', rec, `${f}.id`, `terminal id '${String(t.id)}' must be lower-case letters, digits, '-' or '_'`);
      if (termSeen.has(t.id)) add('duplicate-terminal', rec, `${f}.id`, `terminal id '${t.id}' is used twice`);
      termSeen.add(t.id);
      if (blank(t.name)) add('missing-metadata', rec, `${f}.name`, 'terminal name is required');
      if (!TERMINAL_ROLES.includes(t.role)) add('invalid-terminal', rec, `${f}.role`, `role '${String(t.role)}' is not valid`);
      if (!CONNECTION_TYPES.includes(t.connectionType)) add('invalid-terminal', rec, `${f}.connectionType`, `connection type '${String(t.connectionType)}' is not valid`);
      if (!TERMINAL_POLARITIES.includes(t.polarity)) add('invalid-terminal', rec, `${f}.polarity`, `polarity '${String(t.polarity)}' is not valid`);
      if (t.anchor && (!finite(t.anchor.x) || !finite(t.anchor.y) || t.anchor.x < 0 || t.anchor.x > 1 || t.anchor.y < 0 || t.anchor.y > 1)) add('invalid-terminal', rec, `${f}.anchor`, 'anchor x and y must be between 0 and 1');
    });
    if (d.terminals.length === 0) add('missing-metadata', rec, 'terminals', 'at least one terminal is required');

    specDefinitions(rec, d.specifications);
    if (d.formulas) formulas(rec, d.formulas);
    if (d.symbol) symbol(rec, d.symbol);
    if (d.physical) physical(rec, d.physical, 'definition');

    // assemblies
    if (d.kind === 'assembly') {
      if (!d.assemblyOf || d.assemblyOf.length === 0) add('invalid-assembly', rec, 'assemblyOf', 'an assembly must list the definitions it is made of');
      (d.assemblyOf ?? []).forEach((m, i) => {
        const f = `assemblyOf[${i}]`;
        const target = definitionById.get(m.definitionId);
        if (!target) add('missing-reference', rec, `${f}.definitionId`, `definition '${String(m.definitionId)}' does not exist`);
        else if (target.id === d.id) add('invalid-assembly', rec, `${f}.definitionId`, 'an assembly cannot contain itself');
        else if (target.kind === 'assembly') add('invalid-assembly', rec, `${f}.definitionId`, 'nested assemblies are not supported yet');
        if (blank(m.label)) add('missing-metadata', rec, `${f}.label`, 'label is required');
      });
    } else if (d.assemblyOf !== undefined) add('invalid-assembly', rec, 'assemblyOf', `only an assembly has members (this is a ${String(d.kind)})`);

    // simulation
    const sim = d.simulation as { status?: string; adapterId?: unknown; port?: unknown; limitations?: unknown };
    if (!sim || !['simulatable', 'reference-only', 'planned'].includes(String(sim.status))) add('invalid-simulation', rec, 'simulation.status', `status '${String(sim?.status)}' is not valid`);
    else {
      if (!Array.isArray(sim.limitations) || sim.limitations.length === 0 || sim.limitations.some(blank)) add('invalid-simulation', rec, 'simulation.limitations', 'state at least one non-blank limitation');
      if (sim.status === 'simulatable') {
        if (typeof sim.adapterId !== 'string' || !adapterIds.has(sim.adapterId)) add('invalid-adapter', rec, 'simulation.adapterId', `adapter '${String(sim.adapterId)}' does not exist`);
        if (sim.port !== 'one-port-load') add('invalid-simulation', rec, 'simulation.port', "the only simulatable port is 'one-port-load'");
      } else if (sim.adapterId !== undefined || sim.port !== undefined) add('invalid-simulation', rec, 'simulation', `a ${sim.status} definition must not name an adapter or port`);
    }

    // evidence for this record's own content
    evidence(rec, 'evidence', d.evidence);
    if (d.evidence?.origin === 'manufacturer-datasheet') add('generic-with-manufacturer-evidence', rec, 'evidence.origin', 'a generic definition cannot claim manufacturer-datasheet evidence; describe exact products as ManufacturerPart records');
  }

  // ---- alias collisions between different definitions
  for (const c of collisions) {
    for (const id of c.definitionIds) add('alias-collision', `definition:${id}`, 'aliases', `'${c.key}' is also used by ${c.definitionIds.filter((x) => x !== id).join(', ')}`);
  }

  // ---- manufacturer parts
  for (const p of data.parts as readonly ManufacturerPart[]) {
    const rec = `part:${p.id}`;
    const def = definitionById.get(p.definitionId);
    if (!def) add('missing-reference', rec, 'definitionId', `definition '${String(p.definitionId)}' does not exist`);
    if (blank(p.manufacturer)) add('missing-metadata', rec, 'manufacturer', 'manufacturer is required');
    if (blank(p.partNumber)) add('missing-metadata', rec, 'partNumber', 'part number is required');
    evidence(rec, 'evidence', p.evidence);
    if (p.evidence && p.evidence.origin !== 'manufacturer-datasheet') add('invalid-evidence', rec, 'evidence.origin', 'a manufacturer part needs manufacturer-datasheet evidence with a source reference');
    if (p.physical) physical(rec, p.physical, 'part');
    const defs = new Map((def?.specifications ?? []).map((s) => [s.key, s]));
    const seen = new Set<string>();
    p.specs.forEach((v, i) => {
      if (seen.has(v.key)) add('invalid-spec-value', rec, `specs[${i}].key`, `specification '${v.key}' is given twice`);
      seen.add(v.key);
      specValue(rec, i, v, defs);
    });
  }

  return issues;
}
