// The asteroid catalogue: a manifest plus binary chunks of 16-byte records
// (see build_asteroids() in public/api/data.php), streamed in order: NEOs first,
// then the rest from the largest to the smallest.
import { DEG, type Orbit, orbitFromMean } from './kepler';

export interface Manifest {
  v: string;
  builtAt: string;
  source: string;
  epochJd: number;
  count: number;
  neoCount: number;
  classes: number[];
  chunks: number[];
  shard: number;
  aRange: [number, number];
}

export const API = 'api/data.php';
export const RECORD_U16 = 8;

export async function fetchJson<T>(url: string, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url);
      if (r.status === 503) {
        const wait = Number(r.headers.get('Retry-After')) || 20;
        await new Promise((res) => setTimeout(res, Math.min(wait, 30) * 1000));
        continue;
      }
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (err) {
      lastErr = err;
      await new Promise((res) => setTimeout(res, 1500 * (k + 1)));
    }
  }
  throw lastErr;
}

export function loadManifest(): Promise<Manifest> {
  return fetchJson<Manifest>(`${API}?set=manifest`, 12);
}

export async function loadChunk(m: Manifest, part: number): Promise<Uint16Array> {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(`${API}?set=ast&v=${m.v}&part=${part}`);
      if (!r.ok) throw new Error(`chunk ${part}: HTTP ${r.status}`);
      return new Uint16Array(await r.arrayBuffer());
    } catch (err) {
      if (k >= 3) throw err;
      await new Promise((res) => setTimeout(res, 2000 * (k + 1)));
    }
  }
}

export interface AsteroidRecord {
  a: number;
  e: number;
  iDeg: number;
  nodeDeg: number;
  periDeg: number;
  mDeg: number;
  h: number;
  cls: number;
}

/** Decodes record `index` of a packed array (the same maths as the shader). */
export function decodeRecord(data: Uint16Array, index: number, m: Manifest): AsteroidRecord {
  const o = index * RECORD_U16;
  const lnMin = Math.log(m.aRange[0]);
  const lnSpan = Math.log(m.aRange[1]) - lnMin;
  const hc = data[o + 6];
  return {
    a: Math.exp(lnMin + (data[o] / 65535) * lnSpan),
    e: data[o + 1] / 65535,
    iDeg: (data[o + 2] / 65535) * 180,
    nodeDeg: (data[o + 3] / 65535) * 360,
    periDeg: (data[o + 4] / 65535) * 360,
    mDeg: ((data[o + 5] + data[o + 7] / 65536) / 65536) * 360,
    h: (hc & 255) / 7 - 2,
    cls: hc >> 8,
  };
}

export function recordOrbit(r: AsteroidRecord, m: Manifest): Orbit {
  return orbitFromMean(r.a, r.e, r.iDeg, r.nodeDeg, r.periDeg, r.mDeg, m.epochJd);
}

const nameShards = new Map<number, Promise<string[]>>();

export function nameOf(m: Manifest, index: number): Promise<string> {
  const shard = Math.floor(index / m.shard);
  let p = nameShards.get(shard);
  if (!p) {
    p = fetch(`${API}?set=names&v=${m.v}&shard=${shard}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`names ${shard}`))))
      .then((t) => t.split('\n'));
    p.catch(() => nameShards.delete(shard));
    nameShards.set(shard, p);
  }
  return p.then((lines) => lines[index - shard * m.shard] ?? `#${index}`);
}

/**
 * JPL full names look like "433 Eros (A898 PA)", "(2025 NL78)" or
 * "134340 Pluto (1930 BM)": number, name and provisional designation.
 */
export function splitName(full: string): { number: string | null; name: string | null; des: string | null; title: string; lookup: string } {
  const m = /^\s*(\d+)?\s*([^()]*?)\s*(?:\(([^)]+)\))?\s*$/.exec(full);
  const number = m?.[1] ?? null;
  const name = m?.[2]?.trim() || null;
  const des = m?.[3] ?? null;
  const title = name ? name : des ?? full.trim();
  return { number, name, des, title, lookup: number ?? des ?? full.trim() };
}

export async function searchNames(q: string): Promise<[number, string][]> {
  const r = await fetch(`${API}?set=search&q=${encodeURIComponent(q)}`);
  return r.ok ? ((await r.json()) as [number, string][]) : [];
}

export { DEG };
