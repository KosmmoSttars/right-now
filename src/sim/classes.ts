// Small-body display classes (keep in step with the C_* constants in public/api/data.php).

export const CLASS_COUNT = 10;

export const AstClass = {
  MainBelt: 0,
  NearEarth: 1,
  Hazardous: 2,
  Hungaria: 3,
  Hilda: 4,
  Trojan: 5,
  MarsCrosser: 6,
  Centaur: 7,
  TransNeptunian: 8,
  OuterBelt: 9,
} as const;
export type AstClass = (typeof AstClass)[keyof typeof AstClass];

export interface ClassStyle {
  key: string;
  color: string;
  /** Base point opacity: the huge main belt is faint, rare classes stand out. */
  alpha: number;
  /** Legend order. */
  order: number;
}

// Colours chosen for a near-black sky: warm for what comes near us, cool for the
// distant populations, neutral for the bulk of the belt.
export const CLASS_STYLE: ClassStyle[] = [
  { key: 'mba', color: '#8c9bb5', alpha: 0.22, order: 4 },
  { key: 'neo', color: '#ffb547', alpha: 0.6, order: 1 },
  { key: 'pha', color: '#ff5b4a', alpha: 1.0, order: 0 },
  { key: 'hungaria', color: '#b48cff', alpha: 0.5, order: 3 },
  { key: 'hilda', color: '#5fd38a', alpha: 0.6, order: 6 },
  { key: 'trojan', color: '#4fd1c5', alpha: 0.55, order: 7 },
  { key: 'mars', color: '#e88a6a', alpha: 0.3, order: 2 },
  { key: 'centaur', color: '#7cc4ff', alpha: 0.9, order: 8 },
  { key: 'tno', color: '#6f8cff', alpha: 0.85, order: 9 },
  { key: 'outer', color: '#a7b4c8', alpha: 0.3, order: 5 },
];

/** Diameter estimate from absolute magnitude and an assumed geometric albedo, km. */
export function diameterKm(h: number, albedo: number): number {
  return (1329 / Math.sqrt(albedo)) * Math.pow(10, -h / 5);
}
