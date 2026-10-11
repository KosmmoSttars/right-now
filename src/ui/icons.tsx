const PATHS: Record<string, string> = {
  play: 'M7 5l12 7-12 7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  rewind: 'M11 6v12l-8-6zM20 6v12l-8-6z',
  forward: 'M13 6v12l8-6zM4 6v12l8-6z',
  search: 'M10.5 4a6.5 6.5 0 015.2 10.4l4.4 4.4-1.4 1.4-4.4-4.4A6.5 6.5 0 1110.5 4zm0 2a4.5 4.5 0 100 9 4.5 4.5 0 000-9z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  layers: 'M12 3l9 5-9 5-9-5zm-9 9l9 5 9-5M3 16l9 5 9-5',
  events: 'M12 2a10 10 0 110 20 10 10 0 010-20zm0 2a8 8 0 100 16 8 8 0 000-16zm-1 3h2v6h-2zm0 8h2v2h-2z',
  info: 'M11 10h2v7h-2zm0-3h2v2h-2zM12 2a10 10 0 110 20 10 10 0 010-20zm0 2a8 8 0 100 16 8 8 0 000-16z',
  target: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 7a5 5 0 110 10 5 5 0 010-10z',
  external: 'M14 4h6v6h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H14zM5 6h6v2H6v10h10v-5h2v6H4V6z',
};

const STROKED = new Set(['layers', 'target']);

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  const d = PATHS[name] ?? '';
  const stroke = STROKED.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="icon">
      <path d={d} fill={stroke ? 'none' : 'currentColor'} stroke={stroke ? 'currentColor' : 'none'} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
