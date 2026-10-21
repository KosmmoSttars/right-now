import { useEffect, useRef } from 'react';
import { boot } from './state/controller';
import { useApp } from './state/store';
import { EventsPanel } from './ui/EventsPanel';
import { InfoPanel } from './ui/InfoPanel';
import { LayersPanel } from './ui/LayersPanel';
import { About, Boot } from './ui/Overlays';
import { TimeBar } from './ui/TimeBar';
import { TopBar } from './ui/TopBar';
import { PlaceDialog } from './ui/PlaceDialog';
import { SkyHud } from './ui/SkyHud';
import { SkyInfo } from './ui/SkyInfo';
import { SkyLayersPanel, SkyPanel } from './ui/SkyPanel';

export function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const phase = useApp((s) => s.phase);
  const panel = useApp((s) => s.panel);
  const mode = useApp((s) => s.mode);

  useEffect(() => {
    if (started.current || !sceneRef.current) return;
    started.current = true;
    void boot(sceneRef.current);
  }, []);

  return (
    <div className="app" data-phase={phase} data-mode={mode}>
      <div className="scene" ref={sceneRef} />
      {phase === 'ready' && (
        <>
          <TopBar />
          {panel === 'events' && (mode === 'sky' ? <SkyPanel /> : <EventsPanel />)}
          {panel === 'layers' && (mode === 'sky' ? <SkyLayersPanel /> : <LayersPanel />)}
          {mode === 'sky' ? <SkyInfo /> : <InfoPanel />}
          {mode === 'sky' && <SkyHud />}
          <TimeBar />
          <About />
          <PlaceDialog />
        </>
      )}
      <Boot />
    </div>
  );
}
