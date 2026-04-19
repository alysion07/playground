import type { Slime } from '../state/types';

// Squish response curve. Higher → more dramatic flattening per unit load.
// Tuned so a single slime sitting on another squishes ~0.75×.
export const SQUISH_K = 0.6;
// Minimum vertical compression. Prevents slimes pancaking into invisibility
// under very tall stacks.
export const MIN_COMPRESSION = 0.55;
// XZ footprint margin for "above me" check. Slightly generous so stacked
// slimes count as supported even if slightly offset.
const FOOTPRINT_FACTOR = 1.05;

// Impact squish pulse parameters. The pulse is a damped cosine on top of the
// load-driven compression: ry gets pushed further down and then rebounds ~2
// cycles before settling. Volume-preserving via the same sqrt(1/c) expand.
export const IMPACT_AMPLITUDE = 0.35; // max fractional ry deflection
const IMPACT_OMEGA = (2 * Math.PI) / 0.18; // ≈ 35 rad/s
const IMPACT_TAU = 0.12; // envelope decay (s)
// How close (world units) a slime above needs its bottom edge to our top
// edge to count as "in contact". Without this, airborne drops squish the
// stack the instant they spawn.
const CONTACT_TOLERANCE = 0.06;

// Returns load[i] = total mass pressing down on slime i through vertical
// contact chains. Implemented as a transitive sum: process slimes top-down;
// each slime's load is the sum of (mass + load) of every slime in direct
// contact above it within its XZ footprint.
export function computeLoads(slimes: Slime[]): Float32Array {
  const n = slimes.length;
  const loads = new Float32Array(n);
  if (n === 0) return loads;

  // Highest first → upper slimes resolved before the ones they rest on, so
  // cumulative mass propagates down the stack in a single pass.
  const order: number[] = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => slimes[b].pos[1] - slimes[a].pos[1]);

  for (const i of order) {
    const a = slimes[i];
    const ri = a.baseRadius * FOOTPRINT_FACTOR;
    const aTop = a.pos[1] + a.baseRadius;
    let total = 0;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const b = slimes[k];
      if (b.pos[1] <= a.pos[1]) continue;
      // Must be within the XZ footprint.
      const dx = b.pos[0] - a.pos[0];
      const dz = b.pos[2] - a.pos[2];
      const d2 = dx * dx + dz * dz;
      const rSum = ri + b.baseRadius * FOOTPRINT_FACTOR;
      if (d2 > rSum * rSum) continue;
      // Must actually be in contact vertically — airborne slimes contribute
      // nothing until they land.
      const bBottom = b.pos[1] - b.baseRadius;
      if (bBottom > aTop + CONTACT_TOLERANCE) continue;
      // Transitive: b already accumulated mass from everything above it.
      total += b.mass + loads[k];
    }
    loads[i] = total;
  }
  return loads;
}

// In-place radii update from (baseRadius, load). Preserves volume:
// V = (4/3)π rx ry rz with rx = rz = base * sqrt(1/c), ry = base * c.
//
// When a slime has an active impact (impactMag > 0), an additional damped
// cosine pulse modulates the compression. The pulse multiplies (1 - amp*osc)
// into ry, and rx/rz expand by sqrt(1/ry_factor) so volume is preserved
// continuously through the wobble.
export function applySquish(slimes: Slime[], loads: Float32Array): void {
  const n = slimes.length;
  for (let i = 0; i < n; i++) {
    const s = slimes[i];
    const loadRatio = loads[i] / Math.max(s.mass, 1e-4);
    const baseC = Math.max(MIN_COMPRESSION, 1 / (1 + SQUISH_K * loadRatio));

    let compression = baseC;
    if (s.impactMag > 0) {
      const t = s.impactSec;
      const env = Math.exp(-t / IMPACT_TAU);
      const osc = Math.cos(IMPACT_OMEGA * t);
      // osc=1 at t=0 → maximum squish on contact; amplitude scales with mag.
      const pulse = s.impactMag * env * osc * IMPACT_AMPLITUDE;
      compression = Math.max(MIN_COMPRESSION * 0.7, baseC * (1 - pulse));
    }

    const expand = Math.sqrt(1 / compression);
    s.radii[0] = s.baseRadius * expand;
    s.radii[1] = s.baseRadius * compression;
    s.radii[2] = s.baseRadius * expand;
  }
}

// Indices of slimes currently touching the floor (within a tolerance of their
// compressed ry). Used by topple to determine the support hull.
export function findFloorContacts(slimes: Slime[], tolerance = 0.02): number[] {
  const out: number[] = [];
  for (let i = 0; i < slimes.length; i++) {
    const s = slimes[i];
    if (s.pos[1] - s.radii[1] <= tolerance) out.push(i);
  }
  return out;
}
