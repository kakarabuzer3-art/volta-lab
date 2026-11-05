// -----------------------------------------------------------------------------
// Battery equivalent-circuit model (SI units, discharge-positive current).
//
//        OCV(SOC,T) ──[ R0(SOC,T) ]──[ R1 ‖ C1 ]── terminal
//
//   Vterminal = OCV(SOC,T) − I·R0(SOC,T) − V1          (I > 0 discharges, I < 0 charges)
//   dV1/dt    = (I·R1 − V1) / (R1·C1)                    (one polarization RC pair, exact exp. step)
//   SOC⁺      = SOC − I·Δt / (3600·Ah)                   (Coulomb counting; charging × η_coulombic)
//   Cth·dT/dt = I²·R0 + V1²/R1 + side-reaction heat − (T − Tamb)/Rth
//
// WHAT THIS IS: a Thevenin/1-RC equivalent circuit with chemistry-specific curves.
// WHAT THIS IS NOT: an electrochemical (reaction / diffusion / ageing) model. It does
// not model capacity fade, hysteresis, self-discharge, plating, or temperature
// derating of usable capacity. See ELECTRICAL_MODEL.md.
//
// PARAMETER PROVENANCE. Every chemistry number carries a provenance tag:
//   'physical-law'              – exact by definition (e.g. Coulomb counting)
//   'engineering-approximation' – standard simplification (e.g. 1-RC network)
//   'literature-typical'        – representative of commonly published ranges for the
//                                 chemistry, NOT fitted to any specific cell datasheet
//   'model-assumption'          – chosen by the modeller; needs calibration to real data
// Nothing here is a measurement of a specific product. Replace with datasheet data.
// -----------------------------------------------------------------------------
import { thermalStep } from './thermal.ts';
import { finite, socFraction, validateChemistryProfile, validatePackConfig } from './validate.ts';

export type Chemistry = 'lead-acid' | 'li-ion';
export type Provenance = 'physical-law' | 'engineering-approximation' | 'literature-typical' | 'model-assumption';
export type Table = ReadonlyArray<readonly [number, number]>;

export interface ChemistryProfile {
  chemistry: Chemistry;
  label: string;
  /** Per-cell open-circuit voltage vs SOC at 25 °C (monotone). */
  ocvTable: Table;
  /** dOCV/dT per cell (V/K). */
  ocvTempCoeffVPerK: number;
  /** Cell DC resistance at 25 °C, SOC factor 1, in mΩ·Ah  (R0_cell = value / 1000 / Ah). */
  r0MohmAh: number;
  /** Multiplier on R0 versus SOC. */
  r0SocFactor: Table;
  /** R0 *= exp(k·(25 − T)); positive k → resistance rises when cold. */
  r0TempCoeffPerK: number;
  /** R1 = r1Ratio · R0. */
  r1Ratio: number;
  /** Polarization time constant R1·C1 (s). */
  tau1S: number;
  cutoffVPerCell: number;
  maxChargeVPerCell: number;
  /** Fraction of charge current that is stored (0–1). */
  coulombicEfficiency: number;
  maxDischargeC: number;
  maxChargeC: number;
  specificEnergyWhPerKg: number;
  cpJPerKgK: number;
  maxTempC: number;
  provenance: Readonly<Record<string, Provenance>>;
  limitations: readonly string[];
}

export const LEAD_ACID: ChemistryProfile = {
  chemistry: 'lead-acid',
  label: 'Lead-acid (generic VRLA/flooded)',
  ocvTable: [[0, 1.96], [0.1, 1.98], [0.25, 2.0], [0.5, 2.03], [0.75, 2.07], [0.9, 2.1], [1, 2.12]],
  ocvTempCoeffVPerK: 0.0002,
  r0MohmAh: 100,
  r0SocFactor: [[0, 2.0], [0.2, 1.4], [0.5, 1.0], [1, 0.9]],
  r0TempCoeffPerK: 0.02,
  r1Ratio: 0.5,
  tau1S: 20,
  cutoffVPerCell: 1.75,
  maxChargeVPerCell: 2.4,
  coulombicEfficiency: 0.9,
  maxDischargeC: 3,
  maxChargeC: 0.3,
  specificEnergyWhPerKg: 35,
  cpJPerKgK: 700,
  maxTempC: 50,
  provenance: {
    ocvTable: 'literature-typical', cutoffVPerCell: 'literature-typical', maxChargeVPerCell: 'literature-typical',
    coulombicEfficiency: 'literature-typical', specificEnergyWhPerKg: 'literature-typical', cpJPerKgK: 'literature-typical',
    ocvTempCoeffVPerK: 'model-assumption', r0MohmAh: 'model-assumption', r0SocFactor: 'model-assumption', r0TempCoeffPerK: 'model-assumption',
    r1Ratio: 'model-assumption', tau1S: 'model-assumption', maxDischargeC: 'model-assumption', maxChargeC: 'model-assumption', maxTempC: 'model-assumption',
    socCounting: 'physical-law', equivalentCircuit: 'engineering-approximation',
  },
  limitations: [
    'No Peukert capacity loss, no sulfation/ageing, no gassing model, no temperature derating of capacity.',
    'OCV curve is a representative shape, not a measured curve of a specific battery.',
    'Charging is a coulombic-efficiency approximation; there is no float/absorption charge algorithm.',
  ],
};

export const LI_ION_NMC: ChemistryProfile = {
  chemistry: 'li-ion',
  label: 'Lithium-ion (generic NMC)',
  ocvTable: [[0, 3.0], [0.05, 3.3], [0.1, 3.45], [0.2, 3.55], [0.3, 3.62], [0.4, 3.67], [0.5, 3.72], [0.6, 3.78], [0.7, 3.86], [0.8, 3.95], [0.9, 4.05], [1, 4.15]],
  ocvTempCoeffVPerK: 0.0001,
  r0MohmAh: 50,
  r0SocFactor: [[0, 2.5], [0.1, 1.4], [0.2, 1.15], [0.5, 1.0], [1, 0.95]],
  r0TempCoeffPerK: 0.03,
  r1Ratio: 0.4,
  tau1S: 15,
  cutoffVPerCell: 3.0,
  maxChargeVPerCell: 4.2,
  coulombicEfficiency: 0.995,
  maxDischargeC: 2,
  maxChargeC: 1,
  specificEnergyWhPerKg: 200,
  cpJPerKgK: 900,
  maxTempC: 60,
  provenance: {
    ocvTable: 'literature-typical', cutoffVPerCell: 'literature-typical', maxChargeVPerCell: 'literature-typical',
    coulombicEfficiency: 'literature-typical', specificEnergyWhPerKg: 'literature-typical', cpJPerKgK: 'literature-typical',
    ocvTempCoeffVPerK: 'model-assumption', r0MohmAh: 'model-assumption', r0SocFactor: 'model-assumption', r0TempCoeffPerK: 'model-assumption',
    r1Ratio: 'model-assumption', tau1S: 'model-assumption', maxDischargeC: 'model-assumption', maxChargeC: 'model-assumption', maxTempC: 'model-assumption',
    socCounting: 'physical-law', equivalentCircuit: 'engineering-approximation',
  },
  limitations: [
    'No capacity fade, SEI growth, lithium plating, hysteresis, diffusion or self-discharge.',
    'OCV curve is a representative NMC shape, not a measured curve of a specific cell.',
    'No CC-CV charge controller and no cell balancing; all cells are identical and share one SOC.',
  ],
};

/** Recursively freeze plain data so shared model constants cannot be altered from outside after load. */
export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}
deepFreeze(LEAD_ACID); deepFreeze(LI_ION_NMC);

export const CHEMISTRIES: Readonly<Record<Chemistry, ChemistryProfile>> = Object.freeze({ 'lead-acid': LEAD_ACID, 'li-ion': LI_ION_NMC });

// --- cell-surface thermal scaling constants (engineering approximation) ----------
/** Surface area of a compact cell ≈ AREA_COEFF · mass^(2/3)  (m², kg), from ρ ≈ 2000 kg/m³ geometry. */
const AREA_COEFF = 0.0378;
/** Natural-convection heat-transfer coefficient (W/m²K); literature-typical 5–25. */
const H_CONVECTION = 10;

// ------------------------------------------------------------------ table helpers

/** Piecewise-linear interpolation, clamped to the table ends. */
export function interpolate(table: Table, x: number): number {
  const n = table.length;
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[n - 1][0]) return table[n - 1][1];
  for (let k = 1; k < n; k++) {
    const [x1, y1] = table[k];
    if (x <= x1) {
      const [x0, y0] = table[k - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[n - 1][1];
}

/** Exact integral of the piecewise-linear table from its first x to `x`. */
export function integrateTable(table: Table, x: number): number {
  const n = table.length;
  let acc = 0;
  for (let k = 1; k < n; k++) {
    const [x0, y0] = table[k - 1];
    const [x1, y1] = table[k];
    if (x >= x1) { acc += 0.5 * (y0 + y1) * (x1 - x0); continue; }
    if (x > x0) { const y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); acc += 0.5 * (y0 + y) * (x - x0); }
    break;
  }
  return acc;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

// ------------------------------------------------------------------ pack model

export interface CellSpec { chemistry: Chemistry; capacityAh: number }
export interface PackConfig { cell: CellSpec; seriesCells: number; parallelStrings: number }

export interface PackModel {
  config: PackConfig;
  profile: ChemistryProfile;
  cells: number;
  /** Pack capacity (Ah) = Np · cell Ah. */
  capacityAh: number;
  /** Nominal pack voltage = Ns · mean cell OCV (V). */
  nominalVoltageV: number;
  /** Pack cutoff voltage = Ns · cell cutoff (V). */
  cutoffV: number;
  maxChargeV: number;
  maxDischargeA: number;
  maxChargeA: number;
  /** Energy from empty to full using the OCV curve (Wh). */
  nominalEnergyWh: number;
  cthJPerK: number;
  rthKPerW: number;
  maxTempC: number;
  tau1S: number;
  ocv(soc: number, tempC: number): number;
  r0(soc: number, tempC: number): number;
  r1(soc: number, tempC: number): number;
  c1(soc: number, tempC: number): number;
}

// Cache keyed by the config VALUES (not object identity), so mutating a config object after construction
// can neither corrupt a cached model nor change an engine that is already running.
const modelCache = new Map<string, PackModel>();

/**
 * Series/parallel pack of identical cells:
 *   Vpack = Ns·Vcell    Ah_pack = Np·Ah_cell    Rpack = Ns·Rcell / Np
 * Capacitance C1 = τ/R1 scales as Np/Ns so that the time constant is unchanged.
 */
export function packModel(input: PackConfig): PackModel {
  validatePackConfig(input);
  const key = `${input.cell.chemistry}|${input.cell.capacityAh}|${input.seriesCells}|${input.parallelStrings}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  // Private immutable copy: later changes to the caller's object cannot reach the model.
  const config: PackConfig = deepFreeze({ cell: { chemistry: input.cell.chemistry, capacityAh: input.cell.capacityAh }, seriesCells: input.seriesCells, parallelStrings: input.parallelStrings });
  const { cell, seriesCells: ns, parallelStrings: np } = config;
  const profile = CHEMISTRIES[cell.chemistry];
  validateChemistryProfile(profile);
  const cells = ns * np;
  const meanOcv = integrateTable(profile.ocvTable, 1);
  const cellEnergyWh = cell.capacityAh * meanOcv;
  const cellMassKg = cellEnergyWh / profile.specificEnergyWhPerKg;
  const cthCell = cellMassKg * profile.cpJPerKgK;
  const rthCell = 1 / (H_CONVECTION * AREA_COEFF * Math.pow(cellMassKg, 2 / 3));
  const r0Cell = (soc: number, tempC: number): number =>
    (profile.r0MohmAh / 1000 / cell.capacityAh) * interpolate(profile.r0SocFactor, soc) * Math.exp(profile.r0TempCoeffPerK * (25 - clamp(tempC, -30, 80)));
  const model: PackModel = {
    config, profile, cells,
    capacityAh: np * cell.capacityAh,
    nominalVoltageV: ns * meanOcv,
    cutoffV: ns * profile.cutoffVPerCell,
    maxChargeV: ns * profile.maxChargeVPerCell,
    maxDischargeA: np * profile.maxDischargeC * cell.capacityAh,
    maxChargeA: np * profile.maxChargeC * cell.capacityAh,
    nominalEnergyWh: ns * np * cellEnergyWh,
    cthJPerK: cells * cthCell,
    rthKPerW: rthCell / cells,
    maxTempC: profile.maxTempC,
    tau1S: profile.tau1S,
    ocv: (soc, tempC) => ns * (interpolate(profile.ocvTable, clamp(soc, 0, 1)) + profile.ocvTempCoeffVPerK * (clamp(tempC, -30, 80) - 25)),
    r0: (soc, tempC) => (ns * r0Cell(clamp(soc, 0, 1), tempC)) / np,
    r1: (soc, tempC) => profile.r1Ratio * ((ns * r0Cell(clamp(soc, 0, 1), tempC)) / np),
    c1: (soc, tempC) => profile.tau1S / (profile.r1Ratio * ((ns * r0Cell(clamp(soc, 0, 1), tempC)) / np)),
  };
  Object.freeze(model);
  modelCache.set(key, model);
  return model;
}

// ------------------------------------------------------------------ state + step

export interface BatteryState {
  /** State of charge 0..1. */
  soc: number;
  /** Polarization voltage across the RC pair (V). */
  v1V: number;
  tempC: number;
  /** Cumulative terminal energy delivered / absorbed (Wh). */
  dischargedWh: number;
  chargedWh: number;
  /** Net terminal energy out of the battery (Wh) = ∫Vt·I dt (negative while charging). */
  terminalNetWh: number;
  /** Cumulative internal losses (Wh): ohmic R0, polarization R1, charge side-reactions. */
  r0LossWh: number;
  r1LossWh: number;
  sideLossWh: number;
  /** Energy currently/cumulatively held by the polarization capacitor C1 (Wh). */
  c1StoredWh: number;
  /** Cumulative chemical energy exchanged Σ OCV·I·Δt (Wh, positive = released). */
  chemicalNetWh: number;
}

export function createBatteryState(soc = 1, tempC = 25): BatteryState {
  socFraction('initial SOC', soc); finite('initial battery temperature (°C)', tempC);
  return { soc, v1V: 0, tempC, dischargedWh: 0, chargedWh: 0, terminalNetWh: 0, r0LossWh: 0, r1LossWh: 0, sideLossWh: 0, c1StoredWh: 0, chemicalNetWh: 0 };
}

/** Terminal voltage for discharge-positive current `i` at the start of a step (V). */
export function batteryTerminalVoltage(pack: PackModel, st: BatteryState, currentA: number): number {
  return pack.ocv(st.soc, st.tempC) - currentA * pack.r0(st.soc, st.tempC) - st.v1V;
}

/** Chemical energy stored above empty, from the OCV curve (Wh). */
export function storedEnergyWh(pack: PackModel, soc: number): number {
  return pack.config.seriesCells * pack.capacityAh * integrateTable(pack.profile.ocvTable, clamp(soc, 0, 1));
}

export interface EffectiveSource {
  ocvV: number; r0Ohm: number; r1Ohm: number;
  /** Thevenin equivalent over one step: Vt_mean = eEffV − I·rEffOhm (exact for the exponential RC step). */
  eEffV: number; rEffOhm: number; kappa: number;
}

/**
 * Over a step Δt the RC branch voltage relaxes exponentially, so its time-mean is
 * V1mean = I·R1·(1−κ) + V1₀·κ with κ = (τ/Δt)(1 − e^(−Δt/τ)).
 * Folding this into a Thevenin pair makes the converter/battery power solve exactly
 * consistent with the battery's energy bookkeeping.
 */
export function batteryEffectiveSource(pack: PackModel, st: BatteryState, dtS: number): EffectiveSource {
  const dt = Math.max(dtS, 0);
  const ocvV = pack.ocv(st.soc, st.tempC);
  const r0Ohm = pack.r0(st.soc, st.tempC);
  const r1Ohm = pack.r1(st.soc, st.tempC);
  // dt → 0 limit is κ = 1 (instantaneous source: E = OCV − V1, R = R0).
  const kappa = dt > 0 ? (-pack.tau1S / dt) * Math.expm1(-dt / pack.tau1S) : 1;
  return { ocvV, r0Ohm, r1Ohm, eEffV: ocvV - st.v1V * kappa, rEffOhm: r0Ohm + r1Ohm * (1 - kappa), kappa };
}

/** Maximum power the battery can deliver right now: E²/(4·R) (W). */
export function maxDischargePowerW(pack: PackModel, st: BatteryState, dtS = 0): number {
  const s = batteryEffectiveSource(pack, st, dtS);
  return s.eEffV > 0 ? (s.eEffV * s.eEffV) / (4 * s.rEffOhm) : 0;
}

export interface BatteryPowerSolution {
  feasible: boolean;
  /** Discharge current (A). If infeasible this is the current at maximum power transfer. */
  currentA: number;
  terminalV: number;
  maxPowerW: number;
}

/**
 * Solve I for a constant-power draw P at the battery terminals:  P = (E − I·R)·I
 *   I = 2P / (E + √(E² − 4·R·P))   (numerically stable root)
 * If P exceeds E²/(4R) the battery physically cannot deliver it.
 */
export function solveBatteryForPower(pack: PackModel, st: BatteryState, powerW: number, dtS = 0): BatteryPowerSolution {
  const s = batteryEffectiveSource(pack, st, dtS);
  const e = s.eEffV;
  const r = s.rEffOhm;
  const maxP = e > 0 ? (e * e) / (4 * r) : 0;
  if (!(powerW > 0)) return { feasible: true, currentA: 0, terminalV: e, maxPowerW: maxP };
  if (e <= 0 || powerW > maxP) return { feasible: false, currentA: e > 0 ? e / (2 * r) : 0, terminalV: e > 0 ? e / 2 : 0, maxPowerW: maxP };
  const i = (2 * powerW) / (e + Math.sqrt(Math.max(0, e * e - 4 * r * powerW)));
  return { feasible: true, currentA: i, terminalV: e - i * r, maxPowerW: maxP };
}

/** Discharge current into a fixed resistance: I = E / (R + RL). */
export function solveBatteryForResistance(pack: PackModel, st: BatteryState, ohms: number, dtS = 0): { currentA: number; terminalV: number } {
  const s = batteryEffectiveSource(pack, st, dtS);
  const i = s.eEffV > 0 ? s.eEffV / (s.rEffOhm + Math.max(0, ohms)) : 0;
  return { currentA: i, terminalV: s.eEffV - i * s.rEffOhm };
}

export type BatteryLimit = 'low-voltage' | 'empty' | 'over-temperature' | 'over-discharge-current' | 'over-charge-current' | 'over-voltage';

/** Limits violated at the given operating point (empty list = inside all limits). */
export function batteryLimits(pack: PackModel, st: BatteryState, terminalV: number, currentA: number): BatteryLimit[] {
  const out: BatteryLimit[] = [];
  if (currentA > 0 && terminalV <= pack.cutoffV) out.push('low-voltage');
  if (currentA > 0 && st.soc <= 0) out.push('empty');
  if (st.tempC >= pack.maxTempC) out.push('over-temperature');
  if (currentA > pack.maxDischargeA * (1 + 1e-9)) out.push('over-discharge-current');
  if (-currentA > pack.maxChargeA * (1 + 1e-9)) out.push('over-charge-current');
  if (currentA < 0 && terminalV >= pack.maxChargeV) out.push('over-voltage');
  return out;
}

export interface BatteryStepResult {
  state: BatteryState;
  /** Current actually applied (A): a battery cannot give more charge than it holds, so this can be < requested. */
  currentA: number;
  /** Time-mean terminal voltage over the step (V). */
  terminalV: number;
  ocvV: number;
  r0Ohm: number;
  /** Mean heat generated inside the pack during this step (W). */
  heatW: number;
}

/**
 * Advance the battery by dt with a constant discharge-positive current.
 * Exact identity per step (both signs of I):
 *   OCV·I·Δt = ∫Vt·I dt + I²R0·Δt + ∫V1·I dt,   ∫V1·I dt = R1-loss + ΔE(C1)
 * Ledger terms are computed analytically from the exponential RC step so the identity holds
 * to floating-point precision. Charging: only η·I is stored; (1−η)·OCV·|I| becomes heat.
 */
export function stepBattery(pack: PackModel, st: BatteryState, currentA: number, dtS: number, ambientC: number): BatteryStepResult {
  const dt = Math.max(0, dtS);
  const eff = batteryEffectiveSource(pack, st, dt);
  const { ocvV, r0Ohm, r1Ohm, kappa } = eff;
  const eta = pack.profile.coulombicEfficiency;
  // Charge-availability limit: SOC cannot go below 0 (discharge) — the step is truncated, never extended.
  const iAvail = dt > 0 ? (st.soc * pack.capacityAh * 3600) / dt : Infinity;
  const i = currentA > 0 ? Math.min(currentA, iAvail) : currentA;
  const tau = pack.tau1S;

  const a = i * r1Ohm;
  const b = st.v1V - a;
  const decay = Math.exp(-dt / tau);
  const v1Next = a + b * decay;
  const v1Mean = a * (1 - kappa) + st.v1V * kappa;
  const vtMean = ocvV - i * r0Ohm - v1Mean;

  // RC branch energy bookkeeping (J): input ∫V1·I dt, dissipated in R1, remainder stored in C1.
  const integralV1Sq = a * a * dt + 2 * a * b * tau * (1 - decay) + (b * b * tau * (1 - decay * decay)) / 2;
  const r1LossJ = integralV1Sq / r1Ohm;
  const branchInJ = i * v1Mean * dt;
  const polJ = branchInJ - r1LossJ;

  // Coulomb counting (charging scaled by coulombic efficiency), bounded SOC.
  const dAh = ((i >= 0 ? i : i * eta) * dt) / 3600;
  const socRaw = st.soc - dAh / pack.capacityAh;
  const soc = clamp(socRaw, 0, 1);
  const overflowWh = socRaw > 1 ? (socRaw - 1) * pack.capacityAh * ocvV : 0; // charge that cannot be stored → heat
  const sideWh = (i < 0 ? (1 - eta) * ocvV * -i * dt : 0) / 3600 + overflowWh;

  const r0J = i * i * r0Ohm * dt;
  const heatW = dt > 0 ? (r0J + r1LossJ) / dt + (sideWh * 3600) / dt : 0;
  const wh = 1 / 3600;
  const next: BatteryState = {
    soc,
    v1V: v1Next,
    tempC: thermalStep(st.tempC, heatW, ambientC, pack.cthJPerK, pack.rthKPerW, dt),
    terminalNetWh: st.terminalNetWh + vtMean * i * dt * wh,
    dischargedWh: st.dischargedWh + Math.max(0, vtMean * i) * dt * wh,
    chargedWh: st.chargedWh + Math.max(0, -vtMean * i) * dt * wh,
    r0LossWh: st.r0LossWh + r0J * wh,
    r1LossWh: st.r1LossWh + r1LossJ * wh,
    sideLossWh: st.sideLossWh + sideWh,
    c1StoredWh: st.c1StoredWh + polJ * wh,
    chemicalNetWh: st.chemicalNetWh + ocvV * i * dt * wh,
  };
  return { state: next, currentA: i, terminalV: vtMean, ocvV, r0Ohm, heatW };
}
