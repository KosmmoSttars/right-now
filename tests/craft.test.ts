import { describe, expect, it } from 'vitest';
import { craftFix, flybys, makeCraft, tablePosition, type CraftTable } from '../src/sim/craft';
import type { Vec3 } from '../src/sim/kepler';

/** A circular orbit of radius r (AU) and period P (days), sampled every dt days. */
function circle(r: number, P: number, dt: number, n: number, c: CraftTable['c'] = 'sun', k: CraftTable['k'] = 'cruise'): CraftTable {
  const w = (2 * Math.PI) / P;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = w * i * dt;
    rows.push([r * Math.cos(a), r * Math.sin(a), 0, -r * w * Math.sin(a), r * w * Math.cos(a), 0]);
  }
  return { c, k, t0: 2461000, dt, rows };
}

describe('spacecraft tables', () => {
  it('passes through the samples and follows a curve between them', () => {
    const t = circle(1, 365.25, 5, 100);
    const p: Vec3 = [0, 0, 0];
    tablePosition(t, t.t0 + 5 * 7, p);
    expect(p[0]).toBeCloseTo(t.rows[7][0], 12);
    // Halfway between samples a cubic Hermite stays on the circle to well under 1e-6 au.
    tablePosition(t, t.t0 + 5 * 7.5, p);
    expect(Math.abs(Math.hypot(p[0], p[1]) - 1)).toBeLessThan(1e-6);
  });

  it('uses the finest table and adds its centre body', () => {
    const c = makeCraft({ id: 'x', hz: '-1', name: 'X', agency: '', launch: '2020-01-01', wiki: '', about: { en: '', ru: '' } });
    c.tables = [circle(1, 365.25, 5, 100), { ...circle(1e-4, 1, 0.01, 500, 'mars', 'now') }];
    const mars: Vec3 = [1.5, 0, 0];
    const jd = c.tables[1].t0 + 1.234;
    const f = craftFix(c, jd, (id) => (id === 'mars' ? mars : [0, 0, 0]))!;
    expect(f.center).toBe('mars');
    expect(Math.abs(Math.hypot(f.pos[0] - 1.5, f.pos[1]) - 1e-4)).toBeLessThan(1e-9);
  });

  it('pins an orbiter to its planet when only the coarse table covers the time', () => {
    const c = makeCraft({ id: 'o', hz: '-2', name: 'O', agency: '', launch: '2020-01-01', wiki: '', about: { en: '', ru: '' }, visits: [{ body: 'mars', from: '2020-06-01' }] });
    c.tables = [circle(1.5, 687, 5, 300)];
    const f = craftFix(c, 2461100, (id) => (id === 'mars' ? [1.5, 0.1, 0] : [0, 0, 0]))!;
    expect(f.pinned).toBe(true);
    expect(f.pos).toEqual([1.5, 0.1, 0]);
  });

  it('finds the closest approach of a flyby window', () => {
    // A straight pass at 1e-4 au from the body at 0.01 au/day, closest at day 3.3.
    const rows = [];
    for (let i = 0; i <= 144; i++) {
      const t = i / 24 - 3.3;
      rows.push([0.01 * t, 1e-4, 0, 0.01, 0, 0]);
    }
    const c = makeCraft({ id: 'f', hz: '-3', name: 'F', agency: '', launch: '2020-01-01', wiki: '', about: { en: '', ru: '' } });
    c.tables = [{ c: 'earth', k: 'flyby', t0: 2461000, dt: 1 / 24, rows }];
    const [fb] = flybys(c);
    expect(fb.jd).toBeCloseTo(2461003.3, 4);
    expect(fb.distAu).toBeCloseTo(1e-4, 9);
    expect(fb.speed).toBeCloseTo(0.01, 6);
  });
});
