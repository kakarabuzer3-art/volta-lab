// Transformer family: five GENERIC definitions (catalogue only). None is simulatable and none describes an exact product: no part numbers, no ratings, no
// dimensions. Every record is illustrative educational content, not yet reviewed against a cited source, and says so. The relations below are the ideal-transformer
// textbook expressions (they ignore losses, magnetising current and leakage). Voltage classes (low, medium, high, extra-high) are deliberately NOT given numeric limits
// here: the boundaries differ between standards, and numbers are added only once a standard is cited.
// No imports from the simulator, the UI or three.js.
import type { ComponentDefinition, EvidenceRecord, SchematicSymbol, SpecificationDefinition, TechnicalFormula, TerminalDefinition } from '../types.ts';
import { illustrativeEvidence } from '../provenance.ts';

const EDU: EvidenceRecord = illustrativeEvidence('Educational description written for Volta Lab from general engineering knowledge; not yet reviewed against a cited source.');
const TEXTBOOK: EvidenceRecord = {
  origin: 'engineering-reference', review: { status: 'unverified' },
  note: 'Standard ideal-transformer relationship found in introductory electrical engineering texts. Not yet reviewed against a cited source.',
};
const NOT_SIMULATED = 'Catalogue entry only: it cannot be placed in a circuit or simulated. The simulator models only one-port loads across the machine output.';
const NO_REAL_VALUES = 'No ratings or dimensions are given because this describes a kind of part, not a specific product.';

const t = (id: string, name: string, role: TerminalDefinition['role'], polarity: TerminalDefinition['polarity'] = 'unspecified'): TerminalDefinition =>
  ({ id, name, role, connectionType: 'passive', polarity });
const TWO_WINDINGS: readonly TerminalDefinition[] = [
  t('p1', 'Primary terminal 1', 'primary'), t('p2', 'Primary terminal 2', 'primary'), t('s1', 'Secondary terminal 1', 'secondary'), t('s2', 'Secondary terminal 2', 'secondary'),
];
const spec = (key: string, label: string, plain: string, dimension: SpecificationDefinition['dimension'], displayUnits: readonly string[], symbol?: string): SpecificationDefinition =>
  ({ key, label, ...(symbol ? { symbol } : {}), plain, usage: 'characteristic', valueType: 'quantity', dimension, displayUnits, optional: true });
const V = ['V', 'kV', 'mV'], A = ['A', 'mA', 'kA'], F = ['Hz', 'kHz'];

const symbol = (id: string, markup: string): SchematicSymbol => ({ id, convention: 'iec-style', viewBox: '0 0 64 32', markup, origin: 'original-artwork' });
// Two coils facing each other with two core lines between them. Original artwork drawn for Volta Lab.
const TWO_WINDING_SYMBOL = 'M22 4a4 4 0 0 1 0 8a4 4 0 0 1 0 8a4 4 0 0 1 0 8M42 4a4 4 0 0 0 0 8a4 4 0 0 0 0 8a4 4 0 0 0 0 8M30 2V30M34 2V30M22 4H8M22 28H8M42 4H56M42 28H56';
const AUTO_SYMBOL = 'M32 4a4 4 0 0 1 0 8a4 4 0 0 1 0 8a4 4 0 0 1 0 8M32 4H12M32 28H12M32 12H56';
const CT_SYMBOL = 'M32 8a8 8 0 1 0 0.01 0M4 16H60M28 23V30M36 23V30';

const ideal = (id: string, label: string, expression: string, variables: TechnicalFormula['variables'], audience: 'beginner' | 'advanced' = 'beginner'): TechnicalFormula =>
  ({ id, label, expression, variables, audience, appliesWhen: 'Ideal transformer: no losses, no magnetising current, no leakage.', evidence: TEXTBOOK });

const base = { kind: 'discrete', categoryId: 'cat.passive', familyId: 'fam.transformers', evidence: EDU } as const;
const catalogueOnly = { status: 'reference-only', limitations: [NOT_SIMULATED, NO_REAL_VALUES] } as const;

export const TRANSFORMER_DEFINITIONS: readonly ComponentDefinition[] = [
  {
    ...base, id: 'def.power-transformer', name: 'Power transformer',
    aliases: ['step-up transformer', 'step-down transformer', 'two-winding transformer', 'mains transformer'],
    roles: ['power-electronics'], tags: ['transformer', 'ac', 'voltage-conversion', 'magnetic-coupling'],
    beginnerSummary: 'Two coils of wire wound on one iron core. AC in the primary coil creates a changing magnetic field, which induces an AC voltage in the secondary coil. More turns on the secondary than the primary gives a higher voltage (step-up); fewer turns gives a lower voltage (step-down).',
    electricalPurpose: 'Changes the voltage level of AC power. Voltage and current trade places: stepping the voltage up lowers the current, which is why long power lines run at high voltage (less current means less heat lost in the wire). It works only on AC: a steady DC current in the primary does not pass power to the secondary.',
    applications: ['Raising voltage for transmission', 'Lowering voltage for distribution and equipment', 'Power supplies'],
    terminals: TWO_WINDINGS,
    specifications: [
      spec('primaryVoltage', 'Primary voltage', 'The AC voltage the primary winding is designed to be connected to.', 'voltage', V, 'Vp'),
      spec('secondaryVoltage', 'Secondary voltage', 'The AC voltage the secondary winding delivers.', 'voltage', V, 'Vs'),
      spec('ratedFrequency', 'Rated frequency', 'The AC frequency the transformer is designed for.', 'frequency', F, 'f'),
      spec('turnsRatio', 'Turns ratio', 'Primary turns divided by secondary turns (Np / Ns).', 'ratio', ['1'], 'Np/Ns'),
    ],
    formulas: [
      ideal('voltage-ratio', 'Voltage ratio', 'Vp / Vs = Np / Ns', [{ symbol: 'Vp, Vs', meaning: 'primary and secondary voltage', dimension: 'voltage' }, { symbol: 'Np, Ns', meaning: 'number of turns on each winding' }]),
      ideal('current-ratio', 'Current ratio', 'Ip · Np = Is · Ns', [{ symbol: 'Ip, Is', meaning: 'primary and secondary current', dimension: 'current' }, { symbol: 'Np, Ns', meaning: 'number of turns on each winding' }], 'advanced'),
    ],
    symbol: symbol('sym.power-transformer', TWO_WINDING_SYMBOL), simulation: catalogueOnly,
  },
  {
    ...base, id: 'def.isolation-transformer', name: 'Isolation transformer',
    aliases: ['isolating transformer'], roles: ['protection'], tags: ['transformer', 'ac', 'galvanic-isolation', 'safety'],
    beginnerSummary: 'A transformer whose main job is to separate two circuits electrically. Energy crosses through the magnetic field only; there is no direct wire connection between the primary and the secondary.',
    electricalPurpose: 'Keeps the secondary circuit electrically separate (galvanically isolated) from the supply, which can reduce shock risk and block some electrical noise. The voltage is often similar on both sides, but it does not have to be. Isolation by itself does not make a circuit safe to touch.',
    applications: ['Safety separation', 'Noise reduction', 'Breaking ground loops'],
    terminals: TWO_WINDINGS,
    specifications: [
      spec('primaryVoltage', 'Primary voltage', 'The AC voltage the primary winding is designed to be connected to.', 'voltage', V, 'Vp'),
      spec('secondaryVoltage', 'Secondary voltage', 'The AC voltage the secondary winding delivers.', 'voltage', V, 'Vs'),
      spec('ratedFrequency', 'Rated frequency', 'The AC frequency the transformer is designed for.', 'frequency', F, 'f'),
    ],
    formulas: [ideal('voltage-ratio', 'Voltage ratio', 'Vp / Vs = Np / Ns', [{ symbol: 'Vp, Vs', meaning: 'primary and secondary voltage', dimension: 'voltage' }, { symbol: 'Np, Ns', meaning: 'number of turns on each winding' }])],
    symbol: symbol('sym.isolation-transformer', TWO_WINDING_SYMBOL), simulation: catalogueOnly,
  },
  {
    ...base, id: 'def.autotransformer', name: 'Autotransformer',
    aliases: ['auto transformer'], roles: ['power-electronics'], tags: ['transformer', 'ac', 'single-winding', 'tapped'],
    beginnerSummary: 'A transformer with a single coil and a tap partway along it. Part of the winding is shared between the input and the output, so it can be smaller and lighter than a two-winding transformer for the same job.',
    electricalPurpose: 'Changes AC voltage by a modest ratio using one tapped winding. Because the input and output share part of the same wire, there is no electrical isolation between them.',
    applications: ['Small voltage adjustments', 'Variable AC supplies (with a movable tap)'],
    terminals: [t('common', 'Common terminal', 'common'), t('in', 'Input end of winding', 'input'), t('tap', 'Tap (output)', 'tap')],
    specifications: [
      spec('inputVoltage', 'Input voltage', 'The AC voltage applied across the whole winding.', 'voltage', V, 'Vin'),
      spec('outputVoltage', 'Output voltage', 'The AC voltage taken between the tap and the common terminal.', 'voltage', V, 'Vout'),
      spec('ratedFrequency', 'Rated frequency', 'The AC frequency the autotransformer is designed for.', 'frequency', F, 'f'),
    ],
    formulas: [ideal('voltage-ratio', 'Voltage ratio', 'Vin / Vout = Nin / Nout', [{ symbol: 'Vin, Vout', meaning: 'input and output voltage', dimension: 'voltage' }, { symbol: 'Nin, Nout', meaning: 'turns across the input and across the output part of the winding' }])],
    symbol: symbol('sym.autotransformer', AUTO_SYMBOL), simulation: catalogueOnly,
  },
  {
    ...base, id: 'def.current-transformer', name: 'Current transformer (CT)',
    aliases: ['CT', 'current transformer'], roles: ['sensing', 'measurement'], tags: ['transformer', 'ac', 'instrument-transformer', 'current-sensing'],
    beginnerSummary: 'A transformer used to measure large AC currents safely. The conductor carrying the large current acts as the primary (often passing once through the core); the secondary produces a much smaller current that is proportional to it.',
    electricalPurpose: 'Scales a large AC current down to a small, measurable current for meters and protection relays, and keeps the measuring circuit separate from the high-current conductor. SAFETY: the secondary must never be left open while the primary carries current, because a dangerously high voltage can appear across the open secondary. It is normally kept shorted through the meter or a shorting link.',
    applications: ['Metering', 'Protection relays', 'Current monitoring'],
    terminals: [t('p1', 'Primary terminal 1', 'primary'), t('p2', 'Primary terminal 2', 'primary'), t('s1', 'Secondary terminal 1', 'secondary'), t('s2', 'Secondary terminal 2', 'secondary')],
    specifications: [
      spec('primaryCurrent', 'Primary current', 'The AC current the primary conductor is expected to carry.', 'current', A, 'Ip'),
      spec('secondaryCurrent', 'Secondary current', 'The AC current the secondary delivers at the primary current above.', 'current', A, 'Is'),
      spec('ratedFrequency', 'Rated frequency', 'The AC frequency the CT is designed for.', 'frequency', F, 'f'),
    ],
    formulas: [ideal('current-ratio', 'Current ratio', 'Ip / Is = Ns / Np', [{ symbol: 'Ip, Is', meaning: 'primary and secondary current', dimension: 'current' }, { symbol: 'Np, Ns', meaning: 'number of turns on each winding' }])],
    symbol: symbol('sym.current-transformer', CT_SYMBOL), simulation: catalogueOnly,
  },
  {
    ...base, id: 'def.voltage-transformer', name: 'Voltage transformer (VT)',
    aliases: ['potential transformer', 'PT'], roles: ['sensing', 'measurement'], tags: ['transformer', 'ac', 'instrument-transformer', 'voltage-sensing'],
    beginnerSummary: 'A transformer used to measure high AC voltages safely. It steps a high voltage down to a small, proportional voltage that ordinary meters and relays can handle.',
    electricalPurpose: 'Scales a high AC voltage down to a low, measurable voltage and keeps the measuring circuit separate from the high-voltage line. SAFETY: unlike a current transformer, a voltage transformer secondary must not be short-circuited, because a large current would flow.',
    applications: ['Metering', 'Protection relays', 'Voltage monitoring'],
    terminals: TWO_WINDINGS,
    specifications: [
      spec('primaryVoltage', 'Primary voltage', 'The AC voltage of the line being measured.', 'voltage', V, 'Vp'),
      spec('secondaryVoltage', 'Secondary voltage', 'The AC voltage delivered to the meter or relay.', 'voltage', V, 'Vs'),
      spec('ratedFrequency', 'Rated frequency', 'The AC frequency the VT is designed for.', 'frequency', F, 'f'),
    ],
    formulas: [ideal('voltage-ratio', 'Voltage ratio', 'Vp / Vs = Np / Ns', [{ symbol: 'Vp, Vs', meaning: 'primary and secondary voltage', dimension: 'voltage' }, { symbol: 'Np, Ns', meaning: 'number of turns on each winding' }])],
    symbol: symbol('sym.voltage-transformer', TWO_WINDING_SYMBOL), simulation: catalogueOnly,
  },
];
