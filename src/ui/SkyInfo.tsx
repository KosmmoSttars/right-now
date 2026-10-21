// What was clicked in the sky: where it is from here, how bright, when it rises and
// sets, and a way back to the same object in the Solar System view.
import type { ReactNode } from 'react';
import { fmtDuration, fmtInt, fmtShortDate, fmtSig, useT } from '../i18n';
import { craftLabel } from '../sim/craft';
import { SHOWER_BY_CODE } from '../sim/live';
import { BODY_BY_ID, KM_PER_AU } from '../sim/planets';
import { COMPASS, bodySky, compassIndex, dirToAltAz, limitingMag, refraction, riseSet } from '../sim/sky';
import { getEngine, showInSpace, skyLook, skySelect } from '../state/controller';
import { useApp, type Target } from '../state/store';
import { Icon } from './icons';

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SkyInfo() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const sel = useApp((s) => s.skySel);
  const place = useApp((s) => s.place);
  const simMs = useApp((s) => s.simMs);
  const craft = useApp((s) => s.craft);
  const live = useApp((s) => s.live);
  const sky = getEngine()?.sky;
  if (!sel || !place || !sky) return null;

  const second = Math.floor(simMs / 1000) * 1000;
  const sun = bodySky('sun', second, place);
  const lim = limitingMag(sun.alt);
  const rows: ReactNode[] = [];
  let kind = '';
  let title = '';
  let color = '#dfe6f2';
  let note: string | null = null;
  let space: Target | null = null;

  const dir = sky.selDir(sel, second);
  if (dir) {
    const h = dirToAltAz(dir);
    const alt = h.alt + refraction(h.alt);
    rows.push(<Row key="alt" k={t('altitude')}>{fmtSig(lang, alt, 3)}°{alt < 0 ? ` · ${t('belowHorizon')}` : ''}</Row>);
    rows.push(<Row key="az" k={t('azimuth')}>{fmtSig(lang, h.az, 3)}° · {COMPASS[lang][compassIndex(h.az)]}</Row>);
  }
  const eye = (mag: number) => rows.push(<Row key="mag" k={t('magnitude')}>{fmtSig(lang, mag, 2)} · {mag < lim && (dir?.[1] ?? 0) > 0 ? t('visibleEye') : t('notVisibleEye')}</Row>);
  const when = (ms: number | null) => (ms === null ? '—' : `${fmtShortDate(lang, ms)} · ${ms > second ? t('inTime', { t: fmtDuration(lang, ms - second) }) : t('agoTime', { t: fmtDuration(lang, second - ms) })}`);

  if (sel.kind === 'body') {
    const b = bodySky(sel.id, second, place);
    title = t(sel.id);
    color = BODY_BY_ID[sel.id].color;
    kind = sel.id === 'sun' ? t('kindStar') : sel.id === 'moon' ? t('kindMoon') : t('kindPlanet');
    eye(b.mag);
    rows.push(<Row key="d" k={t('distEarth')}>{b.distAu < 0.01 ? `${fmtInt(lang, b.distAu * KM_PER_AU)} ${t('km')}` : `${fmtSig(lang, b.distAu, 4)} ${t('au')}`}</Row>);
    if (sel.id !== 'sun') rows.push(<Row key="ph" k={t('lit')}>{Math.round(b.phase * 100)}%</Row>);
    const rs = riseSet(sel.id, second, place);
    rows.push(<Row key="r" k={t('rises')}>{when(rs.rise)}</Row>);
    rows.push(<Row key="tr" k={t('transits')}>{rs.transit ? `${when(rs.transit)}${rs.transitAlt !== null ? ` · ${Math.round(rs.transitAlt)}°` : ''}` : '—'}</Row>);
    rows.push(<Row key="s" k={t('sets')}>{when(rs.set)}</Row>);
    space = { kind: 'body', id: sel.id };
    note = t('timesUtc');
  } else if (sel.kind === 'star') {
    const m = sky.starMag(sel.index);
    title = sky.starName(sel.index) ?? `★ ${fmtSig(lang, m, 2)}ᵐ`;
    kind = t('kindStarSky');
    eye(m);
  } else if (sel.kind === 'radiant') {
    const s = SHOWER_BY_CODE[sel.code];
    title = s ? s.name[lang] : sel.code;
    color = s?.color ?? color;
    kind = t('kindRadiant');
    if (s) rows.push(<Row key="z" k="ZHR">{t('zhr', { n: s.zhr })}</Row>);
    note = t('radiantNote');
  } else if (sel.kind === 'craft') {
    const c = craft.find((x) => x.meta.id === sel.id);
    title = c ? craftLabel(c.meta) : sel.id;
    color = '#c7a8ff';
    kind = t('kindCraft');
    const g = sky.geoVector(sel, second);
    if (g) rows.push(<Row key="d" k={t('distEarth')}>{g.dist < 0.01 ? `${fmtInt(lang, g.dist * KM_PER_AU)} ${t('km')}` : `${fmtSig(lang, g.dist, 4)} ${t('au')}`}</Row>);
    space = { kind: 'craft', id: sel.id };
    note = t('craftSkyNote');
  } else {
    const c = live?.comets[sel.index];
    title = c?.[0] ?? '…';
    color = '#9ff2e0';
    kind = t('kindComet');
    const g = sky.geoVector(sel, second);
    if (g) rows.push(<Row key="d" k={t('distEarth')}>{fmtSig(lang, g.dist, 4)} {t('au')}</Row>);
    space = { kind: 'comet', index: sel.index };
  }

  return (
    <aside className="panel info glass" aria-live="polite">
      <header>
        <span className="kind" style={{ color }}>{kind}</span>
        <button className="icon-btn" onClick={() => skySelect(null)} aria-label={t('close')}>
          <Icon name="close" />
        </button>
      </header>
      <h2 className="info-title">{title}</h2>
      <dl>{rows}</dl>
      <div className="info-actions">
        <button className="action" onClick={() => skyLook(sel)}>
          <Icon name="target" />
          {t('lookThere')}
        </button>
        {space && (
          <button className="action ghost" onClick={() => showInSpace(space!)}>
            {t('showInSpace')}
          </button>
        )}
      </div>
      {note && <p className="note">{note}</p>}
    </aside>
  );
}
