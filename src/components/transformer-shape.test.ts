import test from 'node:test';
import assert from 'node:assert/strict';
import { transformerShapeSvg } from './transformer-shape.ts';

test('each construction kind renders a distinct, safe inline SVG', () => {
  const kinds = ['two-winding', 'autotransformer', 'current-transformer'] as const;
  const out = kinds.map(transformerShapeSvg);
  assert.equal(new Set(out).size, 3);
  for (const s of out) { assert.match(s, /^<svg [^>]*viewBox="0 0 120 96"/); assert.match(s, /aria-label=/); assert.doesNotMatch(s, /<script|on\w+=|href=/i); }
});
