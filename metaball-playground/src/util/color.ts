import type { PaletteName, Vec3 } from '../state/types';
import { randRange } from './rng';

export const PALETTES: Record<PaletteName, Vec3[]> = {
  Default: [
    [1.0, 0.35, 0.2],
    [0.2, 0.7, 1.0],
    [0.95, 0.9, 0.3],
    [0.6, 0.3, 0.9],
    [0.3, 0.9, 0.5],
  ],
  Warm: [
    [1.0, 0.5, 0.2],
    [1.0, 0.3, 0.4],
    [0.95, 0.8, 0.3],
    [0.9, 0.45, 0.15],
    [1.0, 0.65, 0.35],
  ],
  Cool: [
    [0.2, 0.55, 1.0],
    [0.15, 0.85, 0.9],
    [0.35, 0.4, 0.95],
    [0.25, 0.75, 0.75],
    [0.45, 0.55, 1.0],
  ],
  Pastel: [
    [1.0, 0.75, 0.8],
    [0.75, 0.88, 1.0],
    [0.95, 0.9, 0.7],
    [0.85, 0.95, 0.85],
    [0.92, 0.8, 0.95],
  ],
  Neon: [
    [0.15, 1.0, 0.4],
    [1.0, 0.15, 0.7],
    [0.2, 0.8, 1.0],
    [1.0, 0.9, 0.15],
    [0.9, 0.25, 1.0],
  ],
};

export function pickColor(rng: () => number, palette: PaletteName = 'Default'): Vec3 {
  const arr = PALETTES[palette];
  const i = Math.floor(randRange(rng, 0, arr.length));
  const c = arr[Math.min(i, arr.length - 1)];
  return [c[0], c[1], c[2]];
}

export function hexToRgb(hex: string): Vec3 {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

export function rgbToHex([r, g, b]: Vec3): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
