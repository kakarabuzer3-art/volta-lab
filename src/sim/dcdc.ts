// -----------------------------------------------------------------------------
// DC-DC converter — AVERAGED (cycle-averaged, CCM-based) model. It does NOT resolve
// individual transistor switching events; ripple values are standard CCM formulas.
//
// Power balance (no free energy):
//   Pin = Pout·(1 + k_sw) + P_fixed + R_cond·Iin²        (all loss terms ≥ 0)
//   Pout = η·Pin      with  η = Pout / Pin  (a RESULT, not an input)
//
// The conduction term is referred to the input current, so combined with a Thevenin
// source (E, R) it gives a closed-form input current:
//   Vin = E − Iin·R ,  Vin·Iin = A + R_cond·Iin²,  A = Pout(1+k_sw)+P_fixed
//   ⇒ (R+R_cond)·Iin² − E·Iin + A = 0 ⇒ Iin = (E − √(E² − 4(R+R_cond)A)) / (2(R+R_cond))
// If the discriminant is negative the source cannot deliver that power at all.
//
// Ideal CCM duty (reference relations — NOT guarantees of achievable output):
//   buck : Vout = D·Vin                     →  D = Vout/(η·Vin)
//   boost: Vout = n·Vin/(1−D)               →  D = 1 − η·n·Vin/Vout
// n = 1 is a non-isolated boost; n > 1 approximates an ISOLATED boost-derived stage
// (transformer turns ratio) and is a documented MODEL ASSUMPTION, not a datasheet value.
// A real boost needs practical duty limits (D ≤ dMax), so gain is bounded by n/(1−dMax).
// In the duty equations η is the CONDUCTION (voltage-drop) efficiency 1 − R_cond·Iin/Vin, not Pout/Pin:
// fixed and switching losses do not shift the CCM voltage ratio.
// -----------------------------------------------------------------------------
import type { Provenance } from './battery.ts';

export type Topology = 'buck' | 'boost';

export interface DcDcSpec {
  label: string;
  /** Transformer turns ratio for boost-derived isolated stage (1 = non-isolated). */
  turnsRatio: number;
  dMax: number;
  fswHz: number;
  inductorH: number;
  outCapF: number;
  /** Fixed (control + gate drive + core) loss (W). */
  pFixedW: number;
  /** Conduction loss resistance referred to the input current (Ω). */
  rConductionOhm: number;
  /** Switching loss as a fraction of output power. */
  swLossFrac: number;
  inCurrentLimitA: number;
  outCurrentLimitA: number;
  tShutdownC: number;
  tRestartC: number;
  cthJPerK: number;
  rthKPerW: number;
  provenance: Provenance;
}

export type ConverterLimit =
  | 'duty-limit' | 'input-current-limit' | 'output-current-limit' | 'source-collapse' | 'thermal-shutdown' | 'disabled';

export interface DcDcSolution {
  topology: Topology;
  vInV: number;
  iInA: number;
  pInW: number;
  vOutV: number;
  iOutA: number;
  pOutW: number;
  lossW: number;
  /** Pout/Pin, or null when Pin = 0 (undefined, not 100 %). */
  efficiency: number | null;
  duty: number;
  /** Highest Vout this stage could regulate at the present Vin given dMax (V). */
  maxOutputAtDutyLimitV: number;
  requestedVoutV: number;
  limited: ConverterLimit | null;
  ripple: { outputVppV: number; inductorPpA: number; ccm: boolean };
}

/** Thevenin equivalent of whatever feeds the converter input. */
export interface TheveninSource { eV: number; rOhm: number }

export interface OutputLoad {
  /** Current drawn by the load at output voltage v (A, ≥ 0). Must be finite for v ≥ 0. */
  iOfV(v: number): number;
}

export function chooseTopology(targetV: number, sourceEV: number): Topology {
  return targetV > sourceEV ? 'boost' : 'buck';
}

export function dutyFor(topology: Topology, spec: DcDcSpec, vIn: number, vOut: number, eta: number): number {
  if (!(vIn > 0) || !(vOut > 0)) return 0;
  const e = Math.min(1, Math.max(0.05, eta));
  const d = topology === 'buck' ? vOut / (e * vIn) : 1 - (e * spec.turnsRatio * vIn) / vOut;
  return Math.max(0, d);
}

export function maxOutputAtDutyLimit(topology: Topology, spec: DcDcSpec, vIn: number, eta = 1): number {
  return topology === 'buck' ? spec.dMax * eta * vIn : (eta * spec.turnsRatio * vIn) / (1 - spec.dMax);
}

interface Trial { limit: ConverterLimit | null; sol: DcDcSolution }

function evaluate(spec: DcDcSpec, topology: Topology, src: TheveninSource, load: OutputLoad, v: number, requested: number): Trial {
  const iOut = v > 0 ? Math.max(0, load.iOfV(v)) : 0;
  const pOut = v * iOut;
  const a = pOut * (1 + spec.swLossFrac) + spec.pFixedW;
  const r = src.rOhm + spec.rConductionOhm;
  const disc = src.eV * src.eV - 4 * r * a;
  let limit: ConverterLimit | null = null;
  let iIn = 0;
  if (src.eV <= 0 || disc < 0) {
    limit = 'source-collapse';
    iIn = src.eV > 0 ? src.eV / (2 * r) : 0;
  } else {
    iIn = r > 0 ? (src.eV - Math.sqrt(disc)) / (2 * r) : a / src.eV;
  }
  const vIn = src.eV - iIn * src.rOhm;
  const pIn = vIn * iIn;
  const lossW = Math.max(0, pIn - pOut);
  const eta = pIn > 0 ? pOut / pIn : 1;
  // Duty uses the VOLTAGE-drop efficiency (conduction only). Fixed/switching losses do not shift the
  // CCM voltage ratio, and using Pout/Pin would wrongly push the duty to its limit at light load.
  const etaV = vIn > 0 ? Math.min(1, Math.max(0.5, 1 - (spec.rConductionOhm * iIn) / vIn)) : 1;
  const duty = dutyFor(topology, spec, vIn, v, etaV);
  if (iOut > spec.outCurrentLimitA) limit = 'output-current-limit';
  else if (!limit && iIn > spec.inCurrentLimitA) limit = 'input-current-limit';
  else if (!limit && duty > spec.dMax + 1e-12) limit = 'duty-limit';
  // Ripple (standard CCM formulas).
  let ipp = 0, vpp = 0;
  if (topology === 'boost') { ipp = (vIn * duty) / (spec.inductorH * spec.fswHz); vpp = (iOut * duty) / (spec.fswHz * spec.outCapF); }
  else { ipp = (v * (1 - duty)) / (spec.inductorH * spec.fswHz); vpp = ipp / (8 * spec.fswHz * spec.outCapF); }
  const iL = topology === 'boost' ? iIn : iOut;
  const sol: DcDcSolution = {
    topology, vInV: vIn, iInA: iIn, pInW: pIn, vOutV: v, iOutA: iOut, pOutW: pOut, lossW,
    efficiency: pIn > 0 ? eta : null, duty, maxOutputAtDutyLimitV: maxOutputAtDutyLimit(topology, spec, vIn, etaV),
    requestedVoutV: requested, limited: null, ripple: { outputVppV: vpp, inductorPpA: ipp, ccm: iL >= ipp / 2 && iL > 0 },
  };
  return { limit, sol };
}

/**
 * Solve the converter operating point. Regulates to `targetV` if feasible; otherwise finds the
 * largest output voltage that respects duty, current and source limits (voltage fold-back for
 * resistive / constant-current loads) and reports WHICH limit is active.
 * For constant-power loads feasibility does not improve at lower voltage, so the result collapses toward 0 V.
 */
export function solveDcDc(spec: DcDcSpec, src: TheveninSource, load: OutputLoad, targetV: number, topology?: Topology): DcDcSolution {
  const topo = topology ?? chooseTopology(targetV, src.eV);
  const target = Math.max(0, targetV);
  const full = evaluate(spec, topo, src, load, target, target);
  if (!full.limit) return full.sol;
  let lo = 0, hi = target;
  let best = evaluate(spec, topo, src, load, 0, target);
  for (let k = 0; k < 60; k++) {
    const mid = 0.5 * (lo + hi);
    const t = evaluate(spec, topo, src, load, mid, target);
    if (t.limit) hi = mid; else { lo = mid; best = t; }
  }
  best.sol.limited = full.limit;
  return best.sol;
}

/** Default converter used by the machine. All numbers are MODEL ASSUMPTIONS (see ELECTRICAL_MODEL.md). */
export const MACHINE_CONVERTER: DcDcSpec = {
  label: 'Machine DC-DC stage (averaged, non-inverting buck/boost)',
  turnsRatio: 1,
  dMax: 0.9,
  fswHz: 50_000,
  inductorH: 220e-6,
  outCapF: 470e-6,
  pFixedW: 4,
  rConductionOhm: 0.05,
  swLossFrac: 0.02,
  inCurrentLimitA: 60,
  outCurrentLimitA: 10,
  tShutdownC: 105,
  tRestartC: 85,
  cthJPerK: 400,
  rthKPerW: 0.6,
  provenance: 'model-assumption',
};

/** Evaluate (without searching) the converter at a fixed output voltage; `limit` is the first violated limit. */
export function operatingPoint(spec: DcDcSpec, src: TheveninSource, load: OutputLoad, vOutV: number, topology?: Topology): { solution: DcDcSolution; limit: ConverterLimit | null } {
  const topo = topology ?? chooseTopology(vOutV, src.eV);
  const t = evaluate(spec, topo, src, load, Math.max(0, vOutV), vOutV);
  return { solution: t.sol, limit: t.limit };
}
