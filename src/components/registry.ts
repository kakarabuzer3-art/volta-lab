// -----------------------------------------------------------------------------
// The component registry: a small, deterministic, read-only lookup over a validated catalogue.
//
// `createRegistry` runs the full integrity validation first and REFUSES to build from a catalogue that has any problem (it throws a
// CatalogueError listing every issue), so a registry can never hold a duplicate id, a dangling reference or an ambiguous alias.
// Lookups return `undefined` for an unknown id; alias lookup returns a tagged result and never silently picks one of several matches.
// Lists keep the order of the source data, so results are stable. No imports from the simulator, the UI or three.js.
// -----------------------------------------------------------------------------
import type { CatalogueData, ComponentCategory, ComponentDefinition, ComponentFamily, ManufacturerPart } from './types.ts';
import { buildAliasIndex, lookupAlias } from './alias.ts';
import type { AliasLookup } from './alias.ts';
import { formatIssue, validateCatalogue } from './validate.ts';
import type { ValidationIssue, ValidationOptions } from './validate.ts';

export class CatalogueError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[]) {
    const shown = issues.slice(0, 10).map(formatIssue).join('\n');
    super(`The component catalogue has ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n${shown}${issues.length > 10 ? `\n… and ${issues.length - 10} more` : ''}`);
    this.name = 'CatalogueError';
    this.issues = issues;
  }
}

export interface Registry {
  readonly categories: readonly ComponentCategory[];
  readonly families: readonly ComponentFamily[];
  readonly definitions: readonly ComponentDefinition[];
  readonly parts: readonly ManufacturerPart[];
  category(id: string): ComponentCategory | undefined;
  family(id: string): ComponentFamily | undefined;
  definition(id: string): ComponentDefinition | undefined;
  part(id: string): ManufacturerPart | undefined;
  familiesInCategory(categoryId: string): readonly ComponentFamily[];
  definitionsInCategory(categoryId: string): readonly ComponentDefinition[];
  definitionsInFamily(familyId: string): readonly ComponentDefinition[];
  partsOfDefinition(definitionId: string): readonly ManufacturerPart[];
  /** Find a definition by its name or any alias (case, spacing, hyphens and the two micro characters never matter). */
  findByAlias(text: string): AliasLookup;
}

const group = <T>(items: readonly T[], key: (item: T) => string): ReadonlyMap<string, readonly T[]> => {
  const m = new Map<string, T[]>();
  for (const it of items) { const k = key(it); const list = m.get(k) ?? []; list.push(it); m.set(k, list); }
  return m;
};
const EMPTY: readonly never[] = Object.freeze([]);

export function createRegistry(data: CatalogueData, options: ValidationOptions): Registry {
  const issues = validateCatalogue(data, options);
  if (issues.length > 0) throw new CatalogueError(issues);

  const categories = Object.freeze([...data.categories]);
  const families = Object.freeze([...data.families]);
  const definitions = Object.freeze([...data.definitions]);
  const parts = Object.freeze([...data.parts]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const familyById = new Map(families.map((f) => [f.id, f]));
  const definitionById = new Map(definitions.map((d) => [d.id, d]));
  const partById = new Map(parts.map((p) => [p.id, p]));
  const familiesByCategory = group(families, (f) => f.categoryId);
  const definitionsByCategory = group(definitions, (d) => d.categoryId);
  const definitionsByFamily = group(definitions, (d) => d.familyId);
  const partsByDefinition = group(parts, (p) => p.definitionId);
  const aliasIndex = buildAliasIndex(definitions);

  return {
    categories, families, definitions, parts,
    category: (id) => categoryById.get(id),
    family: (id) => familyById.get(id),
    definition: (id) => definitionById.get(id),
    part: (id) => partById.get(id),
    familiesInCategory: (id) => familiesByCategory.get(id) ?? EMPTY,
    definitionsInCategory: (id) => definitionsByCategory.get(id) ?? EMPTY,
    definitionsInFamily: (id) => definitionsByFamily.get(id) ?? EMPTY,
    partsOfDefinition: (id) => partsByDefinition.get(id) ?? EMPTY,
    findByAlias: (text) => lookupAlias(aliasIndex, text),
  };
}
