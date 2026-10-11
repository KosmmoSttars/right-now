import { fmtInt, useT, type Key } from '../i18n';
import { CLASS_STYLE } from '../sim/classes';
import { setAllClasses, setHMax, toggleClass, toggleLayer } from '../state/controller';
import { useApp } from '../state/store';

const H_STEPS = [14, 16, 18, 20, 99];

export function LayersPanel() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const layers = useApp((s) => s.layers);
  const manifest = useApp((s) => s.manifest);
  const hMax = useApp((s) => s.hMax);
  const live = useApp((s) => s.live);
  const order = CLASS_STYLE.map((s, i) => ({ ...s, i })).sort((a, b) => a.order - b.order);
  const allOn = layers.asteroids.every(Boolean);

  const toggles: [Parameters<typeof toggleLayer>[0], Key, string | null][] = [
    ['orbits', 'layerOrbits', null],
    ['labels', 'layerLabels', null],
    ['comets', 'layerComets', live ? fmtInt(lang, live.comets.length) : null],
    ['streams', 'layerStreams', null],
    ['meteors', 'layerMeteors', live ? fmtInt(lang, live.meteors.length) : null],
    ['approaches', 'layerApproaches', live ? fmtInt(lang, live.approaches.length) : null],
  ];

  return (
    <aside className="panel layers glass" aria-label={t('layers')}>
      <section>
        <h2>{t('layers')}</h2>
        <ul className="toggles">
          {toggles.map(([key, label, count]) => (
            <li key={key}>
              <label className="toggle">
                <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
                <span className="t-label">{t(label)}</span>
                {count && <span className="t-count">{count}</span>}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>
          <label className="toggle head">
            <input type="checkbox" checked={allOn} onChange={() => setAllClasses(!allOn)} />
            <span className="t-label">{t('layerAsteroids')}</span>
            {manifest && <span className="t-count">{fmtInt(lang, manifest.count)}</span>}
          </label>
        </h2>
        <ul className="toggles">
          {order.map((c) => (
            <li key={c.key}>
              <label className="toggle">
                <input type="checkbox" checked={layers.asteroids[c.i]} onChange={() => toggleClass(c.i)} />
                <span className="swatch" style={{ background: c.color }} />
                <span className="t-label">{t(`cls_${c.key}` as Key)}</span>
                {manifest && <span className="t-count">{fmtInt(lang, manifest.classes[c.i] ?? 0)}</span>}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>{t('faint')}</h2>
        <div className="segmented" role="radiogroup" aria-label={t('faint')}>
          {H_STEPS.map((h) => (
            <button key={h} role="radio" aria-checked={hMax === h} className={hMax === h ? 'on' : ''} onClick={() => setHMax(h)}>
              {h === 99 ? t('faintAll') : `H ≤ ${h}`}
            </button>
          ))}
        </div>
        <p className="note">{t('faintHint')}</p>
      </section>
    </aside>
  );
}
