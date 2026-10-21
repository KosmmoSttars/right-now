// The sky mode's side panels: what is up now from the observer's place, and the
// layers of the planetarium.
import { useMemo } from 'react';
import { fmtDuration, fmtInt, fmtSig, useT, type Key } from '../i18n';
import { DEG } from '../sim/kepler';
import { SHOWERS, showerActive } from '../sim/live';
import { astroTime, bodyPosition, type BodyId } from '../sim/planets';
import { COMPASS, RADIANTS, bodySky, compassIndex, eqjAltAz, moonPhaseAngle, raDecToEqj, riseSet, sunCrossing, sunState, type Place } from '../sim/sky';
import { getEngine, replayNight, skySelect, toggleSkyLayer } from '../state/controller';
import { set, useApp } from '../state/store';


const PLANETS: BodyId[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

export function placeName(lang: 'en' | 'ru', p: Place): string {
  if (p.name) {
    const country = p.country ? countryName(lang, p.country) : '';
    return country ? `${p.name}, ${country}` : p.name;
  }
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
  return `${f(p.lat, lang === 'ru' ? 'с. ш.' : 'N', lang === 'ru' ? 'ю. ш.' : 'S')} ${f(p.lon, lang === 'ru' ? 'в. д.' : 'E', lang === 'ru' ? 'з. д.' : 'W')}`;
}

export function countryName(lang: 'en' | 'ru', code: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function moonPhaseKey(angle: number): Key {
  const keys: Key[] = ['moonNew', 'moonWaxCres', 'moonFirstQ', 'moonWaxGib', 'moonFull', 'moonWanGib', 'moonLastQ', 'moonWanCres'];
  return keys[Math.round((((angle % 360) + 360) % 360) / 45) % 8];
}

export function SkyPanel() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const place = useApp((s) => s.place);
  const simMs = useApp((s) => s.simMs);
  const meteors = useApp((s) => s.meteors);
  const minute = Math.floor(simMs / 60_000);
  const dir = (az: number) => COMPASS[lang][compassIndex(az)];
  const dur = (ms: number) => fmtDuration(lang, ms);

  const data = useMemo(() => {
    if (!place) return null;
    const ms = minute * 60_000;
    const sun = bodySky('sun', ms, place);
    const state = sunState(sun.alt);
    // The next Sun event worth knowing.
    let sunLine: string;
    if (state === 'day') {
      const s = sunCrossing(ms, place, -1, -0.833);
      sunLine = s ? t('sunSetsIn', { t: dur(s - ms) }) : '';
    } else if (state === 'night') {
      const r = sunCrossing(ms, place, +1, -18);
      sunLine = r ? t('darkUntil', { t: dur(r - ms) }) : '';
    } else {
      const rising = bodySky('sun', ms + 10 * 60_000, place).alt > sun.alt;
      const e = rising ? sunCrossing(ms, place, +1, -0.833) : sunCrossing(ms, place, -1, -18);
      sunLine = e ? t(rising ? 'sunRisesIn' : 'darkIn', { t: dur(e - ms) }) : '';
    }
    const moon = bodySky('moon', ms, place);
    const moonRs = riseSet('moon', ms, place);
    const planets = PLANETS.map((id) => ({ id, s: bodySky(id, ms, place), rs: riseSet(id, ms, place) }));
    const earth = bodyPosition('earth', astroTime(ms));
    const solarLon = ((Math.atan2(-earth[1], -earth[0]) / DEG) + 360) % 360;
    const showers = SHOWERS.filter((s) => showerActive(s, solarLon))
      .sort((a, b) => b.zhr - a.zhr)
      .map((s) => {
        const r = RADIANTS[s.code];
        const h = r ? eqjAltAz(raDecToEqj(r[0], r[1]), ms, place) : null;
        return { s, h };
      });
    return { sun, state, sunLine, moon, moonRs, moonAngle: moonPhaseAngle(ms), planets, showers };
  }, [place, minute, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const near = getEngine()?.sky.nearMeteors ?? 0;

  if (!place || !data) {
    return (
      <aside className="panel events sky glass" aria-label={t('skyUpNow')}>
        <section>
          <h2>{t('skyUpNow')}</h2>
          <p className="note">{t('skyNoPlace')}</p>
          <button className="action" onClick={() => set({ dialog: 'place' })}>{t('skyChange')}</button>
        </section>
      </aside>
    );
  }

  const stateKey: Record<string, Key> = { day: 'sunDay', civil: 'sunCivil', nautical: 'sunNautical', astronomical: 'sunAstronomical', night: 'sunNight' };
  const bodyRow = (alt: number, az: number, rs: ReturnType<typeof riseSet>, now: number) => {
    if (alt > 0) return `${t('upAt', { alt: Math.round(alt), dir: dir(az) })}${rs.set ? ` · ${t('setsIn', { t: dur(rs.set - now) })}` : ''}`;
    if (rs.rise) return t('risesIn', { t: dur(rs.rise - now) });
    return t('neverRises');
  };
  const now = minute * 60_000;

  return (
    <aside className="panel events sky glass" aria-label={t('skyUpNow')}>
      <section>
        <h2>{t('skyPlace')}</h2>
        <p className="place-line">
          <span>{placeName(lang, place)}</span>
          <button className="link-btn" onClick={() => set({ dialog: 'place' })}>{t('skyChange')}</button>
        </p>
        <p className={`sun-state s-${data.state}`}>{t(stateKey[data.state])}</p>
        {data.sunLine && <p className="note">{data.sunLine}</p>}
      </section>

      <section>
        <h2>{t('skyMoon')}</h2>
        <ul className="rows">
          <li>
            <button className="row" onClick={() => skySelect({ kind: 'body', id: 'moon' }, true)}>
              <span className="r-main">{t(moonPhaseKey(data.moonAngle))}</span>
              <span className="r-num">{t('litPct', { p: Math.round(data.moon.phase * 100) })}</span>
              <span className="r-sub">{bodyRow(data.moon.alt, data.moon.az, data.moonRs, now)}</span>
            </button>
          </li>
        </ul>
      </section>

      <section>
        <h2>{t('skyPlanets')}</h2>
        <ul className="rows">
          {data.planets.map(({ id, s, rs }) => (
            <li key={id} className={s.alt > 0 ? '' : 'dim'}>
              <button className="row" onClick={() => skySelect({ kind: 'body', id }, true)}>
                <span className="r-main">{t(id)}</span>
                <span className="r-num">{fmtSig(lang, s.mag, 2)}ᵐ</span>
                <span className="r-sub">{bodyRow(s.alt, s.az, rs, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {data.showers.length > 0 && (
        <section>
          <h2>{t('skyShowersNow')}</h2>
          <ul className="rows">
            {data.showers.map(({ s, h }) => (
              <li key={s.code}>
                <button className="row" onClick={() => skySelect({ kind: 'radiant', code: s.code }, true)}>
                  <span className="swatch" style={{ background: s.color }} />
                  <span className="r-main">{s.name[lang]}</span>
                  <span className="r-num">{t('zhr', { n: s.zhr })}</span>
                  <span className="r-sub">
                    {h && h.alt > 0 ? t('radiantAt', { alt: Math.round(h.alt), dir: dir(h.az) }) : t('radiantDown')}
                    {h && h.alt > 0 && data.state === 'night' ? ` · ${t('perHour', { n: fmtInt(lang, Math.max(1, s.zhr * Math.sin(h.alt * DEG))) })}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>{t('skyMeteorsHere')}</h2>
        <p className="note">{near > 0 ? t('skyMeteorsCount', { n: fmtInt(lang, near) }) : t('skyMeteorsNone')}</p>
        <button className="action" onClick={replayNight} disabled={!meteors.length}>{t('replayNight')}</button>
      </section>
      <p className="note">{t('skyHint')}</p>
    </aside>
  );
}

export function SkyLayersPanel() {
  const t = useT();
  const layers = useApp((s) => s.skyLayers);
  const items: [keyof typeof layers, Key][] = [
    ['ground', 'skyGround'],
    ['constellations', 'skyConst'],
    ['names', 'skyNames'],
    ['grid', 'skyGrid'],
    ['showers', 'skyShowers'],
    ['meteors', 'skyMeteors'],
    ['craft', 'skyCraft'],
  ];
  return (
    <aside className="panel layers glass" aria-label={t('skyLayers')}>
      <section>
        <h2>{t('skyLayers')}</h2>
        <ul className="toggles">
          {items.map(([key, label]) => (
            <li key={key}>
              <label className="toggle">
                <input type="checkbox" checked={layers[key]} onChange={() => toggleSkyLayer(key)} />
                <span className="t-label">{t(label)}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
