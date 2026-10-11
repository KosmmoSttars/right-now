// Two-body heliocentric motion in double precision, for every conic: ellipses
// (asteroids, most comets), near-parabolas and hyperbolas (new comets, interstellar
// visitors, a few meteoroids). Positions are ecliptic J2000, AU.

export const GAUSS_K = 0.01720209895; // rad/day, AU^1.5
export const DEG = Math.PI / 180;

export interface Orbit {
  /** Perihelion distance, AU. */
  q: number;
  e: number;
  /** Inclination, ascending node, argument of perihelion: radians. */
  i: number;
  node: number;
  peri: number;
  /** Time of perihelion, JD TT. */
  tp: number;
}

export type Vec3 = [number, number, number];

/** From the usual a, e, mean anomaly at an epoch (angles in degrees). */
export function orbitFromMean(a: number, e: number, iDeg: number, nodeDeg: number, periDeg: number, mDeg: number, epochJd: number): Orbit {
  const n = GAUSS_K / Math.pow(a, 1.5);
  let m = (mDeg * DEG) % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  return { q: a * (1 - e), e, i: iDeg * DEG, node: nodeDeg * DEG, peri: periDeg * DEG, tp: epochJd - m / n };
}

/** From q, e and the true anomaly at a moment (GMN meteoroids). */
export function orbitFromTrue(q: number, e: number, iDeg: number, nodeDeg: number, periDeg: number, fDeg: number, jd: number): Orbit {
  const f = fDeg * DEG;
  const base = { q, e, i: iDeg * DEG, node: nodeDeg * DEG, peri: periDeg * DEG };
  if (e < 1) {
    const a = q / (1 - e);
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(f / 2));
    const M = E - e * Math.sin(E);
    return { ...base, tp: jd - M / (GAUSS_K / Math.pow(a, 1.5)) };
  }
  if (e > 1) {
    const a = q / (e - 1);
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(f / 2));
    const M = e * Math.sinh(H) - H;
    return { ...base, tp: jd - M / (GAUSS_K / Math.pow(a, 1.5)) };
  }
  const s = Math.tan(f / 2);
  return { ...base, tp: jd - (Math.sqrt(2 * q * q * q) * (s + (s * s * s) / 3)) / GAUSS_K };
}

export function semiMajorAxis(o: Orbit): number {
  return o.q / (1 - o.e); // negative for hyperbolas
}

export function periodDays(o: Orbit): number {
  if (o.e >= 1) return Infinity;
  return (2 * Math.PI * Math.pow(semiMajorAxis(o), 1.5)) / GAUSS_K;
}

/** Eccentric anomaly for an ellipse; robust up to e → 1. */
export function solveKepler(M: number, e: number): number {
  M = M % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 60; k++) {
    const f = E - e * Math.sin(E) - M;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

function solveHyperbolic(M: number, e: number): number {
  let H = Math.asinh(M / e);
  for (let k = 0; k < 80; k++) {
    const f = e * Math.sinh(H) - H - M;
    const d = f / (e * Math.cosh(H) - 1);
    H -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return H;
}

/** In-plane position (x toward perihelion) and true anomaly at time jd. */
export function inPlane(o: Orbit, jd: number): { x: number; y: number; r: number; nu: number } {
  const dt = jd - o.tp;
  const e = o.e;
  if (Math.abs(e - 1) < 1e-6) {
    // Barker's equation.
    const w = (GAUSS_K * dt) / Math.sqrt(2 * o.q * o.q * o.q);
    const y3 = 1.5 * w;
    const s = Math.cbrt(y3 + Math.sqrt(y3 * y3 + 1)) - Math.cbrt(Math.sqrt(y3 * y3 + 1) - y3);
    const x = o.q * (1 - s * s);
    const y = 2 * o.q * s;
    return { x, y, r: Math.hypot(x, y), nu: 2 * Math.atan(s) };
  }
  if (e < 1) {
    const a = o.q / (1 - e);
    const E = solveKepler((GAUSS_K / Math.pow(a, 1.5)) * dt, e);
    const x = a * (Math.cos(E) - e);
    const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    return { x, y, r: Math.hypot(x, y), nu: Math.atan2(y, x) };
  }
  const a = o.q / (e - 1);
  const H = solveHyperbolic((GAUSS_K / Math.pow(a, 1.5)) * dt, e);
  const x = a * (e - Math.cosh(H));
  const y = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  return { x, y, r: Math.hypot(x, y), nu: Math.atan2(y, x) };
}

/** Rotates an in-plane point (x toward perihelion) to ecliptic coordinates. */
export function toEcliptic(o: Orbit, x: number, y: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const cw = Math.cos(o.peri), sw = Math.sin(o.peri);
  const cn = Math.cos(o.node), sn = Math.sin(o.node);
  const ci = Math.cos(o.i), si = Math.sin(o.i);
  const px = cw * cn - sw * sn * ci, py = cw * sn + sw * cn * ci, pz = sw * si;
  const qx = -sw * cn - cw * sn * ci, qy = -sw * sn + cw * cn * ci, qz = cw * si;
  out[0] = x * px + y * qx;
  out[1] = x * py + y * qy;
  out[2] = x * pz + y * qz;
  return out;
}

export function positionAt(o: Orbit, jd: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const p = inPlane(o, jd);
  return toEcliptic(o, p.x, p.y, out);
}

/** Heliocentric speed, km/s (vis-viva). */
export function speedKms(o: Orbit, r: number): number {
  const a = semiMajorAxis(o);
  const v = GAUSS_K * Math.sqrt(2 / r - 1 / a); // AU/day
  return (v * 149597870.7) / 86400;
}

/**
 * Points along the orbit for drawing: the whole ellipse, or for open orbits the arc
 * out to rMax on both sides of perihelion. Sampled by eccentric anomaly so the
 * points crowd where the curve bends.
 */
export function orbitPath(o: Orbit, n: number, rMax = 80): Vec3[] {
  const pts: Vec3[] = [];
  const e = o.e;
  if (e < 0.99) {
    const a = o.q / (1 - e);
    const b = a * Math.sqrt(1 - e * e);
    for (let k = 0; k <= n; k++) {
      const E = (k / n) * 2 * Math.PI;
      pts.push(toEcliptic(o, a * (Math.cos(E) - e), b * Math.sin(E)));
    }
    return pts;
  }
  // Open or nearly open: sample by true anomaly up to rMax (and the asymptote).
  const nuLimit = e >= 1 ? Math.acos(-1 / e) - 1e-3 : Math.PI;
  const nuR = Math.acos(Math.min(1, Math.max(-1, ((o.q * (1 + e)) / rMax - 1) / e)));
  const nuMax = Math.min(nuLimit, nuR);
  for (let k = 0; k <= n; k++) {
    const nu = -nuMax + (2 * nuMax * k) / n;
    const r = (o.q * (1 + e)) / (1 + e * Math.cos(nu));
    pts.push(toEcliptic(o, r * Math.cos(nu), r * Math.sin(nu)));
  }
  return pts;
}
