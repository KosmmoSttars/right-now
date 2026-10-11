// Time scales. The simulation clock runs in Unix milliseconds (UTC); orbital elements
// and JPL ephemerides use Julian dates in TDB, which we take as TT (they differ by
// under 2 ms).

export const MS_PER_DAY = 86_400_000;
export const JD_UNIX_EPOCH = 2440587.5;
/** TT − UTC: 37 leap seconds + 32.184 s, valid since 2017 until a new leap second. */
export const TT_MINUS_UTC_DAYS = 69.184 / 86400;

export const jdUtc = (ms: number): number => ms / MS_PER_DAY + JD_UNIX_EPOCH;
export const jdTT = (ms: number): number => jdUtc(ms) + TT_MINUS_UTC_DAYS;
export const msFromJdUtc = (jd: number): number => (jd - JD_UNIX_EPOCH) * MS_PER_DAY;
export const msFromJdTT = (jd: number): number => msFromJdUtc(jd - TT_MINUS_UTC_DAYS);

/** "2026-Oct-11 02:41" style strings from the JPL APIs, UTC. */
export function msFromJplDate(s: string): number {
  const m = /^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(s);
  if (!m) return Date.parse(s.replace(' ', 'T') + 'Z');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[2]);
  return Date.UTC(+m[1], mon, +m[3], +m[4], +m[5]);
}
