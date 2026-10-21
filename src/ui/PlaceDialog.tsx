// Where the observer stands: the browser's location, a city from the bundled
// GeoNames list, or coordinates. Nothing leaves the browser.
import { useEffect, useMemo, useState } from 'react';
import { fmtInt, useT } from '../i18n';
import { fetchJson } from '../sim/catalog';
import { locateMe, setPlace } from '../state/controller';
import { set, useApp } from '../state/store';
import { Icon } from './icons';
import { countryName } from './SkyPanel';

/** name, Cyrillic aliases ("|"-separated), country code, lat, lon, population */
type City = [string, string, string, number, number, number];

let citiesPromise: Promise<City[]> | null = null;
function loadCities(): Promise<City[]> {
  citiesPromise ??= fetchJson<{ cities: City[] }>('data/cities.json').then((j) => j.cities);
  return citiesPromise;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е');

export function PlaceDialog() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const open = useApp((s) => s.dialog === 'place');
  const place = useApp((s) => s.place);
  const [cities, setCities] = useState<City[] | null>(null);
  const [q, setQ] = useState('');
  const [geo, setGeo] = useState<'idle' | 'working' | 'denied' | 'unavailable'>('idle');
  const [lat, setLat] = useState(place ? place.lat.toFixed(4) : '');
  const [lon, setLon] = useState(place ? place.lon.toFixed(4) : '');

  useEffect(() => {
    if (!open) return;
    void loadCities().then(setCities).catch(() => setCities([]));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ dialog: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const hits = useMemo(() => {
    const query = fold(q.trim());
    if (!cities || query.length < 2) return [];
    const starts: City[] = [];
    const contains: City[] = [];
    for (const c of cities) {
      const names = [c[0], ...c[1].split('|')].filter(Boolean).map(fold);
      if (names.some((n) => n.startsWith(query))) starts.push(c);
      else if (names.some((n) => n.includes(query))) contains.push(c);
      if (starts.length >= 12) break;
    }
    return [...starts, ...contains].slice(0, 12);
  }, [cities, q]);

  if (!open) return null;

  const pick = (c: City) => setPlace({ lat: c[3], lon: c[4], height: 0, name: c[0], country: c[2] });
  const latN = Number(lat.replace(',', '.'));
  const lonN = Number(lon.replace(',', '.'));
  const coordsOk = lat !== '' && lon !== '' && Math.abs(latN) <= 90 && Math.abs(lonN) <= 180;

  return (
    <div className="dialog-backdrop" onClick={() => place && set({ dialog: null })}>
      <div className="dialog place-dialog glass" role="dialog" aria-modal="true" aria-labelledby="place-title" onClick={(e) => e.stopPropagation()}>
        {place && (
          <button className="icon-btn close" onClick={() => set({ dialog: null })} aria-label={t('close')}>
            <Icon name="close" />
          </button>
        )}
        <h2 id="place-title">{t('placeTitle')}</h2>
        <p className="note">{t('placeIntro')}</p>
        <button
          className="action"
          disabled={geo === 'working'}
          onClick={async () => {
            setGeo('working');
            const r = await locateMe();
            setGeo(r === 'ok' ? 'idle' : r);
          }}
        >
          <Icon name="target" />
          {geo === 'working' ? t('geoWorking') : t('skyMyLocation')}
        </button>
        {(geo === 'denied' || geo === 'unavailable') && <p className="note warn">{t(geo === 'denied' ? 'geoDenied' : 'geoUnavailable')}</p>}

        <label className="field">
          <span>{t('placeSearch')}</span>
          <input type="search" value={q} autoFocus placeholder={t('placeSearchHint')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hits[0] && pick(hits[0])} />
        </label>
        {hits.length > 0 && (
          <ul className="rows city-list">
            {hits.map((c) => (
              <li key={`${c[0]}${c[3]}${c[4]}`}>
                <button className="row" onClick={() => pick(c)}>
                  <span className="r-main">{c[0]}</span>
                  <span className="r-num">{c[5] ? fmtInt(lang, c[5]) : ''}</span>
                  <span className="r-sub">{countryName(lang, c[2])} · {c[3].toFixed(2)}°, {c[4].toFixed(2)}°</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3>{t('placeOrCoords')}</h3>
        <div className="coords">
          <label className="field">
            <span>{t('latitude')}</span>
            <input inputMode="decimal" value={lat} placeholder="55.75" onChange={(e) => setLat(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('longitude')}</span>
            <input inputMode="decimal" value={lon} placeholder="37.62" onChange={(e) => setLon(e.target.value)} />
          </label>
          <button className="action" disabled={!coordsOk} onClick={() => setPlace({ lat: latN, lon: lonN, height: 0, name: null })}>
            {t('placeUse')}
          </button>
        </div>
        <p className="note">GeoNames (CC BY 4.0)</p>
      </div>
    </div>
  );
}
