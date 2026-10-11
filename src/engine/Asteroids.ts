// Every known asteroid as one point. The GPU solves Kepler's equation for each of
// them every frame from the packed elements, so 1.5 million bodies move in real time
// (or a year per second) without any CPU work.
import * as THREE from 'three';
import { RECORD_U16, type Manifest } from '../sim/catalog';
import { CLASS_COUNT, CLASS_STYLE } from '../sim/classes';
import { HIDE, KEPLER_GLSL, POINT_FRAGMENT } from './glsl';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${KEPLER_GLSL}
in vec4 aE0; // a (log), e, i, node   (normalized uint16)
in vec4 aE1; // peri, M coarse, class|H, M fine
uniform float uDt;
uniform vec3 uOrigin;
uniform float uLnMin;
uniform float uLnSpan;
uniform vec3 uColors[${CLASS_COUNT}];
uniform float uAlpha[${CLASS_COUNT}];
uniform float uMask[${CLASS_COUNT}];
uniform float uPixelRatio;
uniform float uGain;
uniform float uHMax;
out vec3 vColor;
out float vAlpha;

void main() {
  float hc = floor(aE1.z * 65535.0 + 0.5);
  int cls = int(floor(hc / 256.0));
  float H = mod(hc, 256.0) / 7.0 - 2.0;
  if (uMask[cls] < 0.5 || H > uHMax) { ${HIDE} return; }
  float a = exp(uLnMin + aE0.x * uLnSpan);
  float M0 = (floor(aE1.y * 65535.0 + 0.5) + aE1.w * 65535.0 / 65536.0) / 65536.0 * PI2;
  float n = GAUSS_K / (a * sqrt(a));
  vec3 p = keplerEllipse(a, aE0.y, aE0.z * PI, aE0.w * PI2, aE1.x * PI2, M0 + n * uDt);
  vec3 world = eclToThree(p - uOrigin);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
  // Bigger bodies (lower H) draw a little larger and brighter.
  float big = clamp((16.0 - H) / 10.0, 0.0, 1.0);
  gl_PointSize = (1.5 + 2.2 * big * big) * uPixelRatio;
  vColor = uColors[cls];
  vAlpha = uAlpha[cls] * uGain * (0.55 + 0.9 * big);
}
`;

export class Asteroids {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  readonly data: Uint16Array;
  loaded = 0;
  drawCount = 0;
  private buffer: THREE.InterleavedBuffer;
  private geometry: THREE.BufferGeometry;

  constructor(readonly manifest: Manifest) {
    this.data = new Uint16Array(manifest.count * RECORD_U16);
    this.buffer = new THREE.InterleavedBuffer(this.data, RECORD_U16);
    const g = new THREE.BufferGeometry();
    // "position" aliases the same bytes: three counts vertices by it; the shader ignores it.
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0, true));
    g.setAttribute('aE0', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0, true));
    g.setAttribute('aE1', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4, true));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    g.setDrawRange(0, 0);
    this.geometry = g;

    const lnMin = Math.log(manifest.aRange[0]);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: POINT_FRAGMENT,
      uniforms: {
        uDt: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uLnMin: { value: lnMin },
        uLnSpan: { value: Math.log(manifest.aRange[1]) - lnMin },
        uColors: { value: CLASS_STYLE.map((s) => new THREE.Color(s.color)) },
        uAlpha: { value: CLASS_STYLE.map((s) => s.alpha) },
        uMask: { value: CLASS_STYLE.map(() => 1) },
        uPixelRatio: { value: 1 },
        uGain: { value: 1 },
        uHMax: { value: 99 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Adds a chunk of records right after the ones already loaded. */
  append(chunk: Uint16Array): void {
    const start = this.loaded * RECORD_U16;
    this.data.set(chunk, start);
    this.buffer.addUpdateRange(start, chunk.length);
    this.buffer.needsUpdate = true;
    this.loaded += chunk.length / RECORD_U16;
    this.setDrawCount(this.loaded);
  }

  /** Records are sorted NEOs first, then largest to smallest: a prefix is the biggest bodies. */
  setDrawCount(n: number): void {
    this.drawCount = Math.floor(Math.min(n, this.loaded));
    this.geometry.setDrawRange(0, this.drawCount);
  }

  update(dtDays: number, originEcl: ArrayLike<number>, pixelRatio: number, gain: number): void {
    const u = this.material.uniforms;
    u.uDt.value = dtDays;
    (u.uOrigin.value as THREE.Vector3).set(originEcl[0], originEcl[1], originEcl[2]);
    u.uPixelRatio.value = pixelRatio;
    u.uGain.value = gain;
  }

  setMask(mask: boolean[]): void {
    this.material.uniforms.uMask.value = mask.map((m) => (m ? 1 : 0));
  }
}
