// Screen-space ribbon lines with a constant pixel width at any zoom. Points are stored
// relative to an anchor (the parent body: the Sun for planets, the Earth for the
// Moon) and uOffset moves them to the floating scene origin every frame.
import * as THREE from 'three';
import type { Vec3 } from '../sim/kepler';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec2 uResolution;
uniform float uWidth;
uniform vec3 uOffset;
in vec3 aPrev;
in vec3 aNext;
in float aSide;
in float aU;
out float vU;
out float vEdge;

vec3 toThree(vec3 p) { return vec3(p.x, p.z, -p.y) + uOffset; }

void main() {
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c = vp * vec4(toThree(position), 1.0);
  vec4 cp = vp * vec4(toThree(aPrev), 1.0);
  vec4 cn = vp * vec4(toThree(aNext), 1.0);
  vec2 half_ = uResolution * 0.5;
  // Points behind the camera would flip the direction; clamp w.
  vec2 s = c.xy / max(c.w, 1e-9) * half_;
  vec2 sp = cp.xy / max(cp.w, 1e-9) * half_;
  vec2 sn = cn.xy / max(cn.w, 1e-9) * half_;
  vec2 d1 = s - sp;
  vec2 d2 = sn - s;
  vec2 dir;
  if (dot(d1, d1) < 1e-8) dir = normalize(d2 + vec2(1e-6));
  else if (dot(d2, d2) < 1e-8) dir = normalize(d1 + vec2(1e-6));
  else dir = normalize(normalize(d1) + normalize(d2));
  vec2 nrm = vec2(-dir.y, dir.x);
  c.xy += nrm * aSide * uWidth * 0.5 / half_ * c.w;
  vU = aU;
  vEdge = aSide;
  gl_Position = c;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
out highp vec4 fragColor;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHead;
uniform float uFadeMode;
in float vU;
in float vEdge;
void main() {
  #include <logdepthbuf_fragment>
  float a = uOpacity;
  if (uFadeMode > 0.5) {
    // A trail: bright at the body, fading behind it along the orbit.
    float behind = fract(uHead - vU + 1.0);
    a *= mix(0.18, 1.0, pow(1.0 - behind, 1.6));
  }
  a *= 1.0 - smoothstep(0.5, 1.0, abs(vEdge));
  fragColor = vec4(uColor, a); // additive blending multiplies by alpha
}
`;

export interface PolylineOptions {
  color: THREE.ColorRepresentation;
  width: number;
  opacity?: number;
  /** Fade behind the body (uHead marks it, in the same 0..1 "u" as the points). */
  trail?: boolean;
  maxPoints: number;
}

export class Polyline {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private pos: Float32Array;
  private prev: Float32Array;
  private next: Float32Array;
  private u: Float32Array;
  private max: number;

  constructor(opts: PolylineOptions) {
    this.max = opts.maxPoints;
    const n = this.max * 2;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.next = new Float32Array(n * 3);
    this.u = new Float32Array(n);
    const side = new Float32Array(n);
    for (let i = 0; i < n; i++) side[i] = i % 2 ? 1 : -1;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPrev', new THREE.BufferAttribute(this.prev, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aNext', new THREE.BufferAttribute(this.next, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aU', new THREE.BufferAttribute(this.u, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(Math.max(1, this.max - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uWidth: { value: opts.width },
        uOffset: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(opts.color) },
        uOpacity: { value: opts.opacity ?? 1 },
        uHead: { value: 0 },
        uFadeMode: { value: opts.trail ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** Replaces the line: points relative to the anchor (ecliptic AU), u along it (0..1). */
  set(points: Vec3[], u?: ArrayLike<number>): void {
    const count = Math.min(points.length, this.max);
    const index = this.geometry.index!.array as Uint32Array;
    let idx = 0;
    for (let i = 0; i < count; i++) {
      const p = points[i];
      const pp = points[Math.max(0, i - 1)];
      const pn = points[Math.min(count - 1, i + 1)];
      for (let side = 0; side < 2; side++) {
        const o = (i * 2 + side) * 3;
        this.pos[o] = p[0]; this.pos[o + 1] = p[1]; this.pos[o + 2] = p[2];
        this.prev[o] = pp[0]; this.prev[o + 1] = pp[1]; this.prev[o + 2] = pp[2];
        this.next[o] = pn[0]; this.next[o + 1] = pn[1]; this.next[o + 2] = pn[2];
        this.u[i * 2 + side] = u ? u[i] : i / Math.max(1, count - 1);
      }
      if (i < count - 1) {
        const a = i * 2;
        index[idx++] = a; index[idx++] = a + 1; index[idx++] = a + 2;
        index[idx++] = a + 1; index[idx++] = a + 3; index[idx++] = a + 2;
      }
    }
    const g = this.geometry;
    for (const name of ['position', 'aPrev', 'aNext', 'aU']) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count * 2 * attr.itemSize);
      attr.needsUpdate = true;
    }
    g.index!.clearUpdateRanges();
    g.index!.addUpdateRange(0, idx);
    g.index!.needsUpdate = true;
    g.setDrawRange(0, idx);
  }

  clear(): void {
    this.geometry.setDrawRange(0, 0);
  }

  /** anchor − origin, in three coordinates. */
  setOffset(v: THREE.Vector3): void {
    (this.material.uniforms.uOffset.value as THREE.Vector3).copy(v);
  }

  setResolution(w: number, h: number): void {
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(w, h);
  }

  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
  }

  set head(v: number) {
    this.material.uniforms.uHead.value = v;
  }

  set color(c: THREE.ColorRepresentation) {
    (this.material.uniforms.uColor.value as THREE.Color).set(c);
  }
}
