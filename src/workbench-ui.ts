// Component Workbench shell. Pure DOM: open / close, focus management and the narrow-screen area switcher.
// It touches no physics and no three.js; the Load Lab (loadlab-ui.ts) mounts into its three areas and the library sections (library-ui.ts) load on first open. While open, the whole simulator page (#app) is made inert, so the machine keeps
// running underneath but cannot be reached by pointer, keyboard or assistive technology; closing restores everything unchanged.
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function init(): void {
  const dialog = $('workbench'), opener = $<HTMLButtonElement>('workbenchBtn'), closer = $<HTMLButtonElement>('wbClose'), app = $('app'), title = $('wbTitle');
  if (!dialog || !opener || !closer || !app || !title) return;
  const body = dialog.querySelector<HTMLElement>('.wb-body');
  const switchButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-wb-area]'));
  const announce = (text: string): void => { const el = $('srStatus'); if (el) el.textContent = text; };
  const isOpen = (): boolean => !dialog.hidden;

  let librarySectionsLoaded = false;
  function open(): void {
    if (isOpen()) return;
    // The library sections load on first open as their own small chunk, so first paint and the 3D bundle are unaffected.
    if (!librarySectionsLoaded) { librarySectionsLoaded = true; import('./library-ui.ts').catch((error: unknown) => console.error('Volta Lab: library sections failed to load', error)); }
    dialog!.hidden = false;
    (app as HTMLElement & { inert: boolean }).inert = true;
    document.body.classList.add('workbench-open');
    opener!.setAttribute('aria-expanded', 'true');
    title!.focus({ preventScroll: true }); // focus lands on the dialog title, which a screen reader then announces
    announce('Component Workbench opened. The machine keeps its state while this screen is open.');
  }
  function close(): void {
    if (!isOpen()) return;
    dialog!.hidden = true;
    (app as HTMLElement & { inert: boolean }).inert = false;
    document.body.classList.remove('workbench-open');
    opener!.setAttribute('aria-expanded', 'false');
    opener!.focus({ preventScroll: true }); // focus returns to the control that opened it
    announce('Workbench closed. Back at the machine.');
  }
  opener.addEventListener('click', open);
  closer.addEventListener('click', close);

  // Narrow screens show one area at a time; wide screens show all three and ignore the switcher.
  function showArea(area: string): void {
    body?.setAttribute('data-area', area);
    for (const b of switchButtons) b.setAttribute('aria-pressed', String(b.dataset.wbArea === area));
  }
  for (const b of switchButtons) b.addEventListener('click', () => showArea(b.dataset.wbArea as string));

  // On a narrow screen, choosing a load model moves straight on to its Properties (values + Connect). Wide screens already show all three areas.
  document.addEventListener('workbench:model-chosen', () => {
    if (!isOpen() || !window.matchMedia('(max-width: 900px)').matches) return;
    showArea('properties');
    $('wbPropertiesHeading')?.focus({ preventScroll: true }); // the chosen card is now hidden, so focus follows the learner to the next area
    announce('Model chosen. Properties shown: set its values, then connect it.');
  });

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    // Keep Tab inside the dialog (it is modal): wrap from the last focusable control to the first and back.
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || active === title || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  });
}

init();
