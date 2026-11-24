// Transformer test bench (DOM only). A transformer card can be picked up (pointer drag from its grip) and dropped on the bench, or placed with a plain
// button (the keyboard and touch way). The bench then shows the construction drawing and a LIVE ideal-transformer calculator: every keystroke recomputes.
// It receives the calculator and the entries from library-ui.ts, so this file imports nothing from the component library, the simulator or three.js.
// It is an arithmetic teaching aid for an ideal transformer, not a circuit simulation, and it is labelled that way.
import { attachGripDrag } from './drag-drop.ts';

export interface BenchEntry { readonly id: string; readonly name: string; readonly symbolHtml: string; readonly shapeHtml: string; readonly purpose: string }
export interface BenchInput { turnsPrimary: number; turnsSecondary: number; primaryVoltage?: number; primaryCurrent?: number }
export type BenchResult =
  | { ok: true; ratio: number; kind: 'step-up' | 'step-down' | 'one-to-one'; secondaryVoltage?: number; secondaryCurrent?: number; apparentPower?: number }
  | { ok: false; error: string };

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const fmt = (n: number): string => n.toLocaleString('en', { maximumSignificantDigits: 4 });
const field = (id: string, label: string, value: string, hint: string): string =>
  `<div class="ll-field"><label for="${id}">${esc(label)}</label><input class="ll-input" id="${id}" type="number" inputmode="decimal" step="any" min="0" value="${value}" aria-describedby="${id}-h"><p class="ll-hint" id="${id}-h">${esc(hint)}</p></div>`;

export function initBench(root: HTMLElement, entries: readonly BenchEntry[], calc: (i: BenchInput) => BenchResult): void {
  const drop = root.querySelector<HTMLElement>('#tbDrop');
  if (!drop) return;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const hint = drop.innerHTML;

  const compute = (): void => {
    const val = (id: string): number | undefined => { const v = (root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '').trim(); return v === '' ? undefined : Number(v); };
    const out = root.querySelector<HTMLElement>('#tbOut');
    if (!out) return;
    const np = val('tb-np'), ns = val('tb-ns');
    const res = calc({ turnsPrimary: np ?? NaN, turnsSecondary: ns ?? NaN, primaryVoltage: val('tb-vp'), primaryCurrent: val('tb-ip') });
    for (const id of ['tb-np', 'tb-ns', 'tb-vp', 'tb-ip']) root.querySelector(`#${id}`)?.removeAttribute('aria-invalid');
    if (!res.ok) {
      out.textContent = res.error;
      const bad = /Primary turns/.test(res.error) ? 'tb-np' : /Secondary turns/.test(res.error) ? 'tb-ns' : /voltage/.test(res.error) ? 'tb-vp' : 'tb-ip';
      root.querySelector(`#${bad}`)?.setAttribute('aria-invalid', 'true');
      return;
    }
    const parts = [`Turns ratio Np : Ns = ${fmt(res.ratio)} : 1 (${res.kind}).`];
    if (res.secondaryVoltage !== undefined) parts.push(`Secondary voltage Vs = ${fmt(res.secondaryVoltage)} V.`);
    if (res.secondaryCurrent !== undefined) parts.push(`Secondary current Is = ${fmt(res.secondaryCurrent)} A.`);
    if (res.apparentPower !== undefined) parts.push(`Apparent power S = ${fmt(res.apparentPower)} VA, the same on both sides because the transformer is ideal.`);
    if (res.secondaryVoltage === undefined) parts.push('Enter the primary voltage to see the secondary voltage.');
    out.textContent = parts.join(' ');
  };

  const clear = (): void => { drop.innerHTML = hint; drop.removeAttribute('data-placed'); };
  const place = (id: string, moveFocus = false): void => {
    const e = byId.get(id);
    if (!e) return;
    drop.dataset.placed = id;
    drop.innerHTML = `<article class="tb-item" aria-labelledby="tbName">
      <div class="tb-item-head"><span class="ll-symbol-wrap">${e.symbolHtml}</span><h4 id="tbName" class="tb-name" tabindex="-1">${esc(e.name)} on the test bench</h4><button type="button" class="secondary-action tb-remove" data-remove>Remove</button></div>
      <figure class="tb-fig">${e.shapeHtml}<figcaption class="ll-hint">Simplified illustration of the construction. Not to scale, not a specific product.</figcaption></figure>
      <p class="ll-explain"><b>Ideal transformer calculator.</b> Starting values are examples only: change them. Voltages and currents are RMS (AC).</p>
      <output id="tbOut" class="tb-out" aria-live="polite"></output>
      <div class="ll-fields">${field('tb-np', 'Primary turns, Np', '1000', 'Number of turns on the primary winding.')}${field('tb-ns', 'Secondary turns, Ns', '100', 'Number of turns on the secondary winding.')}${field('tb-vp', 'Primary voltage, Vp (V)', '230', 'Optional. Leave empty to see only the ratio.')}${field('tb-ip', 'Primary current, Ip (A)', '', 'Optional. Leave empty to skip the current and power.')}</div>
      <p class="ll-explain"><b>Reminder.</b> ${esc(e.purpose)}</p>
      <p class="lib-evidence">Ideal means no winding resistance, no leakage, no core loss and no frequency effect. A real transformer differs. This is arithmetic, not a circuit simulation.</p>
    </article>`;
    compute();
    if (moveFocus) drop.querySelector<HTMLElement>('#tbName')?.focus();
  };

  root.addEventListener('input', (ev) => { if ((ev.target as HTMLElement).closest('.tb-item')) compute(); });
  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const placeBtn = t.closest<HTMLElement>('[data-place]');
    if (placeBtn) { place(placeBtn.dataset.place as string, true); drop.scrollIntoView({ block: 'nearest' }); return; }
    if (t.closest('[data-remove]')) { clear(); (root.querySelector('[data-place]') as HTMLElement | null)?.focus(); }
  });

  // pick and drop with a pointer (mouse, pen or touch) from the grip of a card
  attachGripDrag(root, { grip: '[data-grip]', idKey: 'grip', drop, label: (id) => byId.get(id)?.name, onDrop: (id) => place(id) });
}
