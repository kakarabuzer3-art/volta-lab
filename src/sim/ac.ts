// -----------------------------------------------------------------------------
// AC circuit theory helpers (established physical laws, SI units).
//
//   v(t) = √2 · Vrms · sin(2πft + φ)          Vpk = √2 Vrms     Vpp = 2 Vpk     T = 1/f
//   XL = 2πfL      XC = 1 / (2πfC)            Z = √(R² + (XL − XC)²)
//   Irms = Vrms / |Z|      P = Vrms Irms cos φ     Q = Vrms Irms sin φ     S = Vrms Irms
//
// Sign convention: φ = atan2(X, R) is the angle by which the VOLTAGE LEADS the
// CURRENT. φ > 0 → inductive (current lags). φ < 0 → capacitive (current leads).
// References: OpenStax University Physics Vol. 2 §15.2 and §15.4.
// -----------------------------------------------------------------------------

export const peakFromRms = (vrms: number): number => Math.SQRT2 * vrms;
export const rmsFromPeak = (vpk: number): number => vpk / Math.SQRT2;
export const peakToPeakFromRms = (vrms: number): number => 2 * Math.SQRT2 * vrms;
export const periodS = (frequencyHz: number): number => (frequencyHz > 0 ? 1 / frequencyHz : Infinity);

/** Instantaneous sinusoidal voltage v(t). */
export function acInstantaneous(vrms: number, frequencyHz: number, tS: number, phaseRad = 0): number {
  return Math.SQRT2 * vrms * Math.sin(2 * Math.PI * frequencyHz * tS + phaseRad);
}

export const inductiveReactance = (henries: number, frequencyHz: number): number => 2 * Math.PI * frequencyHz * henries;
/** Capacitive reactance magnitude. Infinite for DC (f = 0) or no capacitance value. */
export const capacitiveReactance = (farads: number, frequencyHz: number): number =>
  frequencyHz > 0 && farads > 0 ? 1 / (2 * Math.PI * frequencyHz * farads) : Infinity;

/** Series R-L-C branch. `farads: null` means no capacitor in the branch (a wire). */
export interface SeriesRlc { ohms: number; henries: number; farads: number | null }

export interface AcResponse {
  /** |Z| in ohms (Infinity when a series capacitor blocks the branch). */
  impedanceOhm: number;
  /** X = XL − XC in ohms. */
  reactanceOhm: number;
  /** φ = atan2(X, R): voltage-leads-current angle (rad). */
  phaseRad: number;
  irms: number;
  ipeak: number;
  realPowerW: number;
  reactivePowerVAr: number;
  apparentVA: number;
  /** cos φ (≥ 0). */
  powerFactor: number;
  kind: 'resistive' | 'inductive' | 'capacitive' | 'nonlinear';
}

/** Sinusoidal steady-state response of a series RLC branch driven by Vrms at f. */
export function seriesRlcAc(load: SeriesRlc, vrms: number, frequencyHz: number): AcResponse {
  const xl = inductiveReactance(load.henries, frequencyHz);
  const xc = load.farads === null ? 0 : capacitiveReactance(load.farads, frequencyHz);
  const x = xl - xc;
  if (!Number.isFinite(x)) {
    // Capacitor in series with no AC frequency (DC) or zero capacitance: no steady current.
    return { impedanceOhm: Infinity, reactanceOhm: x, phaseRad: -Math.PI / 2, irms: 0, ipeak: 0, realPowerW: 0, reactivePowerVAr: 0, apparentVA: 0, powerFactor: 0, kind: 'capacitive' };
  }
  const z = Math.hypot(load.ohms, x);
  const irms = z > 0 ? vrms / z : Infinity;
  const phi = Math.atan2(x, load.ohms);
  const s = vrms * irms;
  const eps = 1e-12;
  return {
    impedanceOhm: z,
    reactanceOhm: x,
    phaseRad: phi,
    irms,
    ipeak: Math.SQRT2 * irms,
    realPowerW: s * Math.cos(phi),
    reactivePowerVAr: s * Math.sin(phi),
    apparentVA: s,
    powerFactor: Math.abs(Math.cos(phi)),
    kind: Math.abs(phi) < eps ? 'resistive' : phi > 0 ? 'inductive' : 'capacitive',
  };
}

/** Instantaneous current for a branch response when the source voltage has phase `vPhaseRad`. */
export function acCurrentInstantaneous(resp: AcResponse, frequencyHz: number, tS: number, vPhaseRad = 0): number {
  return resp.ipeak * Math.sin(2 * Math.PI * frequencyHz * tS + vPhaseRad - resp.phaseRad);
}

// ---------------------------------------------------------------- waveform statistics

export const meanOf = (xs: ArrayLike<number>): number => {
  let s = 0; for (let k = 0; k < xs.length; k++) s += xs[k];
  return xs.length ? s / xs.length : 0;
};
export const rmsOf = (xs: ArrayLike<number>): number => {
  let s = 0; for (let k = 0; k < xs.length; k++) s += xs[k] * xs[k];
  return xs.length ? Math.sqrt(s / xs.length) : 0;
};

export interface SampledPower {
  vrms: number; irms: number;
  /** Paverage = mean(v(t)·i(t)) over whole periods. */
  realPowerW: number;
  /** S = Vrms · Irms. */
  apparentVA: number;
  /** Non-active power √(S² − P²) (includes distortion power for non-sinusoidal waveforms). */
  reactiveVAr: number;
  /** PF_true = P / S. */
  powerFactor: number;
}

/** True power quantities from time-domain samples (valid for any waveform shape, nonlinear loads included). */
export function powerFromSamples(v: ArrayLike<number>, i: ArrayLike<number>): SampledPower {
  const n = Math.min(v.length, i.length);
  let p = 0, v2 = 0, i2 = 0;
  for (let k = 0; k < n; k++) { p += v[k] * i[k]; v2 += v[k] * v[k]; i2 += i[k] * i[k]; }
  const vrms = n ? Math.sqrt(v2 / n) : 0, irms = n ? Math.sqrt(i2 / n) : 0;
  const real = n ? p / n : 0, s = vrms * irms;
  return { vrms, irms, realPowerW: real, apparentVA: s, reactiveVAr: Math.sqrt(Math.max(0, s * s - real * real)), powerFactor: s > 0 ? Math.abs(real) / s : 0 };
}
