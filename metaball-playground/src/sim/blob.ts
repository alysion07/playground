import type { Blob, PaletteName } from '../state/types';
import { pickColor } from '../util/color';
import { randRange } from '../util/rng';

export type Bounds = { x: number; y: number }; // half-extents in world units

export type RadiusRange = { min: number; max: number };

export const DEFAULT_RADIUS_RANGE: RadiusRange = { min: 0.06, max: 0.16 };

let nextIdNum = 0;
function mintId(): string {
  nextIdNum = (nextIdNum + 1) >>> 0;
  return `b${nextIdNum.toString(36)}`;
}

export function createBlob(
  rng: () => number,
  bounds: Bounds,
  radiusRange: RadiusRange = DEFAULT_RADIUS_RANGE,
  palette: PaletteName = 'Default',
): Blob {
  const r = randRange(rng, radiusRange.min, radiusRange.max);
  const margin = r + 0.02;
  const x = randRange(rng, -bounds.x + margin, bounds.x - margin);
  const y = randRange(rng, -bounds.y + margin, bounds.y - margin);
  const vx = randRange(rng, -0.15, 0.15);
  const vy = randRange(rng, -0.15, 0.15);
  const dt = 1 / 60;
  return {
    id: mintId(),
    pos: [x, y],
    prev: [x - vx * dt, y - vy * dt],
    radius: r,
    color: pickColor(rng, palette),
    mass: r * r,
  };
}

export function populate(
  rng: () => number,
  count: number,
  bounds: Bounds,
  radiusRange: RadiusRange = DEFAULT_RADIUS_RANGE,
  palette: PaletteName = 'Default',
): Blob[] {
  const out: Blob[] = [];
  for (let i = 0; i < count; i++) out.push(createBlob(rng, bounds, radiusRange, palette));
  return out;
}
