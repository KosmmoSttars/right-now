import { useEffect, useRef } from 'react';
import { boot } from './state/controller';
import { useApp } from './state/store';
import { EventsPanel } from './ui/EventsPanel';
import { InfoPanel } from './ui/InfoPanel';
import { LayersPanel } from './ui/LayersPanel';
import { About, Boot } from './ui/Overlays';
import { TimeBar } from './ui/TimeBar';
import { TopBar } from './ui/TopBar';

export function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const phase = useApp((s) => s.phase);
  const panel = useApp((s) => s.panel);

  useEffect(() => {
    if (started.current || !sceneRef.current) return;
    started.current = true;
    void boot(sceneRef.current);
  }, []);

  return (
    <div className="app" data-phase={phase}>
      <div className="scene" ref={sceneRef} />
      {phase === 'ready' && (
        <>
          <TopBar />
          {panel === 'events' && <EventsPanel />}
          {panel === 'layers' && <LayersPanel />}
          <InfoPanel />
          <TimeBar />
          <About />
        </>
      )}
      <Boot />
    </div>
  );
}
