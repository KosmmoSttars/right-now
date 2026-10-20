// Spacecraft on their JPL Horizons trajectories. The server keeps, per craft, a
// whole-mission table relative to the Sun plus finer tables relative to a planet
// (flybys, stays in orbit, a fine track around today); see build_craft() in
// public/api/data.php. A position comes from the finest table that covers the time,
// added to the centre body's position, so an orbiter circles the planet as drawn.
import { API, fetchJson } from './catalog';
import type { Vec3 } from './kepler';
import type { BodyId } from './planets';

export interface CraftVisit {
  body: BodyId;
  from: string;
  to?: string;
  step?: string;
  now?: [string, number];
}

export interface CraftMeta {
  id: string;
  hz: string;
  name: string;
  short?: string;
  agency: string;
  launch: string;
  wiki: string;
  historic?: boolean;
  about: { en: string; ru: string };
  flybys?: [BodyId, string, number, string][];
  visits?: CraftVisit[];
  nowStep?: string;
}

export interface CraftTable {
  /** Centre: 'sun' or the body the vectors are relative to. */
  c: BodyId;
  k: 'cruise' | 'flyby' | 'visit' | 'now';
  /** JD (TDB) of the first row and the spacing in days. */
  t0: number;
  dt: number;
  /** x, y, z (AU), vx, vy, vz (AU/day), ecliptic J2000. */
  rows: number[][];
}

export interface CraftIndex {
  v: number;
  builtAt: string;
  craft: Record<string, { cov: [number, number]; now: CraftTable | null }>;
}

export interface Craft {
  meta: CraftMeta;
  /** First and last JD of the ephemeris (null until the index arrives). */
  cov: [number, number] | null;
  tables: CraftTable[];
  /** True once every table of the craft has loaded, not just today's. */
  full: boolean;
  /** Visit periods as JD ranges, for pinning orbiters to their planet. */
  stays: { body: BodyId; from: number; to: number }[];
}

export interface CraftFix {
  pos: Vec3;
  /** The table used (null when pinned to a body). */
  table: CraftTable | null;
  /** Centre body of the table (or of the stay when pinned). */
  center: BodyId;
  /** In orbit around a body but without fine data for this time: drawn at the body. */
  pinned: boolean;
}

export const jdFromIso = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000 + 2440587.5;

export async function loadCraftMeta(): Promise<CraftMeta[]> {
  const j = await fetchJson<{ craft: CraftMeta[] }>('data/craft.json');
  return j.craft;
}

export function makeCraft(meta: CraftMeta): Craft {
  return {
    meta,
    cov: null,
    tables: [],
    full: false,
    stays: (meta.visits ?? []).map((v) => ({ body: v.body, from: jdFromIso(v.from), to: v.to ? jdFromIso(v.to) : Infinity })),
  };
}

export function loadCraftIndex(): Promise<CraftIndex> {
  return fetchJson<CraftIndex>(`${API}?set=craft`, 8);
}

export function loadCraftFile(id: string, version: string): Promise<{ id: string; tables: CraftTable[] }> {
  return fetchJson(`${API}?set=craftfile&id=${encodeURIComponent(id)}&v=${encodeURIComponent(version)}`, 3);
}

export const tableEnd = (t: CraftTable): number => t.t0 + t.dt * (t.rows.length - 1);

/** The finest table covering jd, or null. */
export function tableAt(c: Craft, jd: number): CraftTable | null {
  let best: CraftTable | null = null;
  for (const t of c.tables) {
    if (jd < t.t0 || jd > tableEnd(t)) continue;
    if (!best || t.dt < best.dt) best = t;
  }
  return best;
}

/** Cubic Hermite interpolation of a table at jd (vectors relative to its centre). */
export function tablePosition(t: CraftTable, jd: number, out: Vec3): Vec3 {
  const n = t.rows.length;
  const k = Math.min(n - 2, Math.max(0, Math.floor((jd - t.t0) / t.dt)));
  const a = t.rows[k];
  const b = t.rows[k + 1];
  const h = t.dt;
  const s = (jd - (t.t0 + k * h)) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let i = 0; i < 3; i++) out[i] = h00 * a[i] + h10 * h * a[3 + i] + h01 * b[i] + h11 * h * b[3 + i];
  return out;
}

/**
 * Heliocentric ecliptic position of a craft at jd (TT), or null when it is outside
 * its ephemeris or its data has not arrived. `bodyAt` gives the heliocentric
 * position of a body at the same jd.
 */
export function craftFix(c: Craft, jd: number, bodyAt: (id: BodyId) => Vec3, out: Vec3 = [0, 0, 0]): CraftFix | null {
  if (c.cov && (jd < c.cov[0] || jd > c.cov[1])) return null;
  const t = tableAt(c, jd);
  const stay = c.stays.find((s) => jd >= s.from && jd <= s.to);
  // The whole-mission table is too coarse for an orbit: between its samples the
  // craft would wander thousands of km off. Keep it on its planet instead.
  if (stay && (!t || t.k === 'cruise')) {
    const p = bodyAt(stay.body);
    out[0] = p[0]; out[1] = p[1]; out[2] = p[2];
    return { pos: out, table: null, center: stay.body, pinned: true };
  }
  if (!t) return null;
  tablePosition(t, jd, out);
  if (t.c !== 'sun') {
    const p = bodyAt(t.c);
    out[0] += p[0]; out[1] += p[1]; out[2] += p[2];
  }
  return { pos: out, table: t, center: t.c, pinned: false };
}

export interface Flyby {
  id: string;
  body: BodyId;
  /** Closest approach: JD (TT) and distance from the body's centre, AU. */
  jd: number;
  distAu: number;
  /** Speed relative to the body at closest approach, AU/day. */
  speed: number;
}

/** Closest approaches in the flyby tables (the time of the nearest row, refined). */
export function flybys(c: Craft): Flyby[] {
  const out: Flyby[] = [];
  for (const t of c.tables) {
    if (t.k !== 'flyby') continue;
    let best = 0;
    let bestR = Infinity;
    t.rows.forEach((r, k) => {
      const d = Math.hypot(r[0], r[1], r[2]);
      if (d < bestR) {
        bestR = d;
        best = k;
      }
    });
    // Refine between the neighbouring rows (golden-section on the Hermite curve).
    let lo = t.t0 + Math.max(0, best - 1) * t.dt;
    let hi = t.t0 + Math.min(t.rows.length - 1, best + 1) * t.dt;
    const p: Vec3 = [0, 0, 0];
    const dist = (jd: number) => Math.hypot(...tablePosition(t, jd, p));
    const g = 0.381966;
    for (let i = 0; i < 40; i++) {
      const m1 = lo + g * (hi - lo);
      const m2 = hi - g * (hi - lo);
      if (dist(m1) < dist(m2)) hi = m2;
      else lo = m1;
    }
    const jd = (lo + hi) / 2;
    const d = dist(jd);
    const q: Vec3 = [0, 0, 0];
    tablePosition(t, jd + 1e-4, q);
    const speed = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 1e-4;
    // A window that never comes near the body (a planned date that moved) is not a flyby.
    if (best > 0 && best < t.rows.length - 1) out.push({ id: c.meta.id, body: t.c, jd, distAu: d, speed });
  }
  return out;
}

/** Display name: the short form when there is one. */
export const craftLabel = (m: CraftMeta): string => m.short ?? m.name;
