// -----------------------------------------------------------------------------
// Volta Lab electrical model (pure functions, SI units, no DOM / Three.js).
//
// This is a SOFTWARE SIMULATION of a bench power source. It does not generate,
// measure or deliver real electrical energy. Every value is computed from the
// explicit equivalent circuit below so voltage, current and power always agree.
//
// Source (Thevenin equivalent):   Voc ──[ Rs ]──●── output terminal A
//                                                │
//                                      load (none, or short with Rc)
//                                                │
//                                      ───────────●── output terminal B
//
//   AC mode : v(t) = sqrt(2) · Vrms · sin(2πft + φ),  displayed as Vrms.
//   DC mode : v(t) = Vdc  (fixed polarity: terminal A positive, B negative).
//
// Load model: the app has no load component. The terminal circuit is either
//   open   – no load, I = 0 (terminal voltage = Voc), or
//   short  – the two cable tips touch: a purely resistive path of Rc (contact
//            resistance). Resistive formulas (I = V/R, P = V·I, PF = 1) apply.
// Anything else (motors, capacitors, LEDs, nonlinear loads) needs a load model
// that does not exist yet and is deliberately NOT approximated here.
// -----------------------------------------------------------------------------

export type SourceMode = 'AC' | 'DC';
export type CircuitState = 'off' | 'open' | 'short' | 'protected';

/** Highest common nominal mains voltage (240/415 V grids; IEC 60038 line-to-line 400 V). */
export const MAX_VOLTAGE = 415;
/** Default AC frequency (Pakistan: 50 Hz). */
export const AC_FREQUENCY_HZ = 50;

/** Thevenin source resistance, AC mode (ohm). Documented model parameter, not a measurement. */
export const AC_SOURCE_RESISTANCE = 2.2;
/** Thevenin source resistance, DC (battery-equivalent) mode (ohm). Batteries are lower-impedance than the AC stage. */
export const DC_SOURCE_RESISTANCE = 0.4;
/** Resistance of two touching cable tips (ohm). */
export const CONTACT_RESISTANCE = 0.05;
/** Electronic current limit (A; RMS in AC mode, DC in DC mode). */
export const CURRENT_LIMIT_A = 10;
/** Protection: a fault that stays in current-limit for this long latches a shutdown (s). */
export const TRIP_DELAY_S = 2;

export interface SourceInput {
  mode: SourceMode;
  /** Main power switch. */
  powered: boolean;
  /** Voltage set-point: RMS volts (AC) or volts DC. Clamped to 0..MAX_VOLTAGE. */
  setVoltage: number;
  /** True when the two exposed cable tips touch (short-circuit fault). */
  shorted: boolean;
  /** True after protection has latched a shutdown (cleared by cycling main power). */
  tripped: boolean;
}

export interface Solution {
  mode: SourceMode;
  state: CircuitState;
  /** Open-circuit (source) voltage actually being produced: RMS (AC) or DC. */
  openCircuitVoltage: number;
  /** Terminal voltage across the output (RMS or DC). Collapses under a short. */
  terminalVoltage: number;
  /** Peak terminal voltage: sqrt(2)·Vrms for AC, equal to Vdc for DC. */
  peakVoltage: number;
  /** Output current: RMS (AC) or DC. */
  current: number;
  /** Current that would flow with no current limit, Voc / (Rs + Rc). 0 when open/off. */
  prospectiveCurrent: number;
  /** True when the electronic current limit is regulating the current. */
  currentLimited: boolean;
  /** Average real power delivered to the load (W). Resistive load, PF = 1. */
  power: number;
  /** Power drawn from the ideal source, Voc · I (W). */
  sourcePower: number;
  /** Power dissipated inside the source / limiter, sourcePower − power (W). */
  internalLoss: number;
  /** Output frequency (Hz). 0 for DC and whenever the output is disabled. */
  frequency: number;
  /** Source resistance in use (ohm). */
  sourceResistance: number;
}

export function clampVoltage(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(MAX_VOLTAGE, Math.max(0, v));
}

export function sourceResistance(mode: SourceMode): number {
  return mode === 'AC' ? AC_SOURCE_RESISTANCE : DC_SOURCE_RESISTANCE;
}

/** Peak of a sinusoid with the given RMS value: Vpk = sqrt(2) · Vrms. */
export function peakFromRms(rms: number): number {
  return Math.SQRT2 * rms;
}

/** Solve the steady-state circuit for the given input. Pure and deterministic. */
export function solveCircuit(input: SourceInput): Solution {
  const mode = input.mode;
  const rs = sourceResistance(mode);
  const base: Solution = {
    mode, state: 'off', openCircuitVoltage: 0, terminalVoltage: 0, peakVoltage: 0, current: 0,
    prospectiveCurrent: 0, currentLimited: false, power: 0, sourcePower: 0, internalLoss: 0,
    frequency: 0, sourceResistance: rs,
  };
  if (!input.powered) return base;
  if (input.tripped) return { ...base, state: 'protected' };

  const voc = clampVoltage(input.setVoltage);
  const frequency = mode === 'AC' ? AC_FREQUENCY_HZ : 0;
  const peakOf = (v: number) => (mode === 'AC' ? peakFromRms(v) : v);

  if (!input.shorted) {
    // Open circuit: terminal voltage = Voc, no load so I = 0, P = 0.
    return { ...base, state: 'open', openCircuitVoltage: voc, terminalVoltage: voc, peakVoltage: peakOf(voc), frequency };
  }

  // Short circuit through contact resistance: I = Voc / (Rs + Rc), then limited.
  const prospective = voc / (rs + CONTACT_RESISTANCE);
  const currentLimited = prospective > CURRENT_LIMIT_A;
  const current = currentLimited ? CURRENT_LIMIT_A : prospective;
  const terminalVoltage = current * CONTACT_RESISTANCE; // V_load = I · R_load
  const power = terminalVoltage * current; // P = V·I = I²·Rc (PF = 1, resistive)
  const sourcePower = voc * current; // Voc · I (in-phase for a resistive circuit)
  return {
    ...base,
    state: 'short',
    openCircuitVoltage: voc,
    terminalVoltage,
    peakVoltage: peakOf(terminalVoltage),
    current,
    prospectiveCurrent: prospective,
    currentLimited,
    power,
    sourcePower,
    internalLoss: sourcePower - power,
    frequency,
  };
}

/** Instantaneous terminal voltage v(t) (V). AC: sqrt(2)·Vrms·sin(2πft+φ). DC: constant, positive polarity. */
export function instantaneousVoltage(s: Solution, t: number, phase = 0): number {
  if (s.state === 'off' || s.state === 'protected') return 0;
  if (s.mode === 'DC') return s.terminalVoltage;
  return s.peakVoltage * Math.sin(2 * Math.PI * s.frequency * t + phase);
}

/** Instantaneous current i(t) (A) for the resistive terminal circuit: i = v/R. Zero when open. */
export function instantaneousCurrent(s: Solution, t: number, phase = 0): number {
  if (s.state !== 'short') return 0;
  return instantaneousVoltage(s, t, phase) / CONTACT_RESISTANCE;
}

/**
 * Advance the protection timer. While the source sits in current limit under a
 * short, time accumulates; after TRIP_DELAY_S the caller must latch `tripped`.
 * Any other condition resets the timer.
 */
export function advanceProtection(timer: number, s: Solution, dt: number): { timer: number; trip: boolean } {
  if (s.state === 'short' && s.currentLimited) {
    const next = timer + Math.max(0, dt);
    return { timer: next, trip: next >= TRIP_DELAY_S };
  }
  return { timer: 0, trip: false };
}
