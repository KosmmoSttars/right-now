// The sky from a place on the Earth: horizontal coordinates, rise and set times,
// twilight, shower radiants and the brightest named stars. Built on astronomy-engine
// (its HOR frame is x = north, y = west, z = zenith).
//
// Scene convention for the planetarium: three.js x = east, y = up, z = south, so an
// observer looking north looks down −z.
import { Body, Equator, Horizon, Illumination, MoonPhase, Observer, RotateVector, Rotation_EQJ_HOR, SearchAltitude, SearchHourAngle, SearchRiseSet, Vector, type AstroTime } from 'astronomy-engine';
import type { BodyId } from './planets';
import { BODY_BY_ID, astroTime } from './planets';

export interface Place {
  lat: number;
  lon: number;
  /** Metres above sea level. */
  height: number;
  /** City name, or null for coordinates typed in or from the browser. */
  name: string | null;
  country?: string;
}

export const DEG = Math.PI / 180;

export function observer(p: Place): Observer {
  return new Observer(p.lat, p.lon, p.height);
}

/** Horizontal direction (altitude, azimuth from north through east, degrees) → scene unit vector. */
export function altAzToDir(altDeg: number, azDeg: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  out[0] = Math.cos(alt) * Math.sin(az);
  out[1] = Math.sin(alt);
  out[2] = -Math.cos(alt) * Math.cos(az);
  return out;
}

/** Scene unit vector → altitude and azimuth, degrees. */
export function dirToAltAz(d: ArrayLike<number>): { alt: number; az: number } {
  const alt = Math.asin(Math.max(-1, Math.min(1, d[1]))) / DEG;
  const az = ((Math.atan2(d[0], -d[2]) / DEG) % 360 + 360) % 360;
  return { alt, az };
}

/**
 * J2000 equatorial → scene rotation at a time and place, as a row-major 3×3
 * (precession, nutation and the Earth's rotation; no refraction).
 */
export function eqjToScene(ms: number, p: Place): number[] {
  const rot = Rotation_EQJ_HOR(astroTime(ms), observer(p));
  const m = new Array<number>(9);
  const t = astroTime(ms);
  const basis = [new Vector(1, 0, 0, t), new Vector(0, 1, 0, t), new Vector(0, 0, 1, t)];
  basis.forEach((b, col) => {
    const h = RotateVector(rot, b);
    // HOR (north, west, up) → scene (east, up, south).
    m[0 * 3 + col] = -h.y;
    m[1 * 3 + col] = h.z;
    m[2 * 3 + col] = -h.x;
  });
  return m;
}

/** RA (hours or degrees) and Dec (degrees) → J2000 equatorial unit vector. */
export function raDecToEqj(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

export function applyRow(m: number[], v: ArrayLike<number>, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

export interface BodySky {
  id: BodyId;
  /** Apparent altitude (with standard refraction) and azimuth, degrees. */
  alt: number;
  az: number;
  /** Geometric (unrefracted) direction in the scene, for drawing. */
  dir: [number, number, number];
  distAu: number;
  mag: number;
  /** Lit fraction (Moon and planets). */
  phase: number;
}

const BODY_ENUM: Record<BodyId, Body> = Object.fromEntries(
  (Object.keys(BODY_BY_ID) as BodyId[]).map((id) => [id, BODY_BY_ID[id].body]),
) as Record<BodyId, Body>;

/** Where a Solar System body stands in the sky right now. */
export function bodySky(id: BodyId, ms: number, p: Place): BodySky {
  const t = astroTime(ms);
  const obs = observer(p);
  const eq = Equator(BODY_ENUM[id], t, obs, true, true);
  const app = Horizon(t, obs, eq.ra, eq.dec, 'normal');
  const geo = Horizon(t, obs, eq.ra, eq.dec);
  let mag = -26.74;
  let phase = 1;
  if (id !== 'sun' && id !== 'earth') {
    const ill = Illumination(BODY_ENUM[id], t);
    mag = ill.mag;
    phase = ill.phase_fraction;
  }
  return { id, alt: app.altitude, az: app.azimuth, dir: altAzToDir(geo.altitude, geo.azimuth), distAu: eq.dist, mag, phase };
}

/** Apparent altitude and azimuth of a J2000 direction (stars, radiants, spacecraft), degrees. */
export function eqjAltAz(vec: ArrayLike<number>, ms: number, p: Place, m = eqjToScene(ms, p)): { alt: number; az: number } {
  const r = Math.hypot(vec[0], vec[1], vec[2]);
  const { alt, az } = dirToAltAz(applyRow(m, [vec[0] / r, vec[1] / r, vec[2] / r]));
  return { alt: alt + refraction(alt), az };
}

/** Standard atmospheric refraction (Saemundsson), degrees, for a true altitude. */
export function refraction(altDeg: number): number {
  if (altDeg < -1) return 0;
  const h = Math.max(altDeg, -0.9);
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
}

export interface RiseSet {
  rise: number | null;
  transit: number | null;
  set: number | null;
  /** Transit altitude, degrees. */
  transitAlt: number | null;
}

/** Next rise, transit and set within a day of ms (Unix ms, or null). */
export function riseSet(id: BodyId, ms: number, p: Place): RiseSet {
  const obs = observer(p);
  const t = astroTime(ms);
  const toMs = (a: AstroTime | null) => (a ? a.date.getTime() : null);
  const rise = SearchRiseSet(BODY_ENUM[id], obs, +1, t, 1.2);
  const set = SearchRiseSet(BODY_ENUM[id], obs, -1, t, 1.2);
  let transit: number | null = null;
  let transitAlt: number | null = null;
  try {
    const h = SearchHourAngle(BODY_ENUM[id], obs, 0, t, +1);
    transit = h.time.date.getTime();
    transitAlt = h.hor.altitude;
  } catch {
    // circumpolar edge cases: leave empty
  }
  return { rise: toMs(rise), transit, set: toMs(set), transitAlt };
}

export type SunState = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

export function sunState(sunAlt: number): SunState {
  if (sunAlt > -0.833) return 'day';
  if (sunAlt > -6) return 'civil';
  if (sunAlt > -12) return 'nautical';
  if (sunAlt > -18) return 'astronomical';
  return 'night';
}

/** The next time the Sun crosses an altitude going down (direction −1) or up (+1). */
export function sunCrossing(ms: number, p: Place, direction: 1 | -1, altitude: number): number | null {
  const a = SearchAltitude(Body.Sun, observer(p), direction, astroTime(ms), 2, altitude);
  return a ? a.date.getTime() : null;
}

/** Moon phase angle (0 new, 90 first quarter, 180 full, 270 last quarter). */
export function moonPhaseAngle(ms: number): number {
  return MoonPhase(astroTime(ms));
}

/**
 * Faintest star visible to the eye for a Sun altitude, roughly: 6 in a dark sky,
 * dropping through twilight to only the brightest planets by day.
 */
export function limitingMag(sunAlt: number): number {
  if (sunAlt < -18) return 6.2;
  if (sunAlt > 0) return -3.5;
  // −18° → 6.2, −12° → 5.2, −6° → 2.5, 0° → −1
  const pts: [number, number][] = [[-18, 6.2], [-12, 5.2], [-6, 2.5], [0, -1]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [a0, m0] = pts[k];
    const [a1, m1] = pts[k + 1];
    if (sunAlt <= a1) return m0 + ((sunAlt - a0) / (a1 - a0)) * (m1 - m0);
  }
  return -1;
}

/** 16-point compass name index (0 = N, 4 = E...). */
export function compassIndex(azDeg: number): number {
  return Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16;
}

export const COMPASS = {
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
  ru: ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'],
};

// ------------------------------------------------------------------ meteors

const A_WGS = 6378.137;
const F_WGS = 1 / 298.257223563;

/** Geodetic latitude, longitude (degrees) and height (km) → Earth-fixed km. */
export function ecef(latDeg: number, lonDeg: number, hKm: number): [number, number, number] {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const e2 = F_WGS * (2 - F_WGS);
  const n = A_WGS / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return [(n + hKm) * Math.cos(la) * Math.cos(lo), (n + hKm) * Math.cos(la) * Math.sin(lo), (n * (1 - e2) + hKm) * Math.sin(la)];
}

/** A point above the Earth (lat, lon, height km) as seen from a place: scene direction and range. */
export function topocentric(p: Place, latDeg: number, lonDeg: number, hKm: number): { dir: [number, number, number]; rangeKm: number } {
  const o = ecef(p.lat, p.lon, p.height / 1000);
  const t = ecef(latDeg, lonDeg, hKm);
  const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  const la = p.lat * DEG;
  const lo = p.lon * DEG;
  // East, north, up at the observer.
  const e = -Math.sin(lo) * d[0] + Math.cos(lo) * d[1];
  const n = -Math.sin(la) * Math.cos(lo) * d[0] - Math.sin(la) * Math.sin(lo) * d[1] + Math.cos(la) * d[2];
  const u = Math.cos(la) * Math.cos(lo) * d[0] + Math.cos(la) * Math.sin(lo) * d[1] + Math.sin(la) * d[2];
  const r = Math.hypot(e, n, u);
  return { dir: [e / r, u / r, -n / r], rangeKm: r };
}

/** Great-circle distance between two places on the Earth, km. */
export function groundKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ------------------------------------------------------------------ catalogues

/** Shower radiants at peak, J2000 RA/Dec degrees (IMO working list). */
export const RADIANTS: Record<string, [number, number]> = {
  QUA: [230, 49], LYR: [271, 34], ETA: [338, -1], SDA: [340, -16], CAP: [307, -10], PER: [48, 58],
  SPE: [48, 40], DRA: [262, 54], STA: [32, 9], ORI: [95, 16], NTA: [58, 22], LEO: [152, 22],
  MON: [100, 8], GEM: [112, 33], HYD: [125, 2], URS: [217, 76],
};

/** The brightest stars by proper name: [en, ru, RA hours, Dec degrees] (J2000). */
export const NAMED_STARS: [string, string, number, number][] = [
  ['Sirius', 'Сириус', 6.7525, -16.716], ['Canopus', 'Канопус', 6.3992, -52.696], ['Arcturus', 'Арктур', 14.261, 19.182],
  ['Rigil Kentaurus', 'Альфа Центавра', 14.6601, -60.834], ['Vega', 'Вега', 18.6156, 38.784], ['Capella', 'Капелла', 5.2782, 45.998],
  ['Rigel', 'Ригель', 5.2423, -8.202], ['Procyon', 'Процион', 7.655, 5.225], ['Achernar', 'Ахернар', 1.6286, -57.237],
  ['Betelgeuse', 'Бетельгейзе', 5.9195, 7.407], ['Hadar', 'Хадар', 14.0637, -60.373], ['Altair', 'Альтаир', 19.8464, 8.868],
  ['Acrux', 'Акрукс', 12.4433, -63.099], ['Aldebaran', 'Альдебаран', 4.5987, 16.509], ['Antares', 'Антарес', 16.4901, -26.432],
  ['Spica', 'Спика', 13.4199, -11.161], ['Pollux', 'Поллукс', 7.7553, 28.026], ['Fomalhaut', 'Фомальгаут', 22.9608, -29.622],
  ['Deneb', 'Денеб', 20.6905, 45.28], ['Mimosa', 'Мимоза', 12.7954, -59.689], ['Regulus', 'Регул', 10.1395, 11.967],
  ['Adhara', 'Адара', 6.9771, -28.972], ['Castor', 'Кастор', 7.5767, 31.888], ['Shaula', 'Шаула', 17.5601, -37.104],
  ['Bellatrix', 'Беллатрикс', 5.4189, 6.35], ['Elnath', 'Эльнат', 5.4382, 28.608], ['Alnilam', 'Альнилам', 5.6036, -1.202],
  ['Alnitak', 'Альнитак', 5.6793, -1.943], ['Mintaka', 'Минтака', 5.5334, -0.299], ['Alioth', 'Алиот', 12.9005, 55.96],
  ['Dubhe', 'Дубхе', 11.0621, 61.751], ['Mirfak', 'Мирфак', 3.4054, 49.861], ['Polaris', 'Полярная', 2.5303, 89.264],
  ['Alkaid', 'Бенетнаш', 13.7923, 49.313], ['Mizar', 'Мицар', 13.3988, 54.925], ['Alphard', 'Альфард', 9.4598, -8.659],
  ['Hamal', 'Хамаль', 2.1196, 23.462], ['Algol', 'Алголь', 3.1361, 40.956], ['Rasalhague', 'Рас Альхаге', 17.5822, 12.56],
  ['Denebola', 'Денебола', 11.8177, 14.572], ['Alpheratz', 'Альферац', 0.1398, 29.091], ['Mirach', 'Мирах', 1.1622, 35.621],
  ['Schedar', 'Шедар', 0.6751, 56.537], ['Kochab', 'Кохаб', 14.8451, 74.156], ['Sadr', 'Садр', 20.3705, 40.257],
  ['Albireo', 'Альбирео', 19.512, 27.96], ['Enif', 'Эниф', 21.7364, 9.875], ['Markab', 'Маркаб', 23.0793, 15.205],
  ['Scheat', 'Шеат', 23.0629, 28.083], ['Alderamin', 'Альдерамин', 21.3096, 62.586], ['Caph', 'Каф', 0.1530, 59.150],
  ['Menkalinan', 'Менкалинан', 5.9921, 44.948], ['Alhena', 'Альхена', 6.6285, 16.399], ['Mirzam', 'Мирзам', 6.3783, -17.956],
  ['Saiph', 'Саиф', 5.7959, -9.67], ['Wezen', 'Везен', 7.1399, -26.393], ['Peacock', 'Павлин', 20.4275, -56.735],
  ['Alnair', 'Альнаир', 22.1372, -46.961], ['Gacrux', 'Гакрукс', 12.5194, -57.113], ['Atria', 'Атрия', 16.8111, -69.028],
  ['Avior', 'Авиор', 8.3752, -59.51], ['Miaplacidus', 'Миаплацидус', 9.22, -69.717], ['Kaus Australis', 'Каус Аустралис', 18.4029, -34.385],
  ['Nunki', 'Нунки', 18.921, -26.297], ['Menkar', 'Менкар', 3.038, 4.09], ['Zubenelgenubi', 'Зубен эль Генуби', 14.8480, -16.042],
  ['Unukalhai', 'Унук аль Хайя', 15.7378, 6.426], ['Eltanin', 'Этамин', 17.9434, 51.489], ['Vindemiatrix', 'Виндемиатрикс', 13.0363, 10.959],
  ['Merak', 'Мерак', 11.0307, 56.382], ['Phecda', 'Фекда', 11.8972, 53.695], ['Megrez', 'Мегрец', 12.2571, 57.033],
  ['Ruchbah', 'Рукбах', 1.4303, 60.235], ['Almach', 'Аламак', 2.065, 42.33], ['Alcyone', 'Альциона', 3.7914, 24.105],
];
