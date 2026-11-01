# Volta Lab electrical model

> **This is a software simulation.** The app runs in a browser; it cannot generate, measure or
> deliver real electrical energy, and it cannot power an LED or any external device. Every number
> shown is computed from the model below. Nothing here is a measurement of real hardware.

## Current engine (`src/sim/`) — what the app uses

One deterministic engine (`src/sim/engine.ts`) owns the **only** simulation state. `src/main.ts`
sets inputs (power, AC/DC, set-point, cable contact / attached load), calls `engine.advance(dt)` and
reads `engine.snapshot()` for the 3D display, HUD and telemetry. Nothing in the UI computes a
voltage, current or power. Quantities the model cannot know are `null` and shown as `n/a`.

```
battery pack ─► DC-DC stage ─► (DC mode) terminals ─► load
                       └────► H-bridge inverter ─► (AC mode) terminals ─► load
```

The AC/DC selector chooses **which chain is active**; it does not convert anything by itself.
Open circuit = 0 A output (only converter standby loss is drawn from the battery). Cable contact =
short (R = contact resistance). A typed `Load` can be attached through `window.voltaLab` (no new UI).

### Clock
Fixed physics step `STEP_S = 20 ms` with an accumulator in `advance()`; render frame rate never
changes results (tested). A stall is capped at 0.25 s. RC polarization and thermal states use exact
exponential steps (unconditionally stable); the rectifier capacitor uses backward Euler.

### Equations (SI; discharge-positive battery current)
| Block | Equation | Status |
|---|---|---|
| AC source | v = √2·Vrms·sin(2πft+φ); Vpk = √2·Vrms; Vpp = 2Vpk; T = 1/f | physical law |
| Series RLC | XL = 2πfL, XC = 1/(2πfC), Z = √(R²+(XL−XC)²), φ = atan2(X,R), Irms = V/Z | physical law |
| AC power | P = Vrms·Irms·cosφ, S = Vrms·Irms, Q = Vrms·Irms·sinφ, PF = P/S; for sampled waveforms P = mean(v·i) | physical law |
| Battery | Vt = OCV(SOC,T) − I·R0(SOC,T) − V1; dV1/dt = (I·R1 − V1)/(R1·C1) | engineering approximation (1-RC Thevenin) |
| SOC | SOC⁺ = SOC − I·Δt/(3600·Ah); charging stores η_c·I; SOC ∈ [0,1]; delivery truncated when SOC would go < 0 | physical law + η_c from literature range |
| Pack | Vpack = Ns·Vcell, Ah = Np·Ah_cell, Rpack = Ns·Rcell/Np | physical law |
| Battery heat | Cth·dT/dt = I²R0 + V1²/R1 + (1−η_c)·OCV·\|I\| − (T−Tamb)/Rth | engineering approximation |
| Power from battery | I = 2P/(E+√(E²−4RP)); Pmax = E²/(4R) | physical law |
| Rectifier | vrect = max(\|v\|−2Vf, 0); with C: charge near peaks, discharge into load; ripple ≈ I/(2fC) at 2f; Vdc,max ≈ √2·Vrms − 2Vf | physical law + piece-wise diode |
| DC-DC (averaged CCM) | Pin = Pout(1+k_sw) + P_fixed + R_cond·Iin²; η = Pout/Pin (a result); buck D = Vout/(η·Vin); boost D = 1 − η·n·Vin/Vout, D ≤ Dmax | engineering approximation |
| Converter ripple | ΔIL = Vin·D/(L·fsw) (boost); output ripple from CCM formulas | engineering approximation |
| Inverter (averaged sine-PWM) | Vac,pk = m·Vlink, m ≤ 0.95; Pin = Pout + P_loss, Pout ≤ η·Pin; real power only drawn from DC, reactive power circulates | engineering approximation |
| Thermal (all) | Cth·dT/dt = Ploss − (T−Tamb)/Rth, exact step | engineering approximation |
| Loads | resistive / inductive / capacitive / series-RLC (phasor), AC-input supply (bridge + bulk cap + constant-power), DC motor (V = Ra·i + k·ω, J·dω/dt = k·i − b·ω − Tload), DC polarized module (diode-like I–V) | per kind |

### Energy conservation
Every step the engine accumulates: battery chemical energy Σ OCV·I·Δt, terminal energy, R0 / R1 /
side-reaction losses, energy held in C1, converter + inverter losses, energy to the output and load heat.
Identities checked by the tests: chemical = terminal + R0 + R1 + ΔE(C1) (exact, floating-point);
terminal − output − conversion loss ≈ 0; delivered energy ≤ stored energy; empty battery → output stops.
Switching AC/DC, moving the dial or touching cables cannot create energy: only the solved currents change.

### Protection and load damage
* Output current limit (converter) → latched trip after `tripDelayS` held in limit; reset by main power OFF→ON.
* Battery: low-voltage cutoff, empty, over-discharge current, over-temperature (0.5 s dwell) → latched trip.
* Converter thermal shutdown with hysteresis (restart below the restart temperature).
* Loads: normal → warning → overloaded → overheating → protection → damaged (permanent, open circuit),
  decided from the load's own ratings (input type, voltage window, absolute max, frequency, polarity,
  current, power, temperature). Unspecified ratings (`null`) are never invented. Each state carries a reason.

### Parameter provenance
| Parameter | Source class |
|---|---|
| OCV(SOC) curve shapes, cutoff / max-charge voltage per cell, coulombic efficiency, specific energy, heat capacity | **literature-typical** (representative of published ranges; **not** a specific cell datasheet) |
| R0, R1/R0, τ1, SOC/T factors, C-rate limits, max temperature, thermal coupling | **model assumption** (calibrate against a datasheet before quantitative use) |
| Default machine pack (100S2P, 5 Ah NMC cells, ≈ 3.7 kWh) | **model assumption**, sized only so 0–415 V is reachable |
| Converter / inverter loss coefficients, Dmax, f_sw, L, C, current limits, turns ratio | **model assumption** |
| 10 A output limit, 2 s trip delay, 0.05 Ω contact resistance, 50 Hz | **model assumption** (50 Hz is the existing default; other frequencies are supported) |
| Example loads (`resistiveLoad(…)` etc.) | **illustrative fixtures**, not real products |

### Mandatory example: 12 V battery → 415 V DC
With the default single-stage, non-isolated boost the engine reports a truthful **duty-limit**: the output
collapses to ≈ Vin/(1−Dmax)·η (≈ 126 V into 100 W-rated resistor in the browser run) instead of showing 415 V.
With an isolated boost-derived stage (turns ratio, a stated assumption) 415 V / 100 W needs ≈ 8.8 A from the
battery at ≈ 12.5 V (terminal sagging below the 12.7 V OCV), η ≈ 91 %, and the SOC and stored energy fall accordingly.

### Limitations (engine)
* Equivalent-circuit battery, **not** an electrochemical model: no ageing / capacity fade, no Peukert effect,
  no hysteresis, no self-discharge, no CC-CV charger, identical cells with no balancing.
* Converters and inverter are **averaged** models: individual switching events, dead time, harmonics and
  EMI are not resolved. CCM is assumed.
* The rectifier / AC-input supply is cycle-resolved only for the rectifier itself, not the downstream regulator.
* Load thermal limits and failure modes (open circuit after damage) are simplifications; there is no explosion,
  arc-energy or human-shock model. The spark is visual only.
* The main machine is battery-powered; there is no mains input, charging path or regeneration in the UI.
* Typed loads can only be attached through the `window.voltaLab` API; there is no load-picker UI.

---

## Legacy model (`src/electrical.ts`) — superseded in the app, kept as reference

All calculations in the first version lived in `src/electrical.ts`. It is no longer imported by `main.ts`
but remains tested (`src/electrical.test.ts`).

## Source: Thevenin equivalent

```
 Voc ──[ Rs ]──●── terminal A (red, +)
               │
        open, or short through Rc
               │
 ──────────────●── terminal B (black, −)
```

| Parameter | Value | Meaning |
|---|---|---|
| `Voc` | 0–415 V | Set-point. RMS in AC mode, steady volts in DC mode |
| `Rs` (AC) | 2.2 Ω | Source resistance of the AC stage |
| `Rs` (DC) | 0.4 Ω | Source resistance of the battery-equivalent DC source |
| `Rc` | 0.05 Ω | Resistance of the two touching cable tips |
| `Ilimit` | 10 A | Electronic current limit (RMS in AC) |
| `TRIP_DELAY_S` | 2 s | A short held in current limit this long latches a shutdown |
| `f` (AC) | 50 Hz | Default AC frequency |

415 V is the highest common nominal mains value (240/415 V grids; IEC 60038 line-to-line 400 V).
It is a three-phase *phase-to-phase* figure, not a universal household single-phase voltage
(single-phase mains is 220–240 V phase-to-neutral).

## Equations

* AC: `v(t) = √2 · Vrms · sin(2πft + φ)`, `Vpeak = √2 · Vrms`. All AC readouts are RMS.
* DC: `v(t) = Vdc`, fixed polarity (A positive, B negative), frequency 0 Hz (shown as "DC").
* Open circuit: `Vterminal = Voc`, `I = 0`, `P = 0`.
* Short circuit: prospective `I = Voc / (Rs + Rc)`; if it exceeds `Ilimit` the current is limited to
  `Ilimit`. Then `Vterminal = I·Rc`, `P = V·I = I²·Rc` (resistive, PF = 1).
* Energy balance: `Voc·I = P_load + P_internal`, with `P_internal` dissipated in the source/limiter.
* OFF or tripped: output voltage, current, power and frequency are all 0.

## Protection

Any short that stays in current limit for 2 s latches `protected` (shutdown). The latch is only
cleared by cycling MAIN POWER (rocker, panel switch, Space or X then Space). Changing AC/DC does
not clear it. A short that stays below the limit never trips.

## Modes

The front-panel rotary AC / DC selector (click it in 3D, or press `M`) swaps `Rs` and the output
waveform model. Screen-reader users get a live status announcement.

## What the spark is

The spark is a visual effect. Its size grows with the voltage set-point; particle count and
brightness are **not** calibrated measurements of arc energy, temperature or fault current.

## Limitations

* No load component exists, so normal load-current testing (LEDs, motors, capacitors, inductors,
  non-linear loads) is not modelled and is deliberately not approximated.
* The DC source has no state of charge or chemistry; it is a Thevenin battery-equivalent and does
  not track a finite energy budget.
* The AC waveform is exercised in `src/electrical.test.ts`; the UI shows RMS and peak values but
  does not draw a live scope.
* The model values (`Rs`, `Rc`, `Ilimit`, trip delay) are documented assumptions, not measurements.

## Tests

```
npm test        # runs src/**/*.test.ts with Node's built-in runner (Node 22.18+; older 22.x: add --experimental-strip-types)
```
