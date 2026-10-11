import { useEffect } from 'react';
import { fmtDateTime, fmtInt, useT } from '../i18n';
import { set, useApp } from '../state/store';
import { Icon } from './icons';

export function Boot() {
  const t = useT();
  const phase = useApp((s) => s.phase);
  const error = useApp((s) => s.error);
  if (phase === 'ready' && !error) return null;
  return (
    <div className={`boot ${phase === 'ready' ? 'fade' : ''}`} role="status">
      <h1>{t('title')}</h1>
      <p>{error === 'webgl' ? t('noWebgl') : error === 'data' ? t('bootFail') : t('bootSky')}</p>
      {!error && <div className="spinner" aria-hidden="true" />}
    </div>
  );
}

export function About() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const open = useApp((s) => s.dialog === 'about');
  const manifest = useApp((s) => s.manifest);
  const live = useApp((s) => s.live);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ dialog: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={() => set({ dialog: null })}>
      <div className="dialog glass" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={() => set({ dialog: null })} aria-label={t('close')}>
          <Icon name="close" />
        </button>
        <h2 id="about-title">{t('aboutTitle')}</h2>
        <p>{t('aboutBody', { n: fmtInt(lang, manifest?.count ?? 1_570_000) })}</p>
        <p className="honest">{t('aboutHonest')}</p>
        <h3>{t('sources')}</h3>
        <p className="note">{t('sourcesList')}</p>
        <p className="note">
          {manifest && t('catalogAge', { t: fmtDateTime(lang, Date.parse(manifest.builtAt), false) + ' UTC' })}
          {live && (
            <>
              <br />
              {t('liveAge', { t: fmtDateTime(lang, Date.parse(live.builtAt), false) + ' UTC' })}
            </>
          )}
        </p>
        <p className="note">{t('controls')}</p>
        <p className="made">
          <a href="https://kosmo-stars.ru/">{t('madeBy')}</a>
        </p>
      </div>
    </div>
  );
}
