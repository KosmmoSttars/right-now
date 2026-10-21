import { Body, Equator, GeoVector, Horizon, Observer } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { astroTime } from '../src/sim/planets';
import { altAzToDir, applyRow, bodySky, dirToAltAz, eqjToScene, limitingMag, refraction, sunState, topocentric, type Place } from '../src/sim/sky';

const moscow: Place = { lat: 55.75, lon: 37.62, height: 150, name: 'Moscow' };
const ms = Date.parse('2026-10-21T19:30:00Z');

describe('sky frame', () => {
  it('round-trips altitude and azimuth', () => {
    for (const [alt, az] of [[0, 0], [30, 90], [-12, 200], [75, 315]]) {
      const h = dirToAltAz(altAzToDir(alt, az));
      expect(h.alt).toBeCloseTo(alt, 9);
      expect(h.az).toBeCloseTo(az, 9);
    }
  });

  it('puts north at −z and east at +x', () => {
    expect(altAzToDir(0, 0)[2]).toBeCloseTo(-1, 12);
    expect(altAzToDir(0, 90)[0]).toBeCloseTo(1, 12);
  });

  it('rotates J2000 directions like astronomy-engine does', () => {
    const t = astroTime(ms);
    const obs = new Observer(moscow.lat, moscow.lon, moscow.height);
    for (const body of [Body.Jupiter, Body.Saturn, Body.Sun]) {
      const v = GeoVector(body, t, true);
      const r = Math.hypot(v.x, v.y, v.z);
      const mine = dirToAltAz(applyRow(eqjToScene(ms, moscow), [v.x / r, v.y / r, v.z / r]));
      const eq = Equator(body, t, obs, true, true);
      const ref = Horizon(t, obs, eq.ra, eq.dec);
      expect(Math.abs(mine.alt - ref.altitude)).toBeLessThan(0.02);
      expect(Math.abs(((mine.az - ref.azimuth + 540) % 360) - 180)).toBeLessThan(0.05);
    }
  });

  it('gives a night sky over Moscow at 22:30 local time', () => {
    const sun = bodySky('sun', ms, moscow);
    expect(sun.alt).toBeLessThan(-18);
    expect(sunState(sun.alt)).toBe('night');
    expect(limitingMag(sun.alt)).toBeGreaterThan(6);
  });

  it('refracts most at the horizon', () => {
    expect(refraction(0)).toBeGreaterThan(0.45);
    expect(refraction(0)).toBeLessThan(0.6);
    expect(refraction(45)).toBeLessThan(0.02);
  });

  it('sees a point 100 km straight up at the zenith', () => {
    const t = topocentric(moscow, moscow.lat, moscow.lon, 100.15);
    expect(t.dir[1]).toBeCloseTo(1, 6);
    expect(t.rangeKm).toBeCloseTo(100, 3);
  });

  it('dims the sky limit steadily through twilight', () => {
    let last = Infinity;
    for (let a = -20; a <= 5; a += 1) {
      const m = limitingMag(a);
      expect(m).toBeLessThanOrEqual(last);
      last = m;
    }
  });
});
