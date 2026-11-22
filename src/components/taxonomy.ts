// -----------------------------------------------------------------------------
// Canonical vocabulary and taxonomy for the component library.
//
// Four separate ideas (never merged):
//   KIND      what sort of thing it is        (discrete part, circuit assembly, module, ...)
//   CATEGORY  the single canonical shelf       (Passive components, Semiconductors, ...)
//   FAMILY    the single canonical sub-shelf   (Resistors, Capacitors, ... defined in ./data/families.ts)
//   ROLE      what it does in a circuit        (cross-cutting; a MOSFET is ONE definition that can have the roles
//                                               'switching' and 'power-electronics', not two records)
// plus free-form tags. A definition has exactly one kind, one category and one family, but any number of roles and tags.
//
// Categories below are the planned shelves; most are empty on purpose. No component records exist for them yet.
// No imports (no simulator, no UI, no three.js).
// -----------------------------------------------------------------------------

export type ComponentKind = 'discrete' | 'assembly' | 'module' | 'electromechanical' | 'source' | 'connector' | 'test-instrument';
export const COMPONENT_KINDS: readonly ComponentKind[] = ['discrete', 'assembly', 'module', 'electromechanical', 'source', 'connector', 'test-instrument'];
export const KIND_LABEL: Readonly<Record<ComponentKind, string>> = {
  'discrete': 'Discrete component',
  'assembly': 'Circuit assembly',
  'module': 'Module',
  'electromechanical': 'Electromechanical device',
  'source': 'Source',
  'connector': 'Connector',
  'test-instrument': 'Test instrument',
};

export type ComponentRole =
  | 'load' | 'source' | 'protection' | 'filtering' | 'sensing' | 'switching' | 'power-electronics'
  | 'energy-storage' | 'current-limiting' | 'motion' | 'measurement';
export const COMPONENT_ROLES: readonly ComponentRole[] = [
  'load', 'source', 'protection', 'filtering', 'sensing', 'switching', 'power-electronics', 'energy-storage', 'current-limiting', 'motion', 'measurement',
];

export interface CategoryRecord { readonly id: string; readonly name: string; readonly summary: string }
export const CATEGORIES: readonly CategoryRecord[] = [
  { id: 'cat.passive', name: 'Passive components', summary: 'Parts that do not amplify or switch: resistors, capacitors, inductors, transformers and filters.' },
  { id: 'cat.semiconductors', name: 'Semiconductors', summary: 'Diodes, LEDs, transistors, thyristors and other solid-state devices.' },
  { id: 'cat.integrated-circuits', name: 'Integrated circuits', summary: 'Many circuit elements in one package: amplifiers, logic, regulators, controllers and drivers.' },
  { id: 'cat.power-modules', name: 'Power modules', summary: 'Packaged power-electronics building blocks such as rectifier, IGBT, MOSFET, DC-DC and inverter modules.' },
  { id: 'cat.protection-control', name: 'Protection and control', summary: 'Fuses, breakers, relays, contactors, switches, thermistors and surge protection.' },
  { id: 'cat.sensors-measurement', name: 'Sensors and measurement', summary: 'Parts and modules that sense current, voltage, temperature or magnetic field.' },
  { id: 'cat.connectors-wiring', name: 'Connectors and wiring', summary: 'Terminals, terminal blocks, plugs, sockets and connectors.' },
  { id: 'cat.sources', name: 'Sources', summary: 'Things that supply electrical energy, such as batteries and supplies.' },
  { id: 'cat.circuit-assemblies', name: 'Circuit assemblies', summary: 'Small circuits made of several components, treated as one named building block.' },
  { id: 'cat.electromechanical-devices', name: 'Electromechanical devices', summary: 'Devices that convert between electrical and mechanical energy, such as motors.' },
  { id: 'cat.test-instruments', name: 'Test instruments', summary: 'Meters, oscilloscopes and other equipment used to measure a circuit.' },
];

/**
 * Which categories each kind may sit in. This keeps the four ideas consistent (an assembly is never filed under Passive components) without
 * duplicating records. Extend deliberately when a new kind of shelf is needed.
 */
export const KIND_CATEGORY_RULES: Readonly<Record<ComponentKind, readonly string[]>> = {
  'discrete': ['cat.passive', 'cat.semiconductors', 'cat.integrated-circuits', 'cat.protection-control', 'cat.sensors-measurement'],
  'assembly': ['cat.circuit-assemblies'],
  'module': ['cat.power-modules', 'cat.sensors-measurement', 'cat.protection-control'],
  'electromechanical': ['cat.electromechanical-devices', 'cat.protection-control'],
  'source': ['cat.sources'],
  'connector': ['cat.connectors-wiring'],
  'test-instrument': ['cat.test-instruments'],
};

// ------------------------------------------------------------------ terminal vocabulary (descriptions only; no connections exist yet)

export type TerminalRole =
  | 'terminal' | 'anode' | 'cathode' | 'gate' | 'drain' | 'source' | 'collector' | 'base' | 'emitter'
  | 'positive' | 'negative' | 'input' | 'output' | 'common' | 'coil' | 'contact' | 'wiper' | 'ground' | 'phase' | 'neutral' | 'earth';
export const TERMINAL_ROLES: readonly TerminalRole[] = [
  'terminal', 'anode', 'cathode', 'gate', 'drain', 'source', 'collector', 'base', 'emitter',
  'positive', 'negative', 'input', 'output', 'common', 'coil', 'contact', 'wiper', 'ground', 'phase', 'neutral', 'earth',
];

/** How a terminal behaves electrically. Planned for a future circuit builder; nothing here connects anything. */
export type ElectricalConnectionType = 'passive' | 'input' | 'output' | 'bidirectional' | 'power' | 'ground' | 'open-collector' | 'open-drain' | 'no-connect';
export const CONNECTION_TYPES: readonly ElectricalConnectionType[] = ['passive', 'input', 'output', 'bidirectional', 'power', 'ground', 'open-collector', 'open-drain', 'no-connect'];

/** Polarity is a description, not a flag: 'none' means the part is symmetric as modelled. */
export type TerminalPolarity = 'none' | 'positive' | 'negative' | 'anode' | 'cathode' | 'unspecified';
export const TERMINAL_POLARITIES: readonly TerminalPolarity[] = ['none', 'positive', 'negative', 'anode', 'cathode', 'unspecified'];
