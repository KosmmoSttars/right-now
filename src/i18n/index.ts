import { useApp } from '../state/store';
import { STRINGS, type Key, type Lang } from './strings';

export type { Key, Lang };

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function useT() {
  const lang = useApp((s) => s.lang);
  return (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

export function initialLang(): Lang {
  try {
    const picked = localStorage.getItem('ks-lang-picked');
    if (picked === 'ru' || picked === 'en') return picked;
  } catch {
    // storage blocked: English
  }
  return 'en';
}

export function rememberLang(lang: Lang): void {
  try {
    localStorage.setItem('ks-lang-picked', lang);
  } catch {
    // not fatal
  }
}

const locale = (lang: Lang) => (lang === 'ru' ? 'ru-RU' : 'en-GB');

export function fmtInt(lang: Lang, n: number): string {
  return new Intl.NumberFormat(locale(lang)).format(Math.round(n));
}

export function fmtNum(lang: Lang, n: number, digits: number): string {
  return new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Significant-figure formatting for physical quantities. */
export function fmtSig(lang: Lang, n: number, sig = 3): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const digits = a === 0 ? 0 : Math.max(0, Math.min(6, sig - 1 - Math.floor(Math.log10(a))));
  return fmtNum(lang, n, digits);
}

export function fmtDateTime(lang: Lang, ms: number, seconds = true): string {
  return new Intl.DateTimeFormat(locale(lang), {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    second: seconds ? '2-digit' : undefined, hour12: false, timeZone: 'UTC',
  }).format(ms);
}

export function fmtDate(lang: Lang, ms: number): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(ms);
}

export function fmtShortDate(lang: Lang, ms: number): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(ms);
}

/** "3 d 4 h", "5 h 12 min", "40 s" style durations. */
export function fmtDuration(lang: Lang, ms: number): string {
  const ru = lang === 'ru';
  const s = Math.abs(ms) / 1000;
  const u = ru ? { y: 'г', d: 'д', h: 'ч', m: 'мин', s: 'с' } : { y: 'y', d: 'd', h: 'h', m: 'min', s: 's' };
  if (s < 60) return `${Math.round(s)} ${u.s}`;
  if (s < 3600) return `${Math.round(s / 60)} ${u.m}`;
  // Round first, then split, so 9 d 23.6 h reads "10 d", not "9 d 24 h".
  if (s < 86400 - 30) {
    const mins = Math.round(s / 60);
    const h = Math.floor(mins / 60);
    const m = mins - h * 60;
    return m ? `${h} ${u.h} ${m} ${u.m}` : `${h} ${u.h}`;
  }
  if (s < 365.25 * 86400) {
    const hours = Math.round(s / 3600);
    const d = Math.floor(hours / 24);
    const h = hours - d * 24;
    return h && d < 10 ? `${d} ${u.d} ${h} ${u.h}` : `${Math.round(s / 86400)} ${u.d}`;
  }
  return `${fmtNum(lang, s / (365.25 * 86400), 1)} ${u.y}`;
}

/** Warp factor as words: "1 hour", "1 year". */
export function fmtWarp(lang: Lang, w: number): string {
  const a = Math.abs(w);
  const ru = lang === 'ru';
  const names: [number, string, string][] = [
    [31_557_600, '1 year', '1 год'],
    [2_592_000, '30 days', '30 дней'],
    [604_800, '1 week', '1 неделя'],
    [86_400, '1 day', '1 день'],
    [3600, '1 hour', '1 час'],
    [60, '1 minute', '1 минута'],
    [1, '1 second', '1 секунда'],
  ];
  const hit = names.find(([v]) => v === a);
  const word = hit ? (ru ? hit[2] : hit[1]) : `${a}×`;
  return (w < 0 ? '−' : '') + word;
}
