import type { SimParams, Slime } from '../state/types';
import { combinedRadius } from './slime';
import { speed } from './physics3d';
import { colorsApproxEqual } from '../util/color';
import { findFloorContacts } from './support';

// Settle threshold — slimes merge only once both are moving slowly, so the
// animation reads as "sat for a beat, then fused" rather than "popped in
// mid-air". Units: Verlet pseudo-velocity per substep.
const MERGE_SPEED_MAX = 0.004;
// Radius similarity for merging: |rA - rB| / max(rA, rB) must be ≤ this.
const MERGE_RADIUS_TOLERANCE = 0.35;
// Minimum age before a slime can participate in a merge. Freshly dropped
// slimes (and freshly-merged results) wait this long before fusing further,
// which breaks the cascade that otherwise collapses same-colour stacks in
// one bouncing chain.
export const MERGE_MIN_AGE_SEC = 0.5;

export type MergeEffect = {
  removed: string[];
  added: Slime;
};

// Scan pairs once and return at most one merge per frame (keeps animation
// readable). Returns null when no merge fires.
export function findMerge(sim: SimParams, slimes: Slime[]): MergeEffect | null {
  const n = slimes.length;
  for (let i = 0; i < n; i++) {
    const a = slimes[i];
    if (a.ageSec < MERGE_MIN_AGE_SEC) continue;
    if (speed(a) > MERGE_SPEED_MAX) continue;
    for (let j = i + 1; j < n; j++) {
      const b = slimes[j];
      if (b.ageSec < MERGE_MIN_AGE_SEC) continue;
      if (speed(b) > MERGE_SPEED_MAX) continue;
      if (!colorsApproxEqual(a.color, b.color)) continue;

      const rA = avgRadius(a);
      const rB = avgRadius(b);
      const radiusRatio = Math.abs(rA - rB) / Math.max(rA, rB);
      if (radiusRatio > MERGE_RADIUS_TOLERANCE) continue;

      const dx = b.pos[0] - a.pos[0];
      const dy = b.pos[1] - a.pos[1];
      const dz = b.pos[2] - a.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rSum = rA + rB;
      const overlap = (rSum - d) / Math.min(rA, rB);
      if (overlap < sim.mergeOverlap) continue;

      return { removed: [a.id, b.id], added: merge(a, b) };
    }
  }
  return null;
}

function avgRadius(s: Slime): number {
  return (s.radii[0] + s.radii[1] + s.radii[2]) / 3;
}

// --- Topple -----------------------------------------------------------------

// Minimum gap between successive topple impulses. Prevents a single tower
// collapse from counting as a dozen topples.
const TOPPLE_COOLDOWN_MS = 700;
// Fraction of base radius the CoM can drift before tipping triggers.
const TOPPLE_COM_MARGIN = 0.92;
// How hard the impulse pushes (world units / frame of prev-offset).
const TOPPLE_IMPULSE = 0.05;
// A slime only counts as "on the tower" if:
//  - its XZ lies within this many base-radii of the base centroid AND
//  - it has been alive long enough to plausibly have settled onto the stack.
// The XZ filter catches unrelated drops at a distant XZ. The age filter
// catches fresh drops whose centre is near the base XZ but still airborne.
const TOWER_FOOTPRINT_MULT = 4.0;
const TOWER_MIN_AGE_SEC = 0.25;

let lastToppleMs = -Infinity;

export type ToppleResult = {
  toppled: boolean;
};

export function tryTopple(slimes: Slime[], nowMs: number): ToppleResult {
  if (slimes.length < 2) return { toppled: false };
  if (nowMs - lastToppleMs < TOPPLE_COOLDOWN_MS) return { toppled: false };

  const contacts = findFloorContacts(slimes, 0.03);
  if (contacts.length === 0) return { toppled: false };

  // Base centroid (mass-weighted XZ of floor-touching slimes).
  let baseX = 0;
  let baseZ = 0;
  let baseMass = 0;
  for (const i of contacts) {
    const s = slimes[i];
    baseX += s.pos[0] * s.mass;
    baseZ += s.pos[2] * s.mass;
    baseMass += s.mass;
  }
  baseX /= baseMass;
  baseZ /= baseMass;

  // Base "radius": farthest contact extent from centroid.
  let baseR = 0;
  for (const i of contacts) {
    const s = slimes[i];
    const dx = s.pos[0] - baseX;
    const dz = s.pos[2] - baseZ;
    const r = Math.hypot(dx, dz) + s.radii[0];
    if (r > baseR) baseR = r;
  }
  // Floor of 0.15m so a lone slime still has a sliver of tolerance.
  baseR = Math.max(baseR, 0.15);

  // Only settled slimes within the tower footprint participate. Floor
  // contacts are always in (they form the base); for everyone else we
  // require proximity to the base in XZ and enough age to have landed.
  const towerRadius = baseR * TOWER_FOOTPRINT_MULT;
  const towerRadius2 = towerRadius * towerRadius;
  const contactSet = new Set(contacts);
  const towerIndices: number[] = [];
  let comX = 0;
  let comZ = 0;
  let totalMass = 0;
  for (let i = 0; i < slimes.length; i++) {
    const s = slimes[i];
    if (!contactSet.has(i)) {
      const dx = s.pos[0] - baseX;
      const dz = s.pos[2] - baseZ;
      if (dx * dx + dz * dz > towerRadius2) continue;
      if (s.ageSec < TOWER_MIN_AGE_SEC) continue;
    }
    comX += s.pos[0] * s.mass;
    comZ += s.pos[2] * s.mass;
    totalMass += s.mass;
    towerIndices.push(i);
  }
  if (totalMass === 0 || towerIndices.length < 2) return { toppled: false };
  comX /= totalMass;
  comZ /= totalMass;

  const devX = comX - baseX;
  const devZ = comZ - baseZ;
  const dev = Math.hypot(devX, devZ);
  if (dev < baseR * TOPPLE_COM_MARGIN) return { toppled: false };

  const dirX = devX / dev;
  const dirZ = devZ / dev;

  // Apply lateral impulse only to the tower slimes, scaled by height above
  // the contact plane. Off-tower slimes (e.g. an unrelated drop in mid-air)
  // are not kicked.
  for (const i of towerIndices) {
    const s = slimes[i];
    const h = Math.max(0, s.pos[1] - 0.25);
    const kick = TOPPLE_IMPULSE * (1 + h * 0.8);
    s.prev[0] -= dirX * kick;
    s.prev[2] -= dirZ * kick;
    // Small upward hop to sell the motion.
    s.prev[1] -= kick * 0.25;
  }

  lastToppleMs = nowMs;
  return { toppled: true };
}

// Test hook — reset the module-level cooldown.
export function _resetToppleState(): void {
  lastToppleMs = -Infinity;
}

function merge(a: Slime, b: Slime): Slime {
  // Merge the undeformed spheres so squish recomputes cleanly next frame.
  const r = combinedRadius(a.baseRadius, b.baseRadius);
  const mA = a.mass;
  const mB = b.mass;
  const mTot = mA + mB;
  // Mass-weighted XZ centroid. Y is anchored to the lower of the two rest
  // heights so the merged slime doesn't clip into the floor and bounce out.
  const cx = (a.pos[0] * mA + b.pos[0] * mB) / mTot;
  const cz = (a.pos[2] * mA + b.pos[2] * mB) / mTot;
  const lowerY = Math.min(a.pos[1], b.pos[1]);
  // If either parent was on/near the floor, seat the merged sphere on top of
  // the floor using its own new radius. Otherwise keep the lower Y.
  const cy = Math.max(lowerY, r + 1e-3);
  return {
    id: `${a.id}+${b.id}`,
    pos: [cx, cy, cz],
    // Zero inherited velocity — stops the "pop out of the floor" bounce.
    prev: [cx, cy, cz],
    radii: [r, r, r],
    baseRadius: r,
    color: [a.color[0], a.color[1], a.color[2]],
    mass: mTot,
    // Merged shape defaults to sphere — combining arbitrary shapes is
    // ambiguous, and the volume-preserving sphere is the natural fallback.
    shape: 'sphere',
    ageSec: 0,
  };
}
