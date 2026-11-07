// -----------------------------------------------------------------------------
// Central electrical engine: ONE authoritative simulation state.
//
//   battery pack ──► DC-DC stage ──► (DC mode) output terminals ──► load
//                              └──► H-bridge inverter ─► (AC mode) output terminals ──► load
//
// * Deterministic fixed-step clock (STEP_S); rendering calls advance(realDt) and never
//   influences results. Same inputs + same step count ⇒ identical state.
// * The AC/DC selector chooses WHICH chain is active. It does not "convert" anything by itself:
//   DC mode = battery → DC-DC; AC mode = battery → DC-DC → inverter (both stages have losses).
// * Open circuit → 0 A output (only converter quiescent loss is drawn from the battery).
// * Every number in `Snapshot` is produced here; the UI only formats it. Quantities this model
//   cannot know are `null` ("unavailable"), never invented.
// -----------------------------------------------------------------------------
import { acInstantaneous, acCurrentInstantaneous, peakFromRms, seriesRlcAc } from './ac.ts';
import type { SeriesRlc } from './ac.ts';
import type { AcResponse } from './ac.ts';
import { batteryEffectiveSource, createBatteryState, packModel, stepBattery, storedEnergyWh, batteryLimits } from './battery.ts';
import type { BatteryLimit, BatteryState, PackConfig, PackModel } from './battery.ts';
import { MACHINE_CONVERTER, solveDcDc } from './dcdc.ts';
import type { ConverterLimit, DcDcSolution, DcDcSpec } from './dcdc.ts';
import { machineInverter, solveInverter } from './inverter.ts';
import type { InverterSolution, InverterSpec } from './inverter.ts';
import { acResponse, acSupplyDetail, createLoadHealth, dcCurrentA, loadOperatingPoint, stepLoadHealth } from './loads.ts';
import type { Load, LoadHealth, LoadOperatingPoint } from './loads.ts';
import { thermalStep } from './thermal.ts';
import { deepFreeze } from './battery.ts';
import { finite, nonNegative, positive, socFraction, validateConnection, validateInverterSpec, validateLoad, validatePackConfig } from './validate.ts';

export const STEP_S = 0.02;
export const MAX_CATCHUP_S = 0.25;
export const MAX_SETPOINT_V = 415;

export type OutputMode = 'ac' | 'dc';
export type Connection = { kind: 'open' } | { kind: 'short' } | { kind: 'load'; load: Load; reversed: boolean };
export type TripReason = 'overcurrent' | 'battery-low-voltage' | 'battery-empty' | 'battery-over-temperature' | 'battery-over-current';
export type Measured = number | null;

export interface EngineConfig {
  pack: PackConfig;
  converter: DcDcSpec;
  inverter: InverterSpec;
  ambientC: number;
  acFreqHz: number;
  /** Cable/contact resistance when the output terminals touch (Ω). MODEL ASSUMPTION. */
  contactOhm: number;
  /** Output current-limit time before latched trip (s). MODEL ASSUMPTION. */
  tripDelayS: number;
  /** Battery limit violation time before latched trip (s). MODEL ASSUMPTION. */
  batteryTripDelayS: number;
  initialSoc: number;
}

/**
 * Default machine battery: an ILLUSTRATIVE 100S2P NMC pack (≈415 V full, ≈370 V nominal, 10 Ah, ≈3.7 kWh), sized only so that
 * the machine's 0–415 V range is reachable. It is not a specific commercial product.
 */
export function defaultConfig(): EngineConfig {
  const converter = { ...MACHINE_CONVERTER };
  return {
    pack: { cell: { chemistry: 'li-ion', capacityAh: 5 }, seriesCells: 100, parallelStrings: 2 },
    converter, inverter: machineInverter(converter),
    ambientC: 25, acFreqHz: 50, contactOhm: 0.05, tripDelayS: 2, batteryTripDelayS: 0.5, initialSoc: 0.9,
  };
}

export interface EngineInputs { powerOn: boolean; mode: OutputMode; setpointV: number; connection: Connection }

export interface Ledger {
  /** Energy delivered to the output terminals (Wh). */
  outputWh: number;
  /** Converter + inverter losses from the converter models (Wh). */
  conversionLossWh: number;
  /** Battery energy at its terminals (Wh, discharge +). */
  batteryTerminalWh: number;
  /** Battery chemical energy exchanged (Wh). */
  batteryChemicalWh: number;
  batteryInternalLossWh: number;
  /** batteryTerminal − output − conversionLoss  (Wh); ≈ 0 up to start-of-step polarization averaging. */
  terminalResidualWh: number;
  /** chemical − (terminal + internal losses + C1 stored) (Wh); ≈ 0 by construction of the exact RC step. */
  batteryResidualWh: number;
  loadHeatWh: number;
}

export interface Snapshot {
  timeS: number;
  steps: number;
  inputs: { powerOn: boolean; mode: OutputMode; setpointV: number; connection: 'open' | 'short' | 'load'; reversed: boolean };
  status: 'off' | 'running' | 'limited' | 'tripped' | 'battery-empty';
  protection: { trip: TripReason | null; message: string | null; overcurrentTimerS: number; converterShutdown: boolean };
  battery: {
    chemistry: string; label: string; seriesCells: number; parallelStrings: number; capacityAh: number;
    socFrac: number; remainingAh: number; remainingWh: number; nominalWh: number;
    ocvV: number; terminalV: number; currentA: number; powerW: number; tempC: number; r0Ohm: number; cutoffV: number;
    dischargedWh: number; chargedWh: number; limits: BatteryLimit[];
  };
  converter: {
    topology: string; vInV: number; iInA: number; pInW: number; vOutV: number; iOutA: number; pOutW: number; lossW: number;
    efficiency: Measured; duty: Measured; limited: ConverterLimit | 'modulation-limit' | null; tempC: number;
    rippleVppV: Measured; maxOutputAtDutyLimitV: Measured; dcLinkV: Measured; modulation: Measured;
  };
  output: {
    kind: OutputMode; targetV: number; voltage: number; vPeakV: Measured; vPpV: Measured; currentA: number; iPeakA: Measured;
    pRealW: number; sVA: Measured; qVAr: Measured; powerFactor: Measured; freqHz: number; polarity: '+/-' | 'n/a';
    prospectiveCurrentA: Measured; currentLimited: boolean;
  };
  load: null | { label: string; dataSource: string; health: LoadHealth; op: LoadOperatingPoint; busMeanV: Measured; busRippleVpp: Measured };
  ledger: Ledger;
}


export function validateEngineConfig(c: EngineConfig): void {
  validatePackConfig(c.pack);
  validateInverterSpec({ ...c.inverter, stage: c.converter });
  validateInverterSpec(c.inverter);
  finite('ambientC', c.ambientC);
  positive('acFreqHz', c.acFreqHz); positive('contactOhm', c.contactOhm);
  positive('tripDelayS', c.tripDelayS); nonNegative('batteryTripDelayS', c.batteryTripDelayS);
  socFraction('initialSoc', c.initialSoc);
  if (!(c.converter.tRestartC > c.ambientC)) throw new RangeError(`converter.tRestartC (${c.converter.tRestartC}) must be above ambientC (${c.ambientC}) or the converter could never restart`);
}

const EMPTY_TEXT = 'Battery is empty (0 % charge): output disabled. This simulator has no charging feature.';
const TRIP_TEXT: Record<TripReason, string> = {
  'overcurrent': 'Output held in current limit past the trip delay.',
  'battery-low-voltage': 'Battery terminal voltage fell to the cutoff voltage under load.',
  'battery-empty': 'Battery state of charge reached 0 %.',
  'battery-over-temperature': 'Battery temperature reached its limit.',
  'battery-over-current': 'Battery discharge current exceeded the pack limit.',
};

export class Engine {
  readonly config: EngineConfig;
  readonly pack: PackModel;
  // Inputs are stored FROZEN (and an attached load as a private deep-frozen clone): neither the object the caller passed in nor the
  // one getInputs() returns can alter validated simulation state. `loadSrc`/`loadKey` remember which caller object (and which
  // content) the clone came from, so re-sending an unchanged load is cheap and does not reset its health.
  private inputs: Readonly<EngineInputs> = Object.freeze({ powerOn: false, mode: 'ac', setpointV: 220, connection: Object.freeze({ kind: 'open' } as const) });
  private loadSrc: Load | null = null;
  private loadKey = '';
  private bat: BatteryState;
  private convTempC: number;
  private shutdown = false;
  private trip: TripReason | null = null;
  private ocTimer = 0;
  private batTimer = 0;
  private health: LoadHealth;
  private timeS = 0;
  private steps = 0;
  private acc = 0;
  private snap: Snapshot;
  private loadHeatJ = 0;
  private outJ = 0;
  private convLossJ = 0;

  constructor(config: EngineConfig = defaultConfig()) {
    validateEngineConfig(config);
    // Private deep, frozen copy: the caller keeping/mutating its own object cannot change a running engine.
    this.config = deepFreeze(structuredClone(config));
    this.pack = packModel(this.config.pack);
    this.bat = createBatteryState(this.config.initialSoc, this.config.ambientC);
    this.convTempC = this.config.ambientC;
    this.health = createLoadHealth(this.config.ambientC);
    this.snap = this.compute(this.idleResult());
  }

  // ---- inputs ---------------------------------------------------------------------------------
  getInputs(): Readonly<EngineInputs> { return this.inputs; }

  setInputs(p: Partial<EngineInputs>): void { this.applyInputs(p, false); }

  private applyInputs(p: Partial<EngineInputs>, resetHealth: boolean): void {
    const prev = this.inputs;
    const next: EngineInputs = { ...prev, ...p } as EngineInputs;
    // ---- 1. validate EVERYTHING first. Nothing below the validation block runs if any field is bad, so a
    //         rejected call cannot change the connection, timers, trips, load health or the last snapshot.
    finite('setpointV', next.setpointV);
    if (typeof next.powerOn !== 'boolean') throw new RangeError(`powerOn must be a boolean; got ${String(next.powerOn)}`);
    if (next.mode !== 'ac' && next.mode !== 'dc') throw new RangeError(`mode must be 'ac' or 'dc'; got ${String(next.mode)}`);
    const connChanged = 'connection' in p && p.connection !== prev.connection;
    if (connChanged) validateConnection(next.connection);
    // ---- 2. commit. Finite set-points outside the documented 0–415 V range are clamped to that range.
    let conn = prev.connection, newLoad = false;
    if (connChanged) {
      const c = next.connection;
      if (c.kind === 'load') {
        const key = JSON.stringify(c.load);
        const same = prev.connection.kind === 'load' && this.loadSrc === c.load && this.loadKey === key;
        const stored: Load = same ? (prev.connection as { load: Load }).load : deepFreeze(structuredClone(c.load));
        conn = Object.freeze({ kind: 'load' as const, load: stored, reversed: c.reversed });
        newLoad = !same; this.loadSrc = c.load; this.loadKey = key;
      } else { conn = Object.freeze({ kind: c.kind }); this.loadSrc = null; this.loadKey = ''; }
    }
    const setpointV = Math.min(MAX_SETPOINT_V, Math.max(0, next.setpointV));
    if (prev.powerOn && !next.powerOn) { this.trip = null; this.ocTimer = 0; this.batTimer = 0; }
    if (prev.mode !== next.mode) { this.ocTimer = 0; this.batTimer = 0; } // no stale mode-specific protection state
    if (resetHealth || newLoad) this.health = createLoadHealth(this.config.ambientC);
    this.inputs = Object.freeze({ powerOn: next.powerOn, mode: next.mode, setpointV, connection: conn });
    this.lastResult = this.solveElectrical();
    this.snap = this.compute(this.lastResult);
  }

  attachLoad(load: Load, reversed = false): void {
    // Validate before anything changes (atomic): a bad load or non-boolean `reversed` leaves the engine untouched.
    this.applyInputs({ connection: { kind: 'load', load, reversed } }, true);
  }
  detachLoad(): void { this.setInputs({ connection: { kind: 'open' } }); }

  // ---- time -----------------------------------------------------------------------------------
  /** Advance by wall-clock time using fixed physics steps. Returns the number of steps executed. */
  advance(realDtS: number): number {
    if (!(realDtS > 0) || !Number.isFinite(realDtS)) return 0;
    this.acc += Math.min(realDtS, MAX_CATCHUP_S);
    let n = 0;
    while (this.acc >= STEP_S - 1e-12) { this.step(); this.acc -= STEP_S; n++; }
    return n;
  }

  snapshot(): Snapshot { return this.snap; }

  // ---- physics step ---------------------------------------------------------------------------
  private lastResult: StepResult | null = null;

  step(): void {
    const dt = STEP_S;
    const cfg = this.config;
    const inp = this.inputs;
    let R = this.solveElectrical();

    // Battery. A battery cannot give more charge than it holds. If SOC reaches 0 inside this step, the output
    // ran for only the fraction `active` of the step and was dead for the rest. EVERYTHING that depends on the
    // machine running (converter heat, load heat, overstress and protection timers, ledger) is therefore applied
    // for `activeS` only; the remaining `idleS` is zero-load time during which the converter and load only cool.
    let requested = R.batteryCurrentA;
    let active = 1;
    const first = stepBattery(this.pack, this.bat, requested, dt, cfg.ambientC);
    if (requested > 0 && first.currentA < requested * (1 - 1e-12)) {
      // Charge left Q (A·s) must equal I·activeS. The converter operating point is re-solved for the shortened
      // interval (the battery's relaxing RC branch averages differently over a shorter time), iterating the weak
      // dependence to a fixed point so the converter power balance stays exact at the depletion boundary.
      const chargeAs = this.bat.soc * this.pack.capacityAh * 3600;
      active = first.currentA / requested;
      for (let it = 0; it < 12; it++) {
        const Rn = this.solveElectrical(dt * active);
        const activeNew = Math.min(1, chargeAs / (Rn.batteryCurrentA * dt));
        const done = Math.abs(activeNew - active) < 1e-14;
        R = Rn; requested = Rn.batteryCurrentA; active = activeNew;
        if (done) break;
      }
      const a = stepBattery(this.pack, this.bat, requested, dt * active, cfg.ambientC);
      // The charge was used up by construction; remove floating-point dust so an exhausted pack is exactly empty.
      this.bat = { ...stepBattery(this.pack, a.state, 0, dt * (1 - active), cfg.ambientC).state, soc: 0 };
    } else {
      this.bat = first.state;
    }
    const applied = requested * active;
    const activeS = dt * active;
    const idleS = dt - activeS;

    // Converter thermal state: heated for the active time, then cooling with zero dissipation.
    this.convTempC = thermalStep(this.convTempC, R.convHeatW, cfg.ambientC, cfg.converter.cthJPerK, cfg.converter.rthKPerW, activeS);
    if (idleS > 0) this.convTempC = thermalStep(this.convTempC, 0, cfg.ambientC, cfg.converter.cthJPerK, cfg.converter.rthKPerW, idleS);
    if (!this.shutdown && this.convTempC >= cfg.converter.tShutdownC) this.shutdown = true;
    else if (this.shutdown && this.convTempC <= cfg.converter.tRestartC) this.shutdown = false;

    // Load health from the actual terminal conditions. `R.drive === null` means NO drive (off / disabled /
    // open): the load is not judged against any input, it only cools.
    if (inp.connection.kind === 'load') {
      const load = inp.connection.load;
      let h = this.health;
      h = stepLoadHealth(load, h, R.drive ?? null, R.loadOp ?? ZERO_OP, cfg.ambientC, activeS);
      if (idleS > 0) h = stepLoadHealth(load, h, null, ZERO_OP, cfg.ambientC, idleS);
      this.health = h;
    }

    // Protection (deterministic timers; they only count time the machine was actually running).
    if (inp.powerOn && !this.trip) {
      if (R.currentLimited) this.ocTimer += activeS; else this.ocTimer = 0;
      if (this.ocTimer >= cfg.tripDelayS) this.trip = 'overcurrent';
      const lim = batteryLimits(this.pack, this.bat, R.batteryTerminalV, applied);
      const lowV = lim.includes('low-voltage') && applied > 0;
      if (this.bat.soc <= 0 && applied > 0) this.trip = 'battery-empty';
      else if (lim.includes('over-temperature')) this.batTimer += activeS;
      else if (lowV || lim.includes('over-discharge-current')) this.batTimer += activeS;
      else this.batTimer = 0;
      if (!this.trip && this.batTimer >= cfg.batteryTripDelayS) {
        this.trip = lim.includes('over-temperature') ? 'battery-over-temperature' : lowV ? 'battery-low-voltage' : 'battery-over-current';
      }
    }

    this.outJ += R.pOutW * dt * active;
    this.convLossJ += R.convLossW * dt * active;
    this.loadHeatJ += (R.loadOp?.heatW ?? 0) * dt * active;
    this.timeS += dt;
    this.steps += 1;
    // Shutdown / restart boundary: the interval just simulated used the enabled state at its START
    // (its energy was really delivered and is in the ledger). The snapshot describes the END of the
    // step, so if the enabled state changed (protection trip, converter thermal shutdown or restart,
    // battery empty) the electrical result is re-solved for the new state. A disabled converter shows
    // 0 V / 0 A / 0 W and draws no battery current; a restarted one shows its energised values at once.
    const enabledNow = inp.powerOn && !this.trip && !this.shutdown && this.bat.soc > 0;
    const Rnow = enabledNow !== R.enabled ? this.solveElectrical() : R;
    this.lastResult = Rnow;
    this.snap = this.compute(Rnow);
  }

  private idleResult(): StepResult {
    return { ...EMPTY_RESULT };
  }

  // ---- electrical solve for the present state (pure with respect to state) ----------------------
  private solveElectrical(durationS: number = STEP_S): StepResult {
    const inp = this.inputs;
    const cfg = this.config;
    // Source seen by the converter over ONE physics step: the exact Thevenin equivalent of the
    // battery's exponentially relaxing RC branch (E_eff, R_eff). With it, the converter power solve and
    // the battery energy bookkeeping use the same mean terminal voltage → ledger identity (B) is exact.
    const eff = batteryEffectiveSource(this.pack, this.bat, durationS);
    const e = eff.eEffV;
    const src = { eV: Math.max(0, e), rOhm: eff.rEffOhm };
    const enabled = inp.powerOn && !this.trip && !this.shutdown && this.bat.soc > 0;
    if (!enabled) return { ...EMPTY_RESULT, batteryTerminalV: Math.max(0, e), enabled: false };

    const conn = inp.connection;
    const loadOk = conn.kind === 'load' && this.health.state !== 'damaged' && this.health.state !== 'protection';
    const target = inp.setpointV;
    const f = cfg.acFreqHz;

    if (inp.mode === 'dc') {
      let iOfV: (v: number) => number;
      if (conn.kind === 'short') iOfV = (v) => v / cfg.contactOhm;
      else if (conn.kind === 'load' && loadOk) iOfV = (v) => Math.max(0, conn.reversed ? -dcCurrentA(conn.load, -v) : dcCurrentA(conn.load, v));
      else iOfV = () => 0;
      const s = solveDcDc(cfg.converter, src, { iOfV }, target);
      const drive = conn.kind === 'load' && loadOk ? ({ kind: 'dc', v: conn.reversed ? -s.vOutV : s.vOutV, freqHz: 0 } as const) : null;
      const loadOp = conn.kind === 'load' && drive ? loadOperatingPoint(conn.load, this.health, drive) : null;
      return {
        enabled: true, dc: s, ac: null, batteryCurrentA: s.iInA, batteryTerminalV: s.vInV,
        vOut: s.vOutV, iOut: s.iOutA, iPeak: s.iOutA, pOutW: s.pOutW, sVA: null, qVAr: null, pf: null, freqHz: 0,
        convHeatW: s.lossW, convLossW: s.lossW, currentLimited: s.limited === 'output-current-limit' || s.limited === 'input-current-limit',
        drive, loadOp, rippleVpp: s.ripple.outputVppV, acResp: null,
      };
    }
    // AC mode
    let respond: (v: number, f: number) => AcResponse;
    if (conn.kind === 'short') respond = (v, fr) => seriesRlcAc({ ohms: cfg.contactOhm, henries: 0, farads: null } as SeriesRlc, v, fr);
    else if (conn.kind === 'load' && loadOk) respond = (v, fr) => acResponse(conn.load, v, fr);
    else respond = () => ZERO_AC;
    const inv = solveInverter(cfg.inverter, src, { respond }, target, f);
    const drive = conn.kind === 'load' && loadOk ? ({ kind: 'ac', v: inv.vOutRms, freqHz: f } as const) : null;
    const loadOp = conn.kind === 'load' && drive ? loadOperatingPoint(conn.load, this.health, drive) : null;
    return {
      enabled: true, dc: null, ac: inv, batteryCurrentA: inv.iInA, batteryTerminalV: inv.vInV,
      vOut: inv.vOutRms, iOut: inv.iOutRms, iPeak: inv.iOutPeak, pOutW: inv.pOutW, sVA: inv.sOutVA, qVAr: inv.qOutVAr, pf: inv.powerFactor, freqHz: f,
      convHeatW: inv.lossW, convLossW: inv.lossW,
      currentLimited: inv.limited === 'output-current-limit' || inv.limited === 'input-current-limit',
      drive, loadOp, rippleVpp: null, acResp: inv.vOutRms > 0 ? respond(inv.vOutRms, f) : null,
    };
  }

  // ---- snapshot -------------------------------------------------------------------------------
  private compute(R: StepResult): Snapshot {
    const inp = this.inputs, cfg = this.config, pk = this.pack, b = this.bat;
    const ocv = pk.ocv(b.soc, b.tempC);
    const i = R.enabled ? R.batteryCurrentA : 0;
    const vt = R.enabled ? R.batteryTerminalV : Math.max(0, ocv - b.v1V);
    const stage = R.dc ?? R.ac?.stage ?? null;
    const ac = inp.mode === 'ac';
    const live = R.enabled;
    const conn = inp.connection;
    const limited = (R.dc?.limited ?? R.ac?.limited) ?? null;
    const empty = b.soc <= 0;
    // An empty battery can never be "running": with power ON it reports 'battery-empty' (even after the empty-battery trip
    // latched, and after power cycling), with power OFF it simply reports 'off'.
    const status: Snapshot['status'] = this.shutdown || (this.trip && !(empty && this.trip === 'battery-empty')) ? 'tripped'
      : !inp.powerOn ? 'off' : empty ? 'battery-empty' : limited ? 'limited' : 'running';
    const rContact = cfg.contactOhm;
    const prospective: Measured = conn.kind === 'short' && inp.powerOn ? inp.setpointV / rContact : null;
    const remainingWh = storedEnergyWh(pk, b.soc);
    const led = this.ledgerNow();
    let busMean: Measured = null, busRipple: Measured = null;
    if (conn.kind === 'load' && conn.load.kind === 'ac-input-supply' && live && ac && R.vOut > 0) {
      const d = acSupplyDetail(conn.load, R.vOut, cfg.acFreqHz);
      if (d.running) { busMean = d.busMeanV; busRipple = d.rippleVpp; }
    }
    const snapshot: Snapshot = {
      timeS: this.timeS, steps: this.steps,
      inputs: { powerOn: inp.powerOn, mode: inp.mode, setpointV: inp.setpointV, connection: conn.kind, reversed: conn.kind === 'load' ? conn.reversed : false },
      status,
      protection: { trip: this.trip, message: inp.powerOn && empty && (!this.trip || this.trip === 'battery-empty') ? EMPTY_TEXT : this.trip ? TRIP_TEXT[this.trip] : this.shutdown ? 'Converter thermal shutdown (restarts after cooling).' : null, overcurrentTimerS: this.ocTimer, converterShutdown: this.shutdown },
      battery: {
        chemistry: pk.profile.chemistry, label: pk.profile.label, seriesCells: pk.config.seriesCells, parallelStrings: pk.config.parallelStrings, capacityAh: pk.capacityAh,
        socFrac: b.soc, remainingAh: b.soc * pk.capacityAh, remainingWh, nominalWh: pk.nominalEnergyWh, ocvV: ocv, terminalV: vt, currentA: i, powerW: vt * i,
        tempC: b.tempC, r0Ohm: pk.r0(b.soc, b.tempC), cutoffV: pk.cutoffV, dischargedWh: b.dischargedWh, chargedWh: b.chargedWh, limits: empty && inp.powerOn && !batteryLimits(pk, b, vt, i).includes('empty') ? [...batteryLimits(pk, b, vt, i), 'empty'] : batteryLimits(pk, b, vt, i),
      },
      converter: {
        topology: !live || !stage ? 'idle' : ac ? `${stage.topology} → H-bridge inverter` : stage.topology,
        vInV: live && stage ? stage.vInV : 0, iInA: live && stage ? stage.iInA : 0, pInW: live ? (R.ac ? R.ac.pInW : stage ? stage.pInW : 0) : 0,
        vOutV: live ? R.vOut : 0, iOutA: live ? R.iOut : 0, pOutW: live ? R.pOutW : 0, lossW: live ? R.convLossW : 0,
        efficiency: live ? (R.ac ? R.ac.efficiency : stage ? stage.efficiency : null) : null,
        duty: live && stage ? stage.duty : null, limited, tempC: this.convTempC,
        rippleVppV: live && R.rippleVpp !== null ? R.rippleVpp : null, maxOutputAtDutyLimitV: live && stage ? stage.maxOutputAtDutyLimitV : null,
        dcLinkV: live && R.ac ? R.ac.dcLinkV : null, modulation: live && R.ac ? R.ac.modulation : null,
      },
      output: {
        kind: inp.mode, targetV: inp.powerOn ? inp.setpointV : 0, voltage: live ? R.vOut : 0,
        vPeakV: ac ? (live ? peakFromRms(R.vOut) : 0) : (live ? R.vOut : 0), vPpV: ac ? (live ? 2 * peakFromRms(R.vOut) : 0) : null,
        currentA: live ? R.iOut : 0, iPeakA: live ? R.iPeak : 0, pRealW: live ? R.pOutW : 0,
        sVA: ac ? (live ? R.sVA : 0) : null, qVAr: ac ? (live ? R.qVAr : 0) : null, powerFactor: ac && live ? R.pf : null,
        freqHz: ac ? cfg.acFreqHz : 0, polarity: ac ? 'n/a' : '+/-', prospectiveCurrentA: prospective, currentLimited: live && R.currentLimited,
      },
      load: conn.kind === 'load' ? { label: conn.load.label, dataSource: conn.load.dataSource, health: { ...this.health, reasons: [...this.health.reasons] }, op: { ...(R.loadOp ?? ZERO_OP) }, busMeanV: busMean, busRippleVpp: busRipple } : null,
      ledger: led,
    };
    // The snapshot is handed to callers: freeze it (deeply) so it cannot be used to reach internal state.
    return deepFreeze(snapshot);
  }

  private ledgerNow(): Ledger {
    const b = this.bat;
    const out = this.outJ / 3600, conv = this.convLossJ / 3600;
    const internal = b.r0LossWh + b.r1LossWh + b.sideLossWh;
    return {
      outputWh: out, conversionLossWh: conv, batteryTerminalWh: b.terminalNetWh, batteryChemicalWh: b.chemicalNetWh, batteryInternalLossWh: internal,
      terminalResidualWh: b.terminalNetWh - out - conv, batteryResidualWh: b.chemicalNetWh - (b.terminalNetWh + b.r0LossWh + b.r1LossWh + b.c1StoredWh),
      loadHeatWh: this.loadHeatJ / 3600,
    };
  }
}

// ---- helpers --------------------------------------------------------------------------------------

interface StepResult {
  enabled: boolean;
  dc?: DcDcSolution | null;
  ac?: InverterSolution | null;
  batteryCurrentA: number; batteryTerminalV: number;
  vOut: number; iOut: number; iPeak: number; pOutW: number; sVA: number | null; qVAr: number | null; pf: number | null; freqHz: number;
  convHeatW: number; convLossW: number; currentLimited: boolean;
  drive?: { kind: 'ac' | 'dc'; v: number; freqHz: number } | null;
  loadOp?: LoadOperatingPoint | null;
  rippleVpp: number | null;
  acResp?: AcResponse | null;
}

const ZERO_OP: LoadOperatingPoint = { currentA: 0, peakA: 0, pRealW: 0, sVA: 0, qVAr: 0, powerFactor: null, heatW: 0, connected: false };
const ZERO_AC: AcResponse = { impedanceOhm: Infinity, reactanceOhm: 0, phaseRad: 0, irms: 0, ipeak: 0, realPowerW: 0, reactivePowerVAr: 0, apparentVA: 0, powerFactor: 0, kind: 'resistive' };
const EMPTY_RESULT: StepResult = {
  enabled: false, dc: null, ac: null, batteryCurrentA: 0, batteryTerminalV: 0, vOut: 0, iOut: 0, iPeak: 0, pOutW: 0, sVA: null, qVAr: null, pf: null, freqHz: 0,
  convHeatW: 0, convLossW: 0, currentLimited: false, drive: null, loadOp: null, rippleVpp: null, acResp: null,
};

/** Instantaneous output voltage (V) for visuals/tests, from the snapshot: AC sine at sim time t, DC constant. */
export function outputVoltageAt(s: Snapshot, tS: number): number {
  return s.output.kind === 'ac' ? acInstantaneous(s.output.voltage, s.output.freqHz, tS) : s.output.voltage;
}
/** Instantaneous output current (A): AC follows the load's phase if known (resistive default), DC constant. */
export function outputCurrentAt(s: Snapshot, tS: number, phaseRad = 0): number {
  if (s.output.kind === 'dc') return s.output.currentA;
  const w = 2 * Math.PI * s.output.freqHz;
  return Math.SQRT2 * s.output.currentA * Math.sin(w * tS - phaseRad);
}
export { acCurrentInstantaneous };
