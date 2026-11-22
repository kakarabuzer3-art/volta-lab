// -----------------------------------------------------------------------------
// LegacyLoadAdapter: the ONE place where the component library touches the simulator, and only to read and delegate.
//
//  - It DESCRIBES the five existing Load Lab models (src/sim/loadlab.ts LOAD_CATALOGUE) as catalogue definitions, reading their summary,
//    role, limits, input fields and units from LOAD_CATALOGUE itself, so nothing is retyped here.
//  - It WRAPS them: `build()` calls the existing `buildLoad()` (validation, unit conversion, the existing load factories). It contains no
//    equation, no second physics implementation and no new validation. The ConnectionCoordinator and the engine are not touched.
//
// A catalogue definition is simulatable ONLY through an adapter that exists, and today the only port is 'one-port-load': a load connected
// across the machine output. Having a definition never makes a part simulatable.
//
// Simulation input origin (`DataSource`: 'user-specified' | 'illustrative-fixture') belongs to the simulator and is passed through
// untouched. It is unrelated to catalogue evidence (see provenance.ts).
// -----------------------------------------------------------------------------
import { LOAD_CATALOGUE, buildLoad, loadTypeSpec } from '../sim/loadlab.ts';
import type { BuildResult, FieldSpec, LoadTypeId, LoadTypeSpec, RawForm } from '../sim/loadlab.ts';
import type { DataSource } from '../sim/loads.ts';
import type { CatalogueData, ComponentDefinition, SimulationAdapterDescription, SpecificationDefinition } from './types.ts';
import { illustrativeEvidence } from './provenance.ts';
import { normaliseAlias } from './alias.ts';
import { CATEGORIES } from './taxonomy.ts';
import { findUnit } from './units.ts';
import { createRegistry } from './registry.ts';
import type { Registry } from './registry.ts';
import { FAMILIES } from './data/families.ts';
import { LEGACY_LOAD_META } from './data/legacy-load-meta.ts';
import type { LegacyLoadMeta } from './data/legacy-load-meta.ts';

export const LEGACY_ADAPTER_PREFIX = 'legacy-load:';
export const legacyAdapterId = (id: LoadTypeId): string => `${LEGACY_ADAPTER_PREFIX}${id}`;

const ONE_PORT_NOTE = 'Modelled only as a one-port load connected across the machine output; it cannot be placed in a circuit.';

function specificationOf(f: FieldSpec): SpecificationDefinition {
  // The dimension comes from the unit the Load Lab itself offers, resolved through the component unit table (never guessed from a number).
  const unit = findUnit(f.units[0].label);
  if (!unit) throw new RangeError(`Load Lab field '${f.key}' uses unit '${f.units[0].label}', which the component unit table does not define`);
  return {
    key: f.key, label: f.label, symbol: f.symbol, plain: f.help, term: f.term,
    usage: 'simulation-input', valueType: 'quantity', dimension: unit.dimension,
    displayUnits: f.units.map((u) => u.label), limits: { minSi: f.min, maxSi: f.max },
    ...(f.optional ? { optional: true } : {}),
  };
}

function definitionOf(meta: LegacyLoadMeta, spec: LoadTypeSpec): ComponentDefinition {
  // The Load Lab's own display name stays searchable when the catalogue name differs (for example 'Capacitor (in series)').
  const seen = new Set<string>([normaliseAlias(meta.name)]);
  const aliases: string[] = [];
  for (const a of [spec.name, ...meta.aliases]) { const k = normaliseAlias(a); if (k !== '' && !seen.has(k)) { seen.add(k); aliases.push(a); } }
  return {
    id: meta.definitionId, kind: meta.kind, categoryId: meta.categoryId, familyId: meta.familyId, name: meta.name,
    aliases, roles: meta.roles, tags: meta.tags,
    beginnerSummary: spec.summary, electricalPurpose: spec.role, applications: meta.applications,
    terminals: meta.terminals, specifications: [...spec.params].map(specificationOf), formulas: meta.formulas,
    ...(meta.assemblyOf ? { assemblyOf: meta.assemblyOf } : {}),
    simulation: { status: 'simulatable', adapterId: legacyAdapterId(spec.id), port: 'one-port-load', limitations: [spec.limitation, `Supported input: ${spec.inputSupport}.`, ONE_PORT_NOTE] },
    evidence: illustrativeEvidence('Educational description taken from the Load Lab V1 catalogue; written for Volta Lab and not yet reviewed against a cited source.'),
  };
}

export class LegacyLoadAdapter {
  /** What the catalogue may know about each adapter. */
  readonly descriptions: readonly SimulationAdapterDescription[];

  constructor() {
    this.assertCataloguesAgree();
    this.descriptions = Object.freeze(LOAD_CATALOGUE.map((s): SimulationAdapterDescription => ({
      id: legacyAdapterId(s.id), port: 'one-port-load', summary: `Existing Load Lab model '${s.name}', built by the simulator's own load factory.`,
    })));
  }

  /** Fails loudly if the Load Lab gains or loses a model without the catalogue metadata following, instead of drifting silently. */
  private assertCataloguesAgree(): void {
    const sim = LOAD_CATALOGUE.map((l) => l.id).sort().join(',');
    const meta = LEGACY_LOAD_META.map((m) => m.loadId).sort().join(',');
    if (sim !== meta) throw new RangeError(`Load Lab models (${sim}) and catalogue metadata (${meta}) must list the same ids`);
  }

  has(adapterId: string): boolean { return this.loadTypeFor(adapterId) !== undefined; }

  loadTypeFor(adapterId: string): LoadTypeId | undefined {
    if (!adapterId.startsWith(LEGACY_ADAPTER_PREFIX)) return undefined;
    const id = adapterId.slice(LEGACY_ADAPTER_PREFIX.length);
    return LOAD_CATALOGUE.find((l) => l.id === id)?.id;
  }

  /** The catalogue definitions describing the five Load Lab models. */
  definitions(): ComponentDefinition[] {
    return LEGACY_LOAD_META.map((m) => definitionOf(m, loadTypeSpec(m.loadId)));
  }

  /**
   * Build an engine Load from typed form values through the EXISTING `buildLoad` (validation, unit conversion and load factories live
   * there). `source` is the simulator's own DataSource and defaults exactly as `buildLoad` does. An unknown adapter id is an error.
   */
  build(adapterId: string, form: RawForm, source?: DataSource): BuildResult {
    const id = this.loadTypeFor(adapterId);
    if (id === undefined) throw new RangeError(`Unknown simulation adapter '${adapterId}'`);
    return source === undefined ? buildLoad(id, form) : buildLoad(id, form, source);
  }
}

export const legacyLoadAdapter = new LegacyLoadAdapter();

/** The catalogue containing ONLY the five existing Load Lab models (no manufacturer parts). */
export function legacyCatalogueData(adapter: LegacyLoadAdapter = legacyLoadAdapter): CatalogueData {
  return { categories: CATEGORIES, families: FAMILIES, definitions: adapter.definitions(), parts: [] };
}

export function createLegacyRegistry(adapter: LegacyLoadAdapter = legacyLoadAdapter): Registry {
  return createRegistry(legacyCatalogueData(adapter), { adapterIds: adapter.descriptions.map((d) => d.id) });
}
