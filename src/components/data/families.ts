// The families that hold the five existing Load Lab models, plus Transformers (catalogue only, not simulated). Nothing else is catalogued yet: more families are added with their records, in later phases.
// No imports from the simulator (see adapters.ts for the one place that touches it).
import type { ComponentFamily } from '../types.ts';

export const FAMILIES: readonly ComponentFamily[] = [
  { id: 'fam.resistors', categoryId: 'cat.passive', name: 'Resistors', summary: 'Parts whose job is to resist the flow of current and turn electrical energy into heat.' },
  { id: 'fam.inductors', categoryId: 'cat.passive', name: 'Inductors and coils', summary: 'Coils of wire that store energy in a magnetic field and resist changes in current.' },
  { id: 'fam.capacitors', categoryId: 'cat.passive', name: 'Capacitors', summary: 'Parts that store energy in an electric field and pass changing current but block steady DC.' },
  { id: 'fam.transformers', categoryId: 'cat.passive', name: 'Transformers', summary: 'Devices that move AC electrical energy between windings through a magnetic core, changing voltage and current levels.' },
  { id: 'fam.rlc-networks', categoryId: 'cat.circuit-assemblies', name: 'RLC networks', summary: 'Small circuits that combine resistors, inductors and capacitors into one building block.' },
  { id: 'fam.dc-motors', categoryId: 'cat.electromechanical-devices', name: 'DC motors', summary: 'Motors that turn steady (DC) electrical energy into rotation.' },
];
