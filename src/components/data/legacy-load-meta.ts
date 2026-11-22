// Catalogue-only facts about the five existing Load Lab models: where each one is filed, what it is called, how people search for it, its
// terminals and the textbook formulas the Load Lab already shows. Everything else (summary, role, limits, input fields and units) is read
// from the simulator's LOAD_CATALOGUE by adapters.ts, so no wording is duplicated here.
// No imports from the simulator: this file is plain data.
import type { AssemblyMember, ComponentKind, ComponentRole, EvidenceRecord, TechnicalFormula, TerminalDefinition } from '../types.ts';

/** The Load Lab's own ids (src/sim/loadlab.ts `LoadTypeId`), repeated as plain strings so this file stays independent of the simulator. adapters.ts checks they match. */
export type LegacyLoadId = 'resistor' | 'inductor' | 'capacitor' | 'rlc' | 'dc-motor';

export interface LegacyLoadMeta {
  readonly loadId: LegacyLoadId;
  readonly definitionId: string;
  /** The catalogue name. The Load Lab's own display name is added automatically as an alias when it differs. */
  readonly name: string;
  readonly kind: ComponentKind;
  readonly categoryId: string;
  readonly familyId: string;
  readonly aliases: readonly string[];
  readonly roles: readonly ComponentRole[];
  readonly tags: readonly string[];
  readonly applications: readonly string[];
  readonly terminals: readonly TerminalDefinition[];
  readonly formulas: readonly TechnicalFormula[];
  /** Only for the assembly: the generic definitions it is made of. */
  readonly assemblyOf?: readonly AssemblyMember[];
}

/** The two-terminal, symmetric-as-modelled description shared by the passive models. No pins, nets or connections exist yet. */
const twoPassive = (note: string): readonly TerminalDefinition[] => [
  { id: 'a', name: `Terminal A${note}`, role: 'terminal', connectionType: 'passive', polarity: 'none' },
  { id: 'b', name: `Terminal B${note}`, role: 'terminal', connectionType: 'passive', polarity: 'none' },
];

const TEXTBOOK: EvidenceRecord = {
  origin: 'engineering-reference',
  review: { status: 'unverified' },
  note: 'Standard textbook relationship, the same expression the Load Lab already shows to learners. Not yet reviewed against a cited source.',
};

export const LEGACY_LOAD_META: readonly LegacyLoadMeta[] = [
  {
    loadId: 'resistor', definitionId: 'def.resistor', name: 'Resistor', kind: 'discrete', categoryId: 'cat.passive', familyId: 'fam.resistors',
    aliases: ['resistance', 'ohmic load', 'R'], roles: ['load', 'current-limiting'], tags: ['passive', 'heating'],
    applications: ['Limiting current', 'Heating elements', 'The simplest possible load'],
    terminals: twoPassive(''),
    formulas: [
      { id: 'ohms-law', label: 'Ohm’s law', expression: 'I = V / R', audience: 'beginner', evidence: TEXTBOOK,
        variables: [{ symbol: 'I', meaning: 'current', dimension: 'current' }, { symbol: 'V', meaning: 'voltage across the resistor', dimension: 'voltage' }, { symbol: 'R', meaning: 'resistance', dimension: 'resistance' }] },
    ],
  },
  {
    loadId: 'inductor', definitionId: 'def.inductor', name: 'Inductor (coil)', kind: 'discrete', categoryId: 'cat.passive', familyId: 'fam.inductors',
    aliases: ['inductor', 'coil', 'choke', 'inductance', 'L'], roles: ['load', 'energy-storage', 'filtering'], tags: ['passive', 'magnetic'],
    applications: ['Chokes', 'Filters', 'Relay and motor windings'],
    terminals: twoPassive(''),
    formulas: [
      { id: 'inductive-reactance', label: 'Inductive reactance', expression: 'XL = 2πfL', audience: 'advanced', evidence: TEXTBOOK,
        appliesWhen: 'Steady AC at one frequency',
        variables: [{ symbol: 'XL', meaning: 'inductive reactance', dimension: 'resistance' }, { symbol: 'f', meaning: 'frequency', dimension: 'frequency' }, { symbol: 'L', meaning: 'inductance', dimension: 'inductance' }] },
    ],
  },
  {
    loadId: 'capacitor', definitionId: 'def.capacitor', name: 'Capacitor', kind: 'discrete', categoryId: 'cat.passive', familyId: 'fam.capacitors',
    aliases: ['capacitance', 'condenser', 'C'], roles: ['load', 'energy-storage', 'filtering'], tags: ['passive', 'ac-coupling'],
    applications: ['Smoothing', 'Filtering', 'Coupling signals'],
    // The Load Lab models a non-polarised capacitor, so polarity is 'none' here. A future electrolytic or tantalum definition will carry real polarity.
    terminals: twoPassive(''),
    formulas: [
      { id: 'capacitive-reactance', label: 'Capacitive reactance', expression: 'XC = 1 / (2πfC)', audience: 'advanced', evidence: TEXTBOOK,
        appliesWhen: 'Steady AC at one frequency',
        variables: [{ symbol: 'XC', meaning: 'capacitive reactance', dimension: 'resistance' }, { symbol: 'f', meaning: 'frequency', dimension: 'frequency' }, { symbol: 'C', meaning: 'capacitance', dimension: 'capacitance' }] },
    ],
  },
  {
    loadId: 'rlc', definitionId: 'def.series-rlc', name: 'Series RLC circuit', kind: 'assembly', categoryId: 'cat.circuit-assemblies', familyId: 'fam.rlc-networks',
    aliases: ['RLC', 'series RLC', 'RLC circuit', 'RLC network'], roles: ['load', 'filtering'], tags: ['assembly', 'resonance'],
    applications: ['Filters', 'Tuned circuits'],
    terminals: twoPassive(' of the series network'),
    assemblyOf: [{ definitionId: 'def.resistor', label: 'Resistor (R)' }, { definitionId: 'def.inductor', label: 'Inductor (L)' }, { definitionId: 'def.capacitor', label: 'Capacitor (C)' }],
    formulas: [
      { id: 'series-impedance', label: 'Series impedance', expression: 'Z = √(R² + (XL − XC)²)', audience: 'advanced', evidence: TEXTBOOK,
        appliesWhen: 'Steady AC at one frequency',
        variables: [{ symbol: 'Z', meaning: 'impedance', dimension: 'resistance' }, { symbol: 'R', meaning: 'resistance', dimension: 'resistance' }, { symbol: 'XL', meaning: 'inductive reactance', dimension: 'resistance' }, { symbol: 'XC', meaning: 'capacitive reactance', dimension: 'resistance' }] },
    ],
  },
  {
    loadId: 'dc-motor', definitionId: 'def.dc-motor', name: 'DC motor', kind: 'electromechanical', categoryId: 'cat.electromechanical-devices', familyId: 'fam.dc-motors',
    aliases: ['direct current motor'], roles: ['load', 'motion'], tags: ['electromechanical', 'rotation'],
    applications: ['Fans and pumps', 'Small drives'],
    // The Load Lab's motor model does not state a polarity requirement, so none is claimed: 'unspecified', not 'none'.
    terminals: [
      { id: 'a', name: 'Armature terminal A', role: 'terminal', connectionType: 'passive', polarity: 'unspecified' },
      { id: 'b', name: 'Armature terminal B', role: 'terminal', connectionType: 'passive', polarity: 'unspecified' },
    ],
    formulas: [
      { id: 'voltage-balance', label: 'Voltage balance', expression: 'V = Ra·I + Ke·ω', audience: 'advanced', evidence: TEXTBOOK, appliesWhen: 'Steady running',
        variables: [{ symbol: 'V', meaning: 'supply voltage', dimension: 'voltage' }, { symbol: 'Ra', meaning: 'armature resistance', dimension: 'resistance' }, { symbol: 'I', meaning: 'current', dimension: 'current' }, { symbol: 'Ke', meaning: 'back-EMF constant', dimension: 'motor-constant' }, { symbol: 'ω', meaning: 'angular speed' }] },
      { id: 'torque-balance', label: 'Torque balance', expression: 'Kt·I = load torque + b·ω', audience: 'advanced', evidence: TEXTBOOK, appliesWhen: 'Steady running',
        variables: [{ symbol: 'Kt', meaning: 'torque constant', dimension: 'motor-constant' }, { symbol: 'I', meaning: 'current', dimension: 'current' }, { symbol: 'b', meaning: 'viscous coefficient', dimension: 'viscous-coefficient' }, { symbol: 'ω', meaning: 'angular speed' }] },
    ],
  },
];
