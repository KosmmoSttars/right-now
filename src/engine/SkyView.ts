// The planetarium: the sky from one place on the Earth at the simulated time. The
// camera stands at the centre of a dome and only turns; everything is a direction.
// Scene frame: x = east, y = up, z = south (see src/sim/sky.ts). Stars, constellation
// lines, the ecliptic and shower radiants live in a group rotated from J2000 to the
// local sky each frame; planets, the Moon, meteors and the grid are placed directly.
import * as THREE from 'three';
import type { Craft } from '../sim/craft';
import { craftFix } from '../sim/craft';
import { positionAt, type Vec3 } from '../sim/kepler';
import type { Meteor, Shower } from '../sim/live';
import { BODY_BY_ID, KM_PER_AU, astroTime, bodyPosition, type BodyId } from '../sim/planets';
import { DEG, NAMED_STARS, RADIANTS, altAzToDir, applyRow, bodySky, eqjToScene, groundKm, limitingMag, raDecToEqj, topocentric, type BodySky, type Place } from '../sim/sky';
import { jdTT } from '../sim/time';
import type { Comet } from './Comets';
import { Labels } from './Labels';

const R = 1000; // dome radius (directions only; the camera never moves)
const SKY_BODIES: BodyId[] = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const OBLIQUITY = 23.4392911 * DEG;

export type SkySel =
  | { kind: 'body'; id: BodyId }
  | { kind: 'star'; index: number }
  | { kind: 'craft'; id: string }
  | { kind: 'comet'; index: number }
  | { kind: 'radiant'; code: string };

export const skySelKey = (s: SkySel | null): string =>
  !s ? '' : s.kind === 'body' || s.kind === 'craft' ? `${s.kind}:${s.id}` : s.kind === 'radiant' ? `radiant:${s.code}` : `${s.kind}:${s.index}`;

export interface SkyLayers {
  ground: boolean;
  grid: boolean;
  constellations: boolean;
  names: boolean;
  showers: boolean;
  meteors: boolean;
  craft: boolean;
}

export interface ConstellationFile {
  constellations: { id: string; en: string; ru: string; label: [number, number] | null; lines: [number, number][][] }[];
}

export interface SkyEvents {
  onSelect: (s: SkySel | null) => void;
}

const domeVertex = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

// Sky brightness from the Sun's altitude: night, a twilight glow on the Sun's side
// of the horizon, a blue day, and a halo around the Sun itself.
const domeFragment = /* glsl */ `
out highp vec4 fragColor;
in vec3 vDir;
uniform vec3 uSun;
void main() {
  vec3 d = normalize(vDir);
  float s = uSun.y;                         // sine of the Sun's altitude
  float h = max(d.y, 0.0);
  float day = smoothstep(-0.1, 0.22, s);
  float tw = smoothstep(-0.31, -0.03, s) * (1.0 - day);
  vec2 sd = normalize(uSun.xz + 1e-5);
  vec2 dd = normalize(d.xz + 1e-5);
  float toward = max(dot(sd, dd), 0.0);
  vec3 night = vec3(0.004, 0.006, 0.014) + vec3(0.012, 0.016, 0.03) * pow(1.0 - h, 4.0);
  vec3 dusk = mix(vec3(0.03, 0.05, 0.12), vec3(0.95, 0.45, 0.18), pow(1.0 - h, 5.0) * (0.25 + 0.75 * pow(toward, 2.5)));
  dusk = mix(dusk, vec3(0.05, 0.09, 0.2), smoothstep(0.0, 0.6, h) * 0.7);
  vec3 dayc = mix(vec3(0.55, 0.69, 0.86), vec3(0.12, 0.27, 0.56), pow(h, 0.45));
  vec3 col = night + dusk * tw + dayc * day;
  float ang = acos(clamp(dot(d, uSun), -1.0, 1.0));
  col += vec3(1.0, 0.85, 0.6) * (exp(-ang * 9.0) * 0.9 + exp(-ang * 2.5) * 0.25) * smoothstep(-0.12, 0.05, s);
  fragColor = vec4(col, 1.0);
}`;

const groundFragment = /* glsl */ `
out highp vec4 fragColor;
uniform float uLight;
void main() {
  fragColor = vec4(mix(vec3(0.010, 0.012, 0.016), vec3(0.11, 0.12, 0.11), uLight), 1.0);
}`;

const starVertex = /* glsl */ `
in float aMag;
in vec3 aColor;
uniform float uLim;
uniform float uPixelRatio;
uniform float uGround;
out vec3 vColor;
out float vA;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 d = normalize(world.xyz);
  // Extinction: stars dim toward the horizon (about 0.25 mag per airmass).
  float m = aMag + 0.2 / max(d.y + 0.04, 0.02) - 0.2;
  float vis = clamp((uLim - m) / 1.6, 0.0, 1.0);
  if (uGround > 0.5 && d.y < 0.0) vis = 0.0;
  vec4 p = projectionMatrix * viewMatrix * world;
  gl_Position = p;
  float b = pow(10.0, -0.4 * (m - 1.0));
  gl_PointSize = vis > 0.0 ? (2.0 + 5.0 * pow(b, 0.36)) * uPixelRatio : 0.0;
  vColor = aColor;
  vA = vis * clamp(0.5 + 0.5 * pow(b, 0.25), 0.0, 1.0);
}`;

const pointFragment = /* glsl */ `
out highp vec4 fragColor;
in vec3 vColor;
in float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA;
  if (a <= 0.003) discard;
  fragColor = vec4(vColor, a);
}`;

const bodyVertex = /* glsl */ `
in float aSize;
in float aAlpha;
in vec3 aColor;
uniform float uPixelRatio;
out vec3 vColor;
out float vA;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  vColor = aColor;
  vA = aAlpha;
}`;

const moonVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// A lit sphere seen from the observer: the phase comes from the Sun's direction in
// the billboard's frame (right, up, toward the viewer).
const moonFragment = /* glsl */ `
out highp vec4 fragColor;
in vec2 vUv;
uniform vec3 uSunLocal;
uniform sampler2D uMap;
uniform float uAlpha;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec3 n = vec3(vUv, sqrt(1.0 - r2));
  float lit = smoothstep(-0.04, 0.06, dot(n, uSunLocal));
  vec2 tuv = vec2(0.5 + atan(n.x, n.z) / 6.2831853, 0.5 + asin(n.y) / 3.1415927);
  vec3 tex = texture(uMap, tuv).rgb;
  vec3 col = tex * mix(0.05, 1.15, lit);
  float edge = 1.0 - smoothstep(0.92, 1.0, r2);
  fragColor = vec4(col, edge * uAlpha);
}`;

const streakVertex = /* glsl */ `
in float aT;
in float aEnd;
uniform float uNow;
uniform float uWindow;
out float vA;
out float vEnd;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  float age = uNow - aT;
  vA = age < 0.0 || age > uWindow ? 0.0 : 1.0 - age / uWindow;
  vEnd = aEnd;
}`;

const streakFragment = /* glsl */ `
out highp vec4 fragColor;
in float vA;
in float vEnd;
void main() {
  if (vA <= 0.0) discard;
  vec3 c = mix(vec3(0.9, 0.97, 1.0), vec3(1.0, 0.6, 0.25), vEnd);
  fragColor = vec4(c, vA * mix(1.0, 0.3, vEnd));
}`;

const lineFragment = /* glsl */ `
out highp vec4 fragColor;
uniform vec3 uColor;
uniform float uAlpha;
void main() { fragColor = vec4(uColor, uAlpha); }`;

const lineVertex = /* glsl */ `
void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

function lineMaterial(color: string, alpha: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const SPECTRAL = ['#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffcc6f'];

interface Marker {
  id: string;
  dir: [number, number, number];
  /** Shown at all (above the horizon, layer on...). */
  on: boolean;
}

export class SkyView {
  active = false;
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, R * 4);
  readonly labels: Labels;
  private scene = new THREE.Scene();
  private celestial = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private ground: THREE.Mesh;
  private groundMat: THREE.ShaderMaterial;
  private horizon: THREE.LineLoop;
  private grid: THREE.LineSegments;
  private constLines: THREE.LineSegments | null = null;
  private ecliptic: THREE.Line;
  private stars: THREE.Points | null = null;
  private starMat: THREE.ShaderMaterial;
  private starDirs = new Float32Array(0);
  private starMags = new Float32Array(0);
  private bodies: THREE.Points;
  private bodyMat: THREE.ShaderMaterial;
  private moon: THREE.Mesh;
  private moonMat: THREE.ShaderMaterial;
  private streaks: THREE.LineSegments;
  private streakMat: THREE.ShaderMaterial;
  private streakBase = Date.now();

  place: Place | null = null;
  layers: SkyLayers = { ground: true, grid: false, constellations: true, names: true, showers: true, meteors: true, craft: true };
  lang: 'en' | 'ru' = 'en';
  /** View direction (degrees) and field of view. */
  az = 180;
  alt = 25;
  fov = 75;
  private vel = { az: 0, alt: 0 };
  private anim: { az0: number; alt0: number; fov0: number; az1: number; alt1: number; fov1: number; t0: number } | null = null;

  /** This frame's positions, for picking and the UI. */
  sky = new Map<BodyId, BodySky>();
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private namedIdx: number[] = [];
  private markers: Marker[] = [];
  private comets: Comet[] = [];
  private craft: Craft[] = [];
  private showers: Shower[] = [];
  private meteors: Meteor[] = [];
  private constellations: ConstellationFile | null = null;
  private selected: SkySel | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private lastRender = 0;
  private lastInput = 0;
  private lastSlow = 0;
  /** 0 in daylight, 1 once the sky is dark (fades constellations in). */
  private darkness = 1;
  private dragging: { x: number; y: number; t: number; moved: number; pointers: Map<number, { x: number; y: number }>; pinch: number } | null = null;

  constructor(container: HTMLElement, private canvas: HTMLCanvasElement, private events: SkyEvents, moonMap: THREE.Texture) {
    this.labels = new Labels(container);
    this.labels.root.classList.add('sky-labels', 'hidden');
    this.camera.rotation.order = 'YXZ';

    this.domeMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: domeVertex, fragmentShader: domeFragment,
      uniforms: { uSun: { value: new THREE.Vector3(0, -1, 0) } }, side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.5, 64, 32), this.domeMat);
    this.dome.renderOrder = -20;
    this.dome.frustumCulled = false;

    this.groundMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: lineVertex, fragmentShader: groundFragment,
      uniforms: { uLight: { value: 0 } }, side: THREE.BackSide, depthWrite: false, depthTest: false,
      // Transparent so it is drawn in order after the (transparent) sky contents.
      transparent: true,
    });
    this.ground = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9, 64, 16, 0, Math.PI * 2, Math.PI / 2 + 0.0005, Math.PI / 2), this.groundMat);
    this.ground.renderOrder = 50;
    this.ground.frustumCulled = false;

    const hz: number[] = [];
    for (let k = 0; k < 360; k++) hz.push(...altAzToDir(0, k).map((v) => v * R * 0.89));
    this.horizon = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(hz, 3)), lineMaterial('#6fa0c8', 0.55));
    this.horizon.renderOrder = 51;

    // Alt-azimuth grid: altitude circles every 15°, azimuth lines every 15°.
    const g: number[] = [];
    const seg = (a0: number, z0: number, a1: number, z1: number) => g.push(...altAzToDir(a0, z0).map((v) => v * R * 0.95), ...altAzToDir(a1, z1).map((v) => v * R * 0.95));
    for (let alt = 15; alt < 90; alt += 15) for (let az = 0; az < 360; az += 3) seg(alt, az, alt, az + 3);
    for (let az = 0; az < 360; az += 15) for (let alt = 0; alt < 87; alt += 3) seg(alt, az, alt + 3, az);
    this.grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(g, 3)), lineMaterial('#4f8fb0', 0.22));
    this.grid.frustumCulled = false;

    // The ecliptic, in J2000 equatorial coordinates.
    const ec: number[] = [];
    for (let k = 0; k <= 360; k += 2) {
      const l = k * DEG;
      ec.push(Math.cos(l) * R * 0.97, Math.sin(l) * Math.cos(OBLIQUITY) * R * 0.97, Math.sin(l) * Math.sin(OBLIQUITY) * R * 0.97);
    }
    this.ecliptic = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ec, 3)), lineMaterial('#d9a35c', 0.28));
    this.ecliptic.frustumCulled = false;
    this.celestial.matrixAutoUpdate = false;
    this.celestial.add(this.ecliptic);

    this.starMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: starVertex, fragmentShader: pointFragment,
      uniforms: { uLim: { value: 6 }, uPixelRatio: { value: 1 }, uGround: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });

    this.bodyMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: bodyVertex, fragmentShader: pointFragment,
      uniforms: { uPixelRatio: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const bg = new THREE.BufferGeometry();
    const nb = SKY_BODIES.length + 12; // + bright comets
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nb * 3), 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(nb), 1).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(nb), 1).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(nb * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.bodies = new THREE.Points(bg, this.bodyMat);
    this.bodies.frustumCulled = false;
    this.bodies.renderOrder = 10;

    moonMap.colorSpace = THREE.SRGBColorSpace;
    this.moonMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: moonVertex, fragmentShader: moonFragment,
      uniforms: { uSunLocal: { value: new THREE.Vector3(1, 0, 0) }, uMap: { value: moonMap }, uAlpha: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.moonMat);
    this.moon.renderOrder = 12;
    this.moon.frustumCulled = false;

    this.streakMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: streakVertex, fragmentShader: streakFragment,
      uniforms: { uNow: { value: 0 }, uWindow: { value: 2 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.streaks = new THREE.LineSegments(new THREE.BufferGeometry(), this.streakMat);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 11;

    this.scene.add(this.dome, this.grid, this.celestial, this.bodies, this.moon, this.streaks, this.ground, this.horizon);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    for (const [k, name] of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].entries()) {
      this.labels.upsert({ id: `compass:${name}`, text: name, color: '#9fc4e8', priority: 300 - k, cls: 'compass', dot: false });
    }
  }

  // ---------------------------------------------------------------- data

  setStars(catalog: [number, number, number, number][]): void {
    const n = catalog.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    this.starMags = new Float32Array(n);
    this.starDirs = new Float32Array(n * 3);
    const c = new THREE.Color();
    catalog.forEach(([ra, dec, mag, cls], k) => {
      const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
      this.starDirs.set(v, k * 3);
      pos.set(v.map((x) => x * R * 0.98), k * 3);
      c.set(SPECTRAL[cls] ?? '#ffffff');
      col.set([c.r, c.g, c.b], k * 3);
      this.starMags[k] = mag;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(this.starMags, 1));
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 5;
    this.celestial.add(this.stars);

    // Named stars: the catalogue entry nearest to each listed position.
    this.namedIdx = NAMED_STARS.map(([, , raH, decD]) => {
      const v = raDecToEqj(raH * 15, decD);
      let best = -1;
      let bestDot = Math.cos(0.4 * DEG);
      for (let k = 0; k < n; k++) {
        if (this.starMags[k] > 4) continue;
        const d = this.starDirs[k * 3] * v[0] + this.starDirs[k * 3 + 1] * v[1] + this.starDirs[k * 3 + 2] * v[2];
        if (d > bestDot) {
          bestDot = d;
          best = k;
        }
      }
      return best;
    });
    this.relabel();
  }

  setConstellations(file: ConstellationFile): void {
    this.constellations = file;
    const pts: number[] = [];
    for (const c of file.constellations) {
      for (const line of c.lines) {
        for (let k = 0; k < line.length - 1; k++) {
          pts.push(...raDecToEqj(line[k][0], line[k][1]).map((v) => v * R * 0.96));
          pts.push(...raDecToEqj(line[k + 1][0], line[k + 1][1]).map((v) => v * R * 0.96));
        }
      }
    }
    this.constLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), lineMaterial('#6f8fd8', 0.32));
    this.constLines.frustumCulled = false;
    this.celestial.add(this.constLines);
    this.relabel();
  }

  setComets(list: Comet[]): void {
    this.comets = list;
  }

  setCraft(list: Craft[]): void {
    this.craft = list;
    this.relabel();
  }

  setShowers(list: Shower[]): void {
    this.showers = list;
    this.relabel();
  }

  setMeteors(list: Meteor[]): void {
    this.meteors = list;
    this.rebuildStreaks();
  }

  setPlace(p: Place): void {
    this.place = p;
    this.rebuildStreaks();
    this.lastRender = 0;
  }

  setLang(lang: 'en' | 'ru', names: Record<string, string>): void {
    this.lang = lang;
    this.bodyNames = names;
    this.relabel();
  }

  private bodyNames: Record<string, string> = {};

  /** Meteors GMN recorded within reach of the observer, as streaks in their sky. */
  private rebuildStreaks(): void {
    const p = this.place;
    const pos: number[] = [];
    const t: number[] = [];
    const end: number[] = [];
    this.nearMeteors = 0;
    if (p) {
      this.streakBase = Date.now();
      for (const m of this.meteors) {
        if (groundKm(p.lat, p.lon, m.begin[0], m.begin[1]) > 1100) continue;
        const a = topocentric(p, m.begin[0], m.begin[1], m.begin[2]);
        const b = topocentric(p, m.end[0], m.end[1], m.end[2]);
        if (a.dir[1] < 0 && b.dir[1] < 0) continue;
        this.nearMeteors++;
        pos.push(...a.dir.map((v) => v * R * 0.93), ...b.dir.map((v) => v * R * 0.93));
        const s = (m.ms - this.streakBase) / 1000;
        t.push(s, s);
        end.push(0, 1);
      }
    }
    const g = this.streaks.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
    g.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 1));
  }

  /** How many recorded meteors crossed this sky (in the loaded GMN days). */
  nearMeteors = 0;

  setLayers(l: SkyLayers): void {
    this.layers = l;
    this.relabel();
    this.lastRender = 0;
  }

  /** Rebuilds label texts (language, layers). */
  private relabel(): void {
    const L = this.labels;
    const ru = this.lang === 'ru';
    L.removeWhere((id) => id.startsWith('star:') || id.startsWith('const:') || id.startsWith('radiant:') || id.startsWith('craft:') || id.startsWith('body:') || id.startsWith('comet:'));
    for (const id of SKY_BODIES) {
      L.upsert({ id: `body:${id}`, text: this.bodyNames[id] ?? id, color: BODY_BY_ID[id].color, priority: id === 'sun' || id === 'moon' ? 120 : 110, onClick: () => this.select({ kind: 'body', id }) });
    }
    if (this.layers.names) {
      NAMED_STARS.forEach(([en, rn], k) => {
        const idx = this.namedIdx[k];
        if (idx >= 0) L.upsert({ id: `star:${idx}`, text: ru ? rn : en, color: '#dfe6f2', priority: 60 - this.starMags[idx] * 6, cls: 'star', onClick: () => this.select({ kind: 'star', index: idx }) });
      });
    }
    if (this.layers.constellations && this.constellations) {
      for (const c of this.constellations.constellations) {
        if (c.label) L.upsert({ id: `const:${c.id}`, text: (ru ? c.ru : c.en) || c.en, color: '#7f9fdf', priority: 8, cls: 'const', dot: false });
      }
    }
    if (this.layers.showers) {
      for (const s of this.showers) {
        L.upsert({ id: `radiant:${s.code}`, text: s.name[this.lang], color: s.color, priority: 90, cls: 'radiant', onClick: () => this.select({ kind: 'radiant', code: s.code }) });
      }
    }
    if (this.layers.craft) {
      for (const c of this.craft) {
        L.upsert({ id: `craft:${c.meta.id}`, text: c.meta.short ?? c.meta.name, color: '#c7a8ff', priority: 30, cls: 'craft', onClick: () => this.select({ kind: 'craft', id: c.meta.id }) });
      }
    }
    if (this.selected) L.selectedId = skySelKey(this.selected);
  }

  select(s: SkySel | null): void {
    this.selected = s;
    this.labels.removeWhere((id) => id.startsWith('sel:'));
    const key = skySelKey(s);
    if (s && s.kind === 'star' && !this.labels.has(key)) {
      this.labels.upsert({ id: key, text: `★ ${this.starMags[s.index].toFixed(1)}ᵐ`, color: '#dfe6f2', priority: 200, cls: 'star' });
    }
    this.labels.selectedId = key || null;
    this.lastRender = 0;
    this.events.onSelect(s);
  }

  /** Turns the view to a direction (degrees), optionally zooming. */
  lookAt(az: number, alt: number, fov = this.fov): void {
    let d = az - this.az;
    d = ((d % 360) + 540) % 360 - 180;
    this.anim = { az0: this.az, alt0: this.alt, fov0: this.fov, az1: this.az + d, alt1: Math.max(-10, Math.min(85, alt)), fov1: fov, t0: performance.now() };
    this.vel.az = this.vel.alt = 0;
  }

  /** Scene direction of a selection now, or null. */
  selDir(s: SkySel, ms: number): [number, number, number] | null {
    if (!this.place) return null;
    switch (s.kind) {
      case 'body':
        return this.sky.get(s.id)?.dir ?? null;
      case 'star':
        return applyRow(this.m, [this.starDirs[s.index * 3], this.starDirs[s.index * 3 + 1], this.starDirs[s.index * 3 + 2]]);
      case 'radiant': {
        const r = RADIANTS[s.code];
        return r ? applyRow(this.m, raDecToEqj(r[0], r[1])) : null;
      }
      case 'craft':
      case 'comet': {
        const v = this.geoVector(s, ms);
        return v ? applyRow(this.m, v.dir) : null;
      }
    }
  }

  /** Geocentric J2000 equatorial direction and distance (AU) of a craft or comet. */
  geoVector(s: SkySel, ms: number): { dir: [number, number, number]; dist: number } | null {
    const jd = jdTT(ms);
    const at = astroTime(ms);
    const cache = new Map<BodyId, Vec3>();
    const bodyAt = (id: BodyId) => cache.get(id) ?? (cache.set(id, bodyPosition(id, at)), cache.get(id)!);
    let p: Vec3 | null = null;
    if (s.kind === 'craft') {
      const c = this.craft.find((x) => x.meta.id === s.id);
      p = c ? craftFix(c, jd, bodyAt)?.pos ?? null : null;
    } else if (s.kind === 'comet') {
      const c = this.comets[s.index];
      p = c ? positionAt(c.orbit, jd, [0, 0, 0]) : null;
    }
    if (!p) return null;
    const e = bodyAt('earth');
    const x = p[0] - e[0], y = p[1] - e[1], z = p[2] - e[2];
    const dist = Math.hypot(x, y, z);
    // Ecliptic → equatorial J2000.
    const eq: [number, number, number] = [x / dist, (y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY)) / dist, (y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)) / dist];
    return { dir: eq, dist };
  }

  // ---------------------------------------------------------------- input

  private onDown = (e: PointerEvent): void => {
    if (!this.active) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (!this.dragging) this.dragging = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, pointers: new Map(), pinch: 0 };
    this.dragging.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.anim = null;
    this.vel.az = this.vel.alt = 0;
    this.lastInput = performance.now();
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.dragging;
    if (!this.active || !d || !d.pointers.has(e.pointerId)) return;
    const prev = d.pointers.get(e.pointerId)!;
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pointers.size === 2) {
      // Pinch to zoom.
      const [a, b] = [...d.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (d.pinch) this.fov = Math.max(4, Math.min(120, this.fov * (d.pinch / dist)));
      d.pinch = dist;
      d.moved += 10;
      this.lastInput = performance.now();
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    // Drag the sky: a pixel turns the view by the angle it spans.
    const k = this.fov / this.height;
    this.az = (this.az - dx * k + 360) % 360;
    this.alt = Math.max(-30, Math.min(89.5, this.alt + dy * k));
    const now = performance.now();
    const dt = Math.max(1, now - d.t);
    this.vel.az = (-dx * k) / dt;
    this.vel.alt = (dy * k) / dt;
    d.t = now;
    this.lastInput = now;
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.dragging;
    if (!this.active || !d) return;
    d.pointers.delete(e.pointerId);
    if (d.pointers.size > 0) return;
    this.dragging = null;
    if (performance.now() - d.t > 80) this.vel.az = this.vel.alt = 0;
    if (d.moved < 6 && e.type === 'pointerup') {
      const r = this.canvas.getBoundingClientRect();
      this.pick(e.clientX - r.left, e.clientY - r.top);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    this.anim = null;
    this.fov = Math.max(4, Math.min(120, this.fov * Math.pow(1.0015, e.deltaY)));
    this.lastInput = performance.now();
  };

  private project(d: ArrayLike<number>): { x: number; y: number; ok: boolean } {
    const v = new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(R).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (0.5 - v.y * 0.5) * this.height, ok: v.z < 1 && v.z > -1 };
  }

  private pick(x: number, y: number): void {
    let best: SkySel | null = null;
    let bestD = 14;
    const consider = (s: SkySel, dir: ArrayLike<number> | null, slack = 0) => {
      if (!dir || (this.layers.ground && dir[1] < -0.01)) return;
      const p = this.project(dir);
      if (!p.ok) return;
      const d = Math.hypot(p.x - x, p.y - y) - slack;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    };
    for (const id of SKY_BODIES) consider({ kind: 'body', id }, this.sky.get(id)?.dir ?? null, 4);
    for (const mk of this.markers) {
      if (!mk.on) continue;
      const [kind, key] = mk.id.split(':');
      if (kind === 'craft') consider({ kind: 'craft', id: key }, mk.dir);
      else if (kind === 'comet') consider({ kind: 'comet', index: Number(key) }, mk.dir);
      else if (kind === 'radiant') consider({ kind: 'radiant', code: key }, mk.dir);
    }
    if (!best) {
      // The brightest star near the click.
      const lim = this.starMat.uniforms.uLim.value as number;
      let bestScore = Infinity;
      const v: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < this.starMags.length; k++) {
        if (this.starMags[k] > lim) continue;
        applyRow(this.m, [this.starDirs[k * 3], this.starDirs[k * 3 + 1], this.starDirs[k * 3 + 2]], v);
        if (this.layers.ground && v[1] < 0) continue;
        const p = this.project(v);
        if (!p.ok) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d > 12) continue;
        const score = d + this.starMags[k] * 2;
        if (score < bestScore) {
          bestScore = score;
          best = { kind: 'star', index: k };
        }
      }
    }
    this.select(best);
  }

  // ---------------------------------------------------------------- frame

  resize(w: number, h: number, pixelRatio: number): void {
    this.width = w;
    this.height = h;
    this.pixelRatio = pixelRatio;
    this.camera.aspect = w / h;
    this.lastRender = 0;
  }

  /** Renders a frame if one is due. Returns whether it drew. */
  frame(now: number, renderer: THREE.WebGLRenderer, simMs: number, warp: number): boolean {
    const moving = !!this.anim || !!this.dragging || Math.abs(this.vel.az) + Math.abs(this.vel.alt) > 1e-4 || now - this.lastInput < 400 || Math.abs(warp) > 30;
    if (!moving && now - this.lastRender < 100) return false;
    this.lastRender = now;
    const p = this.place;
    if (!p) {
      renderer.setClearColor('#010205');
      renderer.clear();
      return true;
    }

    // Camera: animation, inertia, then the view.
    if (this.anim) {
      const a = this.anim;
      const s = Math.min(1, (now - a.t0) / 900);
      const k = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
      this.az = (a.az0 + (a.az1 - a.az0) * k + 360) % 360;
      this.alt = a.alt0 + (a.alt1 - a.alt0) * k;
      this.fov = a.fov0 + (a.fov1 - a.fov0) * k;
      if (s >= 1) this.anim = null;
    } else if (!this.dragging && Math.abs(this.vel.az) + Math.abs(this.vel.alt) > 1e-4) {
      const dt = 16;
      this.az = (this.az + this.vel.az * dt + 360) % 360;
      this.alt = Math.max(-30, Math.min(89.5, this.alt + this.vel.alt * dt));
      this.vel.az *= 0.9;
      this.vel.alt *= 0.9;
    }
    this.camera.fov = this.fov;
    this.camera.rotation.set(this.alt * DEG, -this.az * DEG, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // The sky's rotation and the bodies (the slow parts at most a few times a second
    // unless time is racing).
    if (now - this.lastSlow > 120 || Math.abs(warp) > 30 || this.sky.size === 0) {
      this.lastSlow = now;
      this.m = eqjToScene(simMs, p);
      for (const id of SKY_BODIES) this.sky.set(id, bodySky(id, simMs, p));
    }
    const m = this.m;
    this.celestial.matrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    this.celestial.matrixWorldNeedsUpdate = true;

    const sun = this.sky.get('sun')!;
    const sunDir = sun.dir;
    this.domeMat.uniforms.uSun.value.set(sunDir[0], sunDir[1], sunDir[2]);
    const sunAlt = sun.alt;
    const lim = limitingMag(sunAlt) + Math.max(0, 2.2 * Math.log10(60 / this.fov));
    const darkness = Math.min(1, Math.max(0, (-sunAlt - 2) / 14));
    this.darkness = darkness;
    this.starMat.uniforms.uLim.value = lim;
    this.starMat.uniforms.uPixelRatio.value = this.pixelRatio;
    this.starMat.uniforms.uGround.value = this.layers.ground ? 1 : 0;
    this.groundMat.uniforms.uLight.value = Math.min(1, Math.max(0, (sunAlt + 8) / 20));
    this.ground.visible = this.layers.ground;
    this.grid.visible = this.layers.grid;
    this.ecliptic.visible = this.layers.grid;
    if (this.constLines) {
      this.constLines.visible = this.layers.constellations;
      (this.constLines.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.08 + 0.28 * darkness;
    }

    this.updateBodies(sunDir, lim);
    this.streakMat.uniforms.uNow.value = (simMs - this.streakBase) / 1000;
    // A streak stays about a second and a half on screen at any time speed.
    this.streakMat.uniforms.uWindow.value = Math.max(1.5, Math.abs(warp) * 1.5);
    this.streaks.visible = this.layers.meteors;

    this.updateLabels(simMs, lim);
    renderer.render(this.scene, this.camera);
    return true;
  }

  private updateBodies(sunDir: [number, number, number], lim: number): void {
    const g = this.bodies.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const size = g.getAttribute('aSize') as THREE.BufferAttribute;
    const alpha = g.getAttribute('aAlpha') as THREE.BufferAttribute;
    const col = g.getAttribute('aColor') as THREE.BufferAttribute;
    const c = new THREE.Color();
    const pxPerRad = this.height / (2 * Math.tan((this.fov * DEG) / 2));
    SKY_BODIES.forEach((id, k) => {
      const b = this.sky.get(id)!;
      pos.setXYZ(k, b.dir[0] * R * 0.9, b.dir[1] * R * 0.9, b.dir[2] * R * 0.9);
      const hidden = this.layers.ground && b.dir[1] < -0.005;
      if (id === 'moon') {
        size.setX(k, 0);
        return;
      }
      if (id === 'sun') {
        const px = Math.max(16, ((2 * 695_700) / (b.distAu * KM_PER_AU)) * pxPerRad * 1.6);
        size.setX(k, hidden ? 0 : px);
        alpha.setX(k, 1);
        c.set('#fff3d6');
      } else {
        size.setX(k, hidden ? 0 : Math.max(2.5, Math.min(11, 6.5 - b.mag * 1.1)));
        alpha.setX(k, Math.max(0.25, Math.min(1, (lim + 1.5 - b.mag) / 2)));
        c.set(BODY_BY_ID[id].color).lerp(new THREE.Color('#ffffff'), 0.45);
      }
      col.setXYZ(k, c.r, c.g, c.b);
    });
    for (const a of [pos, size, alpha, col]) a.needsUpdate = true;
    g.setDrawRange(0, SKY_BODIES.length);

    // The Moon: a lit disc, at least big enough to show its phase.
    const mo = this.sky.get('moon')!;
    const md = new THREE.Vector3(...mo.dir);
    const moonKm = mo.distAu * KM_PER_AU;
    const ang = Math.max((2 * 1737.4) / moonKm, 22 / pxPerRad);
    this.moon.visible = !(this.layers.ground && mo.dir[1] < -0.01);
    this.moon.position.copy(md).multiplyScalar(R * 0.88);
    this.moon.quaternion.copy(this.camera.quaternion);
    this.moon.scale.setScalar((ang / 2) * R * 0.88);
    const sunAu = this.sky.get('sun')!.distAu;
    const toSun = new THREE.Vector3(...sunDir).multiplyScalar(sunAu).sub(md.clone().multiplyScalar(mo.distAu)).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const fwd = md.clone().negate();
    this.moonMat.uniforms.uSunLocal.value.set(toSun.dot(right), toSun.dot(up), toSun.dot(fwd));
  }

  private updateLabels(simMs: number, lim: number): void {
    const L = this.labels;
    const ground = this.layers.ground;
    const show = (id: string, dir: ArrayLike<number> | null, extra = true) => {
      if (!dir || !extra || (ground && dir[1] < -0.005)) {
        L.place(id, 0, 0, false);
        return;
      }
      const p = this.project(dir);
      L.place(id, p.x, p.y, p.ok);
    };
    for (const [k, name] of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].entries()) show(`compass:${name}`, altAzToDir(0.6, k * 45));
    for (const id of SKY_BODIES) {
      const b = this.sky.get(id)!;
      const pxPerRad = this.height / (2 * Math.tan((this.fov * DEG) / 2));
      const disc = id === 'moon' ? Math.max(11, ((1737.4 / (b.distAu * KM_PER_AU)) * pxPerRad)) : id === 'sun' ? 10 : 0;
      if (!b.dir || (ground && b.dir[1] < -0.005)) L.place(`body:${id}`, 0, 0, false);
      else {
        const p = this.project(b.dir);
        L.place(`body:${id}`, p.x, p.y, p.ok, disc);
      }
    }
    const v: [number, number, number] = [0, 0, 0];
    if (this.layers.names) {
      for (const idx of this.namedIdx) {
        if (idx < 0) continue;
        applyRow(this.m, [this.starDirs[idx * 3], this.starDirs[idx * 3 + 1], this.starDirs[idx * 3 + 2]], v);
        show(`star:${idx}`, v, this.starMags[idx] < lim + 0.5);
      }
    }
    if (this.layers.constellations && this.constellations) {
      for (const c of this.constellations.constellations) {
        if (!c.label) continue;
        applyRow(this.m, raDecToEqj(c.label[0], c.label[1]), v);
        show(`const:${c.id}`, v, this.darkness > 0.2);
      }
    }
    this.markers = [];
    if (this.layers.showers) {
      const earth = bodyPosition('earth', astroTime(simMs));
      const solarLon = ((Math.atan2(-earth[1], -earth[0]) / DEG) + 360) % 360;
      for (const s of this.showers) {
        const r = RADIANTS[s.code];
        const ahead = (((solarLon - s.start) % 360) + 360) % 360;
        const active = ahead <= ((((s.end - s.start) % 360) + 360) % 360);
        const dir = r && active ? applyRow(this.m, raDecToEqj(r[0], r[1])) : null;
        show(`radiant:${s.code}`, dir);
        if (dir) this.markers.push({ id: `radiant:${s.code}`, dir, on: !(ground && dir[1] < 0) });
      }
    }
    if (this.layers.craft) {
      for (const c of this.craft) {
        const g = this.geoVector({ kind: 'craft', id: c.meta.id }, simMs);
        const dir = g ? applyRow(this.m, g.dir) : null;
        show(`craft:${c.meta.id}`, dir);
        if (dir) this.markers.push({ id: `craft:${c.meta.id}`, dir, on: !(ground && dir[1] < 0) });
      }
    }
    // Comets bright enough for binoculars: labelled.
    const jd = jdTT(simMs);
    const earth = bodyPosition('earth', astroTime(simMs));
    const p: Vec3 = [0, 0, 0];
    this.comets.forEach((c, k) => {
      if (c.m1 === null) return;
      positionAt(c.orbit, jd, p);
      const r = Math.hypot(p[0], p[1], p[2]);
      const delta = Math.hypot(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]);
      const mag = c.m1 + 5 * Math.log10(delta) + 10 * Math.log10(r);
      const id = `comet:${k}`;
      if (mag > 9) {
        if (L.has(id)) L.remove(id);
        return;
      }
      if (!L.has(id)) L.upsert({ id, text: c.name.replace(/\s*\(.*\)\s*$/, ''), color: '#9ff2e0', priority: 80, onClick: () => this.select({ kind: 'comet', index: k }) });
      const g = this.geoVector({ kind: 'comet', index: k }, simMs);
      const dir = g ? applyRow(this.m, g.dir) : null;
      show(id, dir);
      if (dir) this.markers.push({ id, dir, on: !(ground && dir[1] < 0) });
    });
    // An unnamed selected star.
    const sel = this.selected;
    if (sel?.kind === 'star' && L.has(`star:${sel.index}`)) {
      applyRow(this.m, [this.starDirs[sel.index * 3], this.starDirs[sel.index * 3 + 1], this.starDirs[sel.index * 3 + 2]], v);
      show(`star:${sel.index}`, v);
    }
    L.layout(this.width, this.height);
  }

  starMag(index: number): number {
    return this.starMags[index] ?? 99;
  }

  /** Proper name of a catalogue star, if it has one in NAMED_STARS. */
  starName(index: number): string | null {
    const k = this.namedIdx.indexOf(index);
    return k < 0 ? null : NAMED_STARS[k][this.lang === 'ru' ? 1 : 0];
  }

  /** Direction of the view centre (for the UI compass). */
  view(): { az: number; alt: number; fov: number } {
    return { az: this.az, alt: this.alt, fov: this.fov };
  }

  setActive(on: boolean): void {
    this.active = on;
    this.labels.root.classList.toggle('hidden', !on);
    this.lastRender = 0;
  }
}

