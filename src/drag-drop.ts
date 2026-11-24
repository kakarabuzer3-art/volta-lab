// Shared pointer pick-and-drop (DOM only, imports nothing). A "grip" element inside a root is picked up with mouse, pen or touch; a floating ghost follows
// the pointer; the drop area highlights while the pointer is over it; releasing inside calls onDrop(id), releasing outside (or a cancelled pointer) does nothing.
// It is a pointer-only convenience: every action that can be dropped must also have a keyboard path elsewhere, and the grip is not focusable.
export interface GripDragOptions {
  /** Selector of the grip, matched with closest() from the pointerdown target. */
  readonly grip: string;
  /** data-* attribute (camel-cased dataset key) on the grip that holds the id of what is being picked up. */
  readonly idKey: string;
  readonly drop: HTMLElement;
  /** Text shown on the ghost; return undefined to refuse picking this id up. */
  readonly label: (id: string) => string | undefined;
  readonly onDrop: (id: string) => void;
}

export function attachGripDrag(root: HTMLElement, o: GripDragOptions): void {
  root.addEventListener('pointerdown', (ev) => {
    const grip = (ev.target as HTMLElement).closest<HTMLElement>(o.grip);
    if (!grip || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const id = grip.dataset[o.idKey] as string, text = o.label(id);
    if (text === undefined) return;
    ev.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'tb-ghost'; ghost.textContent = text; ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    o.drop.classList.add('is-armed');
    const inside = (x: number, y: number): boolean => { const r = o.drop.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    let moved = false;
    const move = (m: PointerEvent): void => { if (Math.hypot(m.clientX - ev.clientX, m.clientY - ev.clientY) > 4) moved = true; ghost.style.transform = `translate(${m.clientX + 8}px, ${m.clientY + 8}px)`; o.drop.classList.toggle('is-over', inside(m.clientX, m.clientY)); };
    const end = (m: PointerEvent, drops: boolean): void => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      ghost.remove(); o.drop.classList.remove('is-armed', 'is-over');
      if (moved) { // a real drag must not also count as a click on whatever is under the pointer (for example the card it started from)
        const stop = (c: Event): void => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      }
      if (drops && inside(m.clientX, m.clientY)) o.onDrop(id);
    };
    const up = (m: PointerEvent): void => end(m, true);
    const cancel = (m: PointerEvent): void => end(m, false);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    move(ev);
  });
}
