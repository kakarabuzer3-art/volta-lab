// Component Workbench shell. Pure DOM: a left-hand side panel (the mirror of the Controls panel), three section tabs, and the area switcher inside the
// Components section. It touches no physics and no three.js; the Load Lab (loadlab-ui.ts) mounts into the Components section and the library sections
// (library-ui.ts) load on first open. The panel is NOT modal: the machine stays visible and usable beside it, and nothing is made inert. Closing it
// restores nothing because nothing was changed.
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

function init(): void {
  const panel = $('workbench'), opener = $<HTMLButtonElement>('workbenchBtn'), closer = $<HTMLButtonElement>('wbClose'), title = $('wbTitle');
  if (!panel || !opener || !closer || !title) return;
  const body = panel.querySelector<HTMLElement>('.wb-body');
  const areaButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-wb-area]'));
  const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-wb-section]'));
  const announce = (text: string): void => { const el = $('srStatus'); if (el) el.textContent = text; };
  const isOpen = (): boolean => !panel.hidden;

  let librarySectionsLoaded = false;
  function open(): void {
    if (isOpen()) return;
    // The library sections load on first open as their own small chunk, so first paint and the 3D bundle are unaffected.
    if (!librarySectionsLoaded) { librarySectionsLoaded = true; import('./library-ui.ts').catch((error: unknown) => console.error('Volta Lab: library sections failed to load', error)); }
    panel!.hidden = false;
    document.body.classList.add('workbench-open');
    opener!.setAttribute('aria-expanded', 'true');
    title!.focus({ preventScroll: true }); // focus lands on the panel title, which a screen reader then announces
    announce('Component Workbench opened beside the machine. The machine keeps running.');
  }
  function close(): void {
    if (!isOpen()) return;
    const focusWasInside = panel!.contains(document.activeElement);
    panel!.hidden = true;
    document.body.classList.remove('workbench-open');
    opener!.setAttribute('aria-expanded', 'false');
    if (focusWasInside) opener!.focus({ preventScroll: true }); // never leave focus inside a hidden panel
    announce('Workbench closed.');
  }
  opener.addEventListener('click', () => (isOpen() ? close() : open()));
  closer.addEventListener('click', close);

  // ---- three sections (tabs): Components, Transformers, Section 3
  function showSection(name: string, moveFocus = false): void {
    for (const t of tabs) {
      const on = t.dataset.wbSection === name;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      const pane = $(t.getAttribute('aria-controls') ?? ''); if (pane) pane.hidden = !on;
      if (on && moveFocus) t.focus({ preventScroll: true });
    }
  }
  for (const t of tabs) t.addEventListener('click', () => showSection(t.dataset.wbSection as string));
  panel.querySelector('[role=tablist]')?.addEventListener('keydown', (e) => {
    const event = e as KeyboardEvent; const i = tabs.findIndex((t) => t === document.activeElement); if (i < 0) return;
    const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length : event.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); showSection(tabs[next].dataset.wbSection as string, true);
  });

  // ---- inside Components: one area at a time (Library, Work area, Properties), because the panel is narrow
  function showArea(area: string): void {
    body?.setAttribute('data-area', area);
    for (const b of areaButtons) b.setAttribute('aria-pressed', String(b.dataset.wbArea === area));
  }
  for (const b of areaButtons) b.addEventListener('click', () => showArea(b.dataset.wbArea as string));

  // Choosing a load model moves straight on to its Properties (values + Connect).
  document.addEventListener('workbench:model-chosen', () => {
    if (!isOpen()) return;
    showSection('components'); showArea('properties');
    $('wbPropertiesHeading')?.focus({ preventScroll: true }); // the chosen card is now hidden, so focus follows the learner to the next area
    announce('Model chosen. Properties shown: set its values, then connect it.');
  });

  // Escape closes the panel only while focus is inside it, so it never competes with the machine's own keys.
  panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
}

init();
