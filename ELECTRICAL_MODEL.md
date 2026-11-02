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

### Parameter provenance (what each kind of number really is)
Classes: **Law** = established physical law · **Lit** = literature-typical value (representative range, not one product) ·
**Approx** = engineering approximation · **Assumed** = model assumption chosen by the author · **Datasheet** = manufacturer value ·
**Measured** = actually measured and calibrated. *No parameter in this project is currently Datasheet or Measured.*

| Parameter | Class |
|---|---|
| Vpk = √2·Vrms, Z, XL, XC, P = V·I·cosφ, Coulomb counting, series/parallel rules, Cth·dT/dt = P − ΔT/Rth | Law |
| 1-RC (Thevenin) battery structure, averaged converter / inverter models, CCM duty formulas, piece-wise diode | Approx |
| OCV(SOC) curve shapes, cutoff and max-charge volts per cell, coulombic efficiency, specific energy, heat capacity | Lit |
| R0, R1/R0, τ1, SOC and temperature factors on R0, C-rate limits, max temperature, pack thermal coupling | Assumed |
| Default machine pack (100S2P, 5 Ah NMC cells) | Assumed (illustrative; not a commercial product) |
| Converter / inverter loss coefficients, Dmax = 0.9, f_sw, L, C, 10 A limit, 105 °C shutdown / 85 °C restart, turns ratio | Assumed |
| 10 A output limit, 2 s trip delay, 0.05 Ω contact resistance | Assumed |
| 50 Hz output frequency | Assumed default (other frequencies are supported by the equations) |
| Example loads `resistiveLoad(…)`, `acInputSupplyLoad(…)` … and their ratings / thermal values | Assumed (illustrative fixtures; **not real products**) |

### The two battery configurations — do not confuse them
| | **Default machine battery** | **12 V engineering test profile** |
|---|---|---|
| Where | `defaultConfig()` — what the app runs | only inside tests / the optional browser check |
| Cells | NMC lithium-ion, **100 in series × 2 parallel**, 5 Ah per cell | lead-acid, **6 in series × 2 parallel**, 7 Ah per cell |
| Pack | 10 Ah, ≈ 372.6 V nominal, ≈ 3.73 kWh nominal (calculated from the model), full-charge OCV 415 V | 14 Ah, ≈ 12.6 V at 90 % SOC |
| Initial SOC | 90 % (≈ 3.32 kWh remaining, OCV ≈ 405 V) | 90 % |
| Converter | single-stage non-isolated buck/boost (turns ratio 1) | isolated boost-derived stage with an **assumed** turns ratio of 4 (not a hardware specification) |
| Purpose | reach the machine's 0–415 V range | show what a 12 V source must do to give 415 V |

The 12 V profile is **not** the machine battery. With it, 415 V / 100 W (R = 1722.25 Ω) gives (from the engine, 20 ms steps):
Iout = 0.241 A, Iin = 8.99 A, battery terminal 12.25 V (OCV 12.60 V → 0.35 V sag), duty D = 0.886, η = 90.9 %, converter loss 10.0 W,
and after 600 s the SOC falls 90.0 % → 79.1 % (remaining 153.3 → 134.1 Wh; 16.67 Wh went to the load, the rest to losses).
With turns ratio 1 (single-stage boost) the same request is a truthful **duty-limit**: the output collapses instead of showing 415 V.

### What “415 V AC” means here
The machine has two output conductors (Lead A red, Lead B black), so AC is **single-phase, two-wire**. The set-point is the **RMS voltage
between the two leads**; at 415 V the peak is √2 × 415 = 586.9 V and the default frequency is 50 Hz. It is **not** a three-phase
line-to-line voltage and not a statement about household supply (IEC 60038 lists e.g. 230 V and 230/400 V). The 0–415 V range is kept as built.

### Architecture (what the AC/DC selector does and does not do)
* DC mode: battery → DC-DC stage → DC output. AC mode: battery → DC-DC stage → DC link → H-bridge inverter → AC output.
* The selector chooses the **output architecture**. It is not itself a rectifier and does not convert anything; the DC-DC stage and
  inverter (with their losses) do. Switching mode re-solves the circuit and clears mode-specific timers; no state is carried over.
* The bridge **rectifier** model lives inside the **AC-input-supply load** (a device that rectifies the AC it receives). There is no
  separate rectifier stage in the machine.

### Converter thermal shutdown boundary
The converter is enabled for a whole 20 ms step or not at all. Within a step the battery, converter and load run in the state at the **start**
of the step, and that interval’s energy is real and booked. Temperature is advanced at the **end** of the step; if it reaches the shutdown
temperature, the snapshot of that same step is already the **disabled** state (0 V, 0 A, 0 W, no battery current, message “thermal shutdown”)
and no further battery energy is consumed. The converter cools exponentially, restarts only when T ≤ restart temperature (hysteresis),
and the restart snapshot is already energised. Tests: `src/sim/thermal-shutdown.test.ts`.
(Before this fix the snapshot of the shutdown step still showed the old energised readings for one step.)

### Input validation
Every public entry point (battery pack, chemistry, converter, inverter, rectifier, loads, engine config, `setInputs`, `attachLoad`) rejects invalid
numbers with a `RangeError` naming the parameter: NaN / ±Infinity, efficiencies outside 0 < η ≤ 1, duty limit outside 0 < Dmax < 1, non-positive
R/L/C/thermal values, non-integer cell counts, SOC outside 0–1, inverted rating intervals, restart temperature not above ambient / below shutdown.
`null` means “unspecified” in load ratings and is accepted. Finite set-points outside 0–415 V are clamped; NaN is rejected (it is never turned into 0 V).
Tests: `src/sim/validation.test.ts`.

### Energy ledger: sign conventions and tolerances
Discharge is positive. Per step (exact, floating-point): `chemical = terminal + R0 loss + R1 loss + ΔE(C1)`; and
`terminal = output + converter/inverter loss`. Residual tolerances in the tests: battery identity 1e-9 Wh; terminal identity 1e-6 relative.
Output energy is also compared with independent analytic values (V²/R·t, V²R/(R²+X²)·t, a 10 A limit into 5 Ω = 500 W …). Reactive power (Q) is not energy
consumed, so only real power enters the ledger. The rectifier’s backward-Euler step dissipates a small amount numerically; it is measured
separately (< 1 % of input) and shrinks with the step. The averaged converter has **no** inductor / output-capacitor energy state: that
neglected storage is at most ≈ 41 J + 0.011 J (≈ 0.011 Wh), once, when the set-point changes (quantified in `ledger.test.ts`).
When the battery runs out inside a step, only the charge that was left is delivered (output and ledger are scaled by the active fraction).

### Beginner glossary
* **RMS voltage** — the steady DC-equivalent heating value of AC. **Peak** is the top of the wave (√2 × RMS).
* **Current (A)** — flow of charge; **power (W)** = V × I (AC real power also × power factor).
* **SOC** — how full the battery is (0–100 %); **remaining energy (Wh)** — stored energy still available.
* **Efficiency / conversion loss** — a converter gives out less than it takes in; the difference is heat.
* **Thermal shutdown** — the converter switches off when its temperature reaches its limit and restarts after cooling.
* **Simulated device damage** — a modelled consequence of exceeding a *rating* of the attached load; the HUD note says which one.
* **Model assumption vs hardware data** — see the provenance table; none of the numbers are measured hardware data.

### What is *not* real
The browser cannot produce electricity or power a real device. There is no hardware measurement, no charging path and no physical output;
all values come from the equations above.

### Limitations (engine)
* Equivalent-circuit battery, **not** an electrochemical model: no ageing / capacity fade, no Peukert effect,
  no hysteresis, no self-discharge, no CC-CV charger, identical cells with no balancing.
* Converters and inverter are **averaged** models: individual switching events, dead time, harmonics and
  EMI are not resolved. CCM is assumed.
* The AC-input supply load is cycle-resolved only in its rectifier / bulk capacitor; the regulator behind it is a constant-power block.
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
