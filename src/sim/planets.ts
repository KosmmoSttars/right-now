// The major bodies from astronomy-engine (VSOP87 planets, ELP Moon, TOP2013 Pluto,
// IAU 2015 rotation models), converted to heliocentric ecliptic J2000 like the
// small-body elements.
import { AstroTime, Body, GeoMoon, HelioVector, PlanetOrbitalPeriod, RotationAxis } from 'astronomy-engine';
import type { Vec3 } from './kepler';
import { jdUtc } from './time';

export type BodyId = 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';

export const KM_PER_AU = 149_597_870.7;

export interface BodyInfo {
  id: BodyId;
  body: Body;
  /** Mean / equatorial radius, km. */
  radiusKm: number;
  /** Polar flattening. */
  flattening: number;
  color: string;
  /** Which body it orbits (the Moon orbits the Earth). */
  parent: BodyId | null;
  massEarths: number;
  /** Rotation period, hours (negative: retrograde). */
  dayHours: number;
}

export const BODIES: BodyInfo[] = [
  { id: 'sun', body: Body.Sun, radiusKm: 695_700, flattening: 0, color: '#ffd27a', parent: null, massEarths: 332_946, dayHours: 609.12 },
  { id: 'mercury', body: Body.Mercury, radiusKm: 2439.7, flattening: 0, color: '#b9b2a8', parent: 'sun', massEarths: 0.0553, dayHours: 1407.6 },
  { id: 'venus', body: Body.Venus, radiusKm: 6051.8, flattening: 0, color: '#e8cf9a', parent: 'sun', massEarths: 0.815, dayHours: -5832.5 },
  { id: 'earth', body: Body.Earth, radiusKm: 6378.137, flattening: 0.00335, color: '#6fb6ff', parent: 'sun', massEarths: 1, dayHours: 23.934 },
  { id: 'moon', body: Body.Moon, radiusKm: 1737.4, flattening: 0, color: '#cfcfcf', parent: 'earth', massEarths: 0.0123, dayHours: 655.7 },
  { id: 'mars', body: Body.Mars, radiusKm: 3396.2, flattening: 0.00589, color: '#e07a4f', parent: 'sun', massEarths: 0.107, dayHours: 24.623 },
  { id: 'jupiter', body: Body.Jupiter, radiusKm: 71_492, flattening: 0.06487, color: '#e3bf92', parent: 'sun', massEarths: 317.8, dayHours: 9.925 },
  { id: 'saturn', body: Body.Saturn, radiusKm: 60_268, flattening: 0.09796, color: '#ead9a8', parent: 'sun', massEarths: 95.2, dayHours: 10.656 },
  { id: 'uranus', body: Body.Uranus, radiusKm: 25_559, flattening: 0.0229, color: '#a6e3ea', parent: 'sun', massEarths: 14.5, dayHours: -17.24 },
  { id: 'neptune', body: Body.Neptune, radiusKm: 24_764, flattening: 0.0171, color: '#6f8fff', parent: 'sun', massEarths: 17.1, dayHours: 16.11 },
  { id: 'pluto', body: Body.Pluto, radiusKm: 1188.3, flattening: 0, color: '#d9c3a5', parent: 'sun', massEarths: 0.0022, dayHours: -153.29 },
];

export const BODY_BY_ID = Object.fromEntries(BODIES.map((b) => [b.id, b])) as Record<BodyId, BodyInfo>;

const OBLIQUITY = 23.4392911 * (Math.PI / 180);
const CE = Math.cos(OBLIQUITY);
const SE = Math.sin(OBLIQUITY);

/** J2000 equator (EQJ) → J2000 ecliptic. */
export function eqjToEcl(x: number, y: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = x;
  out[1] = CE * y + SE * z;
  out[2] = -SE * y + CE * z;
  return out;
}

export function astroTime(ms: number): AstroTime {
  return new AstroTime(new Date(ms));
}

/** Heliocentric ecliptic position, AU. */
export function bodyPosition(id: BodyId, t: AstroTime, out: Vec3 = [0, 0, 0]): Vec3 {
  if (id === 'sun') {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  if (id === 'moon') {
    const e = HelioVector(Body.Earth, t);
    const m = GeoMoon(t);
    return eqjToEcl(e.x + m.x, e.y + m.y, e.z + m.z, out);
  }
  const v = HelioVector(BODY_BY_ID[id].body, t);
  return eqjToEcl(v.x, v.y, v.z, out);
}

/**
 * Body-fixed frame → ecliptic, as a row-major 3×3 matrix: columns are the body's
 * prime-meridian, 90°E and north-pole directions. IAU: R = Rz(α0 + 90°) Rx(90° − δ0) Rz(W).
 */
export function bodyOrientation(id: BodyId, t: AstroTime): number[] {
  const ax = RotationAxis(BODY_BY_ID[id].body, t);
  const a = (ax.ra * 15 + 90) * (Math.PI / 180);
  const b = (90 - ax.dec) * (Math.PI / 180);
  const w = ax.spin * (Math.PI / 180);
  const rz = (g: number) => [Math.cos(g), -Math.sin(g), 0, Math.sin(g), Math.cos(g), 0, 0, 0, 1];
  const rx = (g: number) => [1, 0, 0, 0, Math.cos(g), -Math.sin(g), 0, Math.sin(g), Math.cos(g)];
  const mul = (p: number[], q: number[]) => {
    const r = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += p[i * 3 + k] * q[k * 3 + j];
    return r;
  };
  const eq = mul(mul(rz(a), rx(b)), rz(w));
  const ecl = [1, 0, 0, 0, CE, SE, 0, -SE, CE];
  return mul(ecl, eq);
}

/** Sidereal orbital period in days (the Moon: around the Earth). */
export function orbitalPeriodDays(id: BodyId): number {
  if (id === 'moon') return 27.321661;
  if (id === 'sun') return Infinity;
  return PlanetOrbitalPeriod(BODY_BY_ID[id].body);
}

/**
 * The orbit as drawn: positions over one period centred on now, relative to the
 * parent. Real ephemeris points, so the curve passes exactly through the body.
 */
export function bodyOrbitPath(id: BodyId, ms: number, n: number): Vec3[] {
  const period = orbitalPeriodDays(id);
  const pts: Vec3[] = [];
  const parent = BODY_BY_ID[id].parent;
  for (let k = 0; k <= n; k++) {
    const t = astroTime(ms + (k / n - 0.5) * period * 86_400_000);
    const p = bodyPosition(id, t);
    if (parent && parent !== 'sun') {
      const q = bodyPosition(parent, t);
      p[0] -= q[0];
      p[1] -= q[1];
      p[2] -= q[2];
    }
    pts.push(p);
  }
  return pts;
}

export const jdOf = (t: AstroTime): number => jdUtc(t.date.getTime());
