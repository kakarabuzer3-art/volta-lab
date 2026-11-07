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
