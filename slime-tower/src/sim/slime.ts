import type { PaletteName, ShapeChoice, ShapeKind, Slime, Vec3 } from '../state/types';
import { SHAPE_KINDS } from '../state/types';
import { pickBodyColor } from '../util/color';
import { mintSlimeId } from '../state/store';
import { randRange } from '../util/rng';

export type DropOptions = {
  radius?: number;
  color?: Vec3;
  // Initial downward velocity injected at spawn (world m/s). Gives drops a
  // satisfying whack on the ground instead of a float.
  initialVy?: number;
};

// Canonical radius range. Kept tight so merged towers read as "stacked eggs"
// rather than "one giant blob".
export const RADIUS_MIN = 0.12;
export const RADIUS_MAX = 0.22;

export function createSlime(pos: Vec3, options: DropOptions = {}): Slime {
  const r = options.radius ?? 0.16;
  const color = options.color ?? [0.6, 0.85, 0.92];
  const vy = options.initialVy ?? -0.4;
  const dt = 1 / 60;
  return {
    id: mintSlimeId(),
    pos: [pos[0], pos[1], pos[2]],
    prev: [pos[0], pos[1] - vy * dt, pos[2]],
    radii: [r, r, r],
    baseRadius: r,
    color: [color[0], color[1], color[2]],
    mass: (4 / 3) * Math.PI * r * r * r,
    shape: 'sphere',
    ageSec: 0,
  };
}

// Resolve "random" to one of the concrete shapes using the supplied RNG so
// the drop is deterministic from seed+count.
export function resolveShape(choice: ShapeChoice, rng: () => number): ShapeKind {
  if (choice !== 'random') return choice;
  const i = Math.floor(rng() * SHAPE_KINDS.length);
  return SHAPE_KINDS[Math.min(i, SHAPE_KINDS.length - 1)];
}

export function randomRadius(rng: () => number): number {
  return randRange(rng, RADIUS_MIN, RADIUS_MAX);
}

// Volume-preserving radius combination for merges. Returns the radius of a
// sphere whose volume equals the sum of two spheres'.
export function combinedRadius(rA: number, rB: number): number {
  return Math.cbrt(rA * rA * rA + rB * rB * rB);
}

export function paletteBodyColor(rng: () => number, palette: PaletteName): Vec3 {
  return pickBodyColor(rng, palette);
}
