// -----------------------------------------------------------------------------
// First-order lumped thermal model (physical law: Newton cooling + heat capacity).
//
//     Cth · dT/dt = Ploss − (T − Tambient) / Rth
//
// Solved EXACTLY over a step with constant Ploss (no numerical stability limit):
//     T(t+dt) = Tinf + (T − Tinf) · exp(−dt / (Cth · Rth)),  Tinf = Tamb + Ploss · Rth
// -----------------------------------------------------------------------------

/** Advance one lumped thermal node by dt seconds. Units: °C, W, J/K, K/W, s. */
export function thermalStep(tempC: number, heatW: number, ambientC: number, cthJPerK: number, rthKPerW: number, dtS: number): number {
  if (!(cthJPerK > 0) || !(rthKPerW > 0)) throw new RangeError('thermal Cth and Rth must be positive');
  const dt = Math.max(0, dtS);
  const tInf = ambientC + Math.max(0, heatW) * rthKPerW;
  return tInf + (tempC - tInf) * Math.exp(-dt / (cthJPerK * rthKPerW));
}

/** Steady-state temperature for constant heat input. */
export function thermalSteadyState(ambientC: number, heatW: number, rthKPerW: number): number {
  return ambientC + Math.max(0, heatW) * rthKPerW;
}

/** Thermal time constant τ = Cth · Rth (s). */
export function thermalTimeConstant(cthJPerK: number, rthKPerW: number): number {
  return cthJPerK * rthKPerW;
}
