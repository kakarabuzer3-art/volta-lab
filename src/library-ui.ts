// Workbench library content (DOM only): "Management & Control" and "Circuits & Components" (inside the Components section) and the Transformers section. Rendered from the component library's data
// (taxonomy, families, definitions); nothing here is typed by hand twice. It is loaded on demand the first time the Workbench opens and imports no simulator,
// no three.js and no machine code, so the 3D bundle and first paint are unaffected. Every entry states honestly whether it is simulated; transformers are
// catalogue entries only. No inputs, no fake controls.
import { CATEGORIES } from './components/taxonomy.ts';
import { FAMILIES } from './components/data/families.ts';
import { TRANSFORMER_DEFINITIONS } from './components/data/transformers.ts';
import { LEGACY_LOAD_META } from './components/data/legacy-load-meta.ts';
import { createRegistry } from './components/registry.ts';
import { describeEvidence } from './components/provenance.ts';
import type { ComponentDefinition } from './components/types.ts';

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const symbolSvg = (d: ComponentDefinition): string => d.symbol
  ? `<span class="ll-symbol-wrap"><svg class="lib-symbol" viewBox="${esc(d.symbol.viewBox)}" aria-hidden="true" focusable="false"><path d="${esc(d.symbol.markup)}"/></svg><span class="ll-symbol-tag">circuit symbol</span></span>` : '';

const MANAGEMENT_SYMBOL = 'M6 8H58M6 16H58M6 24H58M20 5V11M40 13V19M28 21V27';
const MANAGEMENT_ITEMS: readonly { name: string; text: string; status: string }[] = [
  { name: 'Machine source controls', text: 'Power, AC/DC mode, voltage setpoint and protection for the simulated machine.', status: 'Available now, in the Control Room on the machine screen' },
  { name: 'Load connection', text: 'Connect or disconnect one of the five load models from the Properties area of this Workbench.', status: 'Available now, in this Workbench' },
  { name: 'Voltage classes and ranges', text: 'Browse and manage equipment by voltage level, from zero upward.', status: 'Planned, not available yet' },
  { name: 'Transformer ratio and sizing', text: 'Work out ratios, voltages and currents for a chosen transformer.', status: 'Planned, not available yet' },
];

function managementSection(): string {
  return `<details class="lib-section" open>
    <summary><svg class="lib-symbol lib-symbol-lg" viewBox="0 0 64 32" aria-hidden="true" focusable="false"><path d="${MANAGEMENT_SYMBOL}"/></svg><span class="lib-section-name">Management &amp; Control</span></summary>
    <p class="wb-note">Where voltages, ratios and loads will be managed. Only the items marked available work today.</p>
    <ul class="lib-list">${MANAGEMENT_ITEMS.map((m) => `<li><b>${esc(m.name)}</b><span>${esc(m.text)}</span><span class="lib-status ${m.status.startsWith('Available') ? 'is-on' : ''}">${esc(m.status)}</span></li>`).join('')}</ul>
  </details>`;
}

function componentsSection(transformers: readonly ComponentDefinition[]): string {
  const items = [
    ...LEGACY_LOAD_META.map((m) => ({ categoryId: m.categoryId, familyId: m.familyId, name: m.name, status: 'Simulated (Load Lab model)', on: true })),
    ...transformers.map((d) => ({ categoryId: d.categoryId, familyId: d.familyId, name: d.name, status: 'Catalogue entry only, not simulated', on: false })),
  ];
  const cats = CATEGORIES.map((c) => {
    const fams = FAMILIES.filter((f) => f.categoryId === c.id);
    const body = fams.length === 0
      ? '<p class="lib-empty">Nothing in this category yet.</p>'
      : fams.map((f) => {
        const own = items.filter((i) => i.familyId === f.id);
        return `<div class="lib-family"><b>${esc(f.name)}</b><ul>${own.map((i) => `<li>${esc(i.name)} <span class="lib-status ${i.on ? 'is-on' : ''}">${esc(i.status)}</span></li>`).join('')}</ul></div>`;
      }).join('');
    const n = items.filter((i) => i.categoryId === c.id).length;
    return `<details class="lib-cat"><summary><span class="lib-cat-name">${esc(c.name)}</span><span class="lib-count">${n === 0 ? 'empty' : `${n} entr${n === 1 ? 'y' : 'ies'}`}</span></summary><p class="lib-cat-sum">${esc(c.summary)}</p>${body}</details>`;
  }).join('');
  return `<details class="lib-section" open>
    <summary><svg class="lib-symbol lib-symbol-lg" viewBox="0 0 64 32" aria-hidden="true" focusable="false"><path d="M4 16H16L20 6L28 26L34 6L40 26L44 16H60"/></svg><span class="lib-section-name">Circuits &amp; Components</span></summary>
    <p class="wb-note">The shelves of the component library. Most are empty on purpose: entries are added only with real, honest content. Only the five load models below this list can be simulated today.</p>
    ${cats}
  </details>`;
}

function transformerCard(d: ComponentDefinition): string {
  const limits = d.simulation.limitations;
  return `<details class="lib-item" data-def="${esc(d.id)}">
    <summary><span class="lib-item-top">${symbolSvg(d)}<span class="lib-item-name">${esc(d.name)}</span></span><span class="lib-status">Catalogue entry only, not simulated</span></summary>
    <div class="lib-item-body">
      <p class="ll-explain"><b>What it is.</b> ${esc(d.beginnerSummary)}</p>
      <p class="ll-explain"><b>What it does in a circuit.</b> ${esc(d.electricalPurpose)}</p>
      <h5 class="lib-sub">Terminals</h5>
      <ul class="lib-terms">${d.terminals.map((t) => `<li>${esc(t.name)} <span class="lib-role">${esc(t.role)}</span></li>`).join('')}</ul>
      <h5 class="lib-sub">Relations (ideal transformer)</h5>
      <ul class="lib-terms">${(d.formulas ?? []).map((f) => `<li><code>${esc(f.expression)}</code> <span class="lib-role">${esc(f.label)}</span></li>`).join('')}</ul>
      <h5 class="lib-sub">Specifications a real product would state</h5>
      <p class="ll-explain">${d.specifications.map((s) => esc(s.label)).join(', ')}. <i>No values are given here: this is a kind of part, not a specific product.</i></p>
      <p class="lib-evidence">${esc(describeEvidence(d.evidence))}. ${esc(limits.join(' '))}</p>
    </div>
  </details>`;
}

function transformersSection(transformers: readonly ComponentDefinition[]): string {
  return `<div class="lib-pane-head">
    <svg class="lib-symbol lib-symbol-lg" viewBox="0 0 64 32" aria-hidden="true" focusable="false"><path d="M22 4a4 4 0 0 1 0 8a4 4 0 0 1 0 8a4 4 0 0 1 0 8M42 4a4 4 0 0 0 0 8a4 4 0 0 0 0 8a4 4 0 0 0 0 8M30 2V30M34 2V30M22 4H8M22 28H8M42 4H56M42 28H56"/></svg>
    <h3 class="wb-pane-title">Transformers</h3>
  </div>
  <p class="wb-note">Five kinds of transformer, explained. These are reference entries: they cannot be connected or simulated yet. Voltage classes (low, medium, high, extra-high) have no numeric limits here because the boundaries differ between standards.</p>
  <div class="lib-items">${transformers.map(transformerCard).join('')}</div>`;
}

export function initLibrarySections(): void {
  const host = document.getElementById('libSections'), tHost = document.getElementById('libTransformers');
  if (!host || !tHost) return;
  try {
    const registry = createRegistry({ categories: CATEGORIES, families: FAMILIES, definitions: TRANSFORMER_DEFINITIONS, parts: [] }, { adapterIds: [] });
    const transformers = registry.definitionsInFamily('fam.transformers');
    host.innerHTML = managementSection() + componentsSection(transformers);
    tHost.innerHTML = transformersSection(transformers);
  } catch (error) {
    console.error('Volta Lab: the component library data is invalid', error);
    const msg = '<p class="wb-empty" role="alert">The component library could not be shown. The load models still work.</p>';
    host.innerHTML = msg; tHost.innerHTML = msg;
  }
}

initLibrarySections();
