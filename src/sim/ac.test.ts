import test from 'node:test';
import assert from 'node:assert/strict';
import { acInstantaneous, acCurrentInstantaneous, meanOf, peakFromRms, peakToPeakFromRms, periodS, powerFromSamples, rmsFromPeak, rmsOf, seriesRlcAc } from './ac.ts';

const near = (a: number, b: number, tol: number, msg?: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const sample = (f: (t: number) => number, f0: number, n = 4000, periods = 1): number[] => Array.from({ length: n }, (_, k) => f((k * periods) / (f0 * n)));

test('1. sinusoidal waveform amplitude = √2·Vrms', () => {
  const v = sample((t) => acInstantaneous(230, 50, t), 50);
  near(Math.max(...v), 230 * Math.SQRT2, 0.01);
  near(Math.min(...v), -230 * Math.SQRT2, 0.01);
  near(acInstantaneous(230, 50, 0.005), 230 * Math.SQRT2, 1e-9, 'quarter period is the peak');
  near(acInstantaneous(230, 50, 0.01), 0, 1e-9, 'half period is a zero crossing');
});

test('2. RMS / peak / peak-to-peak relationships (sampled, not assumed)', () => {
  const v = sample((t) => acInstantaneous(120, 60, t), 60);
  near(rmsOf(v), 120, 1e-3);
  near(meanOf(v), 0, 1e-9);
  near(peakFromRms(120), 120 * Math.SQRT2, 1e-12);
  near(peakToPeakFromRms(120), 2 * 120 * Math.SQRT2, 1e-12);
  near(rmsFromPeak(peakFromRms(415)), 415, 1e-9);
});

test('3. frequency and period (50 Hz default, 60 Hz profile supported)', () => {
  near(periodS(50), 0.02, 1e-15);
  near(periodS(60), 1 / 60, 1e-15);
  const zc = (f0: number): number => { // rising zero crossings in 1 s
    let n = 0, prev = acInstantaneous(100, f0, 0);
    for (let k = 1; k <= 200000; k++) { const x = acInstantaneous(100, f0, k / 200000 + 1e-9); if (prev < 0 && x >= 0) n++; prev = x; }
    return n;
  };
  assert.equal(zc(50), 50);
  assert.equal(zc(60), 60);
  assert.equal(periodS(0), Infinity);
});

test('4. resistive-load current: Irms = Vrms/R, in phase, PF = 1', () => {
  const r = seriesRlcAc({ ohms: 46, henries: 0, farads: null }, 230, 50);
  near(r.irms, 5, 1e-12);
  near(r.phaseRad, 0, 1e-12);
  near(r.realPowerW, 1150, 1e-9);
  near(r.powerFactor, 1, 1e-12);
  assert.equal(r.kind, 'resistive');
});

test('5. inductive current lags voltage, capacitive current leads (90° for ideal L / C)', () => {
  const L = seriesRlcAc({ ohms: 0, henries: 0.1, farads: null }, 230, 50);
  near(L.reactanceOhm, 2 * Math.PI * 50 * 0.1, 1e-9);
  near(L.phaseRad, Math.PI / 2, 1e-9);
  assert.equal(L.kind, 'inductive');
  // v = 0 and rising at t = 0: an inductive current is at its NEGATIVE peak, a capacitive one at its POSITIVE peak.
  near(acCurrentInstantaneous(L, 50, 0), -L.ipeak, 1e-9);
  const C = seriesRlcAc({ ohms: 0, henries: 0, farads: 100e-6 }, 230, 50);
  near(C.reactanceOhm, -1 / (2 * Math.PI * 50 * 100e-6), 1e-9);
  near(C.phaseRad, -Math.PI / 2, 1e-9);
  assert.equal(C.kind, 'capacitive');
  near(acCurrentInstantaneous(C, 50, 0), C.ipeak, 1e-9);
  // Sampled waveforms: lag/lead peak times relative to the voltage peak (t = T/4).
  const iL = sample((t) => acCurrentInstantaneous(L, 50, t), 50, 4000);
  near((iL.indexOf(Math.max(...iL)) / 4000) * 0.02, 0.01, 1e-4, 'inductive current peaks a quarter period AFTER the voltage peak');
  const iC = sample((t) => acCurrentInstantaneous(C, 50, t), 50, 4000);
  near((iC.indexOf(Math.max(...iC)) / 4000) * 0.02, 0, 1e-4, 'capacitive current peaks a quarter period BEFORE the voltage peak');
});

test('6. real and apparent power: formulas agree with time-domain average(v·i)', () => {
  const load = { ohms: 10, henries: 0.05, farads: null };
  const r = seriesRlcAc(load, 230, 50);
  const X = 2 * Math.PI * 50 * 0.05;
  near(r.impedanceOhm, Math.hypot(10, X), 1e-12);
  near(r.irms, 230 / Math.hypot(10, X), 1e-12);
  near(r.apparentVA, 230 * r.irms, 1e-9);
  near(r.realPowerW, r.irms * r.irms * 10, 1e-9);
  const n = 8000;
  const v = sample((t) => acInstantaneous(230, 50, t), 50, n, 5);
  const i = sample((t) => acCurrentInstantaneous(r, 50, t), 50, n, 5);
  const s = powerFromSamples(v, i);
  near(s.realPowerW, r.realPowerW, 1e-6 * r.realPowerW + 1e-6);
  near(s.apparentVA, r.apparentVA, 1e-3);
  near(s.reactiveVAr, r.reactivePowerVAr, 1e-2);
  near(r.apparentVA ** 2, r.realPowerW ** 2 + r.reactivePowerVAr ** 2, 1e-6);
});

test('7. power factor = cos φ = R/Z, never assumed to be 1; resonance gives PF = 1', () => {
  const r = seriesRlcAc({ ohms: 10, henries: 0.05, farads: null }, 230, 50);
  near(r.powerFactor, 10 / r.impedanceOhm, 1e-12);
  near(r.powerFactor, Math.cos(r.phaseRad), 1e-12);
  assert.ok(r.powerFactor < 0.7);
  const L = 0.1, f = 50, C = 1 / ((2 * Math.PI * f) ** 2 * L);
  const res = seriesRlcAc({ ohms: 20, henries: L, farads: C }, 230, f);
  near(res.reactanceOhm, 0, 1e-6);
  near(res.impedanceOhm, 20, 1e-6);
  near(res.powerFactor, 1, 1e-9);
  // Sampled PF_true for the lagging load matches cos φ.
  const v = sample((t) => acInstantaneous(230, 50, t), 50, 8000, 5);
  const i = sample((t) => acCurrentInstantaneous(r, 50, t), 50, 8000, 5);
  near(powerFromSamples(v, i).powerFactor, r.powerFactor, 1e-4);
});
