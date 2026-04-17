import type { PaletteName, PresetName, RenderParams, SimParams } from '../state/types';
import type { RadiusRange } from './blob';

export type PresetDef = {
  sim: Partial<SimParams>;
  render: Partial<RenderParams>;
  seed: number;
  palette: PaletteName;
  radiusRange: RadiusRange;
};

const PRESETS: Record<PresetName, PresetDef> = {
  Lava: {
    sim: {
      count: 8,
      blobSmoothness: 0.75,
      gravity: 0.35,
      damping: 0.15,
      attraction: 0.25,
      mouseForce: 3,
      boundaryMode: 'bounce',
      timeScale: 1,
    },
    render: {
      aa: 1.8,
      colorSoftness: 5,
      backgroundColor: [0.08, 0.02, 0.02],
      palette: 'Warm',
      bloom: 0.6,
      vignette: 0.45,
      rimLight: 0.4,
    },
    seed: 42,
    palette: 'Warm',
    radiusRange: { min: 0.08, max: 0.18 },
  },
  Jelly: {
    sim: {
      count: 6,
      blobSmoothness: 0.85,
      gravity: 0.1,
      damping: 0.35,
      attraction: 0.15,
      mouseForce: 2,
      boundaryMode: 'soft',
      timeScale: 0.9,
    },
    render: {
      aa: 1.5,
      colorSoftness: 4,
      backgroundColor: [0.04, 0.06, 0.1],
      palette: 'Pastel',
      bloom: 0.2,
      vignette: 0.2,
      rimLight: 0.55,
    },
    seed: 11,
    palette: 'Pastel',
    radiusRange: { min: 0.1, max: 0.2 },
  },
  Mercury: {
    sim: {
      count: 10,
      blobSmoothness: 0.95,
      gravity: 0,
      damping: 0.05,
      attraction: 0.45,
      mouseForce: 4,
      boundaryMode: 'wrap',
      timeScale: 1.1,
    },
    render: {
      aa: 1,
      colorSoftness: 8,
      backgroundColor: [0.02, 0.02, 0.03],
      palette: 'Cool',
      bloom: 0.35,
      vignette: 0.5,
      rimLight: 0.75,
    },
    seed: 7,
    palette: 'Cool',
    radiusRange: { min: 0.05, max: 0.12 },
  },
  SoapBubble: {
    sim: {
      count: 4,
      blobSmoothness: 0.5,
      gravity: -0.15,
      damping: 0.4,
      attraction: 0.02,
      mouseForce: 1.5,
      boundaryMode: 'bounce',
      timeScale: 0.8,
    },
    render: {
      aa: 2.2,
      colorSoftness: 3,
      backgroundColor: [0.9, 0.95, 1.0],
      palette: 'Pastel',
      bloom: 0.1,
      vignette: 0.1,
      rimLight: 0.8,
    },
    seed: 99,
    palette: 'Pastel',
    radiusRange: { min: 0.12, max: 0.22 },
  },
  Galaxy: {
    sim: {
      count: 16,
      blobSmoothness: 0.4,
      gravity: 0,
      damping: 0.1,
      attraction: 0.6,
      mouseForce: 2.5,
      boundaryMode: 'wrap',
      timeScale: 1.2,
    },
    render: {
      aa: 1.2,
      colorSoftness: 7,
      backgroundColor: [0.01, 0.01, 0.04],
      palette: 'Neon',
      bloom: 0.7,
      vignette: 0.6,
      rimLight: 0.5,
    },
    seed: 2024,
    palette: 'Neon',
    radiusRange: { min: 0.04, max: 0.1 },
  },
};

export function getPreset(name: PresetName): PresetDef {
  return PRESETS[name];
}

export const PRESET_NAMES: PresetName[] = Object.keys(PRESETS) as PresetName[];
