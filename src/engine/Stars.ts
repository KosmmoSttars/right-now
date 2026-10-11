// The real background sky: the Yale Bright Star Catalogue (J2000 RA/Dec) turned into
// ecliptic directions and drawn at infinity (only the camera rotation applies).
import * as THREE from 'three';
import { eqjToEcl } from '../sim/planets';

const SPECTRAL = ['#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffcc6f'];

export class Stars {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(catalog: [number, number, number, number][]) {
    const n = catalog.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const bright = new Float32Array(n);
    const c = new THREE.Color();
    catalog.forEach(([ra, dec, mag, cls], k) => {
      const e = eqjToEcl(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
      pos.set([e[0], e[2], -e[1]], k * 3);
      c.set(SPECTRAL[cls] ?? '#ffffff');
      col.set([c.r, c.g, c.b], k * 3);
      bright[k] = Math.min(1, Math.pow(10, -0.4 * (mag - 1.0)));
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uPixelRatio: { value: 1 }, uFade: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uPixelRatio;
        in vec3 aColor;
        in float aBright;
        out vec3 vColor;
        out float vA;
        void main() {
          // Direction only: rotate with the view, never translate.
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 0.0);
          gl_Position = vec4(p.xy, p.w, p.w);
          gl_PointSize = (1.0 + 3.0 * sqrt(aBright)) * uPixelRatio;
          vColor = aColor;
          vA = 0.22 + 0.78 * sqrt(aBright);
        }`,
      fragmentShader: /* glsl */ `
        out highp vec4 fragColor;
        uniform float uFade;
        in vec3 vColor;
        in float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = 1.0 - smoothstep(0.0, 1.0, r);
          a = a * a * vA * uFade;
          fragColor = vec4(vColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
  }

  update(pixelRatio: number, fade: number): void {
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.material.uniforms.uFade.value = fade;
  }
}
