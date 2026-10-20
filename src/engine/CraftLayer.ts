// Spacecraft in the 3D scene: a diamond marker and name for each one that exists at
// the simulated time, its whole-mission path (faint, bright near the craft), and for
// the selected craft the fine local track around the body it is visiting.
import * as THREE from 'three';
import { craftFix, craftLabel, tableEnd, type Craft, type CraftFix, type CraftTable } from '../sim/craft';
import type { Vec3 } from '../sim/kepler';
import type { BodyId } from '../sim/planets';
import type { Labels } from './Labels';
import { Polyline } from './Polyline';

export const CRAFT_COLOR = '#c7a8ff';
export const CRAFT_HISTORIC_COLOR = '#9aa6bd';

interface Entry {
  craft: Craft;
  path: Polyline | null;
  pathTable: CraftTable | null;
  fix: CraftFix | null;
  pos: Vec3;
}

export class CraftLayer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private local = new Polyline({ color: CRAFT_COLOR, width: 1.4, opacity: 0.8, trail: true, maxPoints: 12_001 });
  private localTable: CraftTable | null = null;
  private width = 1;
  private height = 1;
  visible = true;
  selectedId: string | null = null;

  constructor(private labels: Labels, private onClick: (id: string) => void) {
    this.group.add(this.local.mesh);
  }

  setCraft(list: Craft[]): void {
    for (const c of list) {
      if (this.entries.has(c.meta.id)) {
        this.entries.get(c.meta.id)!.craft = c;
        continue;
      }
      this.entries.set(c.meta.id, { craft: c, path: null, pathTable: null, fix: null, pos: [0, 0, 0] });
      this.labels.upsert({
        id: `craft:${c.meta.id}`,
        text: craftLabel(c.meta),
        color: c.meta.historic ? CRAFT_HISTORIC_COLOR : CRAFT_COLOR,
        priority: c.meta.historic ? 44 : 58,
        cls: 'craft',
        onClick: () => this.onClick(c.meta.id),
      });
    }
  }

  get(id: string): Craft | undefined {
    return this.entries.get(id)?.craft;
  }

  /** Where the craft is in this frame (null if it does not exist now). */
  fix(id: string): CraftFix | null {
    return this.entries.get(id)?.fix ?? null;
  }

  *all(): IterableIterator<[string, Vec3]> {
    for (const [id, e] of this.entries) if (e.fix) yield [id, e.pos];
  }

  setResolution(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.local.setResolution(w, h);
    for (const e of this.entries.values()) e.path?.setResolution(w, h);
  }

  /**
   * Per frame: positions at jd, path offsets and fades. `rel` maps a heliocentric
   * point to scene coordinates; `bodyAt` gives this frame's body positions.
   */
  update(jd: number, camDist: number, bodyAt: (id: BodyId) => Vec3, rel: (p: Vec3, out: THREE.Vector3) => THREE.Vector3, project: (p: Vec3) => { x: number; y: number; ok: boolean }): void {
    const v = new THREE.Vector3();
    const sunOff = rel([0, 0, 0], v).clone();
    for (const [id, e] of this.entries) {
      const fix = this.visible ? craftFix(e.craft, jd, bodyAt, e.pos) : null;
      e.fix = fix;
      const key = `craft:${id}`;
      if (!fix) {
        this.labels.place(key, 0, 0, false);
        if (e.path) e.path.mesh.visible = false;
        continue;
      }
      const s = project(e.pos);
      this.labels.place(key, s.x, s.y, s.ok);

      // The whole mission, heliocentric. Built once the full file has arrived.
      const cruise = e.craft.tables.find((t) => t.k === 'cruise') ?? null;
      if (cruise && cruise !== e.pathTable) {
        e.path ??= new Polyline({ color: e.craft.meta.historic ? CRAFT_HISTORIC_COLOR : CRAFT_COLOR, width: 1.2, opacity: 0.3, trail: true, maxPoints: 2101 });
        e.path.set(cruise.rows.map((r) => [r[0], r[1], r[2]] as Vec3));
        e.path.setResolution(this.width, this.height);
        if (!e.path.mesh.parent) this.group.add(e.path.mesh);
        e.pathTable = cruise;
      }
      if (e.path && cruise) {
        const sel = id === this.selectedId;
        e.path.mesh.visible = true;
        e.path.setOffset(sunOff);
        e.path.head = (jd - cruise.t0) / (tableEnd(cruise) - cruise.t0);
        let op = sel ? 0.75 : e.craft.meta.historic ? 0.12 : 0.22;
        // Near a planet the Sun-centred path is a blur of samples around it: fade it
        // out as the camera closes in (the fine local track takes over).
        if (fix.pinned || fix.center !== 'sun') op *= Math.min(1, Math.max(0, (camDist - 0.004) / 0.04));
        e.path.opacity = op;
      }
    }

    // The fine track of the selected craft around the body it is near.
    const sel = this.selectedId ? this.entries.get(this.selectedId) : null;
    const t = sel?.fix?.table && sel.fix.table.c !== 'sun' ? sel.fix.table : null;
    if (t !== this.localTable) {
      this.localTable = t;
      if (t) this.local.set(t.rows.map((r) => [r[0], r[1], r[2]] as Vec3));
      else this.local.clear();
    }
    this.local.mesh.visible = !!t && this.visible;
    if (t) {
      this.local.setOffset(rel(bodyAt(t.c), v));
      this.local.head = (jd - t.t0) / (tableEnd(t) - t.t0);
    }
  }

}
