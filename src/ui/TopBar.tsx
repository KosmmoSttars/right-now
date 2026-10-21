import { useEffect, useRef, useState } from 'react';
import { fmtInt, rememberLang, useT } from '../i18n';
import { searchNames, splitName } from '../sim/catalog';
import { BODIES } from '../sim/planets';
import { selectAndFly, setLang, setMode } from '../state/controller';
import { set, useApp, type Target } from '../state/store';
import { Icon } from './icons';

interface Hit {
  key: string;
  label: string;
  sub: string;
  target: Target;
}

export function TopBar() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const loaded = useApp((s) => s.loaded);
  const manifest = useApp((s) => s.manifest);
  const panel = useApp((s) => s.panel);
  const live = useApp((s) => s.live);
  const mode = useApp((s) => s.mode);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits(null);
      return;
    }
    const my = ++seq.current;
    const low = query.toLowerCase();
    const local: Hit[] = [];
    for (const b of BODIES) {
      const names = [t(b.id), b.id];
      if (names.some((n) => n.toLowerCase().startsWith(low))) {
        local.push({ key: `body:${b.id}`, label: t(b.id), sub: b.id === 'sun' ? t('kindStar') : b.id === 'moon' ? t('kindMoon') : b.id === 'pluto' ? t('kindDwarf') : t('kindPlanet'), target: { kind: 'body', id: b.id } });
      }
    }
    for (const c of useApp.getState().craft) {
      const m = c.meta;
      if (local.length < 12 && [m.name, m.short ?? '', m.id].some((n) => n.toLowerCase().includes(low))) {
        local.push({ key: `craft:${m.id}`, label: m.name, sub: `${t('kindCraftSearch')} · ${m.agency}`, target: { kind: 'craft', id: m.id } });
      }
    }
    (live?.comets ?? []).forEach((c, index) => {
      if (local.length < 12 && c[0].toLowerCase().includes(low)) local.push({ key: `comet:${index}`, label: c[0], sub: t('kindComet'), target: { kind: 'comet', index } });
    });
    setHits(local);
    setActive(0);
    const timer = setTimeout(() => {
      void searchNames(query).then((rows) => {
        if (my !== seq.current) return;
        const remote = rows
          .filter(([index]) => index < (useApp.getState().loaded || 0))
          .map(([index, full]) => {
            const n = splitName(full);
            return { key: `asteroid:${index}`, label: n.title, sub: [n.number ? `(${n.number})` : null, n.name ? n.des : null, t('kindAsteroid')].filter(Boolean).join(' · '), target: { kind: 'asteroid', index } as Target };
          });
        setHits([...local, ...remote]);
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [q, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (h: Hit) => {
    selectAndFly(h.target);
    setQ('');
    setHits(null);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <h1>{t('title')}</h1>
        <p>{t('tagline')}</p>
      </div>
      <div className="mode-switch" role="tablist" aria-label={t('modeSky')}>
        <button role="tab" aria-selected={mode === 'space'} className={mode === 'space' ? 'on' : ''} onClick={() => setMode('space')}>
          {t('modeSpace')}
        </button>
        <button role="tab" aria-selected={mode === 'sky'} className={mode === 'sky' ? 'on' : ''} onClick={() => setMode('sky')}>
          {t('modeSky')}
        </button>
      </div>
      <div className="search" hidden={mode === 'sky'}>
        <label className="search-box glass">
          <Icon name="search" />
          <input
            type="search"
            value={q}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (!hits?.length) return;
              if (e.key === 'ArrowDown') setActive((a) => Math.min(hits.length - 1, a + 1));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
              else if (e.key === 'Enter') choose(hits[active]);
              else if (e.key === 'Escape') setQ('');
              else return;
              e.preventDefault();
            }}
          />
        </label>
        {hits && (
          <ul className="search-results glass" role="listbox">
            {hits.length === 0 && <li className="empty">{t('noResults')}</li>}
            {hits.map((h, k) => (
              <li key={h.key} role="option" aria-selected={k === active} className={k === active ? 'active' : ''} onMouseDown={() => choose(h)} onMouseEnter={() => setActive(k)}>
                <span className="r-label">{h.label}</span>
                <span className="r-sub">{h.sub}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav className="top-actions">
        <button className={`chip ${panel === 'events' ? 'on' : ''}`} onClick={() => set({ panel: panel === 'events' ? null : 'events' })}>
          <Icon name="events" />
          <span>{t('events')}</span>
        </button>
        <button className={`chip ${panel === 'layers' ? 'on' : ''}`} onClick={() => set({ panel: panel === 'layers' ? null : 'layers' })}>
          <Icon name="layers" />
          <span>{t('layers')}</span>
        </button>
        <button className="chip" onClick={() => set({ dialog: 'about' })}>
          <Icon name="info" />
          <span>{t('about')}</span>
        </button>
        <button
          className="chip lang"
          onClick={() => {
            const next = lang === 'en' ? 'ru' : 'en';
            rememberLang(next);
            setLang(next);
          }}
        >
          {t('language')}
        </button>
      </nav>
      {manifest && loaded < manifest.count && (
        <div className="load-strip" aria-live="polite">
          <div className="bar" style={{ width: `${(loaded / manifest.count) * 100}%` }} />
          <span>{t('loadedOf', { n: fmtInt(lang, loaded), total: fmtInt(lang, manifest.count) })}</span>
        </div>
      )}
    </header>
  );
}
