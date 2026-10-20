import type { ReactNode } from 'react';
import { fmtDate, fmtDateTime, fmtDuration, fmtInt, fmtSig, useT, type Key } from '../i18n';
import { decodeRecord, splitName } from '../sim/catalog';
import { CLASS_STYLE, diameterKm } from '../sim/classes';
import { DEG, periodDays, type Orbit } from '../sim/kepler';
import { jdFromIso } from '../sim/craft';
import { LD_AU } from '../sim/live';
import { BODY_BY_ID, KM_PER_AU, orbitalPeriodDays } from '../sim/planets';
import { jdTT, msFromJdTT } from '../sim/time';
import { flyTo, getEngine, select } from '../state/controller';
import { targetKey, useApp } from '../state/store';
import { Icon } from './icons';

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const jplUrl = (s: string) => `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(s)}`;

export function InfoPanel() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const sel = useApp((s) => s.selected);
  const name = useApp((s) => s.selectedName);
  const tel = useApp((s) => s.telemetry);
  const focus = useApp((s) => s.focus);
  const manifest = useApp((s) => s.manifest);
  const approaches = useApp((s) => s.approaches);
  const live = useApp((s) => s.live);
  const craftList = useApp((s) => s.craft);
  const simMs = useApp((s) => s.simMs);
  useApp((s) => s.craftRev);
  if (!sel) return null;

  const key = targetKey(sel);
  const focused = targetKey(focus) === key;
  const telOk = tel && tel.key === key && Number.isFinite(tel.sunAu);
  const au = (v: number) => (v < 0.01 ? `${fmtInt(lang, v * KM_PER_AU)} ${t('km')}` : `${fmtSig(lang, v, 4)} ${t('au')}`);

  let kind = '';
  let title = '';
  let color = '#fff';
  let subtitle: string | null = null;
  const rows: ReactNode[] = [];
  let link: string | null = null;
  let note: string | null = null;
  let about: string | null = null;

  const live3 = () => {
    if (!telOk) return;
    if (!(sel.kind === 'body' && sel.id === 'sun')) rows.push(<Row key="sun" k={t('distSun')}>{au(tel!.sunAu)}</Row>);
    if (tel!.earthAu !== null) rows.push(<Row key="earth" k={t('distEarth')}>{au(tel!.earthAu)}{tel!.earthAu < 0.05 ? ` · ${fmtSig(lang, tel!.earthAu / LD_AU, 3)} LD` : ''}</Row>);
    if (tel!.speedKms !== null) rows.push(<Row key="v" k={t('speed')}>{fmtSig(lang, tel!.speedKms, 3)} {t('kms')}</Row>);
    if (tel!.lightSec !== null) rows.push(<Row key="lt" k={t('lightTime')}>{fmtDuration(lang, tel!.lightSec * 1000)}</Row>);
  };

  const orbitRows = (o: Orbit) => {
    if (o.e < 1) rows.push(<Row key="a" k={t('semiMajor')}>{fmtSig(lang, o.q / (1 - o.e), 4)} {t('au')}</Row>);
    rows.push(<Row key="q" k={t('perihelion')}>{fmtSig(lang, o.q, 4)} {t('au')}</Row>);
    rows.push(<Row key="e" k={t('ecc')}>{fmtSig(lang, o.e, 4)}</Row>);
    rows.push(<Row key="i" k={t('incl')}>{fmtSig(lang, o.i / DEG, 3)}°</Row>);
    const p = periodDays(o);
    if (Number.isFinite(p)) rows.push(<Row key="p" k={t('period')}>{p < 1000 ? `${fmtSig(lang, p, 4)} ${t('days')}` : `${fmtSig(lang, p / 365.25, 4)} ${t('years')}`}</Row>);
  };

  if (sel.kind === 'body') {
    const b = BODY_BY_ID[sel.id];
    title = t(sel.id);
    color = b.color;
    kind = sel.id === 'sun' ? t('kindStar') : sel.id === 'moon' ? t('kindMoon') : sel.id === 'pluto' ? t('kindDwarf') : t('kindPlanet');
    live3();
    rows.push(<Row key="r" k={t('radius')}>{fmtInt(lang, b.radiusKm)} {t('km')}</Row>);
    rows.push(<Row key="m" k={t('mass')}>{fmtSig(lang, b.massEarths, 3)} {t('earths')}</Row>);
    rows.push(<Row key="d" k={t('dayLength')}>{Math.abs(b.dayHours) > 48 ? `${fmtSig(lang, Math.abs(b.dayHours) / 24, 3)} ${t('days')}` : `${fmtSig(lang, Math.abs(b.dayHours), 4)} ${t('hours')}`}{b.dayHours < 0 ? ' ↺' : ''}</Row>);
    if (sel.id !== 'sun') {
      const p = orbitalPeriodDays(sel.id);
      rows.push(<Row key="p" k={t('period')}>{p < 1000 ? `${fmtSig(lang, p, 4)} ${t('days')}` : `${fmtSig(lang, p / 365.25, 4)} ${t('years')}`}</Row>);
    }
    note = t('bodyNote');
  } else if (sel.kind === 'asteroid') {
    const engine = getEngine();
    const rec = engine?.asteroids && manifest ? decodeRecord(engine.asteroids.data, sel.index, manifest) : null;
    const n = name ? splitName(name) : null;
    title = n?.title ?? '…';
    subtitle = n ? [n.number ? `(${n.number})` : null, n.name ? n.des : null].filter(Boolean).join(' ') || null : null;
    const cls = rec ? CLASS_STYLE[rec.cls] : null;
    color = cls?.color ?? '#fff';
    kind = `${t('kindAsteroid')} · ${cls ? t(`cls_${cls.key}` as Key) : ''}`;
    live3();
    const o = engine?.asteroidOrbit(sel.index);
    if (o) orbitRows(o);
    if (rec) {
      rows.push(<Row key="h" k={t('absMag')}>{fmtSig(lang, rec.h, 3)}</Row>);
      const big = diameterKm(rec.h, 0.05);
      const small = diameterKm(rec.h, 0.25);
      const fmtD = (km: number) => (km < 1 ? `${fmtSig(lang, km * 1000, 2)} m` : `${fmtSig(lang, km, 2)} ${t('km')}`);
      rows.push(<Row key="dia" k={t('diameterEst')}>{fmtD(small)} – {fmtD(big)}</Row>);
    }
    if (n) {
      link = jplUrl(n.lookup);
      const risk = live?.sentry.find((r) => r[0] === n.des || r[0] === n.number);
      if (risk) {
        rows.push(<Row key="ip" k={t('riskIp')}>{risk[2] !== null ? `1 : ${fmtInt(lang, 1 / risk[2])}` : '—'} ({risk[6]})</Row>);
        rows.push(<Row key="ts" k={t('riskTorino')}>{risk[4]}</Row>);
      }
    }
    note = t('orbitNote');
  } else if (sel.kind === 'comet') {
    const c = live?.comets[sel.index];
    title = c?.[0] ?? '…';
    color = '#9ff2e0';
    kind = t('kindComet');
    live3();
    if (c) {
      const [, tp, q, e, i, node, peri, m1] = c;
      orbitRows({ q, e, i: i * DEG, node: node * DEG, peri: peri * DEG, tp });
      rows.push(<Row key="tp" k={t('nextPerihelion')}>{fmtDateTime(lang, msFromJdTT(tp), false)} UTC</Row>);
      if (m1 !== null) rows.push(<Row key="m1" k="M1">{fmtSig(lang, m1, 3)}</Row>);
      link = jplUrl(c[0].replace(/\s*\(.*\)\s*$/, ''));
    }
    note = t('orbitNote');
  } else if (sel.kind === 'craft') {
    const c = craftList.find((x) => x.meta.id === sel.id);
    const m = c?.meta;
    title = m ? m.name : sel.id;
    subtitle = m && m.short && m.short !== m.name ? m.short : null;
    color = m?.historic ? '#9aa6bd' : '#c7a8ff';
    kind = `${m?.historic ? t('kindCraftHistoric') : t('kindCraft')}${m ? ` · ${m.agency}` : ''}`;
    if (m) rows.push(<Row key="l" k={t('launched')}>{fmtDate(lang, Date.parse(`${m.launch}T00:00:00Z`))}</Row>);
    if (telOk) {
      if (tel!.rel) {
        const b = BODY_BY_ID[tel!.rel.body];
        const name = t(tel!.rel.body);
        rows.push(<Row key="rd" k={t('relDist', { body: name })}>{fmtInt(lang, tel!.rel.distAu * KM_PER_AU - b.radiusKm)} {t('km')}</Row>);
        rows.push(<Row key="rv" k={t('relSpeed', { body: name })}>{fmtSig(lang, tel!.rel.speedKms, 3)} {t('kms')}</Row>);
      }
      if (!(tel!.pinned)) {
        rows.push(<Row key="sun" k={t('distSun')}>{au(tel!.sunAu)}</Row>);
      }
      if (tel!.earthAu !== null) rows.push(<Row key="earth" k={t('distEarth')}>{au(tel!.earthAu)}</Row>);
      if (tel!.speedKms !== null) rows.push(<Row key="v" k={t('speed')}>{fmtSig(lang, tel!.speedKms, 3)} {t('kms')}</Row>);
      if (tel!.lightSec !== null) rows.push(<Row key="lt" k={t('signalTime')}>{tel!.lightSec < 20 ? `${fmtSig(lang, tel!.lightSec, 2)} ${lang === 'ru' ? 'с' : 's'}` : fmtDuration(lang, tel!.lightSec * 1000)}</Row>);
      rows.push(<Row key="tr" k={t('trajectory')}>{simMs <= Date.now() ? t('trajPast') : t('trajFuture')}</Row>);
    }
    if (m) link = `https://en.wikipedia.org/wiki/${encodeURIComponent(m.wiki)}`;
    const stay = c && m ? c.stays.find((st) => { const jd = jdTT(simMs); return jd >= st.from && jd <= st.to; }) : null;
    note = !telOk
      ? (m && jdTT(simMs) < jdFromIso(m.launch)) || c?.full ? t('craftGone') : null
      : tel!.pinned && stay ? t('craftPinned', { body: t(stay.body) }) : t('craftNote');
    if (m) about = m.about[lang];
  } else {
    const a = approaches.find((x) => x.des === sel.des);
    title = a?.name ?? sel.des;
    color = '#ffb547';
    kind = t('kindApproach');
    if (a) {
      rows.push(<Row key="ca" k={t('closest')}>{fmtDateTime(lang, a.ms, false)} UTC</Row>);
      rows.push(<Row key="cd" k={t('closestDist')}>{fmtInt(lang, a.distAu * KM_PER_AU)} {t('km')} · {fmtSig(lang, a.distAu / LD_AU, 3)} LD</Row>);
      rows.push(<Row key="sg" k={t('sigma')}>{fmtInt(lang, a.distMinAu * KM_PER_AU)} – {fmtInt(lang, a.distMaxAu * KM_PER_AU)} {t('km')}</Row>);
      rows.push(<Row key="vr" k={t('speedRel')}>{fmtSig(lang, a.vKms, 3)} {t('kms')}</Row>);
      if (a.diameterKm) rows.push(<Row key="dm" k={t('diameter')}>{fmtSig(lang, a.diameterKm * 1000, 3)} m</Row>);
      else if (a.h !== null) {
        rows.push(<Row key="h" k={t('absMag')}>{fmtSig(lang, a.h, 3)}</Row>);
        rows.push(<Row key="de" k={t('diameterEst')}>{fmtSig(lang, diameterKm(a.h, 0.25) * 1000, 2)} – {fmtSig(lang, diameterKm(a.h, 0.05) * 1000, 2)} m</Row>);
      }
      link = jplUrl(a.des);
    }
    if (telOk) live3();
    else note = t('outsideTrack');
  }

  return (
    <aside className="panel info glass" aria-live="polite">
      <header>
        <span className="kind" style={{ color }}>{kind}</span>
        <button className="icon-btn" onClick={() => select(null)} aria-label={t('close')}>
          <Icon name="close" />
        </button>
      </header>
      <h2 className="info-title">{title}</h2>
      {subtitle && <p className="info-sub">{subtitle}</p>}
      {about && <p className="info-about">{about}</p>}
      <dl>{rows}</dl>
      <div className="info-actions">
        <button className="action" onClick={() => flyTo(sel)} disabled={focused}>
          <Icon name="target" />
          {focused ? t('focused') : t('flyTo')}
        </button>
        {link && (
          <a className="action ghost" href={link} target="_blank" rel="noreferrer">
            {sel.kind === 'craft' ? t('wikiLink') : t('jplLink')}
            <Icon name="external" size={14} />
          </a>
        )}
      </div>
      {note && <p className="note">{note}</p>}
    </aside>
  );
}
