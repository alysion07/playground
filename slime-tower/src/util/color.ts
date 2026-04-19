import type { PaletteName, Vec3 } from '../state/types';
import { randRange } from './rng';

// Design constraint: HSL saturation ≤ 0.6 → all palettes read as translucent
// glass pastels. An "accent" slot per palette may push to 0.75 for rare pops.
// Tetris intentionally breaks the constraint for an arcade / neon read — its
// whole point is saturated, readable piece colours.
export const PALETTES: Record<PaletteName, Vec3[]> = {
  Aquarium: [
    [0.55, 0.82, 0.92],
    [0.48, 0.78, 0.85],
    [0.62, 0.88, 0.9],
    [0.72, 0.86, 0.82],
    [0.9, 0.5, 0.42], // accent (coral)
  ],
  Caramel: [
    [0.95, 0.78, 0.58],
    [0.88, 0.65, 0.45],
    [0.78, 0.55, 0.38],
    [0.92, 0.82, 0.7],
    [0.52, 0.28, 0.22], // accent (dark chocolate)
  ],
  Lab: [
    [0.65, 0.92, 0.78],
    [0.78, 0.95, 0.62],
    [0.58, 0.88, 0.85],
    [0.88, 0.95, 0.72],
    [0.38, 0.85, 0.62], // accent (neon mint)
  ],
  Mono: [
    [0.92, 0.92, 0.94],
    [0.76, 0.76, 0.8],
    [0.58, 0.58, 0.62],
    [0.35, 0.35, 0.4],
    [0.9, 0.55, 0.45], // accent (coral)
  ],
  // Classic 7-piece tetrominoes. Order: I, O, T, S, Z, L, J.
  Tetris: [
    [0.0, 0.82, 0.94], // I — cyan
    [0.98, 0.82, 0.12], // O — yellow
    [0.55, 0.25, 0.86], // T — purple
    [0.35, 0.82, 0.32], // S — green
    [0.93, 0.22, 0.24], // Z — red
    [0.98, 0.52, 0.1], // L — orange
    [0.15, 0.4, 0.92], // J — blue
  ],
};

export function pickColor(rng: () => number, palette: PaletteName = 'Aquarium'): Vec3 {
  const arr = PALETTES[palette];
  const i = Math.floor(randRange(rng, 0, arr.length));
  const c = arr[Math.min(i, arr.length - 1)];
  return [c[0], c[1], c[2]];
}

// Pick one of the "body" colors — avoids the accent slot for the four pastel
// palettes. Tetris has no accent slot; every entry is a valid piece colour.
export function pickBodyColor(rng: () => number, palette: PaletteName = 'Aquarium'): Vec3 {
  const arr = PALETTES[palette];
  const n = palette === 'Tetris' ? arr.length : Math.max(1, arr.length - 1);
  const i = Math.floor(randRange(rng, 0, n));
  const c = arr[Math.min(i, n - 1)];
  return [c[0], c[1], c[2]];
}

// Pick from the Tetris tetromino palette for the "random" drop colour mode.
// 7 saturated, visually distinct piece colours give noticeably more variety
// than the pastel palettes without muddying into a wash.
export function pickAnyColor(rng: () => number): Vec3 {
  const pool = PALETTES.Tetris;
  const i = Math.floor(randRange(rng, 0, pool.length));
  const c = pool[Math.min(i, pool.length - 1)];
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

export function colorsApproxEqual(a: Vec3, b: Vec3, eps = 0.04): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}
