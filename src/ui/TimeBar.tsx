import { useState } from 'react';
import { fmtDateTime, fmtWarp, useT } from '../i18n';
import { WARPS } from '../sim/clock';
import { goLive, jumpTo, setWarp, togglePause } from '../state/controller';
import { useApp } from '../state/store';
import { Icon } from './icons';

export function TimeBar() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const simMs = useApp((s) => s.simMs);
  const warp = useApp((s) => s.warp);
  const paused = useApp((s) => s.paused);
  const isLive = useApp((s) => s.isLive);
  const [picking, setPicking] = useState(false);

  const idx = WARPS.indexOf(warp as (typeof WARPS)[number]);
  const step = (d: number) => {
    const i = idx < 0 ? WARPS.indexOf(1) : idx;
    setWarp(WARPS[Math.max(0, Math.min(WARPS.length - 1, i + d))]);
  };
  const iso = new Date(simMs).toISOString().slice(0, 16);

  return (
    <div className="timebar glass" role="group" aria-label={t('setDate')}>
      <button className={`live-pill ${isLive ? 'is-live' : ''}`} onClick={goLive} disabled={isLive} title={t('backToNow')}>
        <span className="dot" />
        {isLive ? t('live') : t('backToNow')}
      </button>
      <div className="clock">
        {picking ? (
          <input
            type="datetime-local"
            className="date-input"
            defaultValue={iso}
            autoFocus
            onBlur={() => setPicking(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPicking(false);
              if (e.key === 'Enter') {
                const ms = Date.parse((e.target as HTMLInputElement).value + ':00Z');
                if (Number.isFinite(ms)) jumpTo(ms);
                setPicking(false);
              }
            }}
            onChange={(e) => {
              const ms = Date.parse(e.target.value + ':00Z');
              if (Number.isFinite(ms)) jumpTo(ms);
            }}
          />
        ) : (
          <button className="clock-btn" onClick={() => setPicking(true)} title={t('setDate')}>
            <span className="num">{fmtDateTime(lang, simMs)}</span>
            <span className="unit">{t('utc')}</span>
          </button>
        )}
        <span className="warp-label">{paused ? t('pause') : warp === 1 ? t('warpRealtime') : t('warp', { x: fmtWarp(lang, warp) })}</span>
      </div>
      <div className="warp-buttons">
        <button onClick={() => step(-1)} title={t('slower')} aria-label={t('slower')}>
          <Icon name="rewind" />
        </button>
        <button onClick={togglePause} title={paused ? t('play') : t('pause')} aria-label={paused ? t('play') : t('pause')}>
          <Icon name={paused ? 'play' : 'pause'} />
        </button>
        <button onClick={() => step(1)} title={t('faster')} aria-label={t('faster')}>
          <Icon name="forward" />
        </button>
      </div>
      <input
        className="warp-slider"
        type="range"
        min={0}
        max={WARPS.length - 1}
        step={1}
        value={idx < 0 ? WARPS.indexOf(1) : idx}
        aria-label={t('warp', { x: '' })}
        onChange={(e) => setWarp(WARPS[+e.target.value])}
      />
    </div>
  );
}
