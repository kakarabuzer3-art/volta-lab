// -----------------------------------------------------------------------------
// Load Lab V1 — the *non-visual* half of the feature: catalogue metadata, form → typed Load conversion,
// and the connection coordinator. No DOM, no three.js, no electrical equations (those stay in loads.ts /
// engine.ts). The UI collects text, this module converts units, validates and calls the EXISTING factories.
//
// Five loads only (V1): resistor, inductor, capacitor, series RLC, DC motor. The AC-input supply and DC
// module exist in loads.ts but are planned for V1.1 and are deliberately NOT in this catalogue.
// -----------------------------------------------------------------------------
import { capacitiveLoad, dcMotorLoad, inductiveLoad, resistiveLoad, rlcLoad } from './loads.ts';
import type { DataSource, Load, LoadRatings } from './loads.ts';
import { deepFreeze } from './battery.ts';
import type { Connection, Snapshot } from './engine.ts';
import { validateLoad } from './validate.ts';

export type LoadTypeId = 'resistor' | 'inductor' | 'capacitor' | 'rlc' | 'dc-motor';
export type LoadCategory = 'Basic electrical loads' | 'Electromechanical loads';

export interface UnitOption { label: string; /** multiply the typed number by this to get canonical SI */ factor: number }
export interface FieldSpec {
  key: string;
  label: string;
  symbol: string;
  help: string;
  /** Beginner-readable unit name, e.g. “ohms (Ω)”, shown beside the field. */
  term: string;
  units: readonly UnitOption[];
  /** Valid range in canonical SI, inclusive. `min` 0 means zero is allowed. */
  min: number;
  max: number;
  optional?: boolean;
}
export interface LoadTypeSpec {
  id: LoadTypeId;
  name: string;
  category: LoadCategory;
  summary: string;
  /** What this part does in an electrical circuit, in plain words. */
  role: string;
  inputSupport: string;
  acBehaviour: string;
  dcBehaviour: string;
  limitation: string;
  /** Inner SVG markup for a 64×24 symbol (decorative). */
  symbol: string;
  params: readonly FieldSpec[];
  /** ILLUSTRATIVE educational values, in the first unit of each field. Not a real product. */
  preset: Readonly<Record<string, string>>;
}

const OHM: readonly UnitOption[] = [{ label: 'Ω', factor: 1 }, { label: 'kΩ', factor: 1e3 }, { label: 'mΩ', factor: 1e-3 }];
const HENRY: readonly UnitOption[] = [{ label: 'H', factor: 1 }, { label: 'mH', factor: 1e-3 }, { label: 'µH', factor: 1e-6 }];
const FARAD: readonly UnitOption[] = [{ label: 'µF', factor: 1e-6 }, { label: 'mF', factor: 1e-3 }, { label: 'nF', factor: 1e-9 }, { label: 'F', factor: 1 }];
const one = (label: string): readonly UnitOption[] => [{ label, factor: 1 }];

const R_WIRE = { min: 1e-3, max: 1e9 };
const field = (key: string, label: string, symbol: string, help: string, term: string, units: readonly UnitOption[], range: { min: number; max: number }, optional = false): FieldSpec =>
  ({ key, label, symbol, help, term, units, min: range.min, max: range.max, optional });

/** Optional ratings shared by every load. Left blank = unspecified (null): the model then makes no rating check. */
export const OPTIONAL_RATINGS: readonly FieldSpec[] = [
  field('ratedCurrentA', 'Rated current (optional)', 'I rated', 'If you enter it, the load is flagged “overloaded” when it draws more than this. Leave blank for no check.', 'amperes (A), the unit of current', one('A'), { min: 1e-6, max: 1e6 }, true),
  field('ratedPowerW', 'Rated power (optional)', 'P rated', 'If you enter it, the load is flagged “overloaded” when its real power is above this. Leave blank for no check.', 'watts (W), the unit of power', one('W'), { min: 1e-6, max: 1e9 }, true),
];

export const LOAD_CATALOGUE: readonly LoadTypeSpec[] = [
  {
    id: 'resistor', name: 'Resistor', category: 'Basic electrical loads',
    summary: 'Turns electrical energy into heat. Current follows Ohm’s law, I = V / R.',
    role: 'Limits the current and turns electrical energy into heat. A heater element is a resistor, and so is the simplest possible load.',
    inputSupport: 'AC or DC', symbol: '<path d="M2 12h12l3-8 6 16 6-16 6 16 6-16 3 8h18" />',
    acBehaviour: 'Current is in phase with voltage, so power factor is 1. Real power = V × I.',
    dcBehaviour: 'Steady current I = V / R, power P = V × I.',
    limitation: 'Ideal resistance only: no temperature coefficient, no inductance of the wire.',
    params: [field('ohms', 'Resistance', 'R', 'Larger resistance means less current for the same voltage.', 'ohms (Ω), the unit of resistance', OHM, R_WIRE), ...OPTIONAL_RATINGS],
    preset: { ohms: '50' },
  },
  {
    id: 'inductor', name: 'Inductor (coil)', category: 'Basic electrical loads',
    summary: 'A coil of wire. Modelled as its winding resistance in series with its inductance.',
    role: 'Stores energy in a magnetic field and resists changes in current. Coils like this are found in chokes, filters, relays and motor windings.',
    inputSupport: 'AC or DC', symbol: '<path d="M2 12h8c0-9 10-9 10 0c0-9 10-9 10 0c0-9 10-9 10 0h2m0 0h20" />',
    acBehaviour: 'Reactance XL = 2πfL limits current and makes it lag the voltage (power factor below 1).',
    dcBehaviour: 'Once settled, only the winding resistance limits current: I = V / R.',
    limitation: 'Steady-state only: no switching transients or magnetic saturation.',
    params: [
      field('ohms', 'Winding resistance', 'R', 'The resistance of the wire in the coil.', 'ohms (Ω), the unit of resistance', OHM, R_WIRE),
      field('henries', 'Inductance', 'L', 'Larger inductance opposes AC current more.', 'henries (H), the unit of inductance', HENRY, { min: 1e-9, max: 1e3 }),
      ...OPTIONAL_RATINGS,
    ],
    preset: { ohms: '20', henries: '0.1' },
  },
  {
    id: 'capacitor', name: 'Capacitor (in series)', category: 'Basic electrical loads',
    summary: 'Stores energy in an electric field. Connected in series across the output.',
    role: 'Passes changing (AC) current but blocks steady (DC) current. Used for smoothing, filtering and coupling signals.',
    inputSupport: 'AC (blocks steady DC)', symbol: '<path d="M2 12h24M26 3v18M38 3v18M38 12h24" />',
    acBehaviour: 'Reactance XC = 1 / (2πfC); current leads the voltage. Larger C passes more current.',
    dcBehaviour: 'An ideal series capacitor blocks steady DC: the model shows 0 A.',
    limitation: 'Ideal capacitor plus a series resistance (ESR). No charging transient, no leakage, no voltage rating.',
    params: [
      field('farads', 'Capacitance', 'C', 'Larger capacitance has lower reactance at 50 Hz.', 'farads (F); 1 µF (microfarad) is one-millionth of a farad', FARAD, { min: 1e-12, max: 10 }),
      field('esrOhm', 'Equivalent series resistance (ESR)', 'ESR', 'Small internal resistance of a real capacitor. Zero is allowed.', 'ohms (Ω), the unit of resistance', OHM, { min: 0, max: 1e6 }),
      ...OPTIONAL_RATINGS,
    ],
    preset: { farads: '100', esrOhm: '0.1' },
  },
  {
    id: 'rlc', name: 'Series RLC circuit', category: 'Basic electrical loads',
    summary: 'RLC means resistor, inductor and capacitor. All three are connected in series, so the opposition to current depends on frequency.',
    role: 'Combines resistance (R), inductance (L) and capacitance (C). Its total opposition to AC (impedance, Z) changes with frequency, which is the basis of filters and tuned circuits.',
    inputSupport: 'AC (blocks steady DC)', symbol: '<path d="M2 12h6l2-6 4 12 4-12 2 6h4c0-8 8-8 8 0c0-8 8-8 8 0h2M44 3v18M52 3v18M52 12h10" />',
    acBehaviour: 'Z = √(R² + (XL − XC)²). The model reports RMS current, real, reactive and apparent power and power factor.',
    dcBehaviour: 'The series capacitor blocks steady DC: the model shows 0 A.',
    limitation: 'Steady-state phasor model at the fixed 50 Hz source. No transients or resonance sweep.',
    params: [
      field('ohms', 'Resistance', 'R', 'Sets the real power lost as heat.', 'ohms (Ω), the unit of resistance', OHM, R_WIRE),
      field('henries', 'Inductance', 'L', 'Adds inductive reactance XL.', 'henries (H), the unit of inductance', HENRY, { min: 1e-9, max: 1e3 }),
      field('farads', 'Capacitance', 'C', 'Adds capacitive reactance XC.', 'farads (F); 1 µF (microfarad) is one-millionth of a farad', FARAD, { min: 1e-12, max: 10 }),
      ...OPTIONAL_RATINGS,
    ],
    preset: { ohms: '20', henries: '0.1', farads: '100' },
  },
  {
    id: 'dc-motor', name: 'DC motor', category: 'Electromechanical loads',
    summary: 'Turns electrical energy into rotation. Modelled as winding resistance plus back-EMF, solved at its steady running point.',
    role: 'Converts electrical energy into mechanical turning force. While it spins it generates a back-EMF that opposes the supply, so the running current is lower than the stall current.',
    inputSupport: 'DC only', symbol: '<path d="M2 12h14M48 12h14" /><circle cx="32" cy="12" r="11" /><path d="M26 17v-10l6 6 6-6v10" />',
    acBehaviour: 'Rated for DC only. AC input is flagged as unsupported by the model.',
    dcBehaviour: 'Steady state: V = Ra·I + Ke·ω and Kt·I = load torque + b·ω. A stalled motor draws V / Ra.',
    limitation: 'Steady-state equivalent only: no rotor inertia, start-up, acceleration or mechanical transient.',
    params: [
      field('rArmOhm', 'Armature resistance', 'Ra', 'Winding resistance of the armature. Sets the stall current V / Ra.', 'ohms (Ω), the unit of resistance', OHM, R_WIRE),
      field('kVsPerRad', 'Motor constant', 'K', 'Back-EMF constant (V·s/rad), numerically equal to the torque constant (N·m/A).', 'volt-seconds per radian (V·s/rad)', one('V·s/rad'), { min: 1e-3, max: 1e3 }),
      field('loadTorqueNm', 'Load torque', 'T', 'Mechanical torque the motor must supply. Zero is allowed.', 'newton-metres (N·m), a turning force', one('N·m'), { min: 0, max: 1e4 }),
      field('viscousNmsPerRad', 'Viscous coefficient', 'b', 'Friction proportional to speed. Zero is allowed.', 'newton-metre-seconds per radian (N·m·s/rad)', one('N·m·s/rad'), { min: 0, max: 1e3 }),
      ...OPTIONAL_RATINGS,
    ],
    preset: { rArmOhm: '2', kVsPerRad: '0.5', loadTorqueNm: '0.2', viscousNmsPerRad: '0.001' },
  },
];

export function loadTypeSpec(id: LoadTypeId): LoadTypeSpec {
  const s = LOAD_CATALOGUE.find((l) => l.id === id);
  if (!s) throw new RangeError(`Unknown load type '${String(id)}'`);
  return s;
}

// ------------------------------------------------------------------ parsing / unit conversion / validation

export type RawField = { value: string; unitIndex: number };
export type RawForm = Readonly<Record<string, RawField | undefined>>;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Format an SI value with the most readable unit of `units` (used for range hints and messages). */
export function formatWithUnit(si: number, units: readonly UnitOption[]): string {
  if (si === 0) return `0 ${units[0].label}`;
  let best = units[0];
  for (const u of units) if (Math.abs(si) / u.factor >= 1 && (Math.abs(si) / best.factor < 1 || u.factor > best.factor)) best = u;
  const x = si / best.factor;
  return `${Number(x.toPrecision(4))} ${best.label}`;
}
export function rangeHint(f: FieldSpec): string {
  return `${formatWithUnit(f.min, f.units)} to ${formatWithUnit(f.max, f.units)}`;
}

/** Convert one typed field to canonical SI. Returns the value or a beginner-readable error. */
export function parseField(f: FieldSpec, raw: RawField | undefined): { ok: true; si: number | null } | { ok: false; error: string } {
  const text = (raw?.value ?? '').trim();
  if (text === '') return f.optional ? { ok: true, si: null } : { ok: false, error: `${f.label} is required.` };
  if (!NUMBER.test(text)) return { ok: false, error: `${f.label} must be a plain number such as 20 or 0.5 (not “${text.slice(0, 20)}”).` };
  const unit = f.units[raw?.unitIndex ?? 0];
  if (!unit) return { ok: false, error: `${f.label}: choose a unit.` };
  const si = Number(text) * unit.factor;
  if (!Number.isFinite(si)) return { ok: false, error: `${f.label} is too large.` };
  if (si < 0) return { ok: false, error: `${f.label} cannot be negative.` };
  if (si === 0 && f.min > 0) return { ok: false, error: `${f.label} must be greater than 0 (allowed: ${rangeHint(f)}).` };
  if (si < f.min || si > f.max) return { ok: false, error: `${f.label} must be between ${rangeHint(f)}.` };
  return { ok: true, si };
}

export type BuildResult =
  | { ok: true; load: Load; si: Readonly<Record<string, number | null>> }
  | { ok: false; errors: Readonly<Record<string, string>> };

/**
 * Validate a form and build the typed engine Load through the EXISTING factories. `source` is 'user-specified' for typed values and
 * 'illustrative-fixture' only for an unmodified educational preset. Nothing is clamped: bad input is rejected with the field name.
 */
export function buildLoad(id: LoadTypeId, form: RawForm, source: DataSource = 'user-specified'): BuildResult {
  const spec = loadTypeSpec(id);
  const si: Record<string, number | null> = {};
  const errors: Record<string, string> = {};
  for (const f of [...spec.params]) {
    const r = parseField(f, form[f.key]);
    if (r.ok) si[f.key] = r.si; else errors[f.key] = r.error;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const ratings: Partial<LoadRatings> = {};
  if (si.ratedCurrentA != null) ratings.ratedCurrentA = si.ratedCurrentA;
  if (si.ratedPowerW != null) ratings.ratedPowerW = si.ratedPowerW;
  const n = (k: string): number => si[k] as number;
  try {
    let load: Load;
    switch (id) {
      case 'resistor': load = resistiveLoad(n('ohms'), ratings, undefined, source); break;
      case 'inductor': load = inductiveLoad(n('ohms'), n('henries'), ratings, undefined, source); break;
      case 'capacitor': load = capacitiveLoad(n('farads'), n('esrOhm'), ratings, undefined, source); break;
      case 'rlc': load = rlcLoad(n('ohms'), n('henries'), n('farads'), ratings, undefined, source); break;
      case 'dc-motor': load = dcMotorLoad({ rArmOhm: n('rArmOhm'), kVsPerRad: n('kVsPerRad'), loadTorqueNm: n('loadTorqueNm'), viscousNmsPerRad: n('viscousNmsPerRad') }, ratings, undefined, source); break;
    }
    return { ok: true, load: { ...load, label: friendlyLabel(id, si) }, si };
  } catch (e) {
    // Defence in depth: the existing model validation is the final authority.
    return { ok: false, errors: { _form: e instanceof Error ? e.message : String(e) } };
  }
}

function friendlyLabel(id: LoadTypeId, si: Readonly<Record<string, number | null>>): string {
  const spec = loadTypeSpec(id);
  const part = (k: string): string => { const f = spec.params.find((p) => p.key === k) as FieldSpec; return formatWithUnit(si[k] as number, f.units); };
  switch (id) {
    case 'resistor': return `Resistor ${part('ohms')}`;
    case 'inductor': return `Inductor ${part('ohms')} + ${part('henries')}`;
    case 'capacitor': return `Capacitor ${part('farads')}, ESR ${part('esrOhm')}`;
    case 'rlc': return `Series RLC ${part('ohms')} / ${part('henries')} / ${part('farads')}`;
    case 'dc-motor': return `DC motor Ra ${part('rArmOhm')}, K ${part('kVsPerRad')}`;
  }
}

// ------------------------------------------------------------------ connection coordinator

export type EffectiveKind = 'open' | 'short' | 'load';
export interface Resolved {
  connection: Connection;
  kind: EffectiveKind;
  /** True when the leads touch while a load is connected. The load is kept; the touch is NOT turned into a short. */
  conflict: boolean;
}

/**
 * The single owner of "what is connected to the output". Physical wire contact is an INPUT to `resolve()`;
 * a connected load always wins, so touching the wire tips can never silently replace (and lose) the user's load.
 * The returned `connection` object is cached, so the engine sees a stable identity frame to frame.
 */
export class ConnectionCoordinator {
  private load: Load | null = null;
  private reversed = false;
  private loadConn: Connection | null = null;
  private rev = 0;
  private static readonly OPEN: Connection = Object.freeze({ kind: 'open' as const });
  private static readonly SHORT: Connection = Object.freeze({ kind: 'short' as const });

  /** Increments on every connect / disconnect, so callers can detect a change cheaply. */
  get revision(): number { return this.rev; }
  get loadConnected(): boolean { return this.load !== null; }
  get connectedLoad(): Load | null { return this.load; }

  /** Validate and connect. Refused (nothing changes) if the leads are touching or the load is invalid. */
  connectLoad(load: Load, leadsTouching: boolean, reversed = false): { ok: true } | { ok: false; reason: string } {
    if (typeof reversed !== 'boolean') throw new RangeError(`reversed must be a boolean; got ${String(reversed)}`);
    validateLoad(load);
    if (leadsTouching) return { ok: false, reason: 'The two lead tips are touching (a short-circuit test). Separate the leads first, then connect the load.' };
    const frozen = deepFreeze(structuredClone(load)); // own copy: later mutation of the caller's object cannot bypass validation
    this.load = frozen; this.reversed = reversed;
    this.loadConn = Object.freeze({ kind: 'load' as const, load: frozen, reversed });
    this.rev++;
    return { ok: true };
  }
  disconnectLoad(): void {
    if (!this.load) return;
    this.load = null; this.loadConn = null; this.rev++;
  }
  /** May the physical leads be brought together now? Not while a load is connected. */
  canTouchLeads(): { ok: true } | { ok: false; reason: string } {
    return this.load ? { ok: false, reason: 'A load is connected. Disconnect it in the Workbench (Load Lab) before testing a short circuit.' } : { ok: true };
  }
  resolve(leadsTouching: boolean): Resolved {
    if (this.loadConn) return { connection: this.loadConn, kind: 'load', conflict: leadsTouching };
    if (leadsTouching) return { connection: ConnectionCoordinator.SHORT, kind: 'short', conflict: false };
    return { connection: ConnectionCoordinator.OPEN, kind: 'open', conflict: false };
  }
}

// ------------------------------------------------------------------ results (presentation of the engine snapshot only)

export interface LoadResults {
  label: string;
  dataSource: string;
  inputMode: 'AC' | 'DC';
  /** True while the machine is actually applying a drive to the load. */
  driven: boolean;
  terminalVoltage: { value: number; unit: string };
  current: { value: number; unit: string };
  realPowerW: number;
  /** AC only; null = not defined for DC (shown as unavailable, never invented). */
  apparentVA: number | null;
  reactiveVAr: number | null;
  powerFactor: number | null;
  tempC: number;
  health: string;
  reasons: readonly string[];
  status: string;
}

/** Read-only view of what the engine computed. No physics here: every number is copied from the snapshot. */
export function describeLoadResults(s: Snapshot): LoadResults | null {
  if (!s.load) return null;
  const ac = s.output.kind === 'ac';
  const op = s.load.op;
  const driven = s.inputs.powerOn && op.connected && s.status !== 'off' && s.status !== 'tripped' && s.status !== 'battery-empty';
  const status = !s.inputs.powerOn ? 'Machine OFF: nothing is applied to the load.'
    : s.status === 'battery-empty' ? 'Battery empty: output disabled, no drive applied.'
    : s.status === 'tripped' ? `Protective shutdown: ${s.protection.message ?? 'output disabled'}`
    : s.load.health.state === 'damaged' ? 'Load permanently damaged (modelled as an open circuit).'
    : s.load.health.state === 'protection' ? 'Load protection latched: the load is disconnected from the drive.'
    : 'Load is being driven by the machine output.';
  return {
    label: s.load.label,
    dataSource: s.load.dataSource,
    inputMode: ac ? 'AC' : 'DC',
    driven,
    terminalVoltage: { value: s.output.voltage, unit: ac ? 'V RMS' : 'V DC' },
    current: { value: ac ? op.currentA : Math.abs(op.currentA), unit: ac ? 'A RMS' : 'A DC' },
    realPowerW: op.pRealW,
    apparentVA: ac && driven ? op.sVA : null,
    reactiveVAr: ac && driven ? op.qVAr : null,
    powerFactor: ac && driven ? op.powerFactor : null,
    tempC: s.load.health.tempC,
    health: s.load.health.state,
    reasons: s.load.health.reasons,
    status,
  };
}
