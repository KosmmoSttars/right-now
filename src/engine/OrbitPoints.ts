// Points on elliptical orbits propagated on the GPU from full-precision elements:
// meteoroid streams (particles spread along measured orbits) and the meteoroids the
// Global Meteor Network saw hit the atmosphere in the last days, each on its way to
// the moment it burned up.
import * as THREE from 'three';
import { HIDE, KEPLER_GLSL, POINT_FRAGMENT } from './glsl';

export interface OrbitPoint {
  a: number;
  e: number;
  /** Radians. */
  i: number;
  node: number;
  peri: number;
  /** Mean anomaly at the reference time, radians. */
  m0: number;
  /** Visible between these times, days from the reference (±Infinity: always). */
  tStart: number;
  tEnd: number;
  /** Index into the group colour/gain tables. */
  group: number;
  size: number;
}

const MAX_GROUPS = 24;

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${KEPLER_GLSL}
in vec4 aOrb0;  // a, e, i, node
in vec4 aOrb1;  // peri, M0, group, size
in vec2 aLife;  // start, end (days from the reference)
uniform float uDt;
uniform vec3 uOrigin;
uniform vec3 uColors[${MAX_GROUPS}];
uniform float uGain[${MAX_GROUPS}];
uniform float uPixelRatio;
uniform float uFadeDays;
out vec3 vColor;
out float vAlpha;
void main() {
  int g = int(aOrb1.z + 0.5);
  float gain = uGain[g];
  if (gain <= 0.0 || uDt < aLife.x || uDt > aLife.y) { ${HIDE} return; }
  float a = aOrb0.x;
  float n = GAUSS_K / (a * sqrt(a));
  vec3 p = keplerEllipse(a, aOrb0.y, aOrb0.z, aOrb0.w, aOrb1.x, aOrb1.y + n * uDt);
  gl_Position = projectionMatrix * viewMatrix * vec4(eclToThree(p - uOrigin), 1.0);
  #include <logdepthbuf_vertex>
  gl_PointSize = aOrb1.w * uPixelRatio;
  vColor = uColors[g];
  // Meteoroids brighten as they close in on the Earth.
  float left = aLife.y - uDt;
  float fade = uFadeDays > 0.0 ? clamp(1.0 - left / uFadeDays, 0.15, 1.0) : 1.0;
  vAlpha = gain * fade;
}
`;

export class OrbitPoints {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  count = 0;
  private geometry = new THREE.BufferGeometry();

  constructor(colors: string[], fadeDays = 0) {
    const pad = <T,>(arr: T[], fill: T) => [...arr, ...new Array(MAX_GROUPS - arr.length).fill(fill)];
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: POINT_FRAGMENT,
      uniforms: {
        uDt: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uColors: { value: pad(colors.map((c) => new THREE.Color(c)), new THREE.Color()) },
        uGain: { value: pad(colors.map(() => 1), 0) },
        uPixelRatio: { value: 1 },
        uFadeDays: { value: fadeDays },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  set(list: OrbitPoint[]): void {
    const n = list.length;
    const o0 = new Float32Array(n * 4);
    const o1 = new Float32Array(n * 4);
    const life = new Float32Array(n * 2);
    list.forEach((p, k) => {
      o0.set([p.a, p.e, p.i, p.node], k * 4);
      o1.set([p.peri, p.m0, p.group, p.size], k * 4);
      // Float32 cannot hold Infinity safely in every driver: use a huge finite span.
      life[k * 2] = Number.isFinite(p.tStart) ? p.tStart : -1e9;
      life[k * 2 + 1] = Number.isFinite(p.tEnd) ? p.tEnd : 1e9;
    });
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(o0, 3)); // vertex count only
    g.setAttribute('aOrb0', new THREE.BufferAttribute(o0, 4));
    g.setAttribute('aOrb1', new THREE.BufferAttribute(o1, 4));
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 2));
    g.setDrawRange(0, n);
    this.count = n;
  }

  update(dtDays: number, originEcl: ArrayLike<number>, pixelRatio: number): void {
    const u = this.material.uniforms;
    u.uDt.value = dtDays;
    (u.uOrigin.value as THREE.Vector3).set(originEcl[0], originEcl[1], originEcl[2]);
    u.uPixelRatio.value = pixelRatio;
  }

  setGain(group: number, gain: number): void {
    (this.material.uniforms.uGain.value as number[])[group] = gain;
  }
}
