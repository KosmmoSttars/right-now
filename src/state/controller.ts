// Boot sequence and the actions the UI calls; the only place that talks to both the
// store and the engine.
import * as THREE from 'three';
import { Engine } from '../engine/Engine';
import { translate } from '../i18n';
import { fmtSig } from '../i18n';
import { loadChunk, loadManifest, nameOf, splitName, decodeRecord, type Manifest } from '../sim/catalog';
import { SimClock } from '../sim/clock';
import { CLASS_STYLE } from '../sim/classes';
import { flybys, loadCraftFile, loadCraftIndex, loadCraftMeta, makeCraft, type Craft } from '../sim/craft';
import { LD_AU, approaches, fireballs, loadLive, loadStreams, meteors } from '../sim/live';
import { BODIES } from '../sim/planets';
import { get, set, targetKey, type Target } from './store';

export const clock = new SimClock();
/** Resolves when the asteroid catalogue has loaded (background work waits for it). */
let catalogDone: () => void = () => {};
const catalogLoaded = new Promise<void>((res) => (catalogDone = res));
let engine: Engine | null = null;

export function getEngine(): Engine | null {
  return engine;
}

function webgl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

export async function boot(container: HTMLElement): Promise<void> {
  if (!webgl2()) {
    set({ phase: 'error', error: 'webgl' });
    return;
  }
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const quality = small || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'high';
  const res = quality === 'high' ? '4k' : '2k';
  try {
    const [day, night, aux, stars] = await Promise.all([
      loadTexture(`textures/earth-day-${res}.webp`),
      loadTexture(`textures/earth-night-${res}.webp`),
      loadTexture(`textures/earth-aux-${res}.webp`),
      fetch('data/stars.json').then((r) => r.json() as Promise<[number, number, number, number][]>),
    ]);
    engine = new Engine(
      container,
      clock,
      {
        onSelect: (t) => onSelect(t),
        onFocus: (t) => set({ focus: t }),
        onTelemetry: (t) => set({ telemetry: t }),
        onFps: (fps) => set({ fps }),
      },
      { day, night, aux },
      quality,
    );
    engine.setStars(stars);
    if (import.meta.env.DEV) Object.assign(window, { __rn: { engine, get, set, clock } });
    relabelBodies();
    applyLayers();
    if (small) set({ hMax: 18, panel: null });
    engine.setHMax(get().hMax);
    set({ phase: 'ready' });
  } catch (err) {
    console.error(err);
    set({ phase: 'error', error: 'data' });
    return;
  }

  // Time ticks for the UI.
  setInterval(() => set({ simMs: clock.now(), isLive: clock.isLive() }), 250);
  clock.subscribe(() => set({ warp: clock.warp, paused: clock.paused, simMs: clock.now(), isLive: clock.isLive() }));

  void loadLiveData();
  void loadCraft();
  void loadStreams().then((s) => engine?.setStreams(s)).catch((e) => console.warn('streams', e));
  try {
    await loadCatalog();
  } catch (err) {
    console.error(err);
    if (!get().loaded) set({ error: 'data' });
  }
  catalogDone();
}

async function loadCatalog(): Promise<void> {
  const m = await loadManifest();
  set({ manifest: m });
  engine!.setManifest(m);
  engine!.setHMax(get().hMax);
  applyLayers();
  for (let part = 0; part < m.chunks.length; part++) {
    const chunk = await loadChunk(m, part);
    engine!.appendChunk(chunk);
    set({ loaded: get().loaded + chunk.length / 8 });
    if (part === 0) void labelLargest(m, chunk);
  }
}

/** Dwarf planets and the biggest asteroids: the brightest records after the NEOs. */
async function labelLargest(m: Manifest, chunk: Uint16Array): Promise<void> {
  const picks: number[] = [];
  for (let k = m.neoCount; k < Math.min(m.neoCount + 60, chunk.length / 8); k++) {
    const r = decodeRecord(chunk, k, m);
    if (r.h < 4.6) picks.push(k);
  }
  const named = await Promise.all(picks.map(async (index) => ({ index, name: await nameOf(m, index) })));
  // Pluto is drawn as a major body already.
  const list = named.filter((n) => !/\bPluto\b/.test(n.name));
  engine?.setNamed(list, (n) => splitName(n.name).title);
}

async function loadLiveData(): Promise<void> {
  try {
    const live = await loadLive();
    const ap = approaches(live);
    const fb = fireballs(live);
    const mt = meteors(live);
    set({ live, approaches: ap, fireballs: fb, meteors: mt });
    engine?.setComets(live.comets);
    engine?.setMeteors(mt);
    engine?.setFireballs(fb);
    relabelApproaches();
  } catch (err) {
    console.warn('live data', err);
  }
}

/**
 * Spacecraft: the list, then the index (coverage and today's fine tracks, enough to
 * place them now), then each craft's full set of tables in the background.
 */
async function loadCraft(): Promise<void> {
  let list: Craft[];
  try {
    list = (await loadCraftMeta()).map(makeCraft);
  } catch (err) {
    console.warn('craft list', err);
    return;
  }
  set({ craft: list });
  engine?.setCraft(list);
  let version = '';
  try {
    const index = await loadCraftIndex();
    version = index.builtAt;
    for (const c of list) {
      const e = index.craft[c.meta.id];
      if (!e) continue;
      c.cov = e.cov;
      if (e.now) c.tables = [e.now];
    }
    set({ craftRev: get().craftRev + 1 });
  } catch (err) {
    console.warn('craft index', err);
    return;
  }
  // Selected first, then active missions, then the historic ones.
  const queue = list.filter((c) => c.cov).sort((a, b) => Number(!!a.meta.historic) - Number(!!b.meta.historic));
  let catalogReady = false;
  void catalogLoaded.then(() => (catalogReady = true));
  while (queue.length) {
    // The selected craft loads at once; the rest after the asteroids, so as not to slow them.
    const sel = get().selected;
    const at = sel?.kind === 'craft' ? queue.findIndex((c) => c.meta.id === sel.id) : -1;
    if (at < 0 && !catalogReady) {
      await Promise.race([catalogLoaded, new Promise((res) => setTimeout(res, 500))]);
      continue;
    }
    const c = queue.splice(Math.max(0, at), 1)[0];
    try {
      const f = await loadCraftFile(c.meta.id, version);
      c.tables = f.tables;
      c.full = true;
    } catch (err) {
      console.warn('craft', c.meta.id, err);
      continue;
    }
    set({ craftRev: get().craftRev + 1, flybys: list.flatMap((x) => (x.full ? flybys(x) : [])).sort((a, b) => a.jd - b.jd) });
  }
}

function relabelApproaches(): void {
  const lang = get().lang;
  engine?.setApproaches(get().approaches, (a) => `${a.name} · ${translate(lang, 'ld', { d: fmtSig(lang, a.distAu / LD_AU, 2) })}`);
}

function relabelBodies(): void {
  const lang = get().lang;
  for (const b of BODIES) engine?.setBodyLabel(b.id, translate(lang, b.id));
}

export function setLang(lang: 'en' | 'ru'): void {
  set({ lang });
  document.documentElement.lang = lang;
  relabelBodies();
  relabelApproaches();
  const sel = get().selected;
  if (sel) labelSelection(sel);
}

export function applyLayers(): void {
  const { layers } = get();
  engine?.setLayers(layers);
}

export function toggleLayer(key: 'orbits' | 'labels' | 'comets' | 'streams' | 'meteors' | 'approaches' | 'craft'): void {
  const layers = { ...get().layers, [key]: !get().layers[key] };
  set({ layers });
  applyLayers();
}

export function toggleClass(cls: number): void {
  const asteroids = [...get().layers.asteroids];
  asteroids[cls] = !asteroids[cls];
  set({ layers: { ...get().layers, asteroids } });
  applyLayers();
}

export function setAllClasses(on: boolean): void {
  set({ layers: { ...get().layers, asteroids: get().layers.asteroids.map(() => on) } });
  applyLayers();
}

export function setHMax(h: number): void {
  set({ hMax: h });
  engine?.setHMax(h);
}

// ---------------------------------------------------------------- selection

function onSelect(t: Target | null): void {
  set({ selected: t, selectedName: null, telemetry: null });
  if (t) labelSelection(t);
  else engine?.labels.removeWhere((id) => id.startsWith('sel:'));
}

function labelSelection(t: Target): void {
  const m = get().manifest;
  if (t.kind === 'asteroid' && m) {
    const key = targetKey(t);
    void nameOf(m, t.index).then((full) => {
      if (targetKey(get().selected) !== key) return;
      set({ selectedName: full });
      const cls = engine?.asteroids ? decodeRecord(engine.asteroids.data, t.index, m).cls : 0;
      engine?.labelSelected(t, splitName(full).title, CLASS_STYLE[cls]?.color ?? '#fff');
    });
  } else if (t.kind === 'comet') {
    const c = get().live?.comets[t.index];
    if (c) {
      set({ selectedName: c[0] });
      engine?.labelSelected(t, c[0], '#9ff2e0');
    }
  }
}

export function select(t: Target | null): void {
  engine?.select(t);
}

export function selectAndFly(t: Target): void {
  engine?.selectAndFly(t);
}

export function flyTo(t: Target): void {
  engine?.flyTo(t);
}

// ---------------------------------------------------------------- time

export function setWarp(w: number): void {
  clock.setWarp(w);
}

export function togglePause(): void {
  clock.setPaused(!clock.paused);
}

export function goLive(): void {
  clock.goLive();
}

export function jumpTo(ms: number): void {
  clock.jump(ms);
}

/** Jumps to half a day before a flyby and plays at an hour per second, following the craft. */
export function watchFlyby(id: string, ms: number): void {
  clock.jump(ms - 12 * 3_600_000);
  clock.setWarp(3600);
  engine?.selectAndFly({ kind: 'craft', id });
}

/** Rewinds three days and plays at an hour per second, so the meteors fall again. */
export function replayMeteors(): void {
  const mt = get().meteors;
  const start = mt.length ? mt[0].ms - 3600_000 : Date.now() - 3 * 86_400_000;
  clock.jump(start);
  clock.setWarp(3600);
  const t: Target = { kind: 'body', id: 'earth' };
  engine?.select(t);
  engine?.flyTo(t, 0.00045);
}
