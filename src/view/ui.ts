// A small reusable popup menu: tap a chip or button, a little menu opens next to it, tap outside to close.
// Future player controls are meant to be these little menus too, so keep this generic:
//   popup.open(anchorEl, { title, items: [{ label, on, act }], html, wide, keepOpen })
// Items are buttons (row by default, `col: true` for a list). `html` is free content (stats, forms) that
// `onRender(el)` can wire up. Positioning keeps the menu inside the safe margins (the CSS --ml/--mt/... vars).
export interface PopItem { label: string; on?: boolean; act: () => void; keepOpen?: boolean }
export interface PopSpec { title?: string; items?: PopItem[]; col?: boolean; html?: string; wide?: boolean; onRender?: (el: HTMLElement) => void; id?: string }

class Popup {
  private el: HTMLDivElement | null = null;
  private anchor: HTMLElement | null = null;
  private spec: PopSpec | null = null;
  constructor() {
    // tap outside closes (pointerdown so a pan that starts outside also closes it)
    addEventListener('pointerdown', (e) => { if (this.el && !this.el.contains(e.target as Node) && !(this.anchor && this.anchor.contains(e.target as Node))) this.close(); }, true);
    addEventListener('resize', () => this.place());
  }
  isOpen(id?: string): boolean { return !!this.el && (!id || (this.spec?.id === id)); }
  /** Opens the menu next to anchor; opening the same id again toggles it closed. */
  toggle(anchor: HTMLElement, spec: PopSpec): void { if (this.isOpen(spec.id) && this.anchor === anchor) this.close(); else this.open(anchor, spec); }
  open(anchor: HTMLElement, spec: PopSpec): void {
    this.close(); this.anchor = anchor; this.spec = spec;
    const el = document.createElement('div'); el.className = 'pop' + (spec.wide ? ' wide' : ''); this.el = el;
    this.render(); document.body.appendChild(el); this.place();
  }
  /** Re-draws the open menu (e.g. a speed button changed state) without moving it. */
  refresh(spec?: PopSpec): void { if (!this.el) return; if (spec) this.spec = spec; this.render(); this.place(); }
  close(): void { if (this.el) this.el.remove(); this.el = null; this.anchor = null; this.spec = null; }
  private render(): void {
    const el = this.el!, spec = this.spec!; el.innerHTML = '';
    if (spec.title) { const h = document.createElement('h4'); h.textContent = spec.title; el.appendChild(h); }
    if (spec.html) { const b = document.createElement('div'); b.className = 'body'; b.innerHTML = spec.html; el.appendChild(b); }
    if (spec.items && spec.items.length) {
      const row = document.createElement('div'); row.className = 'items' + (spec.col ? ' col' : '');
      for (const it of spec.items) {
        const b = document.createElement('button'); b.textContent = it.label; if (it.on) b.classList.add('on');
        b.addEventListener('click', () => { it.act(); if (it.keepOpen) this.refresh(); else this.close(); });
        row.appendChild(b);
      }
      el.appendChild(row);
    }
    if (spec.onRender) spec.onRender(el);
  }
  private place(): void {
    const el = this.el, a = this.anchor; if (!el || !a) return;
    const css = getComputedStyle(document.documentElement);
    const px = (v: string): number => { const t = document.createElement('div'); t.style.position = 'fixed'; t.style.left = css.getPropertyValue(v) || '0px'; document.body.appendChild(t); const r = t.getBoundingClientRect().left; t.remove(); return r; };
    const ml = px('--ml'), mr = px('--mr'), mt = px('--mt'), mb = px('--mb');
    const ar = a.getBoundingClientRect(); const W = innerWidth, H = innerHeight;
    el.style.left = '0px'; el.style.top = '0px'; const r = el.getBoundingClientRect();
    let x: number, y: number;
    const rightSide = ar.left > W / 2, bottomSide = ar.top > H * 0.6;
    if (rightSide) { x = ar.left - r.width - 8; y = ar.top + ar.height / 2 - r.height / 2; }       // controls on the right: open to the left
    else if (bottomSide) { x = ar.left; y = ar.top - r.height - 8; }                               // bottom chips: open upward
    else { x = ar.left; y = ar.bottom + 8; }                                                        // top chips: open downward
    x = Math.max(ml, Math.min(W - mr - r.width, x)); y = Math.max(mt, Math.min(H - mb - r.height, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
}
export const popup = new Popup();
