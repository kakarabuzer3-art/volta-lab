import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (f: string): string => readFileSync(new URL(f, root), 'utf8');
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the test bench is DOM-only: it imports nothing (no component library, simulator, machine or three.js)', () => {
  assert.equal(/^\s*import\s/m.test(code(read('src/transformer-bench.ts'))), false);
});
test('pure transformer modules have no DOM and no simulator access', () => {
  for (const f of ['src/components/transformer-calc.ts', 'src/components/transformer-shape.ts']) {
    const t = code(read(f));
    assert.equal(/\b(document|window)\b|from '\.\.\/sim|three/.test(t), false, f);
  }
});
test('every card offers both a keyboard-reachable button and a drag grip, and the bench region is announced', () => {
  const t = read('src/library-ui.ts');
  assert.match(t, /data-place=/); assert.match(t, /data-grip=/);
  assert.match(t, /id="tbDrop" class="tb-drop" role="region" aria-label=/);
});
