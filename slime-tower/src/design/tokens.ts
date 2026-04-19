// Centralised design tokens. The Isometric Translucent Glass + Grid references
// set a tight constraint envelope: pastel body colours (HSL S ≤ 0.6) with one
// saturated accent per palette, soft sky-gradient backgrounds, grid-on-floor
// with distance fade, and a glass shader (Fresnel rim + fake SSS).

import type { PaletteName, Vec3 } from '../state/types';

export type PaletteTheme = {
  name: PaletteName;
  backgroundTop: Vec3;
  backgroundBottom: Vec3;
  // Relative glass intensity. Higher = more rim / SSS.
  glassRim: number;
  sssDensity: number;
  gridIntensity: number;
};

export const THEMES: Record<PaletteName, PaletteTheme> = {
  Aquarium: {
    name: 'Aquarium',
    backgroundTop: [0.78, 0.87, 0.97],
    backgroundBottom: [0.92, 0.95, 1.0],
    glassRim: 0.65,
    sssDensity: 0.55,
    gridIntensity: 0.4,
  },
  Caramel: {
    name: 'Caramel',
    backgroundTop: [0.98, 0.9, 0.82],
    backgroundBottom: [1.0, 0.96, 0.9],
    glassRim: 0.45,
    sssDensity: 0.5,
    gridIntensity: 0.28,
  },
  Lab: {
    name: 'Lab',
    backgroundTop: [0.88, 0.96, 0.92],
    backgroundBottom: [0.95, 0.98, 0.94],
    glassRim: 0.55,
    sssDensity: 0.45,
    gridIntensity: 0.45,
  },
  Mono: {
    name: 'Mono',
    backgroundTop: [0.9, 0.9, 0.94],
    backgroundBottom: [0.96, 0.96, 0.98],
    glassRim: 0.5,
    sssDensity: 0.35,
    gridIntensity: 0.35,
  },
  // Dark arcade backdrop so saturated tetromino colours read as neon.
  Tetris: {
    name: 'Tetris',
    backgroundTop: [0.06, 0.05, 0.12],
    backgroundBottom: [0.11, 0.09, 0.18],
    glassRim: 0.85,
    sssDensity: 0.3,
    gridIntensity: 0.7,
  },
};

// Spacing on the ground grid (world units). Two tiers: fine + major lines.
export const GRID = {
  fineSpacing: 0.25,
  majorSpacing: 1.0,
  fineWidth: 0.008,
  majorWidth: 0.012,
};

export const GLASS = {
  // Minimum rim value to keep slimes feeling like glass at low palette rim.
  minRim: 0.25,
  // SSS falloff exponent applied inside shader.
  sssExponent: 2.0,
};
