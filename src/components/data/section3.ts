// Section 3 catalogue: Resistors, Capacitors and Diodes, as GENERIC "kinds of part" (catalogue only). None is simulatable and none describes an exact product: no part
// numbers, no ratings, no tolerances, no dimensions and no typical numbers (for example no "diode drop" figure). Every record is illustrative educational content, not yet
// reviewed against a cited source, and says so. The relations are introductory textbook expressions and state when they apply. The Load Lab separately simulates an ideal
// resistor and an ideal capacitor (def.resistor, def.capacitor); these records describe the physical kinds of part and never replace those models.
// No imports from the simulator, the UI or three.js.
import type { ComponentDefinition, EvidenceRecord, SchematicSymbol, SpecificationDefinition, TechnicalFormula, TerminalDefinition } from '../types.ts';
import { illustrativeEvidence } from '../provenance.ts';

const EDU: EvidenceRecord = illustrativeEvidence('Educational description written for Volta Lab from general engineering knowledge; not yet reviewed against a cited source.');
const TEXTBOOK: EvidenceRecord = {
  origin: 'engineering-reference', review: { status: 'unverified' },
  note: 'Standard relationship found in introductory electrical engineering texts. Not yet reviewed against a cited source.',
};
const NOT_SIMULATED = 'Catalogue entry only: it cannot be placed in a circuit or simulated. The simulator models only one-port loads across the machine output.';
const NO_REAL_VALUES = 'No ratings, tolerances or dimensions are given because this describes a kind of part, not a specific product.';
const IDEAL_R = 'The Load Lab has a separate, simulated ideal resistor model; this entry describes the physical kind of part.';
const IDEAL_C = 'The Load Lab has a separate, simulated ideal capacitor model; this entry describes the physical kind of part.';

const t = (id: string, name: string, role: TerminalDefinition['role'], polarity: TerminalDefinition['polarity'] = 'none'): TerminalDefinition =>
  ({ id, name, role, connectionType: 'passive', polarity });
const TWO_TERMINALS: readonly TerminalDefinition[] = [t('a', 'Terminal A', 'terminal'), t('b', 'Terminal B', 'terminal')];
const spec = (key: string, label: string, plain: string, dimension: SpecificationDefinition['dimension'], displayUnits: readonly string[], symbol?: string): SpecificationDefinition =>
  ({ key, label, ...(symbol ? { symbol } : {}), plain, usage: 'characteristic', valueType: 'quantity', dimension, displayUnits, optional: true });
const OHM = ['Ω', 'kΩ', 'MΩ'], FARAD = ['µF', 'nF', 'pF', 'mF'], VOLT = ['V', 'mV', 'kV'], AMP = ['A', 'mA', 'µA'], WATT = ['W', 'mW'];

const symbol = (id: string, markup: string): SchematicSymbol => ({ id, convention: 'iec-style', viewBox: '0 0 64 32', markup, origin: 'original-artwork' });
// Original artwork drawn for Volta Lab.
const RESISTOR = 'M4 16H20M20 10H44V22H20ZM44 16H60';
const VARIABLE_R = 'M4 16H20M20 10H44V22H20ZM44 16H60M24 27L40 5M40 5L35 6.5M40 5L40.5 10M32 22V30';
const THERMISTOR = 'M4 16H20M20 10H44V22H20ZM44 16H60M24 27H28L40 5';
const VARISTOR = 'M4 16H20M20 10H44V22H20ZM44 16H60M24 27H29L39 5H44';
const CAP = 'M4 16H27M27 6V26M37 6V26M37 16H60';
const POLAR_CAP = 'M4 16H27M27 6V26M37 6Q32 16 37 26M37 16H60M16 8H22M19 5V11';
const VARIABLE_CAP = 'M4 16H27M27 6V26M37 6V26M37 16H60M20 28L44 4M44 4L39 5.5M44 4L42.5 9';
const DIODE = 'M4 16H24M24 6V26L40 16ZM40 6V26M40 16H60';
const ZENER = 'M4 16H24M24 6V26L40 16ZM37 28L40 26V6L43 4M40 16H60';
const SCHOTTKY = 'M4 16H24M24 6V26L40 16ZM36 9V6H40V26H44V23M40 16H60';
const LED = 'M4 16H24M24 6V26L40 16ZM40 6V26M40 16H60M40 6L48 0M44 0H48V4M46 12L54 6M50 6H54V10';

const f = (id: string, label: string, expression: string, appliesWhen: string, variables: TechnicalFormula['variables'], audience: 'beginner' | 'advanced' = 'beginner'): TechnicalFormula =>
  ({ id, label, expression, variables, audience, appliesWhen, evidence: TEXTBOOK });
const OHMS_LAW = f('ohms-law', "Ohm's law", 'V = I · R', 'A resistive part at one instant, with its resistance taken as constant.',
  [{ symbol: 'V', meaning: 'voltage across the part', dimension: 'voltage' }, { symbol: 'I', meaning: 'current through it', dimension: 'current' }, { symbol: 'R', meaning: 'resistance', dimension: 'resistance' }]);
const POWER_HEAT = f('power-heat', 'Power turned into heat', 'P = I² · R', 'A resistive part carrying current I.',
  [{ symbol: 'P', meaning: 'power dissipated as heat', dimension: 'power' }, { symbol: 'I', meaning: 'current', dimension: 'current' }, { symbol: 'R', meaning: 'resistance', dimension: 'resistance' }], 'advanced');
const CHARGE = f('charge', 'Charge stored', 'Q = C · V', 'An ideal capacitor with a steady voltage V across it.',
  [{ symbol: 'Q', meaning: 'stored charge' }, { symbol: 'C', meaning: 'capacitance', dimension: 'capacitance' }, { symbol: 'V', meaning: 'voltage across the capacitor', dimension: 'voltage' }]);
const ENERGY = f('energy', 'Energy stored', 'E = ½ · C · V²', 'An ideal capacitor with a steady voltage V across it.',
  [{ symbol: 'E', meaning: 'stored energy' }, { symbol: 'C', meaning: 'capacitance', dimension: 'capacitance' }, { symbol: 'V', meaning: 'voltage across the capacitor', dimension: 'voltage' }], 'advanced');
const REACTANCE = f('reactance', 'Capacitive reactance', 'XC = 1 / (2πfC)', 'An ideal capacitor in steady AC at one frequency.',
  [{ symbol: 'XC', meaning: 'opposition to AC current', dimension: 'resistance' }, { symbol: 'f', meaning: 'frequency', dimension: 'frequency' }, { symbol: 'C', meaning: 'capacitance', dimension: 'capacitance' }], 'advanced');

const R = { kind: 'discrete', categoryId: 'cat.passive', familyId: 'fam.resistors', evidence: EDU } as const;
const C = { kind: 'discrete', categoryId: 'cat.passive', familyId: 'fam.capacitors', evidence: EDU } as const;
const D = { kind: 'discrete', categoryId: 'cat.semiconductors', familyId: 'fam.diodes', evidence: EDU } as const;
const only = (...extra: string[]) => ({ status: 'reference-only', limitations: [NOT_SIMULATED, NO_REAL_VALUES, ...extra] }) as const;

const RES_SPECS = [
  spec('resistance', 'Resistance', 'How strongly the part opposes current.', 'resistance', OHM, 'R'),
  spec('powerRating', 'Power rating', 'How much heat power the part can dissipate without damage.', 'power', WATT, 'P'),
];
const CAP_SPECS = [
  spec('capacitance', 'Capacitance', 'How much charge the part stores per volt.', 'capacitance', FARAD, 'C'),
  spec('ratedVoltage', 'Rated voltage', 'The highest voltage the part is designed to have across it.', 'voltage', VOLT, 'V'),
];
const DIODE_SPECS = [
  spec('forwardVoltage', 'Forward voltage', 'The voltage across the diode while it conducts in its forward direction.', 'voltage', VOLT, 'VF'),
  spec('forwardCurrent', 'Forward current', 'The current the diode is designed to carry while conducting.', 'current', AMP, 'IF'),
  spec('reverseVoltage', 'Reverse voltage', 'The highest voltage the diode is designed to block in its reverse direction.', 'voltage', VOLT, 'VR'),
];

export const SECTION3_DEFINITIONS: readonly ComponentDefinition[] = [
  // ------------------------------------------------------------------ resistors
  {
    ...R, id: 'def.fixed-resistor', name: 'Fixed resistor', aliases: ['resistance', 'carbon resistor', 'wirewound resistor'], roles: ['current-limiting', 'load'], tags: ['resistor', 'passive', 'heat'],
    beginnerSummary: 'A part with a set resistance. It opposes the flow of current and turns the electrical energy it takes into heat.',
    electricalPurpose: 'Limits current, divides voltage and acts as a load. The voltage across it is proportional to the current through it (Ohm\'s law), and the power it dissipates becomes heat, so it must be chosen to handle that power without overheating. It works the same way on DC and AC.',
    applications: ['Limiting current (for example in series with an LED)', 'Voltage dividers', 'Pull-up and pull-down connections', 'Heating elements'],
    terminals: TWO_TERMINALS, specifications: RES_SPECS, formulas: [OHMS_LAW, POWER_HEAT], symbol: symbol('sym.fixed-resistor', RESISTOR), simulation: only(IDEAL_R),
  },
  {
    ...R, id: 'def.variable-resistor', name: 'Variable resistor (potentiometer / rheostat)', aliases: ['potentiometer', 'pot', 'rheostat', 'trimmer'], roles: ['current-limiting', 'sensing'], tags: ['resistor', 'passive', 'adjustable'],
    beginnerSummary: 'A resistor whose resistance can be adjusted by turning a knob or sliding a contact. A potentiometer has three terminals: the two ends of a resistive track and a movable contact called the wiper. A rheostat uses only one end and the wiper as an adjustable two-terminal resistor.',
    electricalPurpose: 'Used as an adjustable voltage divider (potentiometer) or an adjustable current limiter (rheostat). Moving the wiper changes how the total track resistance is split between its two sides.',
    applications: ['Volume and level controls', 'Adjusting a set-point', 'Adjustable current limiting'],
    terminals: [t('end1', 'End 1 of track', 'terminal'), t('end2', 'End 2 of track', 'terminal'), t('wiper', 'Wiper (movable contact)', 'wiper')],
    specifications: [...RES_SPECS, spec('wiperPosition', 'Wiper position', 'How far along the track the wiper is, as a fraction of the full travel.', 'ratio', ['%', '1'])],
    formulas: [f('divider', 'Unloaded voltage divider', 'Vout = Vin · R2 / (R1 + R2)', 'Potentiometer used as a divider with nothing connected to the wiper.',
      [{ symbol: 'Vin', meaning: 'voltage across the whole track', dimension: 'voltage' }, { symbol: 'Vout', meaning: 'voltage between wiper and one end', dimension: 'voltage' }, { symbol: 'R1, R2', meaning: 'track resistance on each side of the wiper', dimension: 'resistance' }])],
    symbol: symbol('sym.variable-resistor', VARIABLE_R), simulation: only(),
  },
  {
    ...R, id: 'def.thermistor', name: 'Thermistor (NTC / PTC)', aliases: ['NTC', 'PTC', 'temperature-dependent resistor'], roles: ['sensing', 'protection'], tags: ['resistor', 'passive', 'temperature'],
    beginnerSummary: 'A resistor whose resistance changes a lot with temperature. An NTC thermistor has a resistance that falls as it warms up; a PTC thermistor has a resistance that rises as it warms up.',
    electricalPurpose: 'Measures temperature (the circuit reads the resistance) or limits current: some NTC types limit the surge when equipment is first switched on, and some PTC types act as self-resetting overcurrent protection. Its resistance is not constant, so Ohm\'s law gives only the value at that moment.',
    applications: ['Temperature sensing', 'Inrush current limiting', 'Overcurrent protection'],
    terminals: TWO_TERMINALS,
    specifications: [spec('resistance', 'Resistance at a stated temperature', 'The resistance the part has at a named temperature.', 'resistance', OHM, 'R'), spec('temperature', 'Temperature', 'The temperature at which the resistance is stated.', 'temperature', ['°C', 'K'], 'T')],
    formulas: [OHMS_LAW], symbol: symbol('sym.thermistor', THERMISTOR), simulation: only(),
  },
  {
    ...R, id: 'def.varistor', name: 'Varistor (voltage-dependent resistor)', aliases: ['MOV', 'metal oxide varistor', 'surge absorber', 'voltage-dependent resistor'], roles: ['protection'], tags: ['resistor', 'passive', 'surge', 'clamping'],
    beginnerSummary: 'A part with a very high resistance at normal voltage that drops sharply when the voltage across it rises above a threshold.',
    electricalPurpose: 'Connected across a supply line to absorb voltage surges: when a spike pushes the voltage above its threshold the varistor starts to conduct and limits the rise. Each large surge wears it down, so it is a protection part that ages, not a permanent clamp. It is used with a fuse or breaker, never instead of one.',
    applications: ['Surge protection on mains supplies', 'Protecting equipment from voltage spikes'],
    terminals: TWO_TERMINALS,
    specifications: [spec('clampingVoltage', 'Clamping voltage', 'The voltage level above which the part starts to conduct strongly.', 'voltage', VOLT, 'Vc')],
    symbol: symbol('sym.varistor', VARISTOR), simulation: only(),
  },
  // ------------------------------------------------------------------ capacitors
  {
    ...C, id: 'def.ceramic-capacitor', name: 'Ceramic capacitor', aliases: ['MLCC', 'disc capacitor', 'multilayer ceramic capacitor'], roles: ['filtering', 'energy-storage'], tags: ['capacitor', 'passive', 'non-polarised', 'decoupling'],
    beginnerSummary: 'A small capacitor that uses a ceramic material between its plates. It has no polarity, so it can be connected either way round, and it is usually used for small capacitance values.',
    electricalPurpose: 'Passes changing signals and blocks steady DC. Placed close to an integrated circuit it supplies fast bursts of current and smooths small supply ripples (decoupling). For some ceramic types the real capacitance changes with the voltage across it and with temperature, so the marked value is not always what the circuit gets.',
    applications: ['Decoupling and bypassing', 'High-frequency filtering', 'Coupling signals'],
    terminals: TWO_TERMINALS, specifications: CAP_SPECS, formulas: [CHARGE, REACTANCE], symbol: symbol('sym.ceramic-capacitor', CAP), simulation: only(IDEAL_C),
  },
  {
    ...C, id: 'def.electrolytic-capacitor', name: 'Aluminium electrolytic capacitor', aliases: ['electrolytic capacitor', 'polarised capacitor', 'polarized capacitor', 'electrolytic'], roles: ['energy-storage', 'filtering'], tags: ['capacitor', 'passive', 'polarised', 'smoothing'],
    beginnerSummary: 'A capacitor that gives a large capacitance in a small package by using a thin oxide layer as its insulator. It is polarised: one lead is positive and the other negative, and it must be connected the right way round.',
    electricalPurpose: 'Stores energy and smooths the output of rectifiers in power supplies. SAFETY: connecting it with reversed polarity, or applying more than its rated voltage, can damage it and may make it vent or burst. Its stored charge can remain after the supply is switched off.',
    applications: ['Smoothing rectified DC', 'Energy storage in power supplies', 'Low-frequency coupling'],
    terminals: [t('pos', 'Positive terminal', 'positive', 'positive'), t('neg', 'Negative terminal', 'negative', 'negative')],
    specifications: CAP_SPECS, formulas: [CHARGE, ENERGY], symbol: symbol('sym.electrolytic-capacitor', POLAR_CAP), simulation: only(IDEAL_C),
  },
  {
    ...C, id: 'def.film-capacitor', name: 'Film capacitor', aliases: ['plastic film capacitor', 'polyester capacitor', 'polypropylene capacitor'], roles: ['filtering', 'energy-storage'], tags: ['capacitor', 'passive', 'non-polarised'],
    beginnerSummary: 'A capacitor that uses a thin plastic film as the insulator between its plates. It has no polarity and is known for stable behaviour over time.',
    electricalPurpose: 'Used where a capacitor must work on AC, handle repeated pulses or keep its value reliably: filters, timing circuits, motor-run capacitors and power-electronics snubbers. It is physically larger than a ceramic or electrolytic capacitor of similar capacitance.',
    applications: ['AC and pulse circuits', 'Filters and timing', 'Motor-run capacitors', 'Snubbers'],
    terminals: TWO_TERMINALS, specifications: CAP_SPECS, formulas: [CHARGE, REACTANCE], symbol: symbol('sym.film-capacitor', CAP), simulation: only(IDEAL_C),
  },
  {
    ...C, id: 'def.variable-capacitor', name: 'Variable capacitor', aliases: ['tuning capacitor', 'trimmer capacitor', 'trim capacitor'], roles: ['filtering'], tags: ['capacitor', 'passive', 'adjustable', 'tuning'],
    beginnerSummary: 'A capacitor whose capacitance can be adjusted, usually by changing how much two sets of metal plates overlap, or by a small screw for fine trimming.',
    electricalPurpose: 'Lets a circuit be tuned: together with a coil it sets the frequency a radio circuit responds to. Adjusting it changes the capacitance, and so the reactance at a given frequency.',
    applications: ['Tuning radio circuits', 'Fine adjustment of a filter or oscillator'],
    terminals: TWO_TERMINALS,
    specifications: [spec('minCapacitance', 'Minimum capacitance', 'The capacitance at the lowest setting.', 'capacitance', FARAD, 'Cmin'), spec('maxCapacitance', 'Maximum capacitance', 'The capacitance at the highest setting.', 'capacitance', FARAD, 'Cmax'), CAP_SPECS[1]!],
    formulas: [REACTANCE], symbol: symbol('sym.variable-capacitor', VARIABLE_CAP), simulation: only(IDEAL_C),
  },
  // ------------------------------------------------------------------ diodes
  {
    ...D, id: 'def.rectifier-diode', name: 'Rectifier diode', aliases: ['power diode', 'silicon diode', 'general purpose diode'], roles: ['power-electronics', 'switching'], tags: ['diode', 'semiconductor', 'rectification'],
    beginnerSummary: 'A two-terminal part that lets current flow easily in one direction (anode to cathode) and blocks it in the other. The band on the body marks the cathode end.',
    electricalPurpose: 'Turns AC into pulsating DC (rectification) by passing only one half of each cycle, and stops current flowing backwards. While conducting it has a small forward voltage across it, and so it dissipates some heat. If the reverse voltage exceeds its rating it can break down and fail.',
    applications: ['AC to DC rectifiers', 'Reverse-polarity protection', 'Blocking reverse current'],
    terminals: [t('anode', 'Anode (+ side when conducting)', 'anode', 'anode'), t('cathode', 'Cathode (marked end)', 'cathode', 'cathode')],
    specifications: DIODE_SPECS, symbol: symbol('sym.rectifier-diode', DIODE), simulation: only(),
  },
  {
    ...D, id: 'def.zener-diode', name: 'Zener diode', aliases: ['reference diode', 'breakdown diode', 'voltage reference diode'], roles: ['protection', 'power-electronics'], tags: ['diode', 'semiconductor', 'voltage-reference', 'clamping'],
    beginnerSummary: 'A diode designed to be used in the reverse direction. When the reverse voltage reaches its breakdown (Zener) voltage it conducts and holds the voltage close to that value, without being damaged as long as its power limit is respected.',
    electricalPurpose: 'Provides a fixed reference voltage or clamps a voltage so it cannot rise above a set level. A series resistor must limit the current through it: without one it can overheat. In the forward direction it behaves like an ordinary diode.',
    applications: ['Simple voltage references', 'Voltage clamping', 'Protecting inputs from over-voltage'],
    terminals: [t('anode', 'Anode', 'anode', 'anode'), t('cathode', 'Cathode (marked end)', 'cathode', 'cathode')],
    specifications: [spec('zenerVoltage', 'Zener (breakdown) voltage', 'The reverse voltage at which the diode starts to hold the voltage steady.', 'voltage', VOLT, 'VZ'), spec('powerRating', 'Power rating', 'How much heat power the diode can dissipate without damage.', 'power', WATT, 'P')],
    formulas: [f('series-resistor', 'Series resistor for a Zener', 'R = (Vs − VZ) / I', 'Zener in reverse breakdown, fed from a supply Vs through a resistor R.',
      [{ symbol: 'R', meaning: 'series resistor', dimension: 'resistance' }, { symbol: 'Vs', meaning: 'supply voltage', dimension: 'voltage' }, { symbol: 'VZ', meaning: 'Zener voltage', dimension: 'voltage' }, { symbol: 'I', meaning: 'chosen current', dimension: 'current' }])],
    symbol: symbol('sym.zener-diode', ZENER), simulation: only(),
  },
  {
    ...D, id: 'def.schottky-diode', name: 'Schottky diode', aliases: ['Schottky barrier diode', 'hot-carrier diode'], roles: ['power-electronics', 'switching'], tags: ['diode', 'semiconductor', 'fast-switching', 'low-drop'],
    beginnerSummary: 'A diode made from a metal-to-semiconductor junction. Compared with an ordinary silicon rectifier diode it has a lower forward voltage and switches faster.',
    electricalPurpose: 'Wastes less power as heat while conducting and works well in fast switching circuits such as switch-mode power supplies. The trade-offs are that it usually has more reverse leakage current and a lower reverse-voltage rating than a comparable rectifier diode.',
    applications: ['Switch-mode power supplies', 'Low-loss rectification', 'Freewheeling and clamping'],
    terminals: [t('anode', 'Anode', 'anode', 'anode'), t('cathode', 'Cathode (marked end)', 'cathode', 'cathode')],
    specifications: DIODE_SPECS, symbol: symbol('sym.schottky-diode', SCHOTTKY), simulation: only(),
  },
  {
    ...D, id: 'def.led', name: 'Light-emitting diode (LED)', aliases: ['LED', 'light emitting diode'], roles: ['load'], tags: ['diode', 'semiconductor', 'light', 'indicator'],
    beginnerSummary: 'A diode that gives off light when current flows through it in the forward direction. It has an anode and a cathode and works only one way round.',
    electricalPurpose: 'Used as an indicator or light source. Its brightness follows the current, not the voltage, so it must always have a current-limiting resistor or driver in series: connected straight to a supply it can be destroyed.',
    applications: ['Indicator lights', 'Displays', 'Lighting'],
    terminals: [t('anode', 'Anode (+)', 'anode', 'anode'), t('cathode', 'Cathode (−)', 'cathode', 'cathode')],
    specifications: [spec('forwardVoltage', 'Forward voltage', 'The voltage across the LED while it lights.', 'voltage', VOLT, 'VF'), spec('forwardCurrent', 'Forward current', 'The current the LED is designed to carry while lit.', 'current', AMP, 'IF')],
    formulas: [f('led-resistor', 'Series resistor for an LED', 'R = (Vs − VF) / I', 'LED lit and fed from a supply Vs through a resistor R.',
      [{ symbol: 'R', meaning: 'series resistor', dimension: 'resistance' }, { symbol: 'Vs', meaning: 'supply voltage', dimension: 'voltage' }, { symbol: 'VF', meaning: 'LED forward voltage', dimension: 'voltage' }, { symbol: 'I', meaning: 'chosen LED current', dimension: 'current' }])],
    symbol: symbol('sym.led', LED), simulation: only(),
  },
];
