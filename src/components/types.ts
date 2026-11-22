// -----------------------------------------------------------------------------
// The component library's data architecture, in one place. Type declarations only: no runtime code, and no dependency on the simulator,
// the machine UI or three.js. Quantities, provenance and vocabulary types are defined next to their helpers and re-exported here, so
// importing from this file gives the complete picture.
//
// Hierarchy:   ComponentCategory  →  ComponentFamily  →  ComponentDefinition (generic)  →  ManufacturerPart (one exact product)
// A definition describes a KIND of part (for example "Resistor"). It is never one exact product: exact products are ManufacturerPart
// records with their own traceable evidence. Nothing is simulatable merely because a definition exists (see SimulationCapability).
// -----------------------------------------------------------------------------
import type { Dimension, OperatingConditions, Quantity, QuantityRange, Tolerance } from './units.ts';
import type { EvidenceOrigin, EvidenceRecord, ReviewRecord, SourceKind, SourceRef, VerificationStatus } from './provenance.ts';
import type { CategoryRecord, ComponentKind, ComponentRole, ElectricalConnectionType, TerminalPolarity, TerminalRole } from './taxonomy.ts';

export type { Dimension, OperatingConditions, Quantity, QuantityRange, Tolerance };
export type { EvidenceOrigin, EvidenceRecord, ReviewRecord, SourceKind, SourceRef, VerificationStatus };
export type { ComponentKind, ComponentRole, ElectricalConnectionType, TerminalPolarity, TerminalRole };

// ------------------------------------------------------------------ taxonomy records

/** The canonical category record is defined once, in taxonomy.ts (which also lists the planned categories). */
export type ComponentCategory = CategoryRecord;

export interface ComponentFamily {
  readonly id: string;
  /** The ONE canonical category this family belongs to. */
  readonly categoryId: string;
  readonly name: string;
  readonly summary: string;
}

// ------------------------------------------------------------------ terminals (descriptions only; no connections, nets or pins exist yet)

export interface TerminalDefinition {
  /** Unique within its definition. */
  readonly id: string;
  readonly name: string;
  readonly role: TerminalRole;
  readonly connectionType: ElectricalConnectionType;
  readonly polarity: TerminalPolarity;
  /** Position on the schematic symbol, in symbol space (0 to 1 on each axis). Optional until a symbol exists. */
  readonly anchor?: { readonly x: number; readonly y: number };
}

// ------------------------------------------------------------------ schematic symbol (type only; no artwork exists yet)

export interface SchematicSymbol {
  readonly id: string;
  readonly convention: 'iec-style' | 'ansi-style' | 'generic';
  readonly viewBox: string;
  /** Inner SVG markup. Always presented as schematic notation, never as a picture of the physical part. */
  readonly markup: string;
  /** Third-party artwork must not be used without checking its licence; 'third-party' therefore requires `licence`. */
  readonly origin: 'original-artwork' | 'third-party';
  readonly licence?: string;
}

// ------------------------------------------------------------------ physical model (type only; no 3D model exists yet)

export interface PhysicalDimensions {
  readonly length?: Quantity;
  readonly width?: Quantity;
  readonly height?: Quantity;
  readonly diameter?: Quantity;
  readonly leadPitch?: Quantity;
  readonly packageCode?: string;
  readonly evidence: EvidenceRecord;
}

export interface PhysicalModelDefinition {
  readonly id: string;
  /**
   * 'representative-educational': a generic illustration of the family. It must NOT carry dimensions: sizes are never derived from
   * capacitance, voltage or any other electrical value. 'manufacturer-geometry': geometry taken from manufacturer documentation for one product.
   */
  readonly basis: 'representative-educational' | 'manufacturer-geometry';
  readonly representation: 'parametric' | 'asset';
  readonly assetUrl?: string;
  readonly assetLicence?: string;
  readonly polarityMarking?: 'band' | 'plus-sign' | 'notch' | 'dot' | 'none';
  readonly dimensions?: PhysicalDimensions;
  readonly evidence: EvidenceRecord;
}

// ------------------------------------------------------------------ specifications

/** Describes WHAT a specification is (its name, kind of value, unit and plain-language meaning). */
export interface SpecificationDefinition {
  /** camelCase key, unique within the definition. */
  readonly key: string;
  readonly label: string;
  /** Conventional symbol, for example 'R'. */
  readonly symbol?: string;
  readonly plain: string;
  /** Beginner-readable unit name, for example 'ohms (Ω), the unit of resistance'. */
  readonly term?: string;
  /**
   * 'simulation-input': a number the simulator asks for. 'characteristic': a catalogue fact about the part (for example a datasheet value).
   * Where the simulator's input came from (typed, or an illustrative preset) is the simulator's own `DataSource`, not this field.
   */
  readonly usage: 'simulation-input' | 'characteristic';
  readonly valueType: 'quantity' | 'range' | 'text' | 'enum' | 'boolean';
  /** Required for 'quantity' and 'range'. */
  readonly dimension?: Dimension;
  /** Units offered for display and entry, for example ['Ω', 'kΩ', 'mΩ']. */
  readonly displayUnits?: readonly string[];
  /** Allowed values in canonical SI, inclusive. */
  readonly limits?: { readonly minSi: number; readonly maxSi: number };
  readonly optional?: boolean;
  /** Required for 'enum'. */
  readonly options?: readonly string[];
}

/** One specification value. Numeric values stay typed quantities; text, enum and boolean are explicit, never an unstructured string. */
export type SpecValue =
  | { readonly type: 'quantity'; readonly quantity: Quantity }
  | { readonly type: 'range'; readonly range: QuantityRange }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'enum'; readonly value: string }
  | { readonly type: 'boolean'; readonly value: boolean };

export interface SpecificationValue {
  readonly key: string;
  readonly value: SpecValue;
  readonly conditions?: OperatingConditions;
  /** Each value carries its own evidence, because one datasheet page supports one number, not the whole part. */
  readonly evidence: EvidenceRecord;
}

export interface TechnicalFormula {
  /** Unique within its definition. */
  readonly id: string;
  readonly label: string;
  /** Plain-text expression, for example 'I = V / R'. */
  readonly expression: string;
  readonly variables: readonly { readonly symbol: string; readonly meaning: string; readonly dimension?: Dimension }[];
  readonly appliesWhen?: string;
  readonly audience: 'beginner' | 'advanced';
  readonly evidence: EvidenceRecord;
}

// ------------------------------------------------------------------ simulation

/**
 * Whether Volta Lab can simulate a definition. 'simulatable' requires an adapter that exists; every status states its limitations.
 * The only simulatable port today is 'one-port-load': a load connected across the machine output. That is a hard limit of the engine,
 * not a property of the part, and it does not allow the part to be placed in a circuit.
 */
export type SimulationCapability =
  | { readonly status: 'simulatable'; readonly adapterId: string; readonly port: 'one-port-load'; readonly limitations: readonly string[] }
  | { readonly status: 'reference-only'; readonly limitations: readonly string[] }
  | { readonly status: 'planned'; readonly limitations: readonly string[] };

/** What the catalogue knows about a simulation adapter, without importing the simulator. */
export interface SimulationAdapterDescription {
  readonly id: string;
  readonly port: 'one-port-load';
  readonly summary: string;
}

// ------------------------------------------------------------------ definitions and parts

export interface AssemblyMember { readonly definitionId: string; readonly label: string }

export interface ComponentDefinition {
  /** 'def.<name>', unique across the catalogue. */
  readonly id: string;
  readonly kind: ComponentKind;
  /** Must equal the category of `familyId`. */
  readonly categoryId: string;
  readonly familyId: string;
  readonly name: string;
  /** Other names people search for. The name itself is searched automatically and must not be repeated here. */
  readonly aliases: readonly string[];
  readonly roles: readonly ComponentRole[];
  readonly tags: readonly string[];
  readonly beginnerSummary: string;
  readonly electricalPurpose: string;
  readonly applications?: readonly string[];
  readonly terminals: readonly TerminalDefinition[];
  readonly specifications: readonly SpecificationDefinition[];
  readonly formulas?: readonly TechnicalFormula[];
  /** Only for kind 'assembly': the generic definitions it is made of. */
  readonly assemblyOf?: readonly AssemblyMember[];
  readonly symbol?: SchematicSymbol;
  readonly physical?: PhysicalModelDefinition;
  readonly simulation: SimulationCapability;
  /** Evidence for the descriptive content of THIS record. A generic definition must not claim manufacturer-datasheet evidence. */
  readonly evidence: EvidenceRecord;
}

/** One exact manufacturer product. Always manufacturer-datasheet evidence; nothing is inherited as fact from the generic definition. */
export interface ManufacturerPart {
  /** 'part.<name>', unique across the catalogue. */
  readonly id: string;
  readonly definitionId: string;
  readonly manufacturer: string;
  readonly partNumber: string;
  readonly productName?: string;
  readonly packageName?: string;
  readonly specs: readonly SpecificationValue[];
  readonly physical?: PhysicalModelDefinition;
  readonly evidence: EvidenceRecord;
}

export interface CatalogueData {
  readonly categories: readonly ComponentCategory[];
  readonly families: readonly ComponentFamily[];
  readonly definitions: readonly ComponentDefinition[];
  readonly parts: readonly ManufacturerPart[];
}
