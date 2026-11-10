// Human-readable description of the output stage, derived ONLY from the engine snapshot (never from the UI's own on/off flag),
// so the UI cannot claim "running" while the engine delivers nothing.
import type { Snapshot } from './engine.ts';

export function outputStageDescription(s: Snapshot): string {
  switch (s.status) {
    case 'off': return 'Output stage is disabled';
    case 'battery-empty': return 'Battery is empty: output stage disabled';
    case 'tripped': return s.protection.trip === null && s.protection.converterShutdown
      ? 'Converter thermal shutdown: output stage disabled'
      : 'Protective shutdown: output stage disabled';
    case 'limited': return 'Output stage is running (at current limit)';
    case 'running': return 'Output stage is running';
  }
}

// ---------------------------------------------------------------------------------------------------------
// Machine LCD presentation. ONE pure function of the engine snapshot decides whether the screen is lit and what it
// shows, so the display can never disagree with Main Power:
//   * Main Power OFF  -> screen unlit.
//   * Main Power ON   -> screen ALWAYS lit, whatever the output stage is doing (running, current limit, protective trip,
//                        empty battery, thermal shutdown). A fault is shown as a fault message, never as a blank screen.
//   * AC/DC selection -> only changes the mode label and values; it never changes `lit`.
// ---------------------------------------------------------------------------------------------------------
export type DisplayState = 'off' | 'open' | 'short' | 'load' | 'protected' | 'empty';
export type DisplayTone = 'off' | 'ok' | 'caution' | 'fault';
export interface DisplayPresentation {
  state: DisplayState;
  /** True exactly when Main Power is ON (the snapshot's own input echo). */
  lit: boolean;
  mode: 'AC' | 'DC';
  tone: DisplayTone;
  /** Short chip text in the LCD header. */
  chip: string;
  /** Two short lines shown on the LCD in a fault state (null otherwise). */
  faultLines: [string, string] | null;
}

export function displayState(s: Snapshot): DisplayState {
  if (s.status === 'tripped') return 'protected';
  if (s.status === 'battery-empty') return 'empty';
  if (s.status === 'off') return 'off';
  return s.inputs.connection === 'short' ? 'short' : s.inputs.connection === 'load' ? 'load' : 'open';
}

export function displayPresentation(s: Snapshot): DisplayPresentation {
  const state = displayState(s);
  const mode = s.output.kind === 'ac' ? 'AC' : 'DC';
  const lit = s.inputs.powerOn;
  switch (state) {
    case 'off': return { state, lit, mode, tone: 'off', chip: 'OFF', faultLines: null };
    case 'protected': {
      const thermal = s.protection.trip === null && s.protection.converterShutdown;
      const lines: [string, string] = thermal
        ? ['THERMAL SHUTDOWN', 'RESTARTS WHEN COOL']
        : s.protection.trip === 'overcurrent' ? ['OVERCURRENT TRIP', 'POWER OFF, THEN ON']
        : s.protection.trip === 'battery-low-voltage' ? ['BATTERY LOW VOLTAGE', 'POWER OFF, THEN ON']
        : s.protection.trip === 'battery-over-temperature' ? ['BATTERY OVER-TEMP', 'POWER OFF, THEN ON']
        : s.protection.trip === 'battery-over-current' ? ['BATTERY OVERCURRENT', 'POWER OFF, THEN ON']
        : ['PROTECTIVE TRIP', 'POWER OFF, THEN ON'];
      return { state, lit, mode, tone: 'fault', chip: 'TRIP', faultLines: lines };
    }
    case 'empty': return { state, lit, mode, tone: 'caution', chip: 'EMPTY', faultLines: ['BATTERY EMPTY', 'OUTPUT DISABLED'] };
    case 'short': return { state, lit, mode, tone: 'caution', chip: 'SHORT', faultLines: null };
    case 'load': return { state, lit, mode, tone: 'ok', chip: 'LOAD', faultLines: null };
    case 'open': return { state, lit, mode, tone: 'ok', chip: 'RUN', faultLines: null };
  }
}
