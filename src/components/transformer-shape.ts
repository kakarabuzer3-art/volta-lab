// Simplified pseudo-3D illustrations of transformer construction, as inline SVG strings (no three.js, no DOM). They show the idea (iron core, windings)
// and are NOT drawings of a real product and NOT to scale. Shapes use currentColor so the page theme controls colour.
export type TransformerShapeKind = 'two-winding' | 'autotransformer' | 'current-transformer';

const CORE = `<g class="ts-core">
  <path d="M20 20L34 10H114L100 20Z"/><path d="M100 20L114 10V60L100 70Z"/>
  <path fill-rule="evenodd" d="M20 20H100V70H20ZM42 32V58H78V32Z"/></g>`;
const coil = (x: number, y1: number, y2: number, w: number): string => {
  let lines = '';
  for (let y = y1; y <= y2; y += 4) lines += `M${x} ${y}H${x + w}`;
  return `<g class="ts-coil"><rect x="${x}" y="${y1 - 2}" width="${w}" height="${y2 - y1 + 4}" rx="2"/><path d="${lines}"/></g>`;
};

export function transformerShapeSvg(kind: TransformerShapeKind): string {
  let body: string;
  if (kind === 'two-winding') body = `${CORE}${coil(22, 34, 56, 18)}${coil(80, 34, 56, 18)}`;
  else if (kind === 'autotransformer') body = `${CORE}${coil(22, 30, 60, 18)}<path class="ts-tap" d="M22 45H8M40 45H46"/>`;
  else body = `<g class="ts-core"><ellipse cx="60" cy="52" rx="38" ry="20"/><ellipse cx="60" cy="52" rx="18" ry="8"/></g>
    <g class="ts-coil"><path d="M26 44q4 14 12 16M34 38q4 16 14 20M82 58q8-4 12-16M72 60q10-6 14-20"/></g>
    <path class="ts-tap" d="M60 6V92"/>`;
  return `<svg class="ts-shape" viewBox="0 0 120 96" role="img" aria-label="Simplified illustration of the construction" focusable="false">${body}</svg>`;
}
