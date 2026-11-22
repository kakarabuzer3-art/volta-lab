// -----------------------------------------------------------------------------
// Engineering quantities and units for the component library.
//
// Rules: SI internally, units always explicit, nothing converted silently, nothing guessed from a bare number.
// A `Quantity` stores the SI value, its physical dimension and the canonical unit symbol; a display unit (for example µF) is optional
// and only changes how the number is shown. Conversions throw `UnitError` for an unknown unit or a unit of the wrong dimension.
//
// This module has no imports (no simulator, no UI, no three.js). The simulator's Load Lab keeps its own form conversion
// (src/sim/loadlab.ts); a test checks that both agree on every unit the Load Lab offers.
// -----------------------------------------------------------------------------

export type Dimension =
  | 'resistance' | 'capacitance' | 'inductance' | 'voltage' | 'current' | 'power' | 'frequency' | 'temperature'
  | 'length' | 'time' | 'torque' | 'motor-constant' | 'viscous-coefficient' | 'ratio';

export interface Quantity {
  readonly dimension: Dimension;
  /** The value in the canonical SI unit of `dimension`. */
  readonly si: number;
  /** The canonical unit symbol for `dimension` (for example 'F'). Always stated, never implied. */
  readonly canonicalUnit: string;
  /** Preferred unit for display (for example 'µF'). Presentation only. */
  readonly displayUnit?: string;
}

export type Tolerance =
  | { readonly kind: 'relative'; readonly minusFraction: number; readonly plusFraction: number }
  | { readonly kind: 'absolute'; readonly minusSi: number; readonly plusSi: number };

/** The conditions a value was specified or measured under. Each entry is an explicit quantity. */
export interface OperatingConditions {
  readonly temperature?: Quantity;
  readonly frequency?: Quantity;
  readonly dcBias?: Quantity;
  readonly note?: string;
}

/** Min, typical, nominal and max values (all SI) of one dimension. At least one value must be present. */
export interface QuantityRange {
  readonly dimension: Dimension;
  readonly canonicalUnit: string;
  readonly displayUnit?: string;
  readonly min?: number;
  readonly typical?: number;
  readonly nominal?: number;
  readonly max?: number;
  readonly tolerance?: Tolerance;
  readonly conditions?: OperatingConditions;
}

export interface UnitDef {
  readonly symbol: string;
  readonly dimension: Dimension;
  /** SI value = value × factor + offset. */
  readonly factor: number;
  readonly offset: number;
  readonly canonical: boolean;
}

export class UnitError extends RangeError {}

const u = (dimension: Dimension, symbol: string, factor: number, canonical = false, offset = 0): UnitDef => ({ symbol, dimension, factor, offset, canonical });

// Symbols use the same characters as the simulator's Load Lab (Ω is U+03A9, µ is the micro sign U+00B5, the middle dot is U+00B7; a unit test
// checks every unit the Load Lab offers). Lookup normalises with NFKC, so the micro sign and the Greek mu, and the ohm sign and Greek omega,
// are each the same symbol.
const UNITS: readonly UnitDef[] = [
  u('resistance', 'Ω', 1, true), u('resistance', 'mΩ', 1e-3), u('resistance', 'kΩ', 1e3), u('resistance', 'MΩ', 1e6),
  u('capacitance', 'F', 1, true), u('capacitance', 'mF', 1e-3), u('capacitance', 'µF', 1e-6), u('capacitance', 'nF', 1e-9), u('capacitance', 'pF', 1e-12),
  u('inductance', 'H', 1, true), u('inductance', 'mH', 1e-3), u('inductance', 'µH', 1e-6), u('inductance', 'nH', 1e-9),
  u('voltage', 'V', 1, true), u('voltage', 'mV', 1e-3), u('voltage', 'kV', 1e3),
  u('current', 'A', 1, true), u('current', 'mA', 1e-3), u('current', 'µA', 1e-6), u('current', 'kA', 1e3),
  u('power', 'W', 1, true), u('power', 'mW', 1e-3), u('power', 'kW', 1e3), u('power', 'MW', 1e6),
  u('frequency', 'Hz', 1, true), u('frequency', 'kHz', 1e3), u('frequency', 'MHz', 1e6),
  u('temperature', 'K', 1, true), u('temperature', '°C', 1, false, 273.15),
  u('length', 'm', 1, true), u('length', 'cm', 1e-2), u('length', 'mm', 1e-3), u('length', 'µm', 1e-6),
  u('time', 's', 1, true), u('time', 'ms', 1e-3), u('time', 'µs', 1e-6),
  u('torque', 'N·m', 1, true), u('torque', 'mN·m', 1e-3),
  u('motor-constant', 'V·s/rad', 1, true),
  u('viscous-coefficient', 'N·m·s/rad', 1, true),
  u('ratio', '1', 1, true), u('ratio', '%', 1e-2),
];

/** Dimensions whose SI value can never be negative (a negative resistance, capacitance, length and so on is a data error). */
const NON_NEGATIVE: ReadonlySet<Dimension> = new Set<Dimension>(['resistance', 'capacitance', 'inductance', 'frequency', 'temperature', 'length', 'time', 'viscous-coefficient']);
export const isNonNegativeDimension = (d: Dimension): boolean => NON_NEGATIVE.has(d);

const norm = (s: string): string => s.normalize('NFKC');
const BY_SYMBOL = new Map<string, UnitDef>(UNITS.map((d) => [`${d.dimension}|${norm(d.symbol)}`, d]));
const ANY_SYMBOL = new Map<string, UnitDef[]>();
for (const d of UNITS) { const k = norm(d.symbol); ANY_SYMBOL.set(k, [...(ANY_SYMBOL.get(k) ?? []), d]); }

export const DIMENSIONS: readonly Dimension[] = [...new Set(UNITS.map((d) => d.dimension))];
export function unitsOf(dimension: Dimension): readonly UnitDef[] { return UNITS.filter((d) => d.dimension === dimension); }
export function canonicalUnitOf(dimension: Dimension): string {
  const d = UNITS.find((x) => x.dimension === dimension && x.canonical);
  if (!d) throw new UnitError(`Unknown dimension '${String(dimension)}'`);
  return d.symbol;
}

/**
 * Find a unit by its exact symbol (case-sensitive: 'mΩ' is not 'MΩ'). When `dimension` is given the unit must belong to it. A symbol that
 * exists in several dimensions is never guessed: it is returned only when `dimension` disambiguates it.
 */
export function findUnit(symbol: string, dimension?: Dimension): UnitDef | undefined {
  if (dimension) return BY_SYMBOL.get(`${dimension}|${norm(symbol)}`);
  const all = ANY_SYMBOL.get(norm(symbol));
  return all && all.length === 1 ? all[0] : undefined;
}
function need(symbol: string, dimension?: Dimension): UnitDef {
  const d = findUnit(symbol, dimension);
  if (!d) throw new UnitError(dimension ? `'${symbol}' is not a known ${dimension} unit` : `'${symbol}' is not a known unit (or is ambiguous without a dimension)`);
  return d;
}

export function toSi(value: number, symbol: string, dimension?: Dimension): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UnitError(`value must be a finite number; got ${String(value)}`);
  const d = need(symbol, dimension);
  return value * d.factor + d.offset;
}
export function fromSi(si: number, symbol: string, dimension?: Dimension): number {
  if (typeof si !== 'number' || !Number.isFinite(si)) throw new UnitError(`SI value must be a finite number; got ${String(si)}`);
  const d = need(symbol, dimension);
  return (si - d.offset) / d.factor;
}
/** Convert between two units of the SAME dimension. Different dimensions (for example Ω to F) are an error, never a conversion. */
export function convert(value: number, from: string, to: string): number {
  const a = need(from);
  const b = need(to, a.dimension);
  return fromSi(toSi(value, a.symbol, a.dimension), b.symbol, b.dimension);
}

export function quantity(value: number, symbol: string, dimension?: Dimension): Quantity {
  const d = need(symbol, dimension);
  const si = toSi(value, d.symbol, d.dimension);
  const canonicalUnit = canonicalUnitOf(d.dimension);
  return d.canonical ? { dimension: d.dimension, si, canonicalUnit } : { dimension: d.dimension, si, canonicalUnit, displayUnit: d.symbol };
}
export function toUnit(q: Quantity, symbol: string): number { return fromSi(q.si, symbol, q.dimension); }

/** Format with an explicit unit (default: the quantity's display unit, else its canonical unit). Four significant digits. */
export function formatQuantity(q: Quantity, symbol?: string): string {
  const unit = symbol ?? q.displayUnit ?? q.canonicalUnit;
  return `${Number(toUnit(q, unit).toPrecision(4))} ${unit}`;
}

export function relativeTolerance(minusFraction: number, plusFraction: number = minusFraction): Tolerance { return { kind: 'relative', minusFraction, plusFraction }; }
/** An absolute tolerance is a DIFFERENCE, so unit offsets (°C) do not apply to it. */
export function absoluteTolerance(minus: number, plus: number, symbol: string, dimension?: Dimension): Tolerance {
  const d = need(symbol, dimension);
  return { kind: 'absolute', minusSi: minus * d.factor, plusSi: plus * d.factor };
}

export interface RangeInput { min?: number; typical?: number; nominal?: number; max?: number; tolerance?: Tolerance; conditions?: OperatingConditions }
/** Build a range from numbers typed in ONE explicit unit. */
export function quantityRange(symbol: string, input: RangeInput, dimension?: Dimension): QuantityRange {
  const d = need(symbol, dimension);
  const conv = (x: number | undefined): number | undefined => (x === undefined ? undefined : toSi(x, d.symbol, d.dimension));
  const r: { -readonly [K in keyof QuantityRange]: QuantityRange[K] } = { dimension: d.dimension, canonicalUnit: canonicalUnitOf(d.dimension) };
  if (!d.canonical) r.displayUnit = d.symbol;
  const min = conv(input.min), typical = conv(input.typical), nominal = conv(input.nominal), max = conv(input.max);
  if (min !== undefined) r.min = min;
  if (typical !== undefined) r.typical = typical;
  if (nominal !== undefined) r.nominal = nominal;
  if (max !== undefined) r.max = max;
  if (input.tolerance) r.tolerance = input.tolerance;
  if (input.conditions) r.conditions = input.conditions;
  return r;
}

// ------------------------------------------------------------------ integrity checks (return problems; never throw)

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function checkQuantity(q: Quantity, expected?: Dimension): string[] {
  const p: string[] = [];
  if (!DIMENSIONS.includes(q.dimension)) return [`unknown dimension '${String(q.dimension)}'`];
  if (expected && q.dimension !== expected) p.push(`dimension is ${q.dimension}, expected ${expected}`);
  if (!isFiniteNumber(q.si)) p.push('si must be a finite number');
  else if (isNonNegativeDimension(q.dimension) && q.si < 0) p.push(`a ${q.dimension} cannot be negative (${q.si})`);
  if (q.canonicalUnit !== canonicalUnitOf(q.dimension)) p.push(`canonicalUnit must be '${canonicalUnitOf(q.dimension)}' for ${q.dimension}, got '${String(q.canonicalUnit)}'`);
  if (q.displayUnit !== undefined && !findUnit(q.displayUnit, q.dimension)) p.push(`displayUnit '${q.displayUnit}' is not a ${q.dimension} unit`);
  return p;
}

/** Integrity of operating conditions: temperature, frequency and DC bias must be quantities of the right dimension. Returns problems. */
export function checkConditions(c: OperatingConditions): string[] {
  const p: string[] = [];
  const one = (name: string, q: Quantity | undefined, dim: Dimension): void => { if (q) for (const m of checkQuantity(q, dim)) p.push(`conditions.${name}: ${m}`); };
  one('temperature', c.temperature, 'temperature'); one('frequency', c.frequency, 'frequency'); one('dcBias', c.dcBias, 'voltage');
  if (c.note !== undefined && c.note.trim() === '') p.push('conditions.note must not be blank');
  return p;
}

export function checkRange(r: QuantityRange, expected?: Dimension): string[] {
  const p: string[] = [];
  if (!DIMENSIONS.includes(r.dimension)) return [`unknown dimension '${String(r.dimension)}'`];
  if (expected && r.dimension !== expected) p.push(`dimension is ${r.dimension}, expected ${expected}`);
  if (r.canonicalUnit !== canonicalUnitOf(r.dimension)) p.push(`canonicalUnit must be '${canonicalUnitOf(r.dimension)}' for ${r.dimension}, got '${String(r.canonicalUnit)}'`);
  if (r.displayUnit !== undefined && !findUnit(r.displayUnit, r.dimension)) p.push(`displayUnit '${r.displayUnit}' is not a ${r.dimension} unit`);
  const named: [string, number | undefined][] = [['min', r.min], ['typical', r.typical], ['nominal', r.nominal], ['max', r.max]];
  const present = named.filter(([, v]) => v !== undefined) as [string, number][];
  if (present.length === 0) p.push('a range needs at least one of min, typical, nominal, max');
  for (const [k, v] of present) {
    if (!isFiniteNumber(v)) p.push(`${k} must be a finite number`);
    else if (isNonNegativeDimension(r.dimension) && v < 0) p.push(`${k} cannot be negative for ${r.dimension} (${v})`);
  }
  if (isFiniteNumber(r.min) && isFiniteNumber(r.max) && r.min > r.max) p.push(`min (${r.min}) is greater than max (${r.max})`);
  for (const k of ['typical', 'nominal'] as const) {
    const v = r[k];
    if (isFiniteNumber(v) && isFiniteNumber(r.min) && v < r.min) p.push(`${k} (${v}) is below min (${r.min})`);
    if (isFiniteNumber(v) && isFiniteNumber(r.max) && v > r.max) p.push(`${k} (${v}) is above max (${r.max})`);
  }
  const t = r.tolerance;
  if (t) {
    if (t.kind === 'relative') {
      if (!isFiniteNumber(t.minusFraction) || !isFiniteNumber(t.plusFraction) || t.minusFraction < 0 || t.plusFraction < 0) p.push('relative tolerance fractions must be finite and ≥ 0');
      else if (t.minusFraction > 1) p.push('relative tolerance below the nominal cannot exceed 100 %');
      if (r.nominal === undefined) p.push('a tolerance needs a nominal value');
    } else if (t.kind === 'absolute') {
      if (!isFiniteNumber(t.minusSi) || !isFiniteNumber(t.plusSi) || t.minusSi < 0 || t.plusSi < 0) p.push('absolute tolerance values must be finite and ≥ 0');
      if (r.nominal === undefined) p.push('a tolerance needs a nominal value');
    } else p.push('tolerance kind must be relative or absolute');
  }
  if (r.conditions) p.push(...checkConditions(r.conditions));
  return p;
}
