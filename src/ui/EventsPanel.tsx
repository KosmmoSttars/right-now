import { useMemo } from 'react';
import { fmtDuration, fmtInt, fmtShortDate, fmtSig, useT } from '../i18n';
import { DEG, positionAt } from '../sim/kepler';
import { craftFix, craftLabel } from '../sim/craft';
import { LD_AU, SHOWERS, lonAhead, showerActive } from '../sim/live';
import { BODY_BY_ID, KM_PER_AU, astroTime, bodyPosition, type BodyId } from '../sim/planets';
import { jdTT, msFromJdTT } from '../sim/time';
import { replayMeteors, selectAndFly, watchFlyby } from '../state/controller';
import { useApp } from '../state/store';

const HOUR = 3_600_000;

export function EventsPanel() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const simMs = useApp((s) => s.simMs);
  const approaches = useApp((s) => s.approaches);
  const meteors = useApp((s) => s.meteors);
  const fireballs = useApp((s) => s.fireballs);
  const live = useApp((s) => s.live);
  const craft = useApp((s) => s.craft);
  const craftRev = useApp((s) => s.craftRev);
  const allFlybys = useApp((s) => s.flybys);
  // Coarse clock for the heavier summaries: once a simulated minute is plenty.
  const minute = Math.floor(simMs / 60_000);

  const earth = useMemo(() => bodyPosition('earth', astroTime(minute * 60_000)), [minute]);
  const solarLon = (Math.atan2(-earth[1], -earth[0]) / DEG + 360) % 360;

  const next = approaches.filter((a) => a.ms >= simMs).sort((a, b) => a.ms - b.ms).slice(0, 5);
  const past = approaches.filter((a) => a.ms < simMs).sort((a, b) => b.ms - a.ms).slice(0, 3);

  const active = SHOWERS.filter((s) => showerActive(s, solarLon)).sort((a, b) => b.zhr - a.zhr);
  const recent = meteors.filter((m) => m.ms <= simMs && m.ms > simMs - 24 * HOUR);
  const byShower = new Map<string, number>();
  for (const m of recent) if (m.shower) byShower.set(m.shower, (byShower.get(m.shower) ?? 0) + 1);
  const latestFireball = fireballs.find((f) => f.ms <= simMs);

  const brightComets = useMemo(() => {
    if (!live) return [];
    const jd = jdTT(minute * 60_000);
    const p: [number, number, number] = [0, 0, 0];
    return live.comets
      .map((c, index) => {
        const [name, tp, q, e, i, node, peri, m1] = c;
        if (m1 === null) return null;
        positionAt({ q, e, i: i * DEG, node: node * DEG, peri: peri * DEG, tp }, jd, p);
        const r = Math.hypot(p[0], p[1], p[2]);
        const delta = Math.hypot(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]);
        return { index, name, mag: m1 + 5 * Math.log10(delta) + 10 * Math.log10(r), r };
      })
      .filter((x): x is { index: number; name: string; mag: number; r: number } => !!x && x.mag < 14)
      .sort((a, b) => a.mag - b.mag)
      .slice(0, 4);
  }, [live, minute, earth]);

  // Spacecraft: the next planetary flybys and the farthest ones, from their trajectories.
  const jdNow = jdTT(minute * 60_000);
  const flybys = allFlybys.filter((f) => f.jd > jdNow - 2 && f.jd < jdNow + 800).slice(0, 4);
  const far = useMemo(() => {
    const at = astroTime(minute * 60_000);
    const cache = new Map<BodyId, [number, number, number]>();
    const bodyAt = (id: BodyId) => cache.get(id) ?? (cache.set(id, bodyPosition(id, at)), cache.get(id)!);
    return craft
      .map((c) => {
        const f = craftFix(c, jdNow, bodyAt);
        return f ? { id: c.meta.id, label: craftLabel(c.meta), d: Math.hypot(f.pos[0] - earth[0], f.pos[1] - earth[1], f.pos[2] - earth[2]) } : null;
      })
      .filter((x): x is { id: string; label: string; d: number } => !!x && x.d > 20)
      .sort((a, b) => b.d - a.d)
      .slice(0, 4);
  }, [craft, craftRev, minute, earth, jdNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const scout = (live?.scout ?? []).slice().sort((a, b) => b[2] - a[2]).slice(0, 3);
  const risk = (live?.sentry ?? []).slice().sort((a, b) => (b[3] ?? -99) - (a[3] ?? -99)).slice(0, 3);

  const when = (ms: number) => (ms >= simMs ? t('inTime', { t: fmtDuration(lang, ms - simMs) }) : t('agoTime', { t: fmtDuration(lang, simMs - ms) }));

  return (
    <aside className="panel events glass" aria-label={t('events')}>
      <section>
        <h2>{t('evApproaches')}</h2>
        <p className="note">{t('evApproachesNote')}</p>
        <h3>{t('evNext')}</h3>
        <ul className="rows">
          {next.map((a) => (
            <li key={a.des + a.ms}>
              <button className="row" onClick={() => selectAndFly({ kind: 'approach', des: a.des })}>
                <span className="r-main">{a.name}</span>
                <span className="r-num">{t('ld', { d: fmtSig(lang, a.distAu / LD_AU, 2) })}</span>
                <span className="r-sub">
                  {when(a.ms)}
                  {a.diameterKm ? ` · ${fmtSig(lang, a.diameterKm * 1000, 2)} m` : a.h !== null ? ` · H ${fmtSig(lang, a.h, 3)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {past.length > 0 && (
          <>
            <h3>{t('evPast')}</h3>
            <ul className="rows dim">
              {past.map((a) => (
                <li key={a.des + a.ms}>
                  <button className="row" onClick={() => selectAndFly({ kind: 'approach', des: a.des })}>
                    <span className="r-main">{a.name}</span>
                    <span className="r-num">{t('ld', { d: fmtSig(lang, a.distAu / LD_AU, 2) })}</span>
                    <span className="r-sub">{when(a.ms)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {(flybys.length > 0 || far.length > 0) && (
        <section>
          <h2>{t('evCraft')}</h2>
          {flybys.length > 0 && (
            <>
              <h3>{t('evFlybys')}</h3>
              <ul className="rows">
                {flybys.map((f) => {
                  const c = craft.find((x) => x.meta.id === f.id);
                  const ms = msFromJdTT(f.jd);
                  const alt = f.distAu * KM_PER_AU - BODY_BY_ID[f.body].radiusKm;
                  return (
                    <li key={f.id + f.jd}>
                      <button className="row" onClick={() => watchFlyby(f.id, ms)}>
                        <span className="r-main">{c ? craftLabel(c.meta) : f.id}</span>
                        <span className="r-num">{when(ms)}</span>
                        <span className="r-sub">
                          {t('flybyRow', { body: t(f.body), alt: `${fmtInt(lang, alt)} ${t('km')}` })} · {fmtSig(lang, (f.speed * KM_PER_AU) / 86400, 3)} {t('kms')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="note">{t('evFlybysNote')}</p>
            </>
          )}
          {far.length > 0 && (
            <>
              <h3>{t('evFarthest')}</h3>
              <ul className="rows">
                {far.map((f) => (
                  <li key={f.id}>
                    <button className="row" onClick={() => selectAndFly({ kind: 'craft', id: f.id })}>
                      <span className="r-main">{f.label}</span>
                      <span className="r-num">{fmtSig(lang, f.d, 3)} {t('au')}</span>
                      <span className="r-sub">{t('signalTime')} {fmtDuration(lang, ((f.d * KM_PER_AU) / 299_792.458) * 1000)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section>
        <h2>{t('evShowers')}</h2>
        {active.length === 0 && <p className="note">{t('evShowersNone')}</p>}
        <ul className="rows">
          {active.map((s) => {
            const d = lonAhead(solarLon, s.peak);
            const daysToPeak = d > 180 ? -(360 - d) * 1.0146 : d * 1.0146; // days per degree of solar longitude
            const peak = Math.abs(daysToPeak) < 0.5 ? t('peakNow') : daysToPeak > 0 ? t('peakIn', { t: fmtDuration(lang, daysToPeak * 86_400_000) }) : t('peakAgo', { t: fmtDuration(lang, -daysToPeak * 86_400_000) });
            const seen = byShower.get(s.code);
            return (
              <li key={s.code} className="row static">
                <span className="swatch" style={{ background: s.color }} />
                <span className="r-main">{s.name[lang]}</span>
                <span className="r-num">{t('zhr', { n: s.zhr })}</span>
                <span className="r-sub">
                  {peak}
                  {seen ? ` · ${fmtInt(lang, seen)} GMN` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>{t('evMeteors')}</h2>
        <p className="big-num">{fmtInt(lang, recent.length)}</p>
        <p className="note">{t('evMeteorsNote')}</p>
        <button className="action" onClick={replayMeteors} disabled={!meteors.length}>
          {t('replay')}
        </button>
      </section>

      {latestFireball && (
        <section>
          <h2>{t('evFireballs')}</h2>
          <p className="row static">
            <span className="r-main">{fmtShortDate(lang, latestFireball.ms)} UTC</span>
            <span className="r-num">{t('energyKt', { kt: fmtSig(lang, latestFireball.impactKt, 2) })}</span>
            <span className="r-sub">
              {fmtSig(lang, Math.abs(latestFireball.lat), 3)}°{latestFireball.lat >= 0 ? 'N' : 'S'} {fmtSig(lang, Math.abs(latestFireball.lon), 4)}°{latestFireball.lon >= 0 ? 'E' : 'W'}
              {latestFireball.altKm ? ` · ${fmtSig(lang, latestFireball.altKm, 3)} km` : ''}
              {latestFireball.velKms ? ` · ${fmtSig(lang, latestFireball.velKms, 3)} km/s` : ''}
            </span>
          </p>
          <p className="note">{t('evFireballsNote')}</p>
        </section>
      )}

      {brightComets.length > 0 && (
        <section>
          <h2>{t('evComets')}</h2>
          <ul className="rows">
            {brightComets.map((c) => (
              <li key={c.index}>
                <button className="row" onClick={() => selectAndFly({ kind: 'comet', index: c.index })}>
                  <span className="r-main">{c.name}</span>
                  <span className="r-num">{fmtSig(lang, c.mag, 2)}ᵐ</span>
                  <span className="r-sub">
                    {fmtSig(lang, c.r, 3)} {t('au')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {scout.length > 0 && (
        <section>
          <h2>{t('evScout')}</h2>
          <p className="note">{t('evScoutNote')}</p>
          <ul className="rows">
            {scout.map((s) => (
              <li key={s[0]} className="row static">
                <span className="r-main">{s[0]}</span>
                <span className="r-num">NEO {s[2]}%</span>
                <span className="r-sub">
                  H {s[1] ?? '—'}
                  {s[4] !== null ? ` · ${fmtSig(lang, s[4], 2)} LD` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {risk.length > 0 && (
        <section>
          <h2>{t('evRisk')}</h2>
          <p className="note">{t('evRiskNote')}</p>
          <ul className="rows">
            {risk.map((r) => (
              <li key={r[0]} className="row static">
                <span className="r-main">{r[1].replace(/^\((.*)\)$/, '$1')}</span>
                <span className="r-num">{r[2] !== null ? `1 : ${fmtInt(lang, 1 / r[2])}` : '—'}</span>
                <span className="r-sub">
                  {r[6]}
                  {r[5] ? ` · ${fmtSig(lang, r[5] * 1000, 2)} m` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
