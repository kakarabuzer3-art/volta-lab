// -----------------------------------------------------------------------------
// Typed electrical-load interface + device-class models + stress / damage model.
//
// Nothing here invents the rating of a real product. A load carries the ratings supplied by
// whoever constructs it (`dataSource`), with `null` meaning "unknown — not checked".
// The factories at the bottom are generic device CLASSES for tests/examples, tagged
// 'illustrative-fixture'; they are not datasheet values of any commercial device.
//
// Failure rules (MODEL ASSUMPTIONS, documented in ELECTRICAL_MODEL.md):
//   • Absolute-maximum voltage exceeded for > OVERSTRESS_DWELL_S         → permanent damage (open-circuit failure)
//   • Reverse voltage beyond vReverseMax on a polarized load             → permanent damage after the same dwell
//   • Temperature ≥ tMaxC  (Cth·dT/dt = Ploss − (T−Ta)/Rth)             → permanent damage
//   • Built-in protection (overcurrentTripA / overvoltageTripV) exceeded → 'protection' (latched, NOT damaged)
//   • Rated current/power exceeded, T ≥ tWarnC, or outside rated window  → overloaded / overheating / warning
// -----------------------------------------------------------------------------
import { seriesRlcAc } from './ac.ts';
import type { AcResponse, SeriesRlc } from './ac.ts';
import { thermalStep } from './thermal.ts';
import { createRectifierState, stepRectifier, peakDetectorBusV } from './rectifier.ts';

export type InputType = 'ac' | 'dc' | 'ac-or-dc';
export type DataSource = 'user-specified' | 'illustrative-fixture';

export interface LoadRatings {
  input: InputType;
  /** Rated operating window (AC: V rms, DC: V). null = unspecified. */
  vRatedMinV: number | null;
  vRatedMaxV: number | null;
  vAbsMaxV: number | null;
  freqMinHz: number | null;
  freqMaxHz: number | null;
  polarized: boolean;
  vReverseMaxV: number | null;
  ratedCurrentA: number | null;
  ratedPowerW: number | null;
  overcurrentTripA: number | null;
  overvoltageTripV: number | null;
  tMaxC: number | null;
  tWarnC: number | null;
}

export interface LoadThermal { cthJPerK: number; rthKPerW: number }

interface LoadBase { label: string; dataSource: DataSource; ratings: LoadRatings; thermal: LoadThermal }

export interface LinearLoad extends LoadBase {
  kind: 'resistive' | 'inductive' | 'capacitive' | 'rlc';
  rlc: SeriesRlc;
  /** Steady-state DC resistance; null when the series capacitor blocks DC. */
  dcRohm: number | null;
}
export interface AcSupplyLoad extends LoadBase {
  kind: 'ac-input-supply';
  /** Bulk capacitor behind the bridge (F). */
  busCapF: number;
  /** Regulated output power delivered downstream (W). */
  pOutW: number;
  efficiency: number;
  /** Bus under-voltage lock-out: supply stops below this mean bus voltage (V). */
  busMinV: number;
  vfV: number;
  rDiodeOhm: number;
  sourceRohm: number;
}
export interface DcMotorLoad extends LoadBase {
  kind: 'dc-motor';
  rArmOhm: number;
  /** Back-EMF constant = torque constant (V·s/rad = N·m/A). */
  kVsPerRad: number;
  loadTorqueNm: number;
  viscousNmsPerRad: number;
}
export interface DcModuleLoad extends LoadBase {
  kind: 'dc-module';
  /** Piece-wise linear diode-like I–V: i = max(0, v − Vf)/Rd (forward), 0 (reverse). */
  vForwardV: number;
  rDynOhm: number;
}
export type Load = LinearLoad | AcSupplyLoad | DcMotorLoad | DcModuleLoad;

export const NO_RATINGS: LoadRatings = {
  input: 'ac-or-dc', vRatedMinV: null, vRatedMaxV: null, vAbsMaxV: null, freqMinHz: null, freqMaxHz: null, polarized: false,
  vReverseMaxV: null, ratedCurrentA: null, ratedPowerW: null, overcurrentTripA: null, overvoltageTripV: null, tMaxC: null, tWarnC: null,
};

// ------------------------------------------------------------------ DC behaviour

/** DC current into the load's + terminal (A) for terminal voltage v (V, load polarity; negative = reversed). */
export function dcCurrentA(load: Load, v: number): number {
  switch (load.kind) {
    case 'resistive': case 'inductive': case 'capacitive': case 'rlc':
      return load.dcRohm === null || load.dcRohm <= 0 ? 0 : v / load.dcRohm;
    case 'dc-module':
      return v > load.vForwardV ? (v - load.vForwardV) / load.rDynOhm : 0;
    case 'dc-motor': {
      // Steady state: V = Ra·I + Ke·ω ; Kt·I = T_load + b·ω  (Kt = Ke).  ω = (|V| − Ra·T/K) / (Ra·b/K + K).
      const a = Math.abs(v), k = load.kVsPerRad;
      const w = (a - (load.rArmOhm * load.loadTorqueNm) / k) / ((load.rArmOhm * load.viscousNmsPerRad) / k + k);
      const i = w > 0 ? (load.loadTorqueNm + load.viscousNmsPerRad * w) / k : a / load.rArmOhm; // stalled: I = V/Ra
      return Math.sign(v) * i;
    }
    case 'ac-input-supply': {
      // Accepts DC of either polarity through its bridge; constant-power bus draw: (|V|−2Vf − I·Rt)·I = Pbus.
      const rt = load.sourceRohm + 2 * load.rDiodeOhm;
      const pBus = load.pOutW / load.efficiency;
      const e = Math.abs(v) - 2 * load.vfV;
      const disc = e * e - 4 * rt * pBus;
      if (e < load.busMinV || disc < 0) return 0; // under-voltage lock-out or cannot sustain the power
      return Math.sign(v) * (rt > 0 ? (e - Math.sqrt(disc)) / (2 * rt) : pBus / e);
    }
  }
}

/** Internal dissipation (W) of the load for DC drive. Supplies deliver `pOutW` downstream; that is not heat here. */
export function dcHeatW(load: Load, v: number): number {
  const i = dcCurrentA(load, v);
  switch (load.kind) {
    case 'ac-input-supply': return Math.max(0, Math.abs(v * i) - (i !== 0 ? load.pOutW : 0));
    case 'dc-motor': return i * i * load.rArmOhm + 0; // mechanical output excluded
    default: return Math.abs(v * i);
  }
}

// ------------------------------------------------------------------ AC behaviour

const supplyCache = new WeakMap<AcSupplyLoad, Map<string, AcResponse & { busMeanV: number; busMinV: number; rippleVpp: number; running: boolean }>>();

/** Steady-state response of a capacitor-input bridge supply, from the cycle-resolved rectifier model (memoised). */
export function acSupplyDetail(load: AcSupplyLoad, vrms: number, f: number) {
  let cache = supplyCache.get(load);
  if (!cache) { cache = new Map(); supplyCache.set(load, cache); }
  const key = `${Math.round(vrms * 4)}|${f}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = { vfV: load.vfV, rDiodeOhm: load.rDiodeOhm, capF: load.busCapF, sourceRohm: load.sourceRohm };
  const pBus = load.pOutW / load.efficiency;
  const off = { impedanceOhm: Infinity, reactanceOhm: 0, phaseRad: 0, irms: 0, ipeak: 0, realPowerW: 0, reactivePowerVAr: 0, apparentVA: 0, powerFactor: 0, kind: 'nonlinear' as const, busMeanV: peakDetectorBusV(vrms, load.vfV), busMinV: 0, rippleVpp: 0, running: false };
  let res = off;
  if (f > 0 && vrms > 0 && peakDetectorBusV(vrms, load.vfV) >= load.busMinV) {
    let st = createRectifierState(peakDetectorBusV(vrms, load.vfV));
    const iOfV = (v: number): number => pBus / Math.max(v, 1);
    let prev = Infinity;
    for (let c = 0; c < 60; c++) {
      st = stepRectifier(spec, st, vrms, f, { iOfV }, 1 / f);
      const L = st.last;
      if (L && Math.abs(L.pRealW - prev) < 1e-4 * Math.max(1, L.pRealW) && c > 3) break;
      prev = L ? L.pRealW : Infinity;
    }
    const L = st.last;
    if (L && L.vOutMinV >= load.busMinV && L.pRealW > 0) {
      res = {
        impedanceOhm: L.isrcRmsA > 0 ? vrms / L.isrcRmsA : Infinity, reactanceOhm: 0, phaseRad: 0, irms: L.isrcRmsA, ipeak: L.isrcPeakA,
        realPowerW: L.pRealW, reactivePowerVAr: Math.sqrt(Math.max(0, L.sVA * L.sVA - L.pRealW * L.pRealW)), apparentVA: L.sVA,
        powerFactor: L.powerFactor ?? 0, kind: 'nonlinear', busMeanV: L.vOutMeanV, busMinV: L.vOutMinV, rippleVpp: L.rippleVpp, running: true,
      };
    }
  }
  cache.set(key, res);
  return res;
}

export function acResponse(load: Load, vrms: number, f: number): AcResponse {
  switch (load.kind) {
    case 'resistive': case 'inductive': case 'capacitive': case 'rlc': return seriesRlcAc(load.rlc, vrms, f);
    case 'ac-input-supply': return acSupplyDetail(load, vrms, f);
    case 'dc-motor': case 'dc-module': {
      // DC-only devices on AC: modelled by DC-equivalent electrical path for |v| (no bridge, no rectification claimed):
      // an unfiltered half-wave through a diode-like or motor winding is NOT modelled -> report as resistive winding
      // resistance for the motor, and as blocking-in-reverse half-wave for a diode-like module.
      if (load.kind === 'dc-motor') return seriesRlcAc({ ohms: load.rArmOhm, henries: 0, farads: null }, vrms, f);
      const vpk = Math.SQRT2 * vrms;
      const n = 2000; let sI2 = 0, sP = 0;
      for (let k = 0; k < n; k++) {
        const v = vpk * Math.sin((2 * Math.PI * (k + 0.5)) / n);
        const i = v > load.vForwardV ? (v - load.vForwardV) / load.rDynOhm : 0;
        sI2 += i * i; sP += v * i;
      }
      const irms = Math.sqrt(sI2 / n), p = sP / n, s = vrms * irms;
      return { impedanceOhm: irms > 0 ? vrms / irms : Infinity, reactanceOhm: 0, phaseRad: 0, irms, ipeak: irms > 0 ? (vpk - load.vForwardV) / load.rDynOhm : 0, realPowerW: p, reactivePowerVAr: Math.sqrt(Math.max(0, s * s - p * p)), apparentVA: s, powerFactor: s > 0 ? p / s : 0, kind: 'nonlinear' };
    }
  }
}

export function acHeatW(load: Load, vrms: number, f: number): number {
  const r = acResponse(load, vrms, f);
  switch (load.kind) {
    case 'ac-input-supply': return Math.max(0, r.realPowerW - (r.realPowerW > 0 ? load.pOutW : 0));
    case 'dc-motor': return r.irms * r.irms * load.rArmOhm;
    case 'capacitive': case 'inductive': case 'resistive': case 'rlc': return r.irms * r.irms * load.rlc.ohms;
    default: return Math.max(0, r.realPowerW);
  }
}

// ------------------------------------------------------------------ stress & damage

export type HealthState = 'normal' | 'warning' | 'overloaded' | 'overheating' | 'protection' | 'damaged';

export interface LoadHealth {
  tempC: number;
  state: HealthState;
  /** Seconds spent beyond an absolute (damaging) limit. */
  overstressS: number;
  /** Causal, human-readable reasons for the current state. */
  reasons: string[];
}

export const OVERSTRESS_DWELL_S = 0.05;

export function createLoadHealth(ambientC = 25): LoadHealth {
  return { tempC: ambientC, state: 'normal', overstressS: 0, reasons: [] };
}

export interface LoadDrive {
  kind: 'ac' | 'dc';
  /** AC: Vrms. DC: signed voltage in the load's own polarity (negative = connected backwards). */
  v: number;
  freqHz: number;
}

export interface LoadOperatingPoint {
  /** Current (AC: Irms, DC: signed). Zero when the load is disconnected by protection / failure. */
  currentA: number;
  peakA: number;
  pRealW: number;
  sVA: number;
  qVAr: number;
  powerFactor: number | null;
  heatW: number;
  connected: boolean;
}

export function loadOperatingPoint(load: Load, health: LoadHealth, drive: LoadDrive): LoadOperatingPoint {
  if (health.state === 'damaged' || health.state === 'protection') return { currentA: 0, peakA: 0, pRealW: 0, sVA: 0, qVAr: 0, powerFactor: null, heatW: 0, connected: false };
  if (drive.kind === 'dc') {
    const i = dcCurrentA(load, drive.v);
    const p = drive.v * i;
    return { currentA: i, peakA: Math.abs(i), pRealW: p, sVA: Math.abs(p), qVAr: 0, powerFactor: null, heatW: dcHeatW(load, drive.v), connected: true };
  }
  const r = acResponse(load, drive.v, drive.freqHz);
  return { currentA: r.irms, peakA: r.ipeak, pRealW: r.realPowerW, sVA: r.apparentVA, qVAr: r.reactivePowerVAr, powerFactor: r.apparentVA > 1e-12 ? r.powerFactor : null, heatW: acHeatW(load, drive.v, drive.freqHz), connected: true };
}

const fmt = (x: number, u: string): string => `${Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)} ${u}`;

/** Advance load health by dt. Pure: returns a new health object. */
export function stepLoadHealth(load: Load, health: LoadHealth, drive: LoadDrive, op: LoadOperatingPoint, ambientC: number, dtS: number): LoadHealth {
  if (health.state === 'damaged') return { ...health, tempC: thermalStep(health.tempC, 0, ambientC, load.thermal.cthJPerK, load.thermal.rthKPerW, dtS) };
  const r = load.ratings;
  const reasons: string[] = [];
  const unit = drive.kind === 'ac' ? 'V rms' : 'V';
  const vmag = Math.abs(drive.v);
  let damage = false, trip = false, over = false, warn = false;
  let stressNow = false;

  if (health.state === 'protection') return { ...health, tempC: thermalStep(health.tempC, 0, ambientC, load.thermal.cthJPerK, load.thermal.rthKPerW, dtS) };

  // Input-type and frequency compatibility (informational + consequence via physics below).
  if (r.input === 'ac' && drive.kind === 'dc') { warn = true; reasons.push('Unsupported input: load is rated for AC but is driven with DC.'); }
  if (r.input === 'dc' && drive.kind === 'ac') { warn = true; reasons.push('Unsupported input: load is rated for DC but is driven with AC.'); }
  if (drive.kind === 'ac') {
    if (r.freqMinHz !== null && drive.freqHz < r.freqMinHz) { warn = true; reasons.push(`Unsupported frequency: ${fmt(drive.freqHz, 'Hz')} is below the allowed ${fmt(r.freqMinHz, 'Hz')}.`); }
    if (r.freqMaxHz !== null && drive.freqHz > r.freqMaxHz) { warn = true; reasons.push(`Unsupported frequency: ${fmt(drive.freqHz, 'Hz')} is above the allowed ${fmt(r.freqMaxHz, 'Hz')}.`); }
  }
  // Polarity.
  if (drive.kind === 'dc' && drive.v < 0 && r.polarized) {
    warn = true; reasons.push(`Reverse polarity: ${fmt(vmag, 'V')} applied backwards to a polarized load.`);
    if (r.vReverseMaxV !== null && vmag > r.vReverseMaxV) { stressNow = true; reasons.push(`Reverse voltage ${fmt(vmag, 'V')} exceeds its ${fmt(r.vReverseMaxV, 'V')} reverse rating.`); }
  }
  // Voltage window.
  if (r.vRatedMaxV !== null && vmag > r.vRatedMaxV) { warn = true; reasons.push(`Overvoltage: ${fmt(vmag, unit)} exceeds the rated maximum ${fmt(r.vRatedMaxV, unit)}.`); }
  if (r.vRatedMinV !== null && vmag > 0 && vmag < r.vRatedMinV) { warn = true; reasons.push(`Insufficient voltage: ${fmt(vmag, unit)} is below the rated minimum ${fmt(r.vRatedMinV, unit)}.`); }
  if (r.vAbsMaxV !== null && vmag > r.vAbsMaxV) { stressNow = true; reasons.push(`Absolute maximum exceeded: ${fmt(vmag, unit)} > ${fmt(r.vAbsMaxV, unit)}.`); }
  if (r.overvoltageTripV !== null && vmag > r.overvoltageTripV) { trip = true; reasons.push(`Overvoltage protection tripped at ${fmt(vmag, unit)} (threshold ${fmt(r.overvoltageTripV, unit)}).`); }
  // Current / power.
  if (r.overcurrentTripA !== null && Math.abs(op.currentA) > r.overcurrentTripA) { trip = true; reasons.push(`Overcurrent protection tripped at ${fmt(Math.abs(op.currentA), 'A')} (threshold ${fmt(r.overcurrentTripA, 'A')}).`); }
  if (r.ratedCurrentA !== null && Math.abs(op.currentA) > r.ratedCurrentA) { over = true; reasons.push(`Overcurrent: ${fmt(Math.abs(op.currentA), 'A')} exceeds the rated ${fmt(r.ratedCurrentA, 'A')}.`); }
  if (r.ratedPowerW !== null && Math.abs(op.pRealW) > r.ratedPowerW) { over = true; reasons.push(`Excess input power: ${fmt(Math.abs(op.pRealW), 'W')} exceeds the rated ${fmt(r.ratedPowerW, 'W')}.`); }

  // Dwell above an absolute limit → permanent damage.
  let overstress = health.overstressS;
  if (stressNow && !trip) overstress += dtS; else overstress = Math.max(0, overstress - dtS);
  if (overstress >= OVERSTRESS_DWELL_S) damage = true;

  // Thermal model: Cth·dT/dt = Ploss − (T−Ta)/Rth.
  const tempC = thermalStep(health.tempC, op.heatW, ambientC, load.thermal.cthJPerK, load.thermal.rthKPerW, dtS);
  let hot = false;
  if (r.tWarnC !== null && tempC >= r.tWarnC) { hot = true; reasons.push(`Overheating: ${tempC.toFixed(1)} °C reached the warning level ${r.tWarnC} °C.`); }
  if (r.tMaxC !== null && tempC >= r.tMaxC) { damage = true; reasons.push(`Thermal damage: ${tempC.toFixed(1)} °C reached the maximum ${r.tMaxC} °C.`); }
  if (damage) reasons.push('Permanent failure — modelled as an open circuit.');

  const state: HealthState = damage ? 'damaged' : trip ? 'protection' : hot ? 'overheating' : over ? 'overloaded' : warn ? 'warning' : 'normal';
  return { tempC, state, overstressS: overstress, reasons };
}

// ------------------------------------------------------------------ device-class factories (illustrative fixtures)

const FIXTURE_THERMAL: LoadThermal = { cthJPerK: 50, rthKPerW: 2 };
const positive = (x: number, name: string): number => { if (!(x > 0) || !Number.isFinite(x)) throw new RangeError(`${name} must be a positive finite number`); return x; };

export function resistiveLoad(ohms: number, ratings: Partial<LoadRatings> = {}, thermal: LoadThermal = FIXTURE_THERMAL, dataSource: DataSource = 'illustrative-fixture'): LinearLoad {
  positive(ohms, 'ohms');
  return { kind: 'resistive', label: `Resistive ${ohms} Ω`, dataSource, ratings: { ...NO_RATINGS, ...ratings }, thermal, rlc: { ohms, henries: 0, farads: null }, dcRohm: ohms };
}
export function inductiveLoad(ohms: number, henries: number, ratings: Partial<LoadRatings> = {}, thermal: LoadThermal = FIXTURE_THERMAL, dataSource: DataSource = 'illustrative-fixture'): LinearLoad {
  positive(ohms, 'ohms'); positive(henries, 'henries');
  return { kind: 'inductive', label: `Inductive ${ohms} Ω + ${henries} H`, dataSource, ratings: { ...NO_RATINGS, ...ratings }, thermal, rlc: { ohms, henries, farads: null }, dcRohm: ohms };
}
export function capacitiveLoad(farads: number, esrOhm: number, ratings: Partial<LoadRatings> = {}, thermal: LoadThermal = FIXTURE_THERMAL, dataSource: DataSource = 'illustrative-fixture'): LinearLoad {
  positive(farads, 'farads');
  return { kind: 'capacitive', label: `Capacitive ${farads} F`, dataSource, ratings: { ...NO_RATINGS, ...ratings }, thermal, rlc: { ohms: esrOhm, henries: 0, farads }, dcRohm: null };
}
export function rlcLoad(ohms: number, henries: number, farads: number, ratings: Partial<LoadRatings> = {}, thermal: LoadThermal = FIXTURE_THERMAL, dataSource: DataSource = 'illustrative-fixture'): LinearLoad {
  positive(ohms, 'ohms'); positive(henries, 'henries'); positive(farads, 'farads');
  return { kind: 'rlc', label: `Series RLC ${ohms} Ω / ${henries} H / ${farads} F`, dataSource, ratings: { ...NO_RATINGS, ...ratings }, thermal, rlc: { ohms, henries, farads }, dcRohm: null };
}
export function acInputSupplyLoad(p: { pOutW: number; efficiency: number; busCapF: number; busMinV?: number }, ratings: Partial<LoadRatings> = {}, thermal: LoadThermal = FIXTURE_THERMAL, dataSource: DataSource = 'illustrative-fixture'): AcSupplyLoad {
  positive(p.pOutW, 'pOutW'); positive(p.efficiency, 'efficiency'); positive(p.busCapF, 'busCapF');
  return { kind: 'ac-input-supply', label: `AC-input supply ${p.pOutW} W`, dataSource, ratings: { ...NO_RATINGS, input: 'ac-or-dc', ...ratings }, thermal, busCapF: p.busCapF, pOutW: p.pOutW, efficiency: p.efficiency, busMinV: p.busMinV ?? 90, vfV: 0.9, rDiodeOhm: 0.05, sourceRohm: 1 };
}
export function dcMotorLoad(p: { rArmOhm: number; kVsPerRad: number; loadTorqueNm: number; viscousNmsPerRad: number }, ratings: Partial<LoadRatings> = {}, thermal: LoadThermal = FIXTURE_THERMAL, dataSource: DataSource = 'illustrative-fixture'): DcMotorLoad {
  positive(p.rArmOhm, 'rArmOhm'); positive(p.kVsPerRad, 'kVsPerRad');
  return { kind: 'dc-motor', label: 'DC motor', dataSource, ratings: { ...NO_RATINGS, input: 'dc', ...ratings }, thermal, ...p };
}
export function dcModuleLoad(p: { vForwardV: number; rDynOhm: number }, ratings: Partial<LoadRatings> = {}, thermal: LoadThermal = FIXTURE_THERMAL, dataSource: DataSource = 'illustrative-fixture'): DcModuleLoad {
  positive(p.rDynOhm, 'rDynOhm');
  return { kind: 'dc-module', label: 'Polarized DC module', dataSource, ratings: { ...NO_RATINGS, input: 'dc', polarized: true, ...ratings }, thermal, ...p };
}
