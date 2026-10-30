# Volta Lab electrical model

> **This is a software simulation.** The app runs in a browser; it cannot generate, measure or
> deliver real electrical energy, and it cannot power an LED or any external device. Every number
> shown is computed from the equivalent circuit below.

All calculations live in `src/electrical.ts` (pure functions, SI units, no DOM/Three.js).
`src/main.ts` only calls `solveCircuit()` once per frame and draws the result, so the machine
display, telemetry, cable status and spark logic always read the same state.

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
npm test        # Node's built-in runner (Node 22.18+; older 22.x: add --experimental-strip-types)
```
