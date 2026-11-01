// -----------------------------------------------------------------------------
// Single-phase full-wave bridge rectifier with optional smoothing capacitor.
// Time-domain, cycle-resolved (sub-stepped inside each engine step).
//
//   Unfiltered:  v_rect(t) = max(|v_ac(t)| − 2·Vf, 0)           (two diodes conduct per half-cycle)
//   Capacitor-input: diodes conduct only while |v_ac| − 2Vf > Vc. Then
//        C·dVc/dt = i_diode − i_load(Vc),   i_diode = (|v_ac| − 2Vf − Vc)/(R_s + 2·R_d)
//   Backward-Euler (unconditionally stable) per sub-step; load conductance is the secant i(V)/V
//   evaluated at the previous Vc (lagged).
//   Ripple (analytic reference):  ΔVpp ≈ I_load / (2·f·C)   — rectified ripple frequency is 2f.
//   Light-load DC bus ≈ √2·Vrms − 2·Vf  (peak detector), never the RMS value.
//
// Energy closes exactly per sub-step:
//   ∫|v|·i = R_s·i² + 2Vf·i + 2R_d·i² + ΔE_C + E_load + E_numerical,
// where E_numerical = ½C(ΔVc)² is the (reported) dissipation of backward Euler.
// Does not model diode reverse recovery, source inductance, or harmonic voltage distortion.
// -----------------------------------------------------------------------------

export interface RectifierSpec {
  /** Forward drop per diode (V). */
  vfV: number;
  /** Diode dynamic resistance (Ω). */
  rDiodeOhm: number;
  /** Smoothing capacitance (F); use a very small value to approximate "unfiltered". */
  capF: number;
  /** Series source/cable resistance (Ω). */
  sourceRohm: number;
}

export interface RectifierCycleStats {
  vOutMeanV: number;
  vOutMinV: number;
  vOutMaxV: number;
  rippleVpp: number;
  vinRmsV: number;
  isrcRmsA: number;
  isrcPeakA: number;
  pRealW: number;
  sVA: number;
  powerFactor: number | null;
}

export interface RectifierEnergyJ {
  inputJ: number; sourceLossJ: number; diodeLossJ: number; loadJ: number; capDeltaJ: number; numericalJ: number;
}

interface Acc { t: number; n: number; sumV: number; sumV2in: number; sumI2: number; sumP: number; minV: number; maxV: number; ipk: number }

export interface RectifierState {
  timeS: number;
  vcV: number;
  /** Instantaneous AC input (V), diode current magnitude (A), signed source current (A) at the last sub-step. */
  vAcV: number;
  iSourceA: number;
  last: RectifierCycleStats | null;
  energy: RectifierEnergyJ;
  acc: Acc;
}

const newAcc = (v: number): Acc => ({ t: 0, n: 0, sumV: 0, sumV2in: 0, sumI2: 0, sumP: 0, minV: v, maxV: v, ipk: 0 });

export function createRectifierState(vc = 0): RectifierState {
  return { timeS: 0, vcV: vc, vAcV: 0, iSourceA: 0, last: null, energy: { inputJ: 0, sourceLossJ: 0, diodeLossJ: 0, loadJ: 0, capDeltaJ: 0, numericalJ: 0 }, acc: newAcc(vc) };
}

/** Instantaneous output of an ideal unfiltered bridge with constant diode drops. */
export function unfilteredBridgeVoltage(vAc: number, vfV: number): number {
  return Math.max(Math.abs(vAc) - 2 * vfV, 0);
}
/** Light-load capacitor-input DC bus: √2·Vrms − 2·Vf (peak detector). */
export function peakDetectorBusV(vrms: number, vfV: number): number {
  return Math.max(0, Math.SQRT2 * vrms - 2 * vfV);
}
/** Analytic ripple estimate for constant load current. */
export function rippleEstimateVpp(loadA: number, freqHz: number, capF: number): number {
  return freqHz > 0 && capF > 0 ? loadA / (2 * freqHz * capF) : 0;
}
/** Mean of an unfiltered full-wave rectified sine of amplitude Vpk (ignoring Vf): 2Vpk/π. */
export function meanFullWave(vpk: number): number {
  return (2 * vpk) / Math.PI;
}

export interface RectifierLoad { iOfV(v: number): number }

/**
 * Advance the rectifier by dt (s). `vacRms` is the source RMS value; `freqHz` = 0 means a DC source of value `vacRms`
 * (signed; the bridge makes either polarity produce the same output polarity).
 */
export function stepRectifier(spec: RectifierSpec, st: RectifierState, vacRms: number, freqHz: number, load: RectifierLoad, dtS: number): RectifierState {
  if (!(dtS > 0)) return st;
  const period = freqHz > 0 ? 1 / freqHz : 0.02;
  const n = Math.max(1, Math.ceil(dtS / (period / 400)));
  const h = dtS / n;
  const c = Math.max(spec.capF, 1e-12);
  const rt = spec.sourceRohm + 2 * spec.rDiodeOhm;
  let { timeS: t, vcV: vc } = st;
  let acc = { ...st.acc };
  const en = { ...st.energy };
  let last = st.last;
  let vAc = st.vAcV, iSrc = st.iSourceA;
  for (let k = 0; k < n; k++) {
    vAc = freqHz > 0 ? Math.SQRT2 * vacRms * Math.sin(2 * Math.PI * freqHz * t) : vacRms;
    const vs = Math.abs(vAc) - 2 * spec.vfV;
    const vref = Math.max(vc, 1);
    const g = Math.max(0, load.iOfV(vref)) / vref;
    let vn: number, i: number;
    if (vs > vc) {
      vn = ((c * vc) / h + vs / rt) / (c / h + 1 / rt + g);
      i = Math.max(0, (vs - vn) / rt);
    } else {
      vn = ((c * vc) / h) / (c / h + g);
      i = 0;
    }
    const dv = vn - vc;
    en.inputJ += Math.abs(vAc) * i * h;
    en.sourceLossJ += spec.sourceRohm * i * i * h;
    en.diodeLossJ += (2 * spec.vfV * i + 2 * spec.rDiodeOhm * i * i) * h;
    en.loadJ += g * vn * vn * h;
    en.capDeltaJ += 0.5 * c * (vn * vn - vc * vc);
    en.numericalJ += 0.5 * c * dv * dv;
    iSrc = Math.sign(vAc) * i;
    acc.t += h; acc.n += 1; acc.sumV += vn * h; acc.sumV2in += vAc * vAc * h; acc.sumI2 += i * i * h; acc.sumP += Math.abs(vAc) * i * h;
    acc.minV = Math.min(acc.minV, vn); acc.maxV = Math.max(acc.maxV, vn); acc.ipk = Math.max(acc.ipk, i);
    vc = vn; t += h;
    if (acc.t >= period - 1e-12) {
      const vin = Math.sqrt(acc.sumV2in / acc.t);
      const irms = Math.sqrt(acc.sumI2 / acc.t);
      const p = acc.sumP / acc.t;
      const s = vin * irms;
      last = { vOutMeanV: acc.sumV / acc.t, vOutMinV: acc.minV, vOutMaxV: acc.maxV, rippleVpp: acc.maxV - acc.minV, vinRmsV: vin, isrcRmsA: irms, isrcPeakA: acc.ipk, pRealW: p, sVA: s, powerFactor: s > 1e-12 ? p / s : null };
      acc = newAcc(vc);
    }
  }
  return { timeS: t, vcV: vc, vAcV: vAc, iSourceA: iSrc, last, energy: en, acc };
}

/** Residual (J) of the rectifier energy ledger: input − (all sinks). Should be ~0 by construction. */
export function rectifierEnergyResidualJ(e: RectifierEnergyJ): number {
  return e.inputJ - (e.sourceLossJ + e.diodeLossJ + e.loadJ + e.capDeltaJ + e.numericalJ);
}
