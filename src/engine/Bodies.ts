// The Sun, the planets, the Moon and Pluto at true size and orientation (IAU rotation
// models), lit by the Sun. The Earth has its own day/night shader.
import * as THREE from 'three';
import { BODIES, KM_PER_AU, type BodyId, type BodyInfo } from '../sim/planets';

const loader = new THREE.TextureLoader();

function tex(name: string, srgb = true): THREE.Texture {
  const t = loader.load(`textures/${name}.webp`);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Ecliptic (x, y, z) → three (x, z, −y), as a basis change for orientation matrices. */
export function eclMatrixToThree(m: number[], out: THREE.Matrix4): THREE.Matrix4 {
  // C = T M Tᵀ with T = [[1,0,0],[0,0,1],[0,−1,0]].
  const [a, b, c, d, e, f, g, h, i] = m;
  return out.set(
    a, c, -b, 0,
    g, i, -h, 0,
    -d, -f, e, 0,
    0, 0, 0, 1,
  );
}

const earthVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
out vec2 vUv;
out vec3 vN;
out vec3 vView;
void main() {
  vUv = uv;
  vN = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vView = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const earthFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
out highp vec4 fragColor;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uAux;
uniform vec3 uSunLocal;   // unit vector to the Sun in the body-fixed (mesh) frame
uniform mat3 uLocalToWorld;
uniform float uCloudShift;
in vec2 vUv;
in vec3 vN;
in vec3 vView;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  float ndl = dot(n, uSunLocal);
  float day = smoothstep(-0.08, 0.2, ndl);
  vec3 dayTex = texture(uDay, vUv).rgb;
  vec3 lights = texture(uNight, vUv).rgb;
  vec4 aux = texture(uAux, vUv);
  float water = aux.r;
  float cloud = texture(uAux, vUv + vec2(uCloudShift, 0.0)).g;
  vec3 lit = dayTex * (0.02 + 1.05 * max(ndl, 0.0));
  lit = mix(lit, vec3(1.0) * (0.03 + max(ndl, 0.0)), cloud * 0.9);
  vec3 nw = normalize(uLocalToWorld * n);
  vec3 v = normalize(vView);
  vec3 sw = normalize(uLocalToWorld * uSunLocal);
  float spec = pow(max(dot(nw, normalize(sw + v)), 0.0), 120.0) * water * (1.0 - cloud) * day;
  lit += vec3(1.0, 0.9, 0.75) * spec * 0.3;
  vec3 night = lights * lights * vec3(1.35, 1.05, 0.75) * 2.0 * (1.0 - cloud * 0.8);
  vec3 col = mix(night, lit, day);
  float rim = pow(1.0 - max(dot(nw, v), 0.0), 3.0);
  col += vec3(0.3, 0.55, 1.0) * rim * 0.45 * smoothstep(-0.2, 0.3, ndl);
  fragColor = vec4(col, 1.0);
}
`;

export interface BodyView {
  info: BodyInfo;
  /** Positioned at the body centre; rotated into the body-fixed frame. */
  group: THREE.Group;
  mesh: THREE.Mesh;
  radiusAu: number;
  earth?: THREE.ShaderMaterial;
}

export class Bodies {
  readonly root = new THREE.Group();
  readonly views = new Map<BodyId, BodyView>();
  readonly light: THREE.PointLight;
  readonly sunGlow: THREE.Sprite;
  private tmpM = new THREE.Matrix4();
  private tmpM3 = new THREE.Matrix3();

  constructor(earthTex: { day: THREE.Texture; night: THREE.Texture; aux: THREE.Texture }) {
    this.light = new THREE.PointLight(0xffffff, 3.2, 0, 0);
    this.root.add(this.light, new THREE.AmbientLight(0x8090a0, 0.06));

    for (const info of BODIES) {
      const r = info.radiusKm / KM_PER_AU;
      const geo = new THREE.SphereGeometry(r, info.id === 'sun' || info.id === 'earth' ? 128 : 96, info.id === 'earth' ? 96 : 64);
      let material: THREE.Material;
      let earth: THREE.ShaderMaterial | undefined;
      if (info.id === 'sun') {
        const m = new THREE.MeshBasicMaterial({ map: tex('sun') });
        m.color.setScalar(1.6);
        material = m;
      } else if (info.id === 'earth') {
        for (const t of [earthTex.day, earthTex.night, earthTex.aux]) {
          t.wrapS = THREE.RepeatWrapping;
          t.anisotropy = 8;
        }
        earthTex.day.colorSpace = THREE.SRGBColorSpace;
        earthTex.night.colorSpace = THREE.SRGBColorSpace;
        earth = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: earthVertex,
          fragmentShader: earthFragment,
          uniforms: {
            uDay: { value: earthTex.day },
            uNight: { value: earthTex.night },
            uAux: { value: earthTex.aux },
            uSunLocal: { value: new THREE.Vector3(1, 0, 0) },
            uLocalToWorld: { value: new THREE.Matrix3() },
            uCloudShift: { value: 0 },
          },
        });
        material = earth;
      } else if (info.id === 'pluto') {
        material = new THREE.MeshStandardMaterial({ color: info.color, roughness: 1, metalness: 0 });
      } else {
        material = new THREE.MeshStandardMaterial({ map: tex(info.id), roughness: 1, metalness: 0 });
      }
      const mesh = new THREE.Mesh(geo, material);
      // Oblate giants: squash along the pole (local +Y).
      mesh.scale.set(1, 1 - info.flattening, 1);
      const group = new THREE.Group();
      group.add(mesh);
      group.matrixAutoUpdate = false;
      if (info.id === 'saturn') group.add(saturnRings());
      this.root.add(group);
      this.views.set(info.id, { info, group, mesh, radiusAu: r, earth });
    }

    this.sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color(1.0, 0.86, 0.62),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: false,
      }),
    );
    this.sunGlow.renderOrder = 1;
    this.root.add(this.sunGlow);
  }

  /**
   * pos: body centre relative to the scene origin (three coords); orient: row-major
   * body-fixed → ecliptic matrix.
   */
  place(id: BodyId, pos: THREE.Vector3, orient: number[] | null): void {
    const v = this.views.get(id)!;
    if (orient) eclMatrixToThree(orient, this.tmpM);
    else this.tmpM.identity();
    this.tmpM.setPosition(pos);
    v.group.matrix.copy(this.tmpM);
    v.group.matrixWorldNeedsUpdate = true;
    if (id === 'sun') {
      this.light.position.copy(pos);
      this.sunGlow.position.copy(pos);
    }
  }

  /** Earth day/night: the Sun direction in the Earth-fixed frame. */
  updateEarth(sunDirWorld: THREE.Vector3, simMs: number): void {
    const v = this.views.get('earth')!;
    const u = v.earth!.uniforms;
    this.tmpM3.setFromMatrix4(v.group.matrix);
    (u.uLocalToWorld.value as THREE.Matrix3).copy(this.tmpM3);
    const local = (u.uSunLocal.value as THREE.Vector3).copy(sunDirWorld).applyMatrix3(this.tmpM3.transpose()).normalize();
    void local;
    u.uCloudShift.value = ((simMs / 86_400_000) * 0.02) % 1;
  }

  /** The Sun's glow: a fixed share of the screen when far, hugging the disc when close. */
  updateGlow(sunPxRadius: number, viewportH: number): void {
    const px = Math.max(sunPxRadius * 9, 46);
    this.sunGlow.scale.setScalar((px / viewportH) * 2);
  }
}

function saturnRings(): THREE.Mesh {
  const inner = 74_500 / KM_PER_AU;
  const outer = 140_220 / KM_PER_AU;
  const g = new THREE.RingGeometry(inner, outer, 256, 1);
  // Radial texture coordinates: the ring texture is a strip from the inner to the outer edge.
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let k = 0; k < pos.count; k++) {
    const r = Math.hypot(pos.getX(k), pos.getY(k));
    uv.setXY(k, (r - inner) / (outer - inner), 0.5);
  }
  const m = new THREE.MeshStandardMaterial({
    map: tex('saturn-ring'),
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(g, m);
  ring.rotation.x = -Math.PI / 2; // into the equatorial (local XZ) plane
  ring.renderOrder = 1;
  return ring;
}

function glowTexture(): THREE.Texture {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.1, 'rgba(255,244,220,0.9)');
  g.addColorStop(0.2, 'rgba(255,214,150,0.35)');
  g.addColorStop(0.5, 'rgba(255,170,90,0.07)');
  g.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
