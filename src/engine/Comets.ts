// Comets: a few thousand, propagated on the CPU because many are on near-parabolic or
// hyperbolic paths. Comets near the Sun grow a tail that points away from it.
import * as THREE from 'three';
import { DEG, positionAt, type Orbit, type Vec3 } from '../sim/kepler';
import { POINT_FRAGMENT } from './glsl';

export interface Comet {
  name: string;
  orbit: Orbit;
  /** Total absolute magnitude (M1), or null. */
  m1: number | null;
}

const pointVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
in float aAlpha;
in float aSize;
uniform float uPixelRatio;
out vec3 vColor;
out float vAlpha;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
  gl_PointSize = aSize * uPixelRatio;
  vColor = vec3(0.62, 0.95, 0.88);
  vAlpha = aAlpha;
}
`;

const tailVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
in float aAlpha;
out float vA;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
  vA = aAlpha;
}
`;

const tailFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
out highp vec4 fragColor;
in float vA;
void main() {
  #include <logdepthbuf_fragment>
  fragColor = vec4(0.55, 0.85, 1.0, vA);
}
`;

export class Comets {
  readonly group = new THREE.Group();
  list: Comet[] = [];
  /** Heliocentric ecliptic positions, AU (updated by update()). */
  helio = new Float64Array(0);
  private points: THREE.Points;
  private tails: THREE.LineSegments;
  private pos = new Float32Array(0);
  private alpha = new Float32Array(0);
  private size = new Float32Array(0);
  private tailPos = new Float32Array(0);
  private tailAlpha = new Float32Array(0);
  private pointMat: THREE.ShaderMaterial;
  private tmp: Vec3 = [0, 0, 0];

  constructor() {
    this.pointMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: pointVertex,
      fragmentShader: POINT_FRAGMENT,
      uniforms: { uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.pointMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.tails = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: tailVertex,
        fragmentShader: tailFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.tails.frustumCulled = false;
    this.tails.renderOrder = 2;
    this.group.add(this.tails, this.points);
  }

  /** rows: [name, tp, q, e, i, node, peri, M1] from the live bundle. */
  set(rows: [string, number, number, number, number, number, number, number | null][]): void {
    this.list = rows.map(([name, tp, q, e, i, node, peri, m1]) => ({
      name,
      m1,
      orbit: { q, e, i: i * DEG, node: node * DEG, peri: peri * DEG, tp: tp },
    }));
    const n = this.list.length;
    this.helio = new Float64Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.tailPos = new Float32Array(n * 6);
    this.tailAlpha = new Float32Array(n * 2);
    const g = this.points.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const tg = this.tails.geometry;
    tg.setAttribute('position', new THREE.BufferAttribute(this.tailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('aAlpha', new THREE.BufferAttribute(this.tailAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  }

  update(jdTT: number, origin: Vec3, pixelRatio: number): void {
    this.pointMat.uniforms.uPixelRatio.value = pixelRatio;
    const p = this.tmp;
    for (let k = 0; k < this.list.length; k++) {
      const c = this.list[k];
      positionAt(c.orbit, jdTT, p);
      this.helio[k * 3] = p[0];
      this.helio[k * 3 + 1] = p[1];
      this.helio[k * 3 + 2] = p[2];
      const x = p[0] - origin[0], y = p[1] - origin[1], z = p[2] - origin[2];
      this.pos[k * 3] = x;
      this.pos[k * 3 + 1] = z;
      this.pos[k * 3 + 2] = -y;
      const r = Math.hypot(p[0], p[1], p[2]);
      // Apparent activity: total magnitude at 1 AU from the Earth, the usual 10 log r law.
      const m1 = c.m1 ?? 14;
      const mag = m1 + 10 * Math.log10(Math.max(r, 0.05));
      const vis = Math.min(1, Math.max(0.12, (18 - mag) / 10));
      this.alpha[k] = vis;
      this.size[k] = 1.6 + 2.4 * vis;
      // Tail: away from the Sun, longer and brighter close in.
      const len = r < 5 ? Math.min(0.6, (0.12 * vis) / Math.max(r * r, 0.04)) * Math.min(1, (5 - r) / 2) : 0;
      const o = k * 6;
      this.tailPos[o] = x;
      this.tailPos[o + 1] = z;
      this.tailPos[o + 2] = -y;
      const s = len / Math.max(r, 1e-6);
      this.tailPos[o + 3] = x + p[0] * s;
      this.tailPos[o + 4] = z + p[2] * s;
      this.tailPos[o + 5] = -y - p[1] * s;
      this.tailAlpha[k * 2] = len > 0 ? 0.8 * vis : 0;
      this.tailAlpha[k * 2 + 1] = 0;
    }
    for (const g of [this.points.geometry, this.tails.geometry]) {
      for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
