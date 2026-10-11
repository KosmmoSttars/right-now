// What happened at the Earth itself, in the Earth-fixed frame so it turns with the
// planet: the luminous paths of the meteors the Global Meteor Network recorded
// (begin → end, at their real heights) and the fireballs US government sensors saw.
import * as THREE from 'three';
import type { Fireball, Meteor } from '../sim/live';
import { KM_PER_AU } from '../sim/planets';

const R_KM = 6371;

/** Geodetic-ish lat/lon/height → the Earth mesh's local frame (three-style body-fixed), AU. */
function local(latDeg: number, lonDeg: number, hKm: number, out: number[], o: number): void {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  const r = (R_KM + hKm) / KM_PER_AU;
  const x = r * Math.cos(la) * Math.cos(lo);
  const y = r * Math.cos(la) * Math.sin(lo);
  const z = r * Math.sin(la);
  out[o] = x;
  out[o + 1] = z;
  out[o + 2] = -y;
}

const streakVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
in float aHours;
in float aEnd;
uniform float uNowHours;
uniform float uWindow;
out float vA;
out float vEnd;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
  float age = uNowHours - aHours;
  // Not yet happened, or older than the window: invisible. A flash right after.
  vA = age < 0.0 || age > uWindow ? 0.0 : mix(1.0, 0.25, clamp(age / uWindow, 0.0, 1.0)) + 2.0 * exp(-age * 30.0);
  vEnd = aEnd;
}
`;

const streakFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
out highp vec4 fragColor;
in float vA;
in float vEnd;
void main() {
  #include <logdepthbuf_fragment>
  if (vA <= 0.0) discard;
  // White-hot at the start of the path, cooling to orange where it ends.
  vec3 c = mix(vec3(0.85, 0.95, 1.0), vec3(1.0, 0.55, 0.2), vEnd);
  float a = vA * mix(1.0, 0.4, vEnd);
  fragColor = vec4(c, a);
}
`;

const fireVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
in float aHours;
in float aSize;
uniform float uNowHours;
uniform float uPixelRatio;
out vec3 vColor;
out float vAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
  float age = uNowHours - aHours;
  float years = age / 8766.0;
  // The last year only, fading with age; older events would carpet the globe.
  bool shown = age >= 0.0 && years < 1.0;
  gl_PointSize = shown ? aSize * uPixelRatio : 0.0;
  vColor = vec3(1.0, 0.62, 0.25);
  vAlpha = shown ? mix(0.9, 0.25, years) : 0.0;
}
`;

const fireFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
out highp vec4 fragColor;
in vec3 vColor;
in float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0 || vAlpha <= 0.0) discard;
  // A ring with a bright core: reads as "an event here" rather than a star.
  float ring = smoothstep(0.62, 0.75, r) * (1.0 - smoothstep(0.85, 1.0, r));
  float core = 1.0 - smoothstep(0.0, 0.3, r);
  float a = (ring * 0.9 + core) * vAlpha;
  fragColor = vec4(vColor, a); // additive blending multiplies by alpha
}
`;

const flashVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
in float aHours;
uniform float uNowHours;
uniform float uWindow;
uniform float uPixelRatio;
out vec3 vColor;
out float vAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
  float age = uNowHours - aHours;
  bool shown = age >= 0.0 && age <= uWindow;
  // A burst when it happens, then a small ember that fades over the window.
  float burst = exp(-age * 6.0);
  gl_PointSize = shown ? (2.5 + 9.0 * burst) * uPixelRatio : 0.0;
  vColor = mix(vec3(1.0, 0.7, 0.35), vec3(0.9, 0.97, 1.0), burst);
  vAlpha = shown ? 0.25 + 0.75 * burst : 0.0;
}
`;

export class Surface {
  readonly group = new THREE.Group();
  private flashes: THREE.Points;
  private flashMat: THREE.ShaderMaterial;
  private streaks: THREE.LineSegments;
  private fire: THREE.Points;
  private streakMat: THREE.ShaderMaterial;
  private fireMat: THREE.ShaderMaterial;
  /** Hour counts are relative to this, so float32 keeps them exact. */
  private baseMs = Date.now();

  constructor() {
    this.streakMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: streakVertex,
      fragmentShader: streakFragment,
      uniforms: { uNowHours: { value: 0 }, uWindow: { value: 48 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.streaks = new THREE.LineSegments(new THREE.BufferGeometry(), this.streakMat);
    this.streaks.frustumCulled = false;
    this.fireMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fireVertex,
      fragmentShader: fireFragment,
      uniforms: { uNowHours: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fire = new THREE.Points(new THREE.BufferGeometry(), this.fireMat);
    this.fire.frustumCulled = false;
    this.flashMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: flashVertex,
      fragmentShader: fireFragment.replace('float a = (ring * 0.9 + core) * vAlpha;', 'float a = (1.0 - smoothstep(0.0, 1.0, r)) * vAlpha;'),
      uniforms: { uNowHours: this.streakMat.uniforms.uNowHours, uWindow: this.streakMat.uniforms.uWindow, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashes = new THREE.Points(new THREE.BufferGeometry(), this.flashMat);
    this.flashes.frustumCulled = false;
    this.group.add(this.streaks, this.fire, this.flashes);
  }

  setMeteors(list: Meteor[]): void {
    const pos = new Float32Array(list.length * 6);
    const hours = new Float32Array(list.length * 2);
    const end = new Float32Array(list.length * 2);
    const tmp: number[] = [0, 0, 0, 0, 0, 0];
    list.forEach((m, k) => {
      local(m.begin[0], m.begin[1], m.begin[2], tmp, 0);
      local(m.end[0], m.end[1], m.end[2], tmp, 3);
      pos.set(tmp, k * 6);
      const h = (m.ms - this.baseMs) / 3_600_000;
      hours[k * 2] = hours[k * 2 + 1] = h;
      end[k * 2] = 0;
      end[k * 2 + 1] = 1;
    });
    const g = this.streaks.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aHours', new THREE.BufferAttribute(hours, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    // Flash at the brightest part: the middle of the luminous path.
    const mid = new Float32Array(list.length * 3);
    const one = new Float32Array(list.length);
    for (let k = 0; k < list.length; k++) {
      for (let c = 0; c < 3; c++) mid[k * 3 + c] = (pos[k * 6 + c] + pos[k * 6 + 3 + c]) / 2;
      one[k] = hours[k * 2];
    }
    const f = this.flashes.geometry;
    f.setAttribute('position', new THREE.BufferAttribute(mid, 3));
    f.setAttribute('aHours', new THREE.BufferAttribute(one, 1));
  }

  setFireballs(list: Fireball[]): void {
    const pos = new Float32Array(list.length * 3);
    const hours = new Float32Array(list.length);
    const size = new Float32Array(list.length);
    const tmp = [0, 0, 0];
    list.forEach((f, k) => {
      local(f.lat, f.lon, f.altKm ?? 30, tmp, 0);
      pos.set(tmp, k * 3);
      hours[k] = (f.ms - this.baseMs) / 3_600_000;
      // Radiated energy spans five orders of magnitude: size by its log.
      size[k] = 5 + 2.5 * Math.max(0, Math.log10(Math.max(f.energy, 0.1)) + 1);
    });
    const g = this.fire.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aHours', new THREE.BufferAttribute(hours, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  }

  update(simMs: number, pixelRatio: number, showMeteors: boolean): void {
    const h = (simMs - this.baseMs) / 3_600_000;
    this.streakMat.uniforms.uNowHours.value = h;
    this.fireMat.uniforms.uNowHours.value = h;
    this.fireMat.uniforms.uPixelRatio.value = pixelRatio;
    this.flashMat.uniforms.uPixelRatio.value = pixelRatio;
    this.flashes.visible = showMeteors;
    this.streaks.visible = showMeteors;
    this.fire.visible = showMeteors;
  }
}
