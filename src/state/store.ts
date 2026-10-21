import { create } from 'zustand';
import type { Lang } from '../i18n/strings';
import type { Manifest } from '../sim/catalog';
import { CLASS_COUNT } from '../sim/classes';
import type { SkyLayers, SkySel } from '../engine/SkyView';
import type { Craft, Flyby } from '../sim/craft';
import type { Place } from '../sim/sky';
import type { Approach, Fireball, LiveBundle, Meteor } from '../sim/live';
import type { BodyId } from '../sim/planets';

export type Target =
  | { kind: 'body'; id: BodyId }
  | { kind: 'asteroid'; index: number }
  | { kind: 'comet'; index: number }
  | { kind: 'approach'; des: string }
  | { kind: 'craft'; id: string };

export const targetKey = (t: Target | null): string =>
  !t ? '' : t.kind === 'body' || t.kind === 'craft' ? `${t.kind}:${t.id}` : t.kind === 'approach' ? `approach:${t.des}` : `${t.kind}:${t.index}`;

/** Live numbers for the selected object, refreshed a few times a second. */
export interface Telemetry {
  key: string;
  sunAu: number;
  earthAu: number | null;
  speedKms: number | null;
  /** Light travel time from the object to the Earth, seconds. */
  lightSec: number | null;
  /** Spacecraft near a body: which, distance from its centre (AU) and speed relative to it (km/s). */
  rel?: { body: BodyId; distAu: number; speedKms: number } | null;
  /** Spacecraft: drawn at its planet because only coarse data covers this time. */
  pinned?: boolean;
}

export interface Layers {
  orbits: boolean;
  labels: boolean;
  asteroids: boolean[];
  comets: boolean;
  streams: boolean;
  meteors: boolean;
  approaches: boolean;
  craft: boolean;
}

export interface AppState {
  lang: Lang;
  phase: 'boot' | 'ready' | 'error';
  error: 'webgl' | 'data' | null;
  manifest: Manifest | null;
  /** Asteroid records on the GPU so far. */
  loaded: number;
  live: LiveBundle | null;
  approaches: Approach[];
  fireballs: Fireball[];
  meteors: Meteor[];
  /** Spacecraft (mutable objects; craftRev changes when their data does). */
  craft: Craft[];
  craftRev: number;
  flybys: Flyby[];
  selected: Target | null;
  /** Name of the selected asteroid once its name shard has arrived. */
  selectedName: string | null;
  telemetry: Telemetry | null;
  focus: Target | null;
  layers: Layers;
  /** Faintest asteroid absolute magnitude drawn (performance setting). */
  hMax: number;
  simMs: number;
  warp: number;
  paused: boolean;
  isLive: boolean;
  panel: 'events' | 'layers' | null;
  dialog: 'about' | 'place' | null;
  /** Solar System or the sky from the observer's place. */
  mode: 'space' | 'sky';
  place: Place | null;
  skyLayers: SkyLayers;
  skySel: SkySel | null;
  /** Centre of the sky view, for the compass readout. */
  skyView: { az: number; alt: number; fov: number };
  fps: number;
}

export const useApp = create<AppState>(() => ({
  lang: 'en',
  phase: 'boot',
  error: null,
  manifest: null,
  loaded: 0,
  live: null,
  approaches: [],
  fireballs: [],
  meteors: [],
  craft: [],
  craftRev: 0,
  flybys: [],
  selected: null,
  selectedName: null,
  telemetry: null,
  focus: null,
  layers: {
    orbits: true,
    labels: true,
    asteroids: new Array(CLASS_COUNT).fill(true),
    comets: true,
    streams: true,
    meteors: true,
    approaches: true,
    craft: true,
  },
  hMax: 99,
  simMs: Date.now(),
  warp: 1,
  paused: false,
  isLive: true,
  panel: 'events',
  dialog: null,
  mode: 'space',
  place: null,
  skyLayers: { ground: true, grid: false, constellations: true, names: true, showers: true, meteors: true, craft: true },
  skySel: null,
  skyView: { az: 180, alt: 25, fov: 75 },
  fps: 60,
}));

export const set = useApp.setState;
export const get = useApp.getState;
