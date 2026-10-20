// HTML labels that double as markers: a dot that keeps tiny bodies findable at any
// zoom, and a name. Labels are placed by priority and skipped when they would
// overlap one already placed.

export interface LabelSpec {
  id: string;
  text: string;
  color: string;
  /** Higher wins when labels collide. */
  priority: number;
  /** Small secondary line (distance, date...). */
  sub?: string;
  /** Hide the dot (the body is drawn big enough) but keep the name. */
  dot?: boolean;
  /** Extra class for the marker style ('craft' draws a diamond). */
  cls?: string;
  onClick?: () => void;
}

interface Entry {
  spec: LabelSpec;
  el: HTMLDivElement;
  nameEl: HTMLSpanElement;
  subEl: HTMLSpanElement;
  w: number;
  h: number;
  x: number;
  y: number;
  /** Projected radius of the body's disc, px (0 if a point). */
  discPx: number;
  visible: boolean;
  shown: boolean;
}

export class Labels {
  readonly root: HTMLDivElement;
  private entries = new Map<string, Entry>();
  selectedId: string | null = null;
  hoverId: string | null = null;
  /** Labels below this priority hide (user setting / zoom-dependent clutter control). */
  minPriority = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    container.appendChild(this.root);
  }

  upsert(spec: LabelSpec): void {
    let e = this.entries.get(spec.id);
    if (!e) {
      const el = document.createElement('div');
      el.className = 'label';
      const dot = document.createElement('i');
      const nameEl = document.createElement('span');
      nameEl.className = 'label-name';
      const subEl = document.createElement('span');
      subEl.className = 'label-sub';
      el.append(dot, nameEl, subEl);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.entries.get(spec.id)?.spec.onClick?.();
      });
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      this.root.appendChild(el);
      e = { spec, el, nameEl, subEl, w: 0, h: 0, x: 0, y: 0, discPx: 0, visible: false, shown: false };
      this.entries.set(spec.id, e);
    }
    e.spec = spec;
    if (e.nameEl.textContent !== spec.text) {
      e.nameEl.textContent = spec.text;
      e.w = 0;
    }
    const sub = spec.sub ?? '';
    if (e.subEl.textContent !== sub) {
      e.subEl.textContent = sub;
      e.w = 0;
    }
    e.el.style.setProperty('--c', spec.color);
    e.el.classList.toggle('no-dot', spec.dot === false);
    if (spec.cls) e.el.classList.add(spec.cls);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.el.remove();
    this.entries.delete(id);
  }

  removeWhere(pred: (id: string) => boolean): void {
    for (const id of [...this.entries.keys()]) if (pred(id)) this.remove(id);
  }

  /** Called per frame with the projected position; visible=false for off-screen. */
  place(id: string, x: number, y: number, visible: boolean, discPx = 0): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.x = x;
    e.y = y;
    e.visible = visible;
    e.discPx = discPx;
  }

  layout(width: number, height: number): void {
    const list = [...this.entries.values()].filter((e) => e.visible && e.x > -50 && e.y > -50 && e.x < width + 50 && e.y < height + 50);
    const boost = (e: Entry) => e.spec.priority + (e.spec.id === this.selectedId ? 1000 : 0) + (e.spec.id === this.hoverId ? 500 : 0);
    list.sort((a, b) => boost(b) - boost(a));
    const placed: [number, number, number, number][] = [];
    const placedSet = new Set<Entry>();
    for (const e of list) {
      if (e.spec.priority < this.minPriority && e.spec.id !== this.selectedId) continue;
      if (e.w === 0) {
        e.w = e.el.offsetWidth || e.spec.text.length * 7 + 20;
        e.h = e.el.offsetHeight || 16;
      }
      // The name sits right of the dot, or right of the disc for big bodies.
      const ox = Math.max(0, e.discPx - 4);
      const r: [number, number, number, number] = [e.x + ox - 6, e.y - e.h / 2, e.x + ox + e.w, e.y + e.h / 2];
      const hit = placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
      if (hit && e.spec.id !== this.selectedId) continue;
      placed.push(r);
      placedSet.add(e);
      e.el.style.transform = `translate3d(${(e.x + ox).toFixed(1)}px, ${e.y.toFixed(1)}px, 0)`;
    }
    for (const e of this.entries.values()) {
      const show = placedSet.has(e);
      if (show !== e.shown) {
        e.el.classList.toggle('on', show);
        e.shown = show;
      }
      e.el.classList.toggle('selected', e.spec.id === this.selectedId);
      e.el.classList.toggle('big', e.discPx > 5);
    }
  }
}
