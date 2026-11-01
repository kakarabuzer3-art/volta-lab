// -----------------------------------------------------------------------------
// DC → AC inverter — AVERAGED model of: [DC-DC stage → DC link → full H-bridge + (ideal) output filter].
// It does not resolve PWM switching edges and assumes an ideal sinusoidal filtered output (no THD).
//
//   Vac,pk  = m · V_link            (single-phase full bridge, linear sine-PWM, 0 ≤ m ≤ m_max)
//   Vac,rms = Vac,pk / √2
//   P_link  = P_out,real + P_fixed + k_sw·S_out + R_bridge·Irms²          (bridge losses ≥ 0)
//   Pout ≤ η·Pin  follows because the DC-DC stage supplies P_link from the battery with its own losses.
//
// A 12 V source can only reach 230 V AC through the DC-DC stage; the required input current
// (≈ Pin/Vin) is a RESULT of this chain — it is never assumed.
// -----------------------------------------------------------------------------
import type { AcResponse } from './ac.ts';
import { solveDcDc, operatingPoint, chooseTopology } from './dcdc.ts';
import type { DcDcSolution, DcDcSpec, TheveninSource, ConverterLimit } from './dcdc.ts';

export interface InverterSpec {
  label: string;
  stage: DcDcSpec;
  modulationMax: number;
  /** AC output current (RMS) limit (A). */
  outCurrentLimitA: number;
  bridgeRohm: number;
  bridgeSwLossFrac: number;
  bridgeFixedW: number;
  linkMinV: number;
  linkMaxV: number;
}

export interface AcLoadModel {
  /** Steady-state sinusoidal response of the load at the given RMS voltage and frequency. */
  respond(vrms: number, freqHz: number): AcResponse;
}

export interface InverterSolution {
  vOutRms: number;
  iOutRms: number;
  iOutPeak: number;
  pOutW: number;
  sOutVA: number;
  qOutVAr: number;
  powerFactor: number | null;
  freqHz: number;
  modulation: number;
  dcLinkV: number;
  linkPowerW: number;
  bridgeLossW: number;
  stage: DcDcSolution;
  vInV: number;
  iInA: number;
  pInW: number;
  lossW: number;
  efficiency: number | null;
  requestedVrms: number;
  limited: ConverterLimit | 'modulation-limit' | null;
}

export function linkVoltageFor(spec: InverterSpec, vrms: number): number {
  return Math.min(spec.linkMaxV, Math.max(spec.linkMinV, (Math.SQRT2 * vrms) / spec.modulationMax));
}

function trial(spec: InverterSpec, src: TheveninSource, load: AcLoadModel, vrms: number, f: number) {
  const resp = load.respond(vrms, f);
  const bridgeLoss = spec.bridgeFixedW + spec.bridgeSwLossFrac * resp.apparentVA + spec.bridgeRohm * resp.irms * resp.irms;
  const pLink = Math.max(0, resp.realPowerW) + bridgeLoss;
  const link = linkVoltageFor(spec, vrms);
  const dc = operatingPoint(spec.stage, src, { iOfV: (v) => pLink / Math.max(v, 1) }, link, chooseTopology(link, src.eV));
  const needed = (Math.SQRT2 * vrms) / spec.modulationMax;
  const modLimited = link < needed - 1e-9; // link clamp (linkMaxV) prevents reaching this vrms
  const ocLimited = resp.irms > spec.outCurrentLimitA;
  return { resp, bridgeLoss, pLink, link, dc, limit: ocLimited ? ('output-current-limit' as const) : dc.limit ?? (modLimited ? ('modulation-limit' as const) : null) };
}

export function solveInverter(spec: InverterSpec, src: TheveninSource, load: AcLoadModel, targetVrms: number, freqHz: number): InverterSolution {
  const target = Math.max(0, targetVrms);
  let t = trial(spec, src, load, target, freqHz);
  let vrms = target;
  const requestedLimit = t.limit;
  if (t.limit) {
    let lo = 0, hi = target;
    let best = trial(spec, src, load, 0, freqHz);
    for (let k = 0; k < 50; k++) {
      const mid = 0.5 * (lo + hi);
      const tm = trial(spec, src, load, mid, freqHz);
      if (tm.limit) hi = mid; else { lo = mid; best = tm; }
    }
    t = best; vrms = lo;
  }
  // Re-solve the DC stage at the chosen link voltage so its internal fields are consistent.
  const stage = t.limit ? t.dc.solution : solveDcDc(spec.stage, src, { iOfV: (v) => t.pLink / Math.max(v, 1) }, t.link, chooseTopology(t.link, src.eV));
  const mod = t.link > 0 ? (Math.SQRT2 * vrms) / t.link : 0;
  const pIn = stage.pInW;
  const pOut = Math.max(0, t.resp.realPowerW);
  return {
    vOutRms: vrms, iOutRms: t.resp.irms, iOutPeak: t.resp.ipeak, pOutW: pOut, sOutVA: t.resp.apparentVA, qOutVAr: t.resp.reactivePowerVAr,
    powerFactor: t.resp.apparentVA > 1e-9 ? t.resp.powerFactor : null, freqHz, modulation: mod, dcLinkV: t.link, linkPowerW: t.pLink,
    bridgeLossW: t.bridgeLoss, stage, vInV: stage.vInV, iInA: stage.iInA, pInW: pIn, lossW: Math.max(0, pIn - pOut),
    efficiency: pIn > 0 ? pOut / pIn : null, requestedVrms: target, limited: requestedLimit,
  };
}

/** Default machine inverter. All numbers are MODEL ASSUMPTIONS. */
export function machineInverter(stage: DcDcSpec): InverterSpec {
  return { label: 'Machine inverter (averaged H-bridge sine-PWM)', stage, modulationMax: 0.95, outCurrentLimitA: 10, bridgeRohm: 0.08, bridgeSwLossFrac: 0.015, bridgeFixedW: 3, linkMinV: 60, linkMaxV: 700 };
}
