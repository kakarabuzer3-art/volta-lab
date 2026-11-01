import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, STEP_S, defaultConfig, outputVoltageAt } from './engine.ts';
import type { EngineConfig, Snapshot } from './engine.ts';
import { acInputSupplyLoad, dcModuleLoad, resistiveLoad, inductiveLoad } from './loads.ts';
import { MACHINE_CONVERTER } from './dcdc.ts';
import { machineInverter } from './inverter.ts';
import { storedEnergyWh } from './battery.ts';

const near = (a: number, b: number, tol: number, msg?: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const run = (e: Engine, seconds: number): void => { for (let k = 0; k < Math.round(seconds / STEP_S); k++) e.step(); };

function lead12Config(turns: number): EngineConfig {
  const converter = { ...MACHINE_CONVERTER, turnsRatio: turns };
  return { ...defaultConfig(), pack: { cell: { chemistry: 'lead-acid', capacityAh: 7 }, seriesCells: 6, parallelStrings: 2 }, converter, inverter: machineInverter(converter), initialSoc: 0.9 };
}

function assertFinite(x: unknown, path = 'snapshot'): void {
  if (typeof x === 'number') assert.ok(Number.isFinite(x), `${path} is not finite: ${x}`);
  else if (Array.isArray(x)) x.forEach((v, k) => assertFinite(v, `${path}[${k}]`));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) assertFinite(v, `${path}.${k}`);
}

test('8/9. DC mode: fixed polarity and the commanded DC voltage', () => {
  const e = new Engine();
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 48 });
  run(e, 1);
  const s = e.snapshot();
  assert.equal(s.output.kind, 'dc');
  assert.equal(s.output.polarity, '+/-');
  near(s.output.voltage, 48, 1e-9);
  assert.equal(s.output.freqHz, 0, 'DC fundamental frequency is 0 Hz');
  assert.equal(s.output.vPpV, null); assert.equal(s.output.powerFactor, null); assert.equal(s.output.sVA, null);
  for (let k = 0; k < 20; k++) { assert.equal(outputVoltageAt(s, k * 0.00123), 48, 'v(t) = Vdc, never changes sign'); }
});

test('10/11. DC current is computed from the actual load; open circuit draws no output current', () => {
  const e = new Engine();
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 100 });
  run(e, 0.5);
  let s = e.snapshot();
  assert.equal(s.output.currentA, 0); assert.equal(s.output.pRealW, 0);
  assert.ok(s.battery.currentA > 0 && s.battery.currentA < 0.1, 'only converter quiescent loss flows from the battery');
  e.attachLoad(resistiveLoad(25));
  run(e, 0.5);
  s = e.snapshot();
  near(s.output.currentA, 4, 1e-9); near(s.output.pRealW, 400, 1e-6);
  assert.ok(s.battery.powerW > 400 && s.battery.powerW < 440, `battery supplies output + losses, got ${s.battery.powerW}`);
  e.attachLoad(resistiveLoad(100));
  run(e, 0.2);
  near(e.snapshot().output.currentA, 1, 1e-9, 'a different load gives a different current (no fixed resistance)');
});

test('12. reverse polarity is handled by the load model', () => {
  const e = new Engine();
  const mod = dcModuleLoad({ vForwardV: 3, rDynOhm: 5 }, { vRatedMaxV: 14, vReverseMaxV: 5, vAbsMaxV: 20 });
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 12 });
  e.attachLoad(mod, false);
  run(e, 0.3);
  near(e.snapshot().output.currentA, (12 - 3) / 5, 1e-9);
  assert.equal(e.snapshot().load!.health.state, 'normal');
  e.attachLoad(mod, true); // swapped terminals
  run(e, 0.3);
  const s = e.snapshot();
  assert.equal(s.output.currentA, 0, 'reverse-biased module conducts no current');
  assert.equal(s.load!.health.state, 'damaged');
  assert.ok(s.load!.health.reasons.some((r) => r.includes('Reverse polarity')));
});

test('26/27 (engine). AC load through the full battery→DC-DC→inverter chain', () => {
  const e = new Engine();
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 230 });
  e.attachLoad(resistiveLoad(52.9, { input: 'ac' }));
  run(e, 1);
  const s = e.snapshot();
  near(s.output.voltage, 230, 1e-9); near(s.output.vPeakV!, 230 * Math.SQRT2, 1e-9); near(s.output.vPpV!, 460 * Math.SQRT2, 1e-9);
  near(s.output.currentA, 230 / 52.9, 1e-9); near(s.output.powerFactor!, 1, 1e-9);
  near(s.output.sVA!, 230 * s.output.currentA, 1e-9);
  assert.equal(s.output.freqHz, 50);
  assert.ok(s.converter.pInW > s.output.pRealW && s.converter.efficiency! < 1 && s.converter.efficiency! > 0.8);
  near(s.battery.powerW, s.converter.pInW, 0.01 * s.converter.pInW + 0.5);
  // Reactive load: PF reported < 1; battery supplies real power, not VA.
  e.attachLoad(inductiveLoad(20, 0.1, { input: 'ac' }));
  run(e, 0.3);
  const r = e.snapshot();
  assert.ok(r.output.powerFactor! < 0.8 && r.output.sVA! > r.output.pRealW);
  assert.ok(r.converter.pInW < r.output.sVA!);
  // Nonlinear AC-input supply: PF well below 1, bus ripple reported by the rectifier model.
  e.attachLoad(acInputSupplyLoad({ pOutW: 100, efficiency: 0.9, busCapF: 220e-6 }));
  run(e, 0.3);
  const p = e.snapshot();
  assert.ok(p.output.powerFactor! < 0.8);
  assert.ok(p.load!.busRippleVpp! > 1 && p.load!.busMeanV! > 230);
  assert.equal(p.load!.health.state, 'normal');
});

test('33. main power OFF: zero output, zero battery current, no SOC change', () => {
  const e = new Engine();
  e.setInputs({ powerOn: false, mode: 'ac', setpointV: 415 });
  e.attachLoad(resistiveLoad(50));
  const soc0 = e.snapshot().battery.socFrac;
  run(e, 5);
  const s = e.snapshot();
  assert.equal(s.status, 'off');
  assert.equal(s.output.voltage, 0); assert.equal(s.output.currentA, 0); assert.equal(s.output.pRealW, 0);
  assert.equal(s.battery.currentA, 0);
  assert.equal(s.battery.socFrac, soc0);
  assert.equal(s.converter.pInW, 0);
});

for (const mode of ['dc', 'ac'] as const) {
  test(`34. short-circuit protection (${mode.toUpperCase()}): current-limited, trips after the delay, latched until power cycle`, () => {
    const e = new Engine();
    e.setInputs({ powerOn: true, mode, setpointV: 230, connection: { kind: 'short' } });
    run(e, 0.5);
    let s = e.snapshot();
    near(s.output.currentA, defaultConfig().converter.outCurrentLimitA, 1e-6);
    assert.ok(s.output.currentLimited && s.status === 'limited');
    assert.ok(s.output.prospectiveCurrentA! > 1000, 'prospective current is far above the limit');
    assert.ok(s.output.voltage < 1, 'voltage folds back to I·R_contact');
    near(s.output.pRealW, s.output.currentA ** 2 * 0.05, 1e-6, 'only I²R at the contact');
    assert.equal(s.protection.trip, null);
    run(e, 2);
    s = e.snapshot();
    assert.equal(s.protection.trip, 'overcurrent');
    assert.equal(s.status, 'tripped');
    assert.equal(s.output.currentA, 0); assert.equal(s.output.voltage, 0);
    run(e, 1);
    assert.equal(e.snapshot().protection.trip, 'overcurrent', 'latched');
    e.setInputs({ connection: { kind: 'open' } });
    run(e, 0.5);
    assert.equal(e.snapshot().protection.trip, 'overcurrent', 'removing the fault does not reset the latch');
    e.setInputs({ powerOn: false }); e.setInputs({ powerOn: true });
    run(e, 0.2);
    s = e.snapshot();
    assert.equal(s.protection.trip, null);
    near(s.output.voltage, 230, 1e-6);
  });
}

test('35. AC/DC switching leaves no stale state', () => {
  const e = new Engine();
  e.setInputs({ powerOn: true, mode: 'ac', setpointV: 230, connection: { kind: 'short' } });
  run(e, 1.0);
  assert.ok(e.snapshot().protection.overcurrentTimerS > 0.9);
  e.setInputs({ mode: 'dc', connection: { kind: 'open' } });
  let s = e.snapshot();
  assert.equal(s.protection.overcurrentTimerS, 0, 'protection timer cleared on mode change');
  assert.equal(s.output.kind, 'dc');
  assert.equal(s.output.sVA, null); assert.equal(s.output.powerFactor, null); assert.equal(s.output.vPpV, null);
  assert.equal(s.converter.dcLinkV, null); assert.equal(s.converter.modulation, null);
  run(e, 0.3);
  s = e.snapshot();
  assert.equal(s.output.freqHz, 0);
  near(s.output.voltage, 230, 1e-9);
  assert.equal(s.protection.trip, null);
  e.setInputs({ mode: 'ac' }); run(e, 0.3);
  s = e.snapshot();
  assert.equal(s.output.freqHz, 50); near(s.output.voltage, 230, 1e-9); assert.notEqual(s.converter.dcLinkV, null);
  // The AC/DC selector alone does not change stored energy except through real current.
  const e2 = new Engine(); e2.setInputs({ powerOn: false });
  const soc = e2.snapshot().battery.socFrac;
  e2.setInputs({ mode: 'dc' }); e2.setInputs({ mode: 'ac' }); run(e2, 1);
  assert.equal(e2.snapshot().battery.socFrac, soc);
});

test('mandatory example (engine): 12 V lead-acid battery → 415 V DC', () => {
  const e = new Engine(lead12Config(4));
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 415 });
  e.attachLoad(resistiveLoad(415 ** 2 / 100)); // 100 W at 415 V
  const before = e.snapshot();
  run(e, 60);
  const s = e.snapshot();
  assert.equal(s.protection.trip, null);
  near(s.output.voltage, 415, 1e-6); near(s.output.pRealW, 100, 1e-3);
  assert.ok(s.battery.currentA > 8 && s.battery.currentA < 12, `battery current ${s.battery.currentA} A`);
  assert.ok(s.battery.terminalV < s.battery.ocvV - 0.2, 'terminal voltage sags');
  assert.ok(s.battery.socFrac < before.battery.socFrac, 'SOC drops');
  assert.ok(s.battery.remainingWh < before.battery.remainingWh);
  assert.ok(before.battery.remainingWh - s.battery.remainingWh >= 100 * 60 / 3600, 'stored energy falls by at least the delivered energy');
  near(s.battery.powerW, s.converter.pInW, 0.02 * s.converter.pInW);
  assert.ok(s.converter.efficiency! < 1 && s.converter.lossW > 0);
  // Without the (documented) isolated-stage assumption the single-stage boost truthfully cannot reach 415 V.
  const single = new Engine(lead12Config(1));
  single.setInputs({ powerOn: true, mode: 'dc', setpointV: 415 });
  single.attachLoad(resistiveLoad(415 ** 2 / 100));
  run(single, 0.5);
  const t = single.snapshot();
  assert.equal(t.converter.limited, 'duty-limit');
  assert.ok(t.output.voltage < 150 && t.output.voltage > 50, `limited to ≈ ${t.output.voltage} V`);
  assert.ok(t.converter.maxOutputAtDutyLimitV! < 150);
  // 12 V → 230 V AC also needs the DC-DC stage: required battery current follows from Pin.
  const ac = new Engine(lead12Config(4));
  ac.setInputs({ powerOn: true, mode: 'ac', setpointV: 230 });
  ac.attachLoad(resistiveLoad(529, { input: 'ac' })); // 100 W
  run(ac, 1);
  const a = ac.snapshot();
  near(a.output.pRealW, 100, 0.01);
  assert.ok(a.converter.pInW > 105 && a.converter.efficiency! < 0.95);
  near(a.battery.currentA * a.battery.terminalV, a.converter.pInW, 0.02 * a.converter.pInW);
  assert.ok(a.battery.currentA > 8);
});

test('battery protection: over-current / low-voltage trips and empty battery cut-off', () => {
  const e = new Engine(lead12Config(4));
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 415 });
  e.attachLoad(resistiveLoad(415 ** 2 / 600)); // 600 W is beyond what this small pack can deliver safely
  run(e, 3);
  const s = e.snapshot();
  assert.ok(['battery-over-current', 'battery-low-voltage'].includes(s.protection.trip ?? ''), `trip: ${s.protection.trip}`);
  assert.equal(s.output.currentA, 0);
});

test('36 (engine). depletion: delivered energy never exceeds stored energy; empty battery stops the output', () => {
  const cfg: EngineConfig = { ...defaultConfig(), pack: { cell: { chemistry: 'li-ion', capacityAh: 0.05 }, seriesCells: 100, parallelStrings: 1 }, initialSoc: 1 };
  const e = new Engine(cfg);
  const stored = storedEnergyWh(e.pack, 1);
  e.setInputs({ powerOn: true, mode: 'dc', setpointV: 200 });
  e.attachLoad(resistiveLoad(40)); // 1 kW from a ≈ 18 Wh pack
  for (let k = 0; k < 4000 && e.snapshot().protection.trip === null; k++) e.step();
  const s = e.snapshot();
  assert.ok(s.protection.trip !== null, `a trip occurred (${s.protection.trip})`);
  assert.ok(s.ledger.outputWh <= stored, `output ${s.ledger.outputWh} Wh ≤ stored ${stored} Wh`);
  assert.ok(s.ledger.batteryTerminalWh <= stored);
  assert.equal(s.output.currentA, 0);
  assert.ok(s.battery.socFrac >= 0 && s.battery.remainingWh >= 0);
});

test('energy conservation across the whole chain (source → conversion → load)', () => {
  for (const mode of ['dc', 'ac'] as const) {
    const e = new Engine();
    e.setInputs({ powerOn: true, mode, setpointV: 230 });
    e.attachLoad(resistiveLoad(mode === 'ac' ? 30 : 30, { input: 'ac-or-dc' }));
    const e0 = storedEnergyWh(e.pack, e.snapshot().battery.socFrac);
    run(e, 120);
    const s = e.snapshot();
    const L = s.ledger;
    assert.ok(L.outputWh > 1, `${mode}: energy was delivered`);
    near(L.batteryResidualWh, 0, 1e-9, `${mode}: battery chemical = terminal + losses`);
    near(L.terminalResidualWh, 0, 0.005 * L.outputWh, `${mode}: battery terminal energy = output + conversion loss`);
    assert.ok(L.batteryTerminalWh > L.outputWh, 'more energy leaves the battery than reaches the load');
    assert.ok(L.conversionLossWh > 0 && L.batteryInternalLossWh > 0);
    const dStored = e0 - storedEnergyWh(e.pack, s.battery.socFrac);
    near(dStored, L.batteryChemicalWh, 0.01 * dStored, `${mode}: stored energy falls by the chemical energy released`);
    near(L.loadHeatWh, L.outputWh, 1e-6 * L.outputWh, 'a resistive load turns all absorbed energy into heat');
    assert.ok(dStored >= L.outputWh, 'cannot deliver more than was taken from storage');
  }
});

test('37. no NaN / Infinity / division by zero across extreme inputs', () => {
  const loads = [null, resistiveLoad(1e-6), resistiveLoad(1e9), inductiveLoad(0.001, 1e-9), acInputSupplyLoad({ pOutW: 1e5, efficiency: 0.5, busCapF: 1e-9 }), dcModuleLoad({ vForwardV: 0, rDynOhm: 1e-6 })];
  const setpoints = [0, 1e-9, 0.5, 12, 230, 415, 500, -5, NaN, Infinity];
  for (const mode of ['ac', 'dc'] as const) for (const sp of setpoints) for (const load of loads) for (const reversed of [false, true]) {
    const e = new Engine();
    e.setInputs({ powerOn: true, mode, setpointV: sp });
    if (load) e.attachLoad(load, reversed); else e.setInputs({ connection: { kind: 'short' } });
    for (let k = 0; k < 8; k++) { e.step(); assertFinite(e.snapshot(), `${mode}/${sp}/${load?.label}`); }
  }
  assert.equal(new Engine().advance(NaN), 0);
  assert.equal(new Engine().advance(-1), 0);
});

test('38. deterministic: identical inputs ⇒ identical state, independent of frame timing', () => {
  const make = (): Engine => { const e = new Engine(); e.setInputs({ powerOn: true, mode: 'ac', setpointV: 230 }); e.attachLoad(inductiveLoad(30, 0.05, { input: 'ac' })); return e; };
  const a = make(), b = make(), c = make();
  for (let k = 0; k < 200; k++) a.step();
  for (let k = 0; k < 100; k++) b.advance(0.04);          // 25 Hz frames
  for (let k = 0; k < 400; k++) c.advance(0.01);          // 100 Hz frames
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.deepEqual(c.snapshot(), a.snapshot());
  const jitter = make();
  for (const dt of [0.005, 0.031, 0.0166, 0.2, 0.0009, 0.0471]) jitter.advance(dt);
  assert.equal(jitter.snapshot().steps, Math.floor((0.005 + 0.031 + 0.0166 + 0.2 + 0.0009 + 0.0471) / STEP_S + 1e-9));
  const first: Snapshot = make().snapshot();
  assert.deepEqual(make().snapshot(), first);
  // A long stall is capped (no spiral of death) and does not change results beyond the cap.
  const s = make(); const n = s.advance(30);
  assert.equal(n, Math.floor(0.25 / STEP_S + 1e-9)); // 12 whole steps fit in the 0.25 s cap
});
