import { create } from 'zustand';
import type { Lang } from '../i18n/strings';
import type { Manifest } from '../sim/catalog';
import { CLASS_COUNT } from '../sim/classes';
import type { Approach, Fireball, LiveBundle, Meteor } from '../sim/live';
import type { BodyId } from '../sim/planets';

export type Target =
  | { kind: 'body'; id: BodyId }
  | { kind: 'asteroid'; index: number }
  | { kind: 'comet'; index: number }
  | { kind: 'approach'; des: string };

export const targetKey = (t: Target | null): string =>
  !t ? '' : t.kind === 'body' ? `body:${t.id}` : t.kind === 'approach' ? `approach:${t.des}` : `${t.kind}:${t.index}`;

/** Live numbers for the selected object, refreshed a few times a second. */
export interface Telemetry {
  key: string;
  sunAu: number;
  earthAu: number | null;
  speedKms: number | null;
  /** Light travel time from the object to the Earth, seconds. */
  lightSec: number | null;
}

export interface Layers {
  orbits: boolean;
  labels: boolean;
  asteroids: boolean[];
  comets: boolean;
  streams: boolean;
  meteors: boolean;
  approaches: boolean;
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
  dialog: 'about' | null;
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
  },
  hMax: 99,
  simMs: Date.now(),
  warp: 1,
  paused: false,
  isLive: true,
  panel: 'events',
  dialog: null,
  fps: 60,
}));

export const set = useApp.setState;
export const get = useApp.getState;
