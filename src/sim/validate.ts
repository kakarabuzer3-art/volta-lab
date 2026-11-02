// -----------------------------------------------------------------------------
// Boundary validation for every public model entry point. Invalid physics is REJECTED with an
// error naming the exact parameter; nothing is silently clamped into a valid-looking value.
//   * `null` always means "genuinely unspecified" (only where a field allows it).
//   * Zero / negative values are accepted ONLY where the model explicitly permits them
//     (e.g. a 0 V diode knee, a 0 Ω capacitor ESR, a negative-going temperature in °C).
// -----------------------------------------------------------------------------
import type { Chemistry, ChemistryProfile, PackConfig } from './battery.ts';
import type { DcDcSpec } from './dcdc.ts';
import type { InverterSpec } from './inverter.ts';
import type { Load, LoadRatings, LoadThermal } from './loads.ts';
import type { RectifierSpec } from './rectifier.ts';

const bad = (name: string, rule: string, v: unknown): never => { throw new RangeError(`${name} must be ${rule}; got ${String(v)}`); };

export function finite(name: string, v: unknown): number { if (typeof v !== 'number' || !Number.isFinite(v)) bad(name, 'a finite number', v); return v as number; }
export function positive(name: string, v: unknown): number { const x = finite(name, v); if (!(x > 0)) bad(name, 'a positive finite number (> 0)', v); return x; }
export function nonNegative(name: string, v: unknown): number { const x = finite(name, v); if (x < 0) bad(name, 'a finite number ≥ 0', v); return x; }
export function positiveInteger(name: string, v: unknown): number { const x = finite(name, v); if (!Number.isInteger(x) || x < 1) bad(name, 'a positive integer (≥ 1)', v); return x; }
/** Passive power-conversion efficiency: 0 < η ≤ 1. */
export function efficiency(name: string, v: unknown): number { const x = finite(name, v); if (!(x > 0 && x <= 1)) bad(name, 'an efficiency with 0 < η ≤ 1 (not a percentage)', v); return x; }
/** Open unit interval 0 < x < 1 (e.g. maximum duty cycle). */
export function openUnit(name: string, v: unknown): number { const x = finite(name, v); if (!(x > 0 && x < 1)) bad(name, 'strictly between 0 and 1', v); return x; }
/** State of charge as a fraction 0 ≤ SOC ≤ 1. */
export function socFraction(name: string, v: unknown): number { const x = finite(name, v); if (x < 0 || x > 1) bad(name, 'a fraction between 0 and 1 (0–100 %)', v); return x; }
const nullablePositive = (name: string, v: number | null): void => { if (v !== null) positive(name, v); };
const nullableNonNeg = (name: string, v: number | null): void => { if (v !== null) nonNegative(name, v); };

export function validateThermalPair(name: string, cth: unknown, rth: unknown): void {
  positive(`${name}.cthJPerK (thermal capacitance)`, cth);
  positive(`${name}.rthKPerW (thermal resistance)`, rth);
}

export function validateChemistryProfile(p: ChemistryProfile): void {
  const n = `chemistry '${p.chemistry}'`;
  if (p.chemistry !== 'lead-acid' && p.chemistry !== 'li-ion') bad('chemistry', "a supported chemistry ('lead-acid' | 'li-ion')", p.chemistry);
  positive(`${n}.r0MohmAh`, p.r0MohmAh); positive(`${n}.tau1S`, p.tau1S); positive(`${n}.r1Ratio`, p.r1Ratio);
  efficiency(`${n}.coulombicEfficiency`, p.coulombicEfficiency);
  positive(`${n}.maxDischargeC`, p.maxDischargeC); positive(`${n}.maxChargeC`, p.maxChargeC);
  positive(`${n}.specificEnergyWhPerKg`, p.specificEnergyWhPerKg); positive(`${n}.cpJPerKgK`, p.cpJPerKgK);
  finite(`${n}.maxTempC`, p.maxTempC); finite(`${n}.ocvTempCoeffVPerK`, p.ocvTempCoeffVPerK); finite(`${n}.r0TempCoeffPerK`, p.r0TempCoeffPerK);
  positive(`${n}.cutoffVPerCell`, p.cutoffVPerCell);
  if (!(p.maxChargeVPerCell > p.cutoffVPerCell)) bad(`${n}.maxChargeVPerCell`, `greater than cutoffVPerCell (${p.cutoffVPerCell})`, p.maxChargeVPerCell);
  for (const [tn, t] of [['ocvTable', p.ocvTable], ['r0SocFactor', p.r0SocFactor]] as const) {
    if (t.length < 2) bad(`${n}.${tn}`, 'a table with ≥ 2 points', t.length);
    t.forEach(([x, y], k) => { finite(`${n}.${tn}[${k}].soc`, x); positive(`${n}.${tn}[${k}].value`, y); if (k > 0 && !(x > t[k - 1][0])) bad(`${n}.${tn}[${k}].soc`, 'strictly increasing', x); });
  }
  p.ocvTable.forEach(([, v], k) => { if (k > 0 && v < p.ocvTable[k - 1][1]) bad(`${n}.ocvTable[${k}]`, 'non-decreasing with SOC', v); });
}

export function validatePackConfig(c: PackConfig): void {
  if (!c || !c.cell) bad('pack.cell', 'defined', c?.cell);
  if (c.cell.chemistry !== 'lead-acid' && c.cell.chemistry !== 'li-ion') bad('pack.cell.chemistry', "a supported chemistry ('lead-acid' | 'li-ion')", c.cell.chemistry);
  positive('pack.cell.capacityAh', c.cell.capacityAh);
  positiveInteger('pack.seriesCells (Ns)', c.seriesCells);
  positiveInteger('pack.parallelStrings (Np)', c.parallelStrings);
}

export function validateConverterSpec(s: DcDcSpec): void {
  const n = 'converter';
  positive(`${n}.turnsRatio`, s.turnsRatio);
  openUnit(`${n}.dMax (maximum duty cycle)`, s.dMax);
  positive(`${n}.fswHz`, s.fswHz); positive(`${n}.inductorH`, s.inductorH); positive(`${n}.outCapF`, s.outCapF);
  nonNegative(`${n}.pFixedW`, s.pFixedW); nonNegative(`${n}.rConductionOhm`, s.rConductionOhm);
  nonNegative(`${n}.swLossFrac`, s.swLossFrac);
  if (s.swLossFrac >= 1) bad(`${n}.swLossFrac`, 'below 1 (a loss fraction, not a gain)', s.swLossFrac);
  positive(`${n}.inCurrentLimitA`, s.inCurrentLimitA); positive(`${n}.outCurrentLimitA`, s.outCurrentLimitA);
  validateThermalPair(n, s.cthJPerK, s.rthKPerW);
  finite(`${n}.tShutdownC`, s.tShutdownC); finite(`${n}.tRestartC`, s.tRestartC);
  if (!(s.tShutdownC > s.tRestartC)) bad(`${n}.tShutdownC`, `greater than tRestartC (${s.tRestartC}) so that hysteresis exists`, s.tShutdownC);
}

export function validateInverterSpec(s: InverterSpec): void {
  const n = 'inverter';
  validateConverterSpec(s.stage);
  finite(`${n}.modulationMax`, s.modulationMax);
  if (!(s.modulationMax > 0 && s.modulationMax <= 1)) bad(`${n}.modulationMax`, 'in (0, 1]', s.modulationMax);
  positive(`${n}.outCurrentLimitA`, s.outCurrentLimitA);
  nonNegative(`${n}.bridgeRohm`, s.bridgeRohm); nonNegative(`${n}.bridgeSwLossFrac`, s.bridgeSwLossFrac); nonNegative(`${n}.bridgeFixedW`, s.bridgeFixedW);
  positive(`${n}.linkMinV`, s.linkMinV); positive(`${n}.linkMaxV`, s.linkMaxV);
  if (!(s.linkMaxV > s.linkMinV)) bad(`${n}.linkMaxV`, `greater than linkMinV (${s.linkMinV})`, s.linkMaxV);
}

export function validateRectifierSpec(s: RectifierSpec): void {
  nonNegative('rectifier.vfV', s.vfV); nonNegative('rectifier.rDiodeOhm', s.rDiodeOhm);
  positive('rectifier.capF', s.capF); nonNegative('rectifier.sourceRohm', s.sourceRohm);
}

export function validateRatings(r: LoadRatings): void {
  const n = 'load.ratings';
  if (r.input !== 'ac' && r.input !== 'dc' && r.input !== 'ac-or-dc') bad(`${n}.input`, "'ac' | 'dc' | 'ac-or-dc'", r.input);
  if (typeof r.polarized !== 'boolean') bad(`${n}.polarized`, 'a boolean', r.polarized);
  nullableNonNeg(`${n}.vRatedMinV`, r.vRatedMinV); nullablePositive(`${n}.vRatedMaxV`, r.vRatedMaxV); nullablePositive(`${n}.vAbsMaxV`, r.vAbsMaxV);
  if (r.vRatedMinV !== null && r.vRatedMaxV !== null && !(r.vRatedMinV <= r.vRatedMaxV)) bad(`${n}.vRatedMinV`, `≤ vRatedMaxV (${r.vRatedMaxV}); the rated window is inverted`, r.vRatedMinV);
  if (r.vAbsMaxV !== null && r.vRatedMaxV !== null && !(r.vAbsMaxV >= r.vRatedMaxV)) bad(`${n}.vAbsMaxV`, `≥ vRatedMaxV (${r.vRatedMaxV}); absolute maximum cannot be below the rated maximum`, r.vAbsMaxV);
  nullableNonNeg(`${n}.freqMinHz`, r.freqMinHz); nullablePositive(`${n}.freqMaxHz`, r.freqMaxHz);
  if (r.freqMinHz !== null && r.freqMaxHz !== null && !(r.freqMinHz <= r.freqMaxHz)) bad(`${n}.freqMinHz`, `≤ freqMaxHz (${r.freqMaxHz})`, r.freqMinHz);
  nullableNonNeg(`${n}.vReverseMaxV`, r.vReverseMaxV);
  nullablePositive(`${n}.ratedCurrentA`, r.ratedCurrentA); nullablePositive(`${n}.ratedPowerW`, r.ratedPowerW);
  nullablePositive(`${n}.overcurrentTripA`, r.overcurrentTripA); nullablePositive(`${n}.overvoltageTripV`, r.overvoltageTripV);
  if (r.tMaxC !== null) finite(`${n}.tMaxC`, r.tMaxC);
  if (r.tWarnC !== null) finite(`${n}.tWarnC`, r.tWarnC);
  if (r.tMaxC !== null && r.tWarnC !== null && !(r.tMaxC > r.tWarnC)) bad(`${n}.tMaxC`, `greater than tWarnC (${r.tWarnC})`, r.tMaxC);
}

export function validateLoadThermal(t: LoadThermal): void { validateThermalPair('load.thermal', t.cthJPerK, t.rthKPerW); }

/** Validate a complete typed load, including loads built by hand rather than through the factories. */
export function validateLoad(load: Load): void {
  if (!load || typeof load !== 'object') bad('load', 'a Load object', load);
  if (!load.ratings || typeof load.ratings !== 'object') bad('load.ratings', 'a LoadRatings object (use NO_RATINGS with null for unspecified fields)', load.ratings);
  if (!load.thermal || typeof load.thermal !== 'object') bad('load.thermal', '{ cthJPerK, rthKPerW }', load.thermal);
  validateRatings(load.ratings); validateLoadThermal(load.thermal);
  if ((load.kind === 'resistive' || load.kind === 'inductive' || load.kind === 'capacitive' || load.kind === 'rlc') && (!load.rlc || typeof load.rlc !== 'object')) bad('load.rlc', '{ ohms, henries, farads }', load.rlc);
  switch (load.kind) {
    case 'resistive': positive('load.rlc.ohms (resistance)', load.rlc.ohms); break;
    case 'inductive': positive('load.rlc.ohms (winding resistance)', load.rlc.ohms); positive('load.rlc.henries', load.rlc.henries); break;
    case 'capacitive': nonNegative('load.rlc.ohms (ESR)', load.rlc.ohms); positive('load.rlc.farads', load.rlc.farads); break;
    case 'rlc': positive('load.rlc.ohms', load.rlc.ohms); positive('load.rlc.henries', load.rlc.henries); positive('load.rlc.farads', load.rlc.farads); break;
    case 'ac-input-supply':
      positive('load.pOutW', load.pOutW); efficiency('load.efficiency', load.efficiency); positive('load.busCapF', load.busCapF);
      positive('load.busMinV', load.busMinV); nonNegative('load.vfV', load.vfV); nonNegative('load.rDiodeOhm', load.rDiodeOhm); nonNegative('load.sourceRohm', load.sourceRohm);
      break;
    case 'dc-motor':
      positive('load.rArmOhm (winding resistance)', load.rArmOhm); positive('load.kVsPerRad (motor constant)', load.kVsPerRad);
      nonNegative('load.loadTorqueNm', load.loadTorqueNm); nonNegative('load.viscousNmsPerRad', load.viscousNmsPerRad);
      break;
    case 'dc-module': nonNegative('load.vForwardV (diode knee voltage)', load.vForwardV); positive('load.rDynOhm (dynamic resistance)', load.rDynOhm); break;
    default: bad('load.kind', 'a supported load kind', (load as { kind?: unknown }).kind);
  }
}

export function validateChemistryName(c: Chemistry): void {
  if (c !== 'lead-acid' && c !== 'li-ion') bad('chemistry', "a supported chemistry ('lead-acid' | 'li-ion')", c);
}
