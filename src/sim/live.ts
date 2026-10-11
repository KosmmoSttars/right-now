// The live bundle: close approaches (CNEOS), fireballs, the Sentry impact-risk list,
// Scout's unconfirmed new objects, comets, and the last days of meteors from the
// Global Meteor Network. Rows are compact arrays; see build_live() in data.php.
import { API, fetchJson } from './catalog';
import { msFromJdTT, msFromJdUtc } from './time';

type Num = number | null;

export interface LiveBundle {
  v: number;
  builtAt: string;
  /** des, full name, JD (TDB), dist, dist_min, dist_max (AU), v_rel km/s, H, diameter km */
  approaches: [string, string, number, number, number, number, number, Num, Num][];
  /** date UTC, energy 1e10 J, impact energy kt, lat, lon, alt km, vel km/s, vx, vy, vz */
  fireballs: [string, number, number, number, number, Num, Num, Num, Num, Num][];
  /** des, full name, impact probability, Palermo cumulative, Torino max, diameter km, years */
  sentry: [string, string, Num, Num, number, Num, string][];
  /** temp designation, H, NEO score, PHA score, closest approach LD, v_inf, nObs, arc days, last run */
  scout: [string, Num, number, number, Num, Num, number, Num, string][];
  /** name, tp (JD TDB), q, e, i, node, peri, M1 */
  comets: [string, number, number, number, number, number, number, Num][];
  /** JD UTC, shower, q, e, i, node, peri, true anomaly, Vgeo, lat0, lon0, h0, lat1, lon1, h1, abs mag, mass kg */
  meteors: [number, string, number, number, number, number, number, number, number, number, number, number, number, number, number, Num, Num][];
}

export function loadLive(): Promise<LiveBundle> {
  return fetchJson<LiveBundle>(`${API}?set=live`, 6);
}

export const LD_AU = 384_400 / 149_597_870.7;

export interface Approach {
  des: string;
  name: string;
  jdTT: number;
  ms: number;
  distAu: number;
  distMinAu: number;
  distMaxAu: number;
  vKms: number;
  h: number | null;
  diameterKm: number | null;
}

export function approaches(b: LiveBundle): Approach[] {
  return b.approaches.map(([des, name, jd, d, dmin, dmax, v, h, diam]) => ({
    des,
    name: name.replace(/^\((.*)\)$/, '$1'),
    jdTT: jd,
    ms: msFromJdTT(jd),
    distAu: d,
    distMinAu: dmin,
    distMaxAu: dmax,
    vKms: v,
    h,
    diameterKm: diam,
  }));
}

export interface Fireball {
  ms: number;
  energy: number;
  impactKt: number;
  lat: number;
  lon: number;
  altKm: number | null;
  velKms: number | null;
}

export function fireballs(b: LiveBundle): Fireball[] {
  return b.fireballs
    .map(([date, energy, kt, lat, lon, alt, vel]) => ({ ms: Date.parse(date.replace(' ', 'T') + 'Z'), energy, impactKt: kt, lat, lon, altKm: alt, velKms: vel }))
    .sort((a, b) => b.ms - a.ms);
}

export interface Meteor {
  ms: number;
  jd: number;
  shower: string;
  q: number;
  e: number;
  i: number;
  node: number;
  peri: number;
  f: number;
  vgeo: number;
  begin: [number, number, number];
  end: [number, number, number];
  mag: number | null;
  massKg: number | null;
}

export function meteors(b: LiveBundle): Meteor[] {
  return b.meteors.map(([jd, shower, q, e, i, node, peri, f, vgeo, la0, lo0, h0, la1, lo1, h1, mag, mass]) => ({
    ms: msFromJdUtc(jd),
    jd,
    shower,
    q, e, i, node, peri, f, vgeo,
    begin: [la0, lo0, h0],
    end: [la1, lo1, h1],
    mag,
    massKg: mass,
  }));
}

// ------------------------------------------------------------------ showers

export interface Shower {
  code: string;
  name: { en: string; ru: string };
  parent: string;
  /** Solar longitude (J2000, degrees): activity start, peak, end. */
  start: number;
  peak: number;
  end: number;
  zhr: number;
  color: string;
}

// IMO working list values. Colours: one hue family per parent (Halley's two showers
// share one, so do the Taurids).
export const SHOWERS: Shower[] = [
  { code: 'QUA', name: { en: 'Quadrantids', ru: 'Квадрантиды' }, parent: '2003 EH1', start: 276, peak: 283.15, end: 292, zhr: 80, color: '#7fd6ff' },
  { code: 'LYR', name: { en: 'Lyrids', ru: 'Лириды' }, parent: 'C/1861 G1 (Thatcher)', start: 24, peak: 32.32, end: 40, zhr: 18, color: '#a3a0ff' },
  { code: 'ETA', name: { en: 'Eta Aquariids', ru: 'Эта-Аквариды' }, parent: '1P/Halley', start: 29, peak: 45.5, end: 67, zhr: 50, color: '#ffd166' },
  { code: 'SDA', name: { en: 'Southern Delta Aquariids', ru: 'Южные дельта-Аквариды' }, parent: '96P/Machholz', start: 110, peak: 127, end: 150, zhr: 25, color: '#9be7a3' },
  { code: 'CAP', name: { en: 'Alpha Capricornids', ru: 'Альфа-Каприкорниды' }, parent: '169P/NEAT', start: 101, peak: 127, end: 143, zhr: 5, color: '#e6a3ff' },
  { code: 'PER', name: { en: 'Perseids', ru: 'Персеиды' }, parent: '109P/Swift–Tuttle', start: 115, peak: 140.0, end: 152, zhr: 100, color: '#ff8fb1' },
  { code: 'SPE', name: { en: 'September Epsilon Perseids', ru: 'Сентябрьские эпсилон-Персеиды' }, parent: '—', start: 162, peak: 166.7, end: 173, zhr: 5, color: '#d9b8ff' },
  { code: 'DRA', name: { en: 'Draconids', ru: 'Дракониды' }, parent: '21P/Giacobini–Zinner', start: 193, peak: 195.4, end: 197, zhr: 10, color: '#8cf0d8' },
  { code: 'STA', name: { en: 'Southern Taurids', ru: 'Южные Тауриды' }, parent: '2P/Encke', start: 167, peak: 197, end: 238, zhr: 5, color: '#ffb47a' },
  { code: 'ORI', name: { en: 'Orionids', ru: 'Ориониды' }, parent: '1P/Halley', start: 189, peak: 208, end: 225, zhr: 20, color: '#ffd166' },
  { code: 'NTA', name: { en: 'Northern Taurids', ru: 'Северные Тауриды' }, parent: '2P/Encke', start: 207, peak: 230, end: 257, zhr: 5, color: '#ffb47a' },
  { code: 'LEO', name: { en: 'Leonids', ru: 'Леониды' }, parent: '55P/Tempel–Tuttle', start: 224, peak: 235.27, end: 248, zhr: 15, color: '#ff7a7a' },
  { code: 'MON', name: { en: 'December Monocerotids', ru: 'Декабрьские Моноцеротиды' }, parent: 'C/1917 F1 (Mellish)', start: 245, peak: 257, end: 270, zhr: 3, color: '#b0c4ff' },
  { code: 'GEM', name: { en: 'Geminids', ru: 'Геминиды' }, parent: '3200 Phaethon', start: 252, peak: 262.2, end: 268, zhr: 150, color: '#7af0ff' },
  { code: 'HYD', name: { en: 'Sigma Hydrids', ru: 'Сигма-Гидриды' }, parent: '—', start: 250, peak: 265, end: 276, zhr: 7, color: '#c7f59a' },
  { code: 'URS', name: { en: 'Ursids', ru: 'Урсиды' }, parent: '8P/Tuttle', start: 265, peak: 270.7, end: 275, zhr: 10, color: '#ffe08a' },
];

export const SHOWER_BY_CODE = Object.fromEntries(SHOWERS.map((s) => [s.code, s]));

/** Degrees of solar longitude from a to b going forward (0..360). */
export function lonAhead(a: number, b: number): number {
  return (((b - a) % 360) + 360) % 360;
}

export function showerActive(s: Shower, solarLon: number): boolean {
  return lonAhead(s.start, solarLon) <= lonAhead(s.start, s.end);
}

export interface StreamsFile {
  source: string;
  year: number;
  showers: Record<string, { count2025: number; orbits: [number, number, number, number, number][] }>;
}

export function loadStreams(): Promise<StreamsFile> {
  return fetchJson<StreamsFile>('data/streams.json');
}

// ------------------------------------------------------------------ Horizons tracks

export interface Track {
  des: string;
  /** JD TDB, x, y, z (AU), vx, vy, vz (AU/day), heliocentric ecliptic. */
  rows: [number, number, number, number, number, number, number][];
}

const tracks = new Map<string, Promise<Track | null>>();

export function loadTrack(des: string, jd: number): Promise<Track | null> {
  const key = `${des}@${Math.floor(jd)}`;
  let p = tracks.get(key);
  if (!p) {
    p = fetch(`${API}?set=track&des=${encodeURIComponent(des)}&jd=${jd.toFixed(3)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Track>) : null))
      .catch(() => null);
    tracks.set(key, p);
  }
  return p;
}

/** Cubic Hermite position from a track at JD TT; null outside it. */
export function trackPosition(t: Track, jd: number, out: [number, number, number]): [number, number, number] | null {
  const rows = t.rows;
  if (rows.length < 2 || jd < rows[0][0] || jd > rows[rows.length - 1][0]) return null;
  const step = rows[1][0] - rows[0][0];
  const k = Math.min(rows.length - 2, Math.max(0, Math.floor((jd - rows[0][0]) / step)));
  const a = rows[k];
  const b = rows[k + 1];
  const h = b[0] - a[0];
  const s = (jd - a[0]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let c = 0; c < 3; c++) out[c] = h00 * a[1 + c] + h10 * h * a[4 + c] + h01 * b[1 + c] + h11 * h * b[4 + c];
  return out;
}

export { msFromJdTT };
