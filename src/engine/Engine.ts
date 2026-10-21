// The scene and everything that moves in it. React talks to it through a small
// imperative API and receives selections, telemetry and frame rate through callbacks.
//
// Precision: positions are heliocentric ecliptic AU in double precision on the CPU.
// The scene origin floats with the camera focus (origin = the focused body), so the
// GPU only ever sees small numbers near the camera, from Saturn's rings down to a
// meteor streak 80 km above Moscow.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Manifest } from '../sim/catalog';
import { decodeRecord, recordOrbit } from '../sim/catalog';
import type { SimClock } from '../sim/clock';
import { orbitFromTrue, orbitPath, periodDays, positionAt, type Orbit, type Vec3 } from '../sim/kepler';
import { SHOWERS, loadTrack, showerActive, trackPosition, type Approach, type Fireball, type Meteor, type StreamsFile, type Track } from '../sim/live';
import { BODIES, BODY_BY_ID, KM_PER_AU, astroTime, bodyOrbitPath, bodyOrientation, bodyPosition, orbitalPeriodDays, type BodyId } from '../sim/planets';
import { craftFix, type Craft } from '../sim/craft';
import { jdTT, msFromJdTT } from '../sim/time';
import { targetKey, type Target, type Telemetry } from '../state/store';
import type { PickRequest, PickResponse } from '../workers/pick.worker';
import { Asteroids } from './Asteroids';
import { Bodies } from './Bodies';
import { Comets } from './Comets';
import { CraftLayer } from './CraftLayer';
import { Labels } from './Labels';
import { OrbitPoints, type OrbitPoint } from './OrbitPoints';
import { Polyline } from './Polyline';
import { SkyView, type SkySel } from './SkyView';
import { Stars } from './Stars';
import { Surface } from './Surface';

export interface EngineEvents {
  onSelect: (t: Target | null) => void;
  onFocus: (t: Target) => void;
  onTelemetry: (t: Telemetry | null) => void;
  onFps: (fps: number) => void;
  onSkySelect: (s: SkySel | null) => void;
}

export interface NamedBody {
  index: number;
  name: string;
}

const LABEL_PRIORITY: Record<BodyId, number> = {
  sun: 100, earth: 96, jupiter: 92, saturn: 91, mars: 90, venus: 89, mercury: 88, uranus: 87, neptune: 86, moon: 70, pluto: 72,
};

const EARTH_SHOWER_GROUP = SHOWERS.length; // sporadic meteoroids
const ease = (s: number) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2);

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private bodies: Bodies;
  private stars: Stars | null = null;
  asteroids: Asteroids | null = null;
  private manifest: Manifest | null = null;
  private comets = new Comets();
  private streams = new OrbitPoints([...SHOWERS.map((s) => s.color)]);
  private meteoroids = new OrbitPoints([...SHOWERS.map((s) => s.color), '#cfd8e6'], 20);
  private meteorRefJd = 0;
  private surface = new Surface();
  readonly labels: Labels;
  private orbitLines = new Map<BodyId, { line: Polyline; at: number }>();
  private selLine = new Polyline({ color: '#ffffff', width: 1.6, opacity: 0.75, trail: true, maxPoints: 721 });
  private selOrbit: Orbit | null = null;
  private trackLines = new Map<string, Polyline>();
  private tracks = new Map<string, Track | null>();
  private approaches: Approach[] = [];
  private named: NamedBody[] = [];
  private namedOrbits = new Map<number, Orbit>();

  /** Scene origin: heliocentric ecliptic AU (double). */
  private origin: Vec3 = [0, 0, 0];
  private focus: Target = { kind: 'body', id: 'sun' };
  private selected: Target | null = null;
  private fly: { from: Vec3; t0: number; dur: number; d0: number; d1: number } | null = null;
  private bodyPos = new Map<BodyId, Vec3>(BODIES.map((b) => [b.id, [0, 0, 0] as Vec3]));
  private layers = { orbits: true, labels: true, comets: true, streams: true, meteors: true, approaches: true, craft: true };
  readonly craft: CraftLayer;
  /** The planetarium view from a place on the Earth (shares the renderer). */
  readonly sky: SkyView;
  private skyMode = false;
  /** JD of the frame whose body positions are in bodyPos. */
  private frameJd = NaN;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private raf = 0;
  /**
   * Point budget. Drawing a point costs a fixed amount of GPU time (some GPUs
   * emulate points), so while the view moves we draw as many of the largest
   * asteroids as keep the frame rate up; a still view gets all of them at a
   * relaxed frame rate, since nothing visibly moves between frames.
   */
  private budget = Infinity;
  private lastActive = performance.now();
  private lastRender = 0;
  private frameMs = 16.7;
  private lastFrameAt = 0;
  forceFull = false;
  private lastStreamGain = 0;
  private downAt = new THREE.Vector2();
  private downTime = 0;
  private pickWorker: Worker;
  private pickId = 0;
  private lastTelemetry = 0;
  private fpsFrames = 0;
  private fpsSince = performance.now();
  private clockEpoch = -1;
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();
  private tmp: Vec3 = [0, 0, 0];
  private tmp2: Vec3 = [0, 0, 0];

  constructor(
    private container: HTMLElement,
    private clock: SimClock,
    private events: EngineEvents,
    earthTex: { day: THREE.Texture; night: THREE.Texture; aux: THREE.Texture },
    readonly quality: 'high' | 'low',
  ) {
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      stencil: false,
    });
    renderer.setClearColor('#010205');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    const canvas = renderer.domElement;
    canvas.className = 'scene-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Interactive 3D model of the Solar System at the current moment. Drag to rotate, scroll to zoom, click an object to select it.');
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(42, 1, 1e-10, 1e6);
    this.camera.position.set(0, 30, 50);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 1.6;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 400;

    this.bodies = new Bodies(earthTex);
    this.bodies.views.get('earth')!.group.add(this.surface.group);
    this.scene.add(this.bodies.root, this.comets.group, this.streams.points, this.meteoroids.points, this.selLine.mesh);

    for (const b of BODIES) {
      if (b.id === 'sun') continue;
      const line = new Polyline({ color: b.color, width: 1.5, opacity: 0.6, trail: true, maxPoints: 513 });
      this.orbitLines.set(b.id, { line, at: -Infinity });
      this.scene.add(line.mesh);
    }

    this.controls.addEventListener('change', () => (this.lastActive = performance.now()));

    this.labels = new Labels(container);
    this.craft = new CraftLayer(this.labels, (id) => this.selectAndFly({ kind: 'craft', id }));
    this.scene.add(this.craft.group);
    for (const b of BODIES) {
      this.labels.upsert({
        id: `body:${b.id}`,
        text: b.id,
        color: b.color,
        priority: LABEL_PRIORITY[b.id],
        onClick: () => this.selectAndFly({ kind: 'body', id: b.id }),
      });
    }

    this.sky = new SkyView(container, canvas, { onSelect: (sel) => this.events.onSkySelect(sel) }, new THREE.TextureLoader().load('textures/moon.webp'));

    this.pickWorker = new Worker(new URL('../workers/pick.worker.ts', import.meta.url), { type: 'module' });
    this.pickWorker.onmessage = (ev: MessageEvent<PickResponse>) => {
      if (ev.data.id !== this.pickId) return;
      const idx = ev.data.index;
      this.select(idx === null ? null : { kind: 'asteroid', index: idx });
    };

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('dblclick', this.onDoubleClick);

    // Opening shot: from beyond Neptune down to the inner Solar System.
    this.camera.position.set(0, 26, 52);
    this.flyTo({ kind: 'body', id: 'sun' }, 10.5, 4.2);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- data

  setStars(catalog: [number, number, number, number][]): void {
    this.stars = new Stars(catalog);
    this.scene.add(this.stars.points);
    this.sky.setStars(catalog);
  }

  setManifest(m: Manifest): void {
    this.manifest = m;
    this.asteroids = new Asteroids(m);
    this.scene.add(this.asteroids.points);
  }

  appendChunk(chunk: Uint16Array): void {
    if (!this.asteroids || !this.manifest) return;
    this.asteroids.append(chunk);
    const copy = chunk.slice();
    const msg: PickRequest = { type: 'chunk', data: copy, aRange: this.manifest.aRange };
    this.pickWorker.postMessage(msg, [copy.buffer]);
  }

  /** The largest bodies of the catalogue (dwarf planets, Ceres, Vesta...), labelled. */
  setNamed(list: NamedBody[], labelText: (n: NamedBody) => string): void {
    if (!this.asteroids || !this.manifest) return;
    this.named = list;
    for (const n of list) {
      const rec = decodeRecord(this.asteroids.data, n.index, this.manifest);
      this.namedOrbits.set(n.index, recordOrbit(rec, this.manifest));
      this.labels.upsert({
        id: `asteroid:${n.index}`,
        text: labelText(n),
        color: '#c9d3e3',
        priority: 50 - rec.h,
        onClick: () => this.selectAndFly({ kind: 'asteroid', index: n.index }),
      });
    }
  }

  setComets(rows: Parameters<Comets['set']>[0]): void {
    this.comets.set(rows);
    this.sky.setComets(this.comets.list);
  }

  setStreams(file: StreamsFile): void {
    // Each measured orbit becomes several particles spread along it (an old stream
    // fills its whole orbit), a little jittered so they do not sit on one curve.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pts: OrbitPoint[] = [];
    SHOWERS.forEach((s, g) => {
      const orbits = file.showers[s.code]?.orbits ?? [];
      for (const [q, e, i, node, peri] of orbits) {
        const a = q / (1 - e);
        if (!(a > 0) || a > 60) continue;
        for (let k = 0; k < 6; k++) {
          const j = 1 + (rand() - 0.5) * 0.04;
          pts.push({
            a: a * j, e, i: (i * Math.PI) / 180, node: (node * Math.PI) / 180, peri: (peri * Math.PI) / 180,
            m0: rand() * Math.PI * 2, tStart: -Infinity, tEnd: Infinity, group: g, size: 1.6,
          });
        }
      }
    });
    this.streams.set(pts);
  }

  setMeteors(list: Meteor[]): void {
    // Meteoroids on the heliocentric orbits GMN measured, on their way in during
    // the 30 days before they hit the atmosphere.
    this.meteorRefJd = list.length ? list[list.length - 1].jd : 0;
    const pts: OrbitPoint[] = [];
    for (const m of list) {
      if (!(m.e < 0.98) || m.q <= 0) continue;
      const o = orbitFromTrue(m.q, m.e, m.i, m.node, m.peri, m.f, m.jd);
      const a = m.q / (1 - m.e);
      const n = 0.01720209895 / Math.pow(a, 1.5);
      const tHit = m.jd - this.meteorRefJd;
      const g = SHOWERS.findIndex((s) => s.code === m.shower);
      pts.push({
        a, e: m.e, i: o.i, node: o.node, peri: o.peri,
        m0: n * (this.meteorRefJd - o.tp),
        tStart: tHit - 30, tEnd: tHit, group: g >= 0 ? g : EARTH_SHOWER_GROUP, size: 2.2,
      });
    }
    this.meteoroids.set(pts);
    this.surface.setMeteors(list);
    this.sky.setMeteors(list);
  }

  setCraft(list: Craft[]): void {
    this.craft.setCraft(list);
    this.sky.setCraft(list);
  }

  setFireballs(list: Fireball[]): void {
    this.surface.setFireballs(list);
  }

  setApproaches(list: Approach[], labelText: (a: Approach) => string): void {
    this.approaches = list;
    for (const a of list) {
      this.labels.upsert({
        id: `approach:${a.des}`,
        text: labelText(a),
        color: '#ffb547',
        priority: 65,
        onClick: () => this.selectAndFly({ kind: 'approach', des: a.des }),
      });
    }
  }

  setLayers(l: { orbits: boolean; labels: boolean; asteroids: boolean[]; comets: boolean; streams: boolean; meteors: boolean; approaches: boolean; craft: boolean }): void {
    this.layers = { orbits: l.orbits, labels: l.labels, comets: l.comets, streams: l.streams, meteors: l.meteors, approaches: l.approaches, craft: l.craft };
    this.craft.visible = l.craft;
    this.asteroids?.setMask(l.asteroids);
    this.comets.group.visible = l.comets;
    this.streams.points.visible = l.streams;
    this.meteoroids.points.visible = l.meteors;
    this.labels.root.classList.toggle('hidden', !l.labels || this.skyMode);
  }

  /** Switches between the Solar System and the sky from the observer's place. */
  setMode(mode: 'space' | 'sky'): void {
    this.skyMode = mode === 'sky';
    this.sky.setActive(this.skyMode);
    this.controls.enabled = !this.skyMode;
    this.labels.root.classList.toggle('hidden', !this.layers.labels || this.skyMode);
    this.lastRender = 0;
  }

  setHMax(h: number): void {
    if (this.asteroids) this.asteroids.material.uniforms.uHMax.value = h;
  }

  setBodyLabel(id: BodyId, text: string): void {
    const b = BODY_BY_ID[id];
    this.labels.upsert({ id: `body:${id}`, text, color: b.color, priority: LABEL_PRIORITY[id], onClick: () => this.selectAndFly({ kind: 'body', id }) });
  }

  // ---------------------------------------------------------------- targets

  /** Heliocentric ecliptic position of a target now, or null if unknown. */
  targetPosition(t: Target, jd: number, out: Vec3): Vec3 | null {
    switch (t.kind) {
      case 'body': {
        const p = this.bodyPos.get(t.id)!;
        out[0] = p[0]; out[1] = p[1]; out[2] = p[2];
        return out;
      }
      case 'asteroid': {
        const o = this.asteroidOrbit(t.index);
        return o ? positionAt(o, jd, out) : null;
      }
      case 'comet': {
        const c = this.comets.list[t.index];
        return c ? positionAt(c.orbit, jd, out) : null;
      }
      case 'approach': {
        const tr = this.tracks.get(t.des);
        return tr ? trackPosition(tr, jd, out) : null;
      }
      case 'craft': {
        const c = this.craft.get(t.id);
        return c ? craftFix(c, jd, this.bodyAtJd(jd), out)?.pos ?? null : null;
      }
    }
  }

  /** Body positions at any jd: this frame's when it matches, computed otherwise. */
  bodyAtJd(jd: number): (id: BodyId) => Vec3 {
    if (jd === this.frameJd) return (id) => this.bodyPos.get(id)!;
    const at = astroTime(msFromJdTT(jd));
    const cache = new Map<BodyId, Vec3>();
    return (id) => {
      let p = cache.get(id);
      if (!p) cache.set(id, (p = bodyPosition(id, at)));
      return p;
    };
  }

  asteroidOrbit(index: number): Orbit | null {
    if (!this.asteroids || !this.manifest || index >= this.asteroids.loaded) return null;
    let o = this.namedOrbits.get(index);
    if (!o) o = recordOrbit(decodeRecord(this.asteroids.data, index, this.manifest), this.manifest);
    return o;
  }

  private targetRadius(t: Target): number {
    return t.kind === 'body' ? BODY_BY_ID[t.id].radiusKm / KM_PER_AU : t.kind === 'craft' ? 1e-9 : 2e-6;
  }

  private defaultDistance(t: Target): number {
    if (t.kind === 'body') {
      const r = this.targetRadius(t);
      return t.id === 'sun' ? 10.5 : t.id === 'saturn' ? r * 7 : r * 4.2;
    }
    if (t.kind === 'approach') {
      const a = this.approaches.find((x) => x.des === t.des);
      return Math.max(0.0012, (a?.distAu ?? 0.01) * 2.2);
    }
    if (t.kind === 'craft') {
      // Near a planet: frame the craft with the planet; in cruise: show its path.
      const jd = jdTT(this.clock.now());
      const c = this.craft.get(t.id);
      const bodyAt = this.bodyAtJd(jd);
      const fix = c ? craftFix(c, jd, bodyAt) : null;
      if (fix?.pinned) return (BODY_BY_ID[fix.center].radiusKm / KM_PER_AU) * 5;
      if (fix && fix.center !== 'sun') {
        const b = bodyAt(fix.center);
        const d = Math.hypot(fix.pos[0] - b[0], fix.pos[1] - b[1], fix.pos[2] - b[2]);
        return Math.max((BODY_BY_ID[fix.center].radiusKm / KM_PER_AU) * 4, Math.min(d * 2.6, 0.08));
      }
      return 0.6;
    }
    return t.kind === 'comet' ? 0.25 : 0.06;
  }

  select(t: Target | null): void {
    this.selected = t;
    this.selOrbit = null;
    this.selLine.clear();
    this.labels.selectedId = t ? targetKey(t) : null;
    this.craft.selectedId = t?.kind === 'craft' ? t.id : null;
    if (t && (t.kind === 'asteroid' || t.kind === 'comet')) {
      const o = t.kind === 'asteroid' ? this.asteroidOrbit(t.index) : this.comets.list[t.index]?.orbit ?? null;
      if (o) {
        this.selOrbit = o;
        const pts = orbitPath(o, 720, 60);
        this.selLine.set(pts);
        this.selLine.color = t.kind === 'comet' ? '#9ff2e0' : '#ffffff';
      }
    }
    if (t?.kind === 'approach') this.ensureTrack(t.des, true);
    this.lastTelemetry = 0;
    this.events.onSelect(t);
  }

  selectAndFly(t: Target): void {
    this.select(t);
    this.flyTo(t);
  }

  flyTo(t: Target, distance?: number, seconds = 1.8): void {
    if (t.kind === 'approach') this.ensureTrack(t.des, true);
    const d0 = this.camera.position.length();
    this.focus = t;
    this.fly = { from: [...this.origin] as Vec3, t0: performance.now(), dur: seconds * 1000, d0, d1: distance ?? this.defaultDistance(t) };
    this.controls.minDistance = this.targetRadius(t) * 1.08;
    this.events.onFocus(t);
  }

  /**
   * Tracks load one at a time (Horizons, behind our cache, dislikes bursts); a
   * selected approach jumps the queue. Failures are retried after a while.
   */
  private trackQueue: string[] = [];
  private trackBusy = false;
  private trackRetryAt = new Map<string, number>();

  private ensureTrack(des: string, urgent = false): void {
    if (this.tracks.get(des)) return;
    if ((this.trackRetryAt.get(des) ?? 0) > performance.now()) return;
    const at = this.trackQueue.indexOf(des);
    if (at >= 0) {
      if (!urgent) return;
      this.trackQueue.splice(at, 1);
    }
    if (urgent) this.trackQueue.unshift(des);
    else this.trackQueue.push(des);
    void this.pumpTracks();
  }

  private async pumpTracks(): Promise<void> {
    if (this.trackBusy) return;
    this.trackBusy = true;
    try {
      while (this.trackQueue.length) {
        const des = this.trackQueue.shift()!;
        const a = this.approaches.find((x) => x.des === des);
        if (!a || this.tracks.get(des)) continue;
        const tr = await loadTrack(des, a.jdTT);
        if (!tr) {
          this.trackRetryAt.set(des, performance.now() + 120_000);
          continue;
        }
        this.tracks.set(des, tr);
        const line = new Polyline({ color: '#ffb547', width: 1.3, opacity: 0.55, maxPoints: tr.rows.length });
        line.set(tr.rows.map((r) => [r[1], r[2], r[3]] as Vec3));
        line.setResolution(this.width, this.height);
        this.trackLines.set(des, line);
        this.scene.add(line.mesh);
      }
    } finally {
      this.trackBusy = false;
    }
  }

  /** Approaches within a few days of the simulated time get their JPL tracks loaded, nearest first. */
  private refreshTracks(simMs: number): void {
    const near = this.approaches
      .filter((a) => Math.abs(a.ms - simMs) < 5.5 * 86_400_000)
      .sort((a, b) => Math.abs(a.ms - simMs) - Math.abs(b.ms - simMs));
    for (const a of near) this.ensureTrack(a.des);
  }

  // ---------------------------------------------------------------- input

  private onPointerDown = (e: PointerEvent): void => {
    this.downAt.set(e.clientX, e.clientY);
    this.downTime = performance.now();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || this.skyMode) return;
    const moved = this.downAt.distanceTo(this.v2(e.clientX, e.clientY));
    if (moved > 5 || performance.now() - this.downTime > 600) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pick(e.clientX - rect.left, e.clientY - rect.top);
  };

  private onDoubleClick = (): void => {
    if (this.selected && !this.skyMode) this.flyTo(this.selected);
  };

  private v2(x: number, y: number): THREE.Vector2 {
    return new THREE.Vector2(x, y);
  }

  private project(rel: THREE.Vector3): { x: number; y: number; ok: boolean } {
    this.v3b.copy(rel).project(this.camera);
    return {
      x: (this.v3b.x * 0.5 + 0.5) * this.width,
      y: (0.5 - this.v3b.y * 0.5) * this.height,
      ok: this.v3b.z < 1 && this.v3b.z > -1,
    };
  }

  private relThree(p: Vec3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(p[0] - this.origin[0], p[2] - this.origin[2], -(p[1] - this.origin[1]));
  }

  private pick(x: number, y: number): void {
    const jd = jdTT(this.clock.now());
    // Bodies first (their disc or a few pixels around the dot).
    let best: Target | null = null;
    let bestD = 12;
    for (const b of BODIES) {
      const s = this.project(this.relThree(this.bodyPos.get(b.id)!, this.v3));
      if (!s.ok) continue;
      const d = Math.hypot(s.x - x, s.y - y) - this.discPx(b.id);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'body', id: b.id };
      }
    }
    if (best) return this.select(best);
    for (const [id, p] of this.craft.all()) {
      const s = this.project(this.relThree(p, this.v3));
      const d = Math.hypot(s.x - x, s.y - y);
      if (s.ok && d < 8 && d < bestD) {
        bestD = d;
        best = { kind: 'craft', id };
      }
    }
    if (best) return this.select(best);
    if (this.layers.comets) {
      const h = this.comets.helio;
      for (let k = 0; k < this.comets.list.length; k++) {
        this.tmp[0] = h[k * 3]; this.tmp[1] = h[k * 3 + 1]; this.tmp[2] = h[k * 3 + 2];
        const s = this.project(this.relThree(this.tmp, this.v3));
        if (!s.ok) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < 7 && d < bestD) {
          bestD = d;
          best = { kind: 'comet', index: k };
        }
      }
      if (best) return this.select(best);
    }
    if (!this.asteroids || !this.manifest) return this.select(null);
    const vp = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const req: PickRequest = {
      type: 'pick',
      id: ++this.pickId,
      dtDays: jd - this.manifest.epochJd,
      origin: [...this.origin] as [number, number, number],
      viewProj: new Float32Array(vp.elements),
      x, y,
      width: this.width,
      height: this.height,
      radiusPx: 9,
      mask: (this.asteroids.material.uniforms.uMask.value as number[]).map((v) => v > 0.5),
      hMax: this.asteroids.material.uniforms.uHMax.value as number,
    };
    this.pickWorker.postMessage(req);
  }

  /** Projected radius of a body's disc, px. */
  private discPx(id: BodyId): number {
    const r = BODY_BY_ID[id].radiusKm / KM_PER_AU;
    const d = this.relThree(this.bodyPos.get(id)!, this.v3b).distanceTo(this.camera.position);
    const f = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    return (r / Math.max(d, 1e-12)) * f;
  }

  // ---------------------------------------------------------------- frame

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.width = w;
    this.height = h;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const { line } of this.orbitLines.values()) line.setResolution(w, h);
    this.selLine.setResolution(w, h);
    for (const l of this.trackLines.values()) l.setResolution(w, h);
    this.craft.setResolution(w, h);
    this.sky.resize(w, h, this.pixelRatio);
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.skyMode) {
      if (this.sky.frame(now, this.renderer, this.clock.now(), this.clock.warp)) this.countFrame(now);
      return;
    }
    const active = !!this.fly || now - this.lastActive < 500 || Math.abs(this.clock.warp) > 60 || now - this.lastRender > 1000;
    if (!active && now - this.lastRender < 70) {
      this.lastFrameAt = 0;
      return;
    }
    this.adaptBudget(now, active);
    this.lastRender = now;
    const simMs = this.clock.now();
    const at = astroTime(simMs);
    const jd = jdTT(simMs);

    if (this.clock.epoch !== this.clockEpoch) {
      this.clockEpoch = this.clock.epoch;
      for (const o of this.orbitLines.values()) o.at = -Infinity;
      this.refreshTracks(simMs);
    }

    for (const b of BODIES) bodyPosition(b.id, at, this.bodyPos.get(b.id)!);
    this.frameJd = jd;

    // Origin: follow the focus, or glide toward it during a flight.
    const target = this.targetPosition(this.focus, jd, this.tmp2) ?? this.origin;
    if (this.fly) {
      const s = Math.min(1, (now - this.fly.t0) / this.fly.dur);
      const k = ease(s);
      for (let c = 0; c < 3; c++) this.origin[c] = this.fly.from[c] + (target[c] - this.fly.from[c]) * k;
      const d = Math.exp(Math.log(this.fly.d0) + (Math.log(this.fly.d1) - Math.log(this.fly.d0)) * k);
      this.camera.position.setLength(d);
      if (s >= 1) this.fly = null;
      this.controls.enabled = !this.fly;
    } else {
      this.origin[0] = target[0];
      this.origin[1] = target[1];
      this.origin[2] = target[2];
    }
    this.controls.update();
    this.camera.updateMatrixWorld();

    const camDist = this.camera.position.length();
    const pr = this.pixelRatio;

    // Bodies.
    for (const b of BODIES) {
      const rel = this.relThree(this.bodyPos.get(b.id)!, this.v3);
      this.bodies.place(b.id, rel, bodyOrientation(b.id, at));
    }
    const sunRel = this.relThree(this.bodyPos.get('sun')!, this.v3);
    const earthRel = this.relThree(this.bodyPos.get('earth')!, this.v3b);
    this.bodies.updateEarth(sunRel.clone().sub(earthRel).normalize(), simMs);
    this.bodies.updateGlow(this.discPx('sun'), this.height);

    // Orbit lines (recomputed when the body has moved a twentieth of its orbit).
    for (const [id, o] of this.orbitLines) {
      const period = orbitalPeriodDays(id) * 86_400_000;
      if (Math.abs(simMs - o.at) > period / 20) {
        o.line.set(bodyOrbitPath(id, simMs, id === 'moon' ? 180 : 512));
        o.at = simMs;
      }
      const parent = BODY_BY_ID[id].parent!;
      o.line.setOffset(this.relThree(this.bodyPos.get(parent)!, this.v3));
      o.line.head = 0.5 + (simMs - o.at) / period;
      // The Moon's orbit only when it spans a useful size on screen; planets fade when tiny.
      const spanPx = this.orbitPx(id === 'moon' ? 0.00257 : Math.hypot(...this.bodyPos.get(id)!), parent, camDist);
      let op = (this.layers.orbits ? 1 : 0) * Math.min(0.75, Math.max(0, (spanPx - 12) / 60));
      // Close to a body its own orbit runs through the camera: fade it out.
      if (this.focus.kind === 'body' && this.focus.id === id) op *= Math.min(1, Math.max(0, (camDist - 0.004) / 0.03));
      o.line.opacity = op;
      o.line.mesh.visible = o.line.material.uniforms.uOpacity.value > 0.001;
    }

    // Selected orbit and approach tracks hang off the Sun.
    const sunOff = this.relThree([0, 0, 0], this.v3);
    this.selLine.setOffset(sunOff);
    if (this.selOrbit && this.selOrbit.e < 0.99) {
      const P = periodDays(this.selOrbit);
      const frac = (((jd - this.selOrbit.tp) / P) % 1 + 1) % 1;
      this.selLine.head = frac;
    } else this.selLine.head = 0.5;
    const selDes = this.selected?.kind === 'approach' ? this.selected.des : null;
    for (const [des, l] of this.trackLines) {
      const a = this.approaches.find((x) => x.des === des);
      const near = !!a && Math.abs(a.ms - simMs) < 3 * 86_400_000;
      l.setOffset(sunOff);
      l.mesh.visible = this.layers.approaches && (near || des === selDes);
      l.opacity = des === selDes ? 0.9 : 0.12;
    }

    // Small bodies.
    const gain = Math.min(1.6, Math.max(0.45, 1.05 - 0.3 * Math.log10(camDist / 2)));
    if (this.asteroids && this.manifest) this.asteroids.update(jd - this.manifest.epochJd, this.origin, pr, gain);
    if (this.layers.comets) this.comets.update(jd, this.origin, pr);
    this.streams.update(jd - 2461000.5, this.origin, pr);
    if (now - this.lastStreamGain > 2000) {
      // Streams the Earth is crossing now stand out; the rest stay a faint context.
      this.lastStreamGain = now;
      const e = this.bodyPos.get('earth')!;
      const solarLon = ((Math.atan2(-e[1], -e[0]) * 180) / Math.PI + 360) % 360;
      SHOWERS.forEach((sh, g) => this.streams.setGain(g, showerActive(sh, solarLon) ? 0.5 : 0.06));
    }
    this.meteoroids.update(jd - this.meteorRefJd, this.origin, pr);
    this.surface.update(simMs, pr, this.layers.meteors);
    this.craft.update(
      jd,
      camDist,
      (id) => this.bodyPos.get(id)!,
      (p, out) => this.relThree(p, out),
      (p) => this.project(this.relThree(p, this.v3)),
    );
    this.stars?.update(pr, 1);

    this.updateLabels(jd, camDist);
    this.updateTelemetry(now, jd, simMs);

    this.renderer.render(this.scene, this.camera);
    this.countFrame(now);
  };

  private countFrame(now: number): void {
    this.fpsFrames++;
    if (now - this.fpsSince > 2000) {
      this.events.onFps((this.fpsFrames * 1000) / (now - this.fpsSince));
      this.fpsFrames = 0;
      this.fpsSince = now;
    }
  }

  private adaptBudget(now: number, active: boolean): void {
    const ast = this.asteroids;
    if (!ast) return;
    if (this.lastFrameAt) this.frameMs += (Math.min(now - this.lastFrameAt, 200) - this.frameMs) * 0.15;
    this.lastFrameAt = active ? now : 0;
    if (active && !this.forceFull && ast.loaded > 200_000) {
      if (this.frameMs > 21 && this.budget > 150_000) this.budget = Math.max(150_000, Math.min(this.budget, ast.loaded) * 0.82);
      else if (this.frameMs < 17.5 && this.budget < ast.loaded) this.budget *= 1.06;
    }
    ast.setDrawCount(active && !this.forceFull ? Math.min(ast.loaded, this.budget) : ast.loaded);
  }

  /** Asteroids drawn right now and in total (for the UI). */
  drawStats(): { drawn: number; loaded: number } {
    const ast = this.asteroids;
    return { drawn: ast ? ast.drawCount : 0, loaded: ast ? ast.loaded : 0 };
  }

  /** Rough on-screen size of an orbit of radius r around a parent, px. */
  private orbitPx(r: number, parent: BodyId, camDist: number): number {
    const d = Math.max(this.relThree(this.bodyPos.get(parent)!, this.v3b).distanceTo(this.camera.position), camDist * 0.2);
    const f = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    return (r / d) * f;
  }

  private updateLabels(jd: number, camDist: number): void {
    if (!this.layers.labels) return;
    for (const b of BODIES) {
      const id = `body:${b.id}`;
      const rel = this.relThree(this.bodyPos.get(b.id)!, this.v3);
      const s = this.project(rel);
      const disc = this.discPx(b.id);
      // Moons and satellites crowd their planet: only near it.
      let vis = s.ok;
      if (b.id === 'moon') vis = vis && this.orbitPx(0.00257, 'earth', camDist) > 30;
      this.labels.place(id, s.x, s.y, vis, disc);
    }
    for (const n of this.named) {
      const o = this.namedOrbits.get(n.index);
      if (!o) continue;
      const s = this.project(this.relThree(positionAt(o, jd, this.tmp), this.v3));
      this.labels.place(`asteroid:${n.index}`, s.x, s.y, s.ok);
    }
    for (const a of this.approaches) {
      const id = `approach:${a.des}`;
      const tr = this.tracks.get(a.des);
      const near = Math.abs(a.ms - this.clock.now()) < 3 * 86_400_000 || targetKey(this.selected) === id;
      const p = tr && near ? trackPosition(tr, jd, this.tmp) : null;
      if (!p || !this.layers.approaches) {
        this.labels.place(id, 0, 0, false);
        continue;
      }
      const s = this.project(this.relThree(p, this.v3));
      this.labels.place(id, s.x, s.y, s.ok);
    }
    // A label for whatever is selected among the many unnamed points.
    const sel = this.selected;
    if (sel && (sel.kind === 'asteroid' || sel.kind === 'comet')) {
      const key = targetKey(sel);
      if (this.labels.has(key)) {
        const p = this.targetPosition(sel, jd, this.tmp);
        if (p) {
          const s = this.project(this.relThree(p, this.v3));
          this.labels.place(key, s.x, s.y, s.ok);
        }
      }
    }
    this.labels.layout(this.width, this.height);
  }

  /** Adds (or renames) the floating label of the selected small body. */
  labelSelected(t: Target, text: string, color: string): void {
    this.labels.removeWhere((id) => id.startsWith('sel:'));
    const key = targetKey(t);
    if (this.named.some((n) => `asteroid:${n.index}` === key)) return;
    if (t.kind === 'asteroid' || t.kind === 'comet') {
      this.labels.removeWhere((id) => (id.startsWith('asteroid:') || id.startsWith('comet:')) && !this.named.some((n) => `asteroid:${n.index}` === id));
      this.labels.upsert({ id: key, text, color, priority: 200, onClick: () => this.flyTo(t) });
    }
  }

  private updateTelemetry(now: number, jd: number, simMs: number): void {
    if (now - this.lastTelemetry < 250) return;
    this.lastTelemetry = now;
    this.refreshTracks(simMs);
    const t = this.selected;
    if (!t) {
      this.events.onTelemetry(null);
      return;
    }
    const p = this.targetPosition(t, jd, [0, 0, 0]);
    if (!p) {
      this.events.onTelemetry({ key: targetKey(t), sunAu: NaN, earthAu: null, speedKms: null, lightSec: null });
      return;
    }
    const dtDay = 1 / 1440;
    const q = this.targetPosition(t, jd + dtDay, [0, 0, 0]);
    let speed: number | null = null;
    if (q && t.kind !== 'body') speed = (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / dtDay) * KM_PER_AU / 86400;
    if (t.kind === 'body' && t.id !== 'sun') {
      const at2 = astroTime(simMs + 60_000);
      const q2 = bodyPosition(t.id, at2);
      speed = (Math.hypot(q2[0] - p[0], q2[1] - p[1], q2[2] - p[2]) / dtDay) * KM_PER_AU / 86400;
    }
    const e = this.bodyPos.get('earth')!;
    const earthAu = t.kind === 'body' && t.id === 'earth' ? null : Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]);
    let rel: Telemetry['rel'] = null;
    let pinned = false;
    if (t.kind === 'craft') {
      const fix = this.craft.fix(t.id);
      pinned = !!fix?.pinned;
      if (fix && !fix.pinned && fix.center !== 'sun' && q) {
        // Relative to the body it orbits or flies past.
        const b0 = this.bodyPos.get(fix.center)!;
        const b1 = this.bodyAtJd(jd + dtDay)(fix.center);
        const d = Math.hypot(p[0] - b0[0], p[1] - b0[1], p[2] - b0[2]);
        const dv = Math.hypot(q[0] - b1[0] - (p[0] - b0[0]), q[1] - b1[1] - (p[1] - b0[1]), q[2] - b1[2] - (p[2] - b0[2]));
        if (d < 0.05) rel = { body: fix.center, distAu: d, speedKms: (dv / dtDay) * KM_PER_AU / 86400 };
      }
      if (pinned) speed = null;
    }
    this.events.onTelemetry({
      rel,
      pinned,
      key: targetKey(t),
      sunAu: Math.hypot(p[0], p[1], p[2]),
      earthAu,
      speedKms: speed,
      lightSec: earthAu === null ? null : (earthAu * KM_PER_AU) / 299_792.458,
    });
  }

  /** Earth's heliocentric position now (for the UI: solar longitude etc.). */
  earthPosition(): Vec3 {
    return [...this.bodyPos.get('earth')!] as Vec3;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.pickWorker.terminate();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
