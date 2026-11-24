import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (f: string): string => readFileSync(new URL(f, root), 'utf8');
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the test bench is DOM-only: its only import is the shared drag module (no component library, simulator, machine or three.js)', () => {
  const imports = code(read('src/transformer-bench.ts')).match(/^\s*import\s.*$/gm) ?? [];
  assert.deepEqual(imports.map((l) => l.trim()), ["import { attachGripDrag } from './drag-drop.ts';"]);
});
test('drag-drop.ts imports nothing; a drop on the machine output uses the same connect() path as the Connect button', () => {
  assert.equal(/^\s*import\s/m.test(code(read('src/drag-drop.ts'))), false);
  const t = code(read('src/loadlab-ui.ts'));
  assert.match(t, /onDrop: \(id\) => \{[\s\S]*?connect\(\);/);
  assert.match(read('index.html'), /id="llDrop" class="tb-drop ll-drop" role="region" aria-label="Machine output drop area"/);
  assert.match(t, /class="ll-grip"[^>]*aria-hidden="true"/);
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
