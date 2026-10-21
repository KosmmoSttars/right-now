// The sky mode's compass readout: where the view is pointing.
import { useT } from '../i18n';
import { COMPASS, compassIndex } from '../sim/sky';
import { useApp } from '../state/store';

export function SkyHud() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const v = useApp((s) => s.skyView);
  const place = useApp((s) => s.place);
  if (!place) return null;
  return (
    <div className="sky-hud" aria-live="off">
      {t('looking', { dir: COMPASS[lang][compassIndex(v.az)], alt: Math.round(v.alt) })} · {Math.round(v.fov)}°
    </div>
  );
}
