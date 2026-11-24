// Load Lab V1 — the DOM half, mounted inside the Component Workbench (library | work area | properties). Collects text, converts units and validates through ./sim/loadlab.ts, asks the coordinator to connect the
// load, and shows results copied from the engine snapshot. It contains no electrical equations and no three.js.
import { LOAD_CATALOGUE, buildLoad, describeLoadResults, loadTypeSpec, rangeHint } from './sim/index.ts';
import { attachGripDrag } from './drag-drop.ts';
import type { ConnectionCoordinator, FieldSpec, LoadTypeId, LoadTypeSpec, RawForm, Snapshot } from './sim/index.ts';

export interface LoadLabDeps {
  coordinator: ConnectionCoordinator;
  leadsTouching: () => boolean;
  announce: (message: string) => void;
  /** Ask the render loop to re-send the connection to the engine on its next frame. */
  forceSync: () => void;
}
export interface LoadLabUi { refresh: (snap: Snapshot, elapsedS: number) => void }

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const SVG = (inner: string): string => `<svg class="ll-symbol" viewBox="0 0 64 24" aria-hidden="true" focusable="false">${inner}</svg>`;
/** A circuit symbol is schematic notation, not a picture of the part: it is always captioned as such. */
const SYMBOL = (inner: string): string => `<span class="ll-symbol-wrap">${SVG(inner)}<span class="ll-symbol-tag">circuit symbol</span></span>`;
const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const SOURCE_TEXT: Record<string, string> = {
  'user-specified': 'User-specified model input',
  'illustrative-fixture': 'Illustrative example (educational, not a real product)',
};

export function initLoadLab(deps: LoadLabDeps): LoadLabUi {
  const { coordinator } = deps;
  const library = $('llLibrary'), formHost = $('llForm'), connectHost = $('llConnect'), resultsHost = $('llResults'), pill = $('llStatusPill');
  const workHost = $('llWork'), liveHost = $('llLive'), statusHost = $('llStatus'), dialog = $('workbench');
  /** null until the learner chooses a model: the work area and properties then show a clean empty state. */
  let selected: LoadTypeId | null = null;
  let usingPreset = true;
  let touched = new Set<string>();
  const values: Record<string, { value: string; unitIndex: number }> = {};
  let message = '';
  let lastResultsHtml = '', lastConnectHtml = '', lastStatusHtml = '', lastPill = '', lastRefresh = -1, wasVisible = false;

  const spec = (): LoadTypeSpec => loadTypeSpec(selected as LoadTypeId);
  const allFields = (): FieldSpec[] => (selected ? [...spec().params] : []);

  function fillPreset(): void {
    for (const k of Object.keys(values)) delete values[k];
    for (const f of allFields()) values[f.key] = { value: spec().preset[f.key] ?? '', unitIndex: 0 };
    usingPreset = true; touched = new Set();
  }
  const form = (): RawForm => values;

  // ---------------------------------------------------------------- Stage A: library
  function renderLibrary(): void {
    library.innerHTML = LOAD_CATALOGUE.map((l, i) => {
      const on = l.id === selected;
      const first = selected === null && i === 0; // nothing chosen yet: the first card is the single tab stop
      return `<button type="button" role="radio" class="ll-card" aria-checked="${on}" tabindex="${on || first ? 0 : -1}" data-load="${l.id}" data-index="${i}">
        <span class="ll-card-top"><span class="ll-grip" data-grip="${l.id}" aria-hidden="true" title="Drag to the machine output">⠿</span>${SYMBOL(l.symbol)}<span class="ll-card-name">${esc(l.name)}</span>${on ? '<span class="ll-selected-tag">Selected</span>' : ''}</span>
        <span class="ll-card-sum">${esc(l.summary)}</span>
        <span class="ll-card-meta"><b>Input</b> ${esc(l.inputSupport)} · <b>Values</b> ${l.params.filter((p) => !p.optional).map((p) => esc(p.symbol)).join(', ')}</span>
        <span class="ll-card-limit"><b>Limit</b> ${esc(l.limitation)}</span>
      </button>`;
    }).join('');
  }
  library.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-load]');
    if (!btn) return;
    // Choosing the model that is already selected must never wipe the values the learner has typed.
    if (btn.dataset.load !== selected) selectLoad(btn.dataset.load as LoadTypeId, false);
    document.dispatchEvent(new CustomEvent('workbench:model-chosen')); // click / Enter / Space only: narrow screens move on to Properties
  });
  library.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
    e.preventDefault(); e.stopPropagation();
    const n = LOAD_CATALOGUE.length;
    const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-load]')?.dataset.load; // move from the focused card, not only the selected one
    const i = LOAD_CATALOGUE.findIndex((l) => l.id === (focusedId ?? selected ?? LOAD_CATALOGUE[0].id));
    const next = k === 'Home' ? 0 : k === 'End' ? n - 1 : (i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : n - 1)) % n;
    selectLoad(LOAD_CATALOGUE[next].id, true);
  });
  function selectLoad(id: LoadTypeId, focus: boolean): void {
    selected = id; message = ''; fillPreset(); renderLibrary(); renderForm(); renderWork(); paintLive();
    if (focus) library.querySelector<HTMLButtonElement>(`[data-load="${id}"]`)?.focus();
    deps.announce(`${spec().name} selected. Example values loaded.`);
    lastConnectHtml = '';
  }

  // ---------------------------------------------------------------- work area: what the selected model is
  function renderWork(): void {
    if (!selected) { workHost.innerHTML = '<p class="wb-empty">No model selected. Choose one from Available Load Models to see what it is, what it does in a circuit and whether it works on AC or DC.</p>'; return; }
    const s = spec();
    workHost.innerHTML = `<div class="ll-work-head">${SYMBOL(s.symbol)}<h4 class="ll-work-name">${esc(s.name)}</h4></div>
      <p class="ll-explain">${esc(s.summary)}</p>
      <dl class="ll-behaviour">
        <div><dt>In a circuit</dt><dd>${esc(s.role)}</dd></div>
        <div><dt>Works on</dt><dd><b>${esc(s.inputSupport)}</b></dd></div>
        <div><dt>In AC</dt><dd>${esc(s.acBehaviour)}</dd></div>
        <div><dt>In DC</dt><dd>${esc(s.dcBehaviour)}</dd></div>
        <div><dt>Not modelled</dt><dd>${esc(s.limitation)}</dd></div>
      </dl>
      <p class="ll-caption">The drawing is a circuit symbol (schematic notation), not a picture of the physical part.</p>`;
  }
  /** The connection status and live results are the engine's truth, so they show whenever a model is chosen or a load is connected. */
  function paintLive(): void { liveHost.hidden = !(selected || coordinator.loadConnected); }

  // ---------------------------------------------------------------- Stage B: configure
  function fieldHtml(f: FieldSpec): string {
    const v = values[f.key] ?? { value: '', unitIndex: 0 };
    const id = `ll-${f.key}`;
    return `<div class="ll-field" data-field="${f.key}">
      <label for="${id}">${esc(f.label)} <span class="ll-sym">(${esc(f.symbol)})</span></label>
      <div class="ll-input-row">
        <input id="${id}" class="ll-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(v.value)}" aria-describedby="${id}-help ${id}-err" ${f.optional ? 'placeholder="not set"' : ''} />
        <select id="${id}-unit" class="ll-unit" aria-label="${esc(f.label)} unit"${f.units.length < 2 ? ' disabled' : ''}>${f.units.map((u, k) => `<option value="${k}"${k === v.unitIndex ? ' selected' : ''}>${esc(u.label)}</option>`).join('')}</select>
      </div>
      <small id="${id}-help" class="ll-help">Measured in ${esc(f.term)}. ${esc(f.help)} Allowed: ${esc(rangeHint(f))}.</small>
      <small id="${id}-err" class="ll-err" role="alert"></small>
    </div>`;
  }
  function renderForm(): void {
    if (!selected) { formHost.innerHTML = '<p class="wb-empty">Nothing selected. Choose a load model to set its values.</p>'; return; }
    const s = spec();
    const main = s.params.filter((p) => !p.optional), opt = s.params.filter((p) => p.optional);
    formHost.innerHTML = `
      <h4 class="ll-sub">${esc(s.name)}: values</h4>
      <div class="ll-fields">${main.map(fieldHtml).join('')}</div>
      <details class="ll-optional"><summary>Optional ratings (leave blank if unknown; not manufacturer data)</summary>${opt.map(fieldHtml).join('')}</details>
      <div class="ll-provenance" id="llProvenance"></div>
      <div class="ll-form-actions"><button type="button" class="secondary-action" id="llPreset">Use example values</button></div>`;
    paintProvenance();
    for (const f of allFields()) paintFieldError(f, false);
  }
  function paintProvenance(): void {
    const el = document.getElementById('llProvenance');
    if (el) el.textContent = usingPreset ? 'Values: ILLUSTRATIVE educational example. Not a real product and not a manufacturer rating; change any value to enter your own.' : 'Values: user-specified model inputs. Nothing here is a manufacturer rating.';
  }
  function paintFieldError(f: FieldSpec, show: boolean): void {
    const row = formHost.querySelector<HTMLElement>(`[data-field="${f.key}"]`); if (!row) return;
    const input = row.querySelector<HTMLInputElement>('input')!, err = row.querySelector<HTMLElement>('.ll-err')!;
    const r = buildLoad(selected as LoadTypeId, fullFormFor(f), 'user-specified');
    const text = !r.ok ? (r.errors[f.key] ?? '') : '';
    err.textContent = show ? text : ''; input.setAttribute('aria-invalid', String(show && text !== ''));
  }
  /** Validate with every other field set to its preset so that only THIS field's error is reported. */
  function fullFormFor(f: FieldSpec): RawForm {
    const base: Record<string, { value: string; unitIndex: number }> = {};
    for (const g of allFields()) base[g.key] = g.key === f.key ? (values[g.key] ?? { value: '', unitIndex: 0 }) : { value: spec().preset[g.key] ?? '', unitIndex: 0 };
    return base;
  }
  formHost.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement; const row = t.closest<HTMLElement>('[data-field]'); if (!row || !t.classList.contains('ll-input')) return;
    const key = row.dataset.field as string; values[key] = { value: t.value, unitIndex: values[key]?.unitIndex ?? 0 };
    usingPreset = false; touched.add(key); paintProvenance();
    paintFieldError(allFields().find((f) => f.key === key) as FieldSpec, true);
  });
  formHost.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement; const row = t.closest<HTMLElement>('[data-field]'); if (!row || !t.classList.contains('ll-unit')) return;
    const key = row.dataset.field as string; values[key] = { value: values[key]?.value ?? '', unitIndex: Number(t.value) };
    usingPreset = false; touched.add(key); paintProvenance();
    paintFieldError(allFields().find((f) => f.key === key) as FieldSpec, true);
  });
  formHost.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'llPreset') { fillPreset(); renderForm(); deps.announce('Example values restored.'); }
  });

  // ---------------------------------------------------------------- Stage C: connect
  function connect(): void {
    if (!selected) { message = 'Choose a load model in Available Load Models first.'; deps.announce(message); lastConnectHtml = ''; return; }
    const result = buildLoad(selected, form(), usingPreset ? 'illustrative-fixture' : 'user-specified');
    if (!result.ok) {
      for (const f of allFields()) paintFieldError(f, true);
      const first = allFields().find((f) => result.errors[f.key]);
      message = first ? `Cannot connect: ${result.errors[first.key]}` : `Cannot connect: ${result.errors._form ?? 'invalid values.'}`;
      deps.announce(message);
      if (first) formHost.querySelector<HTMLInputElement>(`[data-field="${first.key}"] input`)?.focus();
      lastConnectHtml = ''; return;
    }
    const replacing = coordinator.loadConnected;
    const r = coordinator.connectLoad(result.load, deps.leadsTouching());
    if (!r.ok) { message = r.reason; deps.announce(message); lastConnectHtml = ''; return; }
    deps.forceSync();
    message = replacing ? `Replaced the previous load with: ${result.load.label}.` : `Connected: ${result.load.label}.`;
    deps.announce(message); lastConnectHtml = '';
  }
  function disconnect(): void {
    coordinator.disconnectLoad(); deps.forceSync();
    message = 'Load disconnected. The output is an open circuit again.'; deps.announce(message); lastConnectHtml = '';
  }
  connectHost.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest('button')?.id;
    if (id === 'llConnectBtn') connect(); else if (id === 'llDisconnectBtn') disconnect();
  });
  function connectState(snap: Snapshot): { pill: string; status: string; html: string } {
    const touching = deps.leadsTouching();
    const l = coordinator.connectedLoad;
    const state = l ? `LOAD CONNECTED` : touching ? 'SHORT-CIRCUIT TEST' : 'NO LOAD (OPEN CIRCUIT)';
    const line = l ? `<b>Connected:</b> ${esc(l.label)} <span class="ll-tag">${esc(SOURCE_TEXT[l.dataSource] ?? l.dataSource)}</span>`
      : touching ? 'The two lead tips are touching: that is a <b>short-circuit fault test</b>, not a load. Separate the leads to connect a load.'
      : 'Nothing is connected across the leads. Output current is 0 A.';
    const conflict = l && touching ? '<p class="ll-warn" role="alert">The lead tips are touching while a load is connected. The load stays connected; this is not treated as a short.</p>' : '';
    const kind = snap.inputs.connection;
    const sel = selected ? `<p class="ll-state-sel">Selected model: <b>${esc(spec().name)}</b> (${esc(spec().inputSupport)}). Input now: <b>${snap.output.kind === 'ac' ? 'AC' : 'DC'}</b>.</p>` : '';
    return {
      pill: state,
      status: `<p class="ll-state" data-kind="${kind}"><span class="ll-state-name">${state}</span><br>${line}</p>${conflict}${sel}`,
      html: `<div class="ll-connect-actions"><button type="button" id="llConnectBtn" class="primary-action"${selected ? '' : ' disabled'}>${l ? 'Replace connected load' : 'Connect load'}</button><button type="button" id="llDisconnectBtn" class="secondary-action"${l ? '' : ' disabled'}>Disconnect load</button></div>
        <p class="ll-msg" id="llMsg" role="status">${esc(message)}</p>`,
    };
  }

  // ---------------------------------------------------------------- Stage D: results (snapshot only)
  const f2 = (x: number, d = 2): string => (Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(d));
  function resultsHtml(snap: Snapshot): string {
    const r = describeLoadResults(snap);
    if (!r) return '<p class="ll-empty">No load connected. Choose a model, set its values under Properties and press Connect load to see how the model responds. Values come from the simulation engine; nothing is estimated here.</p>';
    const na = '<span class="ll-na">not defined</span>';
    const row = (k: string, v: string): string => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const reasons = r.reasons.length ? `<ul class="ll-reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    return `<p class="ll-status" data-health="${esc(r.health)}">${esc(r.status)}</p>
      <dl class="ll-results">
        ${row('Load', esc(r.label))}
        ${row('Data source', esc(SOURCE_TEXT[r.dataSource] ?? r.dataSource))}
        ${row('Input mode', r.inputMode)}
        ${row('Terminal voltage (V)', `${f2(r.terminalVoltage.value, 1)} ${r.terminalVoltage.unit}`)}
        ${row('Load current (I)', `${f2(r.current.value)} ${r.current.unit}`)}
        ${row('Real power (P)', `${f2(r.realPowerW, 1)} W`)}
        ${row('Apparent power (S)', r.apparentVA === null ? na : `${f2(r.apparentVA, 1)} VA`)}
        ${row('Reactive power (Q)', r.reactiveVAr === null ? na : `${f2(r.reactiveVAr, 1)} var`)}
        ${row('Power factor (PF)', r.powerFactor === null ? na : r.powerFactor.toFixed(3))}
        ${row('Load temperature', `${r.tempC.toFixed(1)} °C`)}
        ${row('Load health', esc(r.health))}
      </dl>${reasons}`;
  }

  // ---------------------------------------------------------------- refresh (called from the render loop, throttled)
  function refresh(snap: Snapshot, t: number): void {
    const visible = !dialog.hidden;
    const cs = connectState(snap);
    if (cs.pill !== lastPill) { lastPill = cs.pill; pill.innerHTML = `<i></i> ${esc(cs.pill)}`; pill.classList.toggle('connected', coordinator.loadConnected); }
    if (!visible) { wasVisible = false; return; }
    if (!wasVisible) { wasVisible = true; lastRefresh = -1; } // just reopened: repaint at once from the current snapshot
    if (t - lastRefresh < 0.2) return;
    lastRefresh = t;
    paintLive();
    if (cs.status !== lastStatusHtml) { lastStatusHtml = cs.status; statusHost.innerHTML = cs.status; }
    if (cs.html !== lastConnectHtml) {
      const active = document.activeElement?.id; lastConnectHtml = cs.html; connectHost.innerHTML = cs.html;
      if (active && connectHost.contains(document.getElementById(active))) document.getElementById(active)?.focus({ preventScroll: true }); // keep keyboard focus across a repaint
    }
    const rh = resultsHtml(snap);
    if (rh !== lastResultsHtml) { lastResultsHtml = rh; resultsHost.innerHTML = rh; }
  }

  // ---------------------------------------------------------------- pick and drop: drag a model's grip onto the machine-output drop area
  // A drop selects the model (keeping typed values if it is already selected) and runs the SAME connect() as the Connect button: same validation,
  // same coordinator, same engine. Nothing is faked and the keyboard path (choose a model, then Connect load) is unchanged.
  const dropZone = document.getElementById('llDrop'), dropMsg = document.getElementById('llDropMsg');
  if (dropZone) {
    attachGripDrag(library, {
      grip: '.ll-grip', idKey: 'grip', drop: dropZone,
      label: (id) => LOAD_CATALOGUE.find((l) => l.id === id)?.name,
      onDrop: (id) => {
        if (id !== selected) selectLoad(id as LoadTypeId, false);
        connect();
        if (dropMsg) dropMsg.textContent = message + ' Live results are in the Work area.';
      },
    });
  }

  renderLibrary(); renderForm(); renderWork(); paintLive();
  return { refresh };
}
