// Ideal-transformer arithmetic (pure functions, no DOM, no simulator). An IDEAL transformer has no winding resistance, no leakage, no core loss and no
// frequency effect, so it is only a teaching relationship: Vp / Vs = Np / Ns and Ip · Np = Is · Ns, with equal apparent power on both sides.
// Values are RMS magnitudes for AC. Nothing here claims to model a real product.
export interface IdealTransformerInput {
  readonly turnsPrimary: number;
  readonly turnsSecondary: number;
  /** RMS volts on the primary, optional. */
  readonly primaryVoltage?: number;
  /** RMS amperes in the primary, optional. */
  readonly primaryCurrent?: number;
}
export type TransformerKind = 'step-up' | 'step-down' | 'one-to-one';
export type IdealTransformerResult =
  | { readonly ok: true; readonly ratio: number; readonly kind: TransformerKind; readonly secondaryVoltage?: number; readonly secondaryCurrent?: number; readonly apparentPower?: number }
  | { readonly ok: false; readonly error: string };

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const nonNegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function idealTransformer(input: IdealTransformerInput): IdealTransformerResult {
  const { turnsPrimary: np, turnsSecondary: ns, primaryVoltage: vp, primaryCurrent: ip } = input;
  if (!positive(np)) return { ok: false, error: 'Primary turns must be a number greater than zero.' };
  if (!positive(ns)) return { ok: false, error: 'Secondary turns must be a number greater than zero.' };
  if (vp !== undefined && !nonNegative(vp)) return { ok: false, error: 'Primary voltage must be zero or more.' };
  if (ip !== undefined && !nonNegative(ip)) return { ok: false, error: 'Primary current must be zero or more.' };
  const ratio = np / ns;
  const kind: TransformerKind = np === ns ? 'one-to-one' : ns > np ? 'step-up' : 'step-down';
  return {
    ok: true, ratio, kind,
    ...(vp !== undefined ? { secondaryVoltage: vp / ratio } : {}),
    ...(ip !== undefined ? { secondaryCurrent: ip * ratio } : {}),
    ...(vp !== undefined && ip !== undefined ? { apparentPower: vp * ip } : {}),
  };
}
