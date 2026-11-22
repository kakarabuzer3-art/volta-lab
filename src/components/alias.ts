// -----------------------------------------------------------------------------
// Alias normalisation, indexing and lookup. Kept separate from the registry so that validation can detect collisions without a cyclic import
// (validate.ts and registry.ts both depend on this file; this file depends on neither).
//
// An item is found by its name or any alias. Normalisation is one fixed rule applied to both the stored text and the search text, so a
// lookup can never succeed or fail because of letter case, spacing, hyphens or the two different micro characters.
// A text that matches several different definitions is reported as AMBIGUOUS with every candidate; it never silently picks one.
// -----------------------------------------------------------------------------
import type { ComponentDefinition } from './types.ts';

/** NFKC, lower-case, hyphens/underscores/dots/whitespace collapsed to single spaces, trimmed. Returns '' when nothing searchable remains. */
export function normaliseAlias(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\-_.]+/g, ' ').trim();
}

/** Every searchable key of a definition: its name plus its aliases, normalised, in order, blanks removed. */
export function aliasKeys(def: Pick<ComponentDefinition, 'name' | 'aliases'>): string[] {
  return [def.name, ...def.aliases].map(normaliseAlias).filter((k) => k !== '');
}

export type AliasIndex = ReadonlyMap<string, readonly string[]>;
export interface AliasCollision { readonly key: string; readonly definitionIds: readonly string[] }

/** key → the distinct definition ids that own it. A definition repeating its own key counts once. */
export function buildAliasIndex(definitions: readonly Pick<ComponentDefinition, 'id' | 'name' | 'aliases'>[]): AliasIndex {
  const m = new Map<string, string[]>();
  for (const d of definitions) for (const k of new Set(aliasKeys(d))) { const ids = m.get(k) ?? []; if (!ids.includes(d.id)) ids.push(d.id); m.set(k, ids); }
  return m;
}

export function aliasCollisions(index: AliasIndex): AliasCollision[] {
  return [...index].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, definitionIds: [...ids].sort() })).sort((a, b) => a.key.localeCompare(b.key));
}

export type AliasLookup =
  | { readonly status: 'found'; readonly definitionId: string }
  | { readonly status: 'ambiguous'; readonly candidates: readonly string[] }
  | { readonly status: 'none' };

export function lookupAlias(index: AliasIndex, text: string): AliasLookup {
  const key = normaliseAlias(text);
  const ids = key === '' ? undefined : index.get(key);
  if (!ids || ids.length === 0) return { status: 'none' };
  return ids.length === 1 ? { status: 'found', definitionId: ids[0] } : { status: 'ambiguous', candidates: [...ids].sort() };
}
