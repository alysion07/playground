import type { ShapeKind, SimParams, Slime } from '../state/types';

export type Bounds3 = { x: number; y: number; z: number };

const MAX_SUBSTEPS = 3;
const FIXED_DT = 1 / 120;
const FLOOR_RESTITUTION = 0.3;
const WALL_RESTITUTION = 0.5;

// Advance physics by wall-clock dt. Mutates slimes in place.
export function step(dtSeconds: number, sim: SimParams, slimes: Slime[], bounds: Bounds3): void {
  if (slimes.length === 0 || dtSeconds <= 0) return;
  const scaled = dtSeconds * Math.max(0, sim.timeScale);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(scaled / FIXED_DT)));
  const h = scaled / steps;
  for (let s = 0; s < steps; s++) substep(h, sim, slimes, bounds);
  for (const sl of slimes) sl.ageSec += dtSeconds;
}

function substep(h: number, sim: SimParams, slimes: Slime[], bounds: Bounds3): void {
  const n = slimes.length;

  // Verlet position update with velocity damping.
  const dampPerSec = Math.max(0, Math.min(1, sim.damping));
  const dampFactor = Math.pow(1 - dampPerSec, h);
  const g = sim.gravity;

  for (let i = 0; i < n; i++) {
    const s = slimes[i];
    const vx = (s.pos[0] - s.prev[0]) * dampFactor;
    const vy = (s.pos[1] - s.prev[1]) * dampFactor;
    const vz = (s.pos[2] - s.prev[2]) * dampFactor;
    const nx = s.pos[0] + vx;
    const ny = s.pos[1] + vy - g * h * h;
    const nz = s.pos[2] + vz;
    s.prev[0] = s.pos[0];
    s.prev[1] = s.pos[1];
    s.prev[2] = s.pos[2];
    s.pos[0] = nx;
    s.pos[1] = ny;
    s.pos[2] = nz;
  }

  // Pairwise soft sphere repulsion — so stacks settle instead of collapsing
  // into the same point.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      separate(slimes[i], slimes[j]);
    }
  }

  // World bounds.
  for (let i = 0; i < n; i++) clampToBounds(slimes[i], bounds);
}

// Position correction runs with full prev-follow so the separation itself
// does not create velocity. Velocity damping is a separate step — we
// explicitly kill most of the closing (normal) velocity while leaving
// tangential motion alone. That gives inelastic stacking without
// pinning sliding motion.
const NORMAL_VEL_DAMP = 0.6;
// Contact friction: damp tangential relative velocity while slimes touch so
// a slime landing sideways next to another does not keep gliding off into
// the distance. Only applied on CLOSING contacts and scaled by overlap
// depth so glancing touches do not inject energy.
const CONTACT_FRICTION_MAX = 0.18;
const FRICTION_OVERLAP_SATURATE = 0.03;
// Cap per-substep position correction to avoid the "teleport pushing out"
// failure mode when two shapes overlap deeply in a single integration step.
const MAX_CORRECTION_PER_SUBSTEP = 0.04;

function separate(a: Slime, b: Slime): void {
  const ra = collisionRadius(a);
  const rb = collisionRadius(b);
  const dx = b.pos[0] - a.pos[0];
  const dy = b.pos[1] - a.pos[1];
  const dz = b.pos[2] - a.pos[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  const rSum = ra + rb;
  if (d2 >= rSum * rSum || d2 < 1e-12) return;
  const d = Math.sqrt(d2);
  const overlap = Math.min(rSum - d, MAX_CORRECTION_PER_SUBSTEP);
  // Grounded slimes anchor the stack — effective mass goes way up so upper
  // slimes take the full correction instead of jostling the foundation.
  const mA = effectiveMass(a);
  const mB = effectiveMass(b);
  const wA = mB / (mA + mB);
  const wB = mA / (mA + mB);
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  const pushA = overlap * wA;
  const pushB = overlap * wB;
  a.pos[0] -= nx * pushA;
  a.pos[1] -= ny * pushA;
  a.pos[2] -= nz * pushA;
  a.prev[0] -= nx * pushA;
  a.prev[1] -= ny * pushA;
  a.prev[2] -= nz * pushA;
  b.pos[0] += nx * pushB;
  b.pos[1] += ny * pushB;
  b.pos[2] += nz * pushB;
  b.prev[0] += nx * pushB;
  b.prev[1] += ny * pushB;
  b.prev[2] += nz * pushB;

  // Normal-velocity damping: reduce the relative closing speed along the
  // contact normal. Tangential components stay intact so sliding reads
  // naturally. Weighted with effectiveMass so anchors don't get kicked.
  const avx = a.pos[0] - a.prev[0];
  const avy = a.pos[1] - a.prev[1];
  const avz = a.pos[2] - a.prev[2];
  const bvx = b.pos[0] - b.prev[0];
  const bvy = b.pos[1] - b.prev[1];
  const bvz = b.pos[2] - b.prev[2];
  const vRelX = bvx - avx;
  const vRelY = bvy - avy;
  const vRelZ = bvz - avz;
  const vN = vRelX * nx + vRelY * ny + vRelZ * nz;
  // Both normal damping and tangential friction only fire on a closing
  // contact. Glancing contacts (vN ≥ 0) leave velocities untouched so a
  // slime that merely brushes past another does not get a phantom kick.
  if (vN >= 0) return;

  const impulse = -vN * NORMAL_VEL_DAMP;
  const impA = impulse * wA;
  const impB = impulse * wB;
  a.prev[0] += nx * impA;
  a.prev[1] += ny * impA;
  a.prev[2] += nz * impA;
  b.prev[0] -= nx * impB;
  b.prev[1] -= ny * impB;
  b.prev[2] -= nz * impB;

  // Friction fades in with overlap depth. A near-zero overlap (grazing)
  // applies almost no friction; a deep overlap applies the full coefficient.
  // Prevents the "first-contact teleport" feel where a landing slime got
  // energy siphoned even when only a corner tipped in.
  const overlapDepth = rSum - d;
  const frictionScale = Math.min(overlapDepth / FRICTION_OVERLAP_SATURATE, 1);
  const friction = CONTACT_FRICTION_MAX * frictionScale;
  if (friction > 0) {
    const vtX = vRelX - vN * nx;
    const vtY = vRelY - vN * ny;
    const vtZ = vRelZ - vN * nz;
    a.prev[0] -= vtX * friction * wA;
    a.prev[1] -= vtY * friction * wA;
    a.prev[2] -= vtZ * friction * wA;
    b.prev[0] += vtX * friction * wB;
    b.prev[1] += vtY * friction * wB;
    b.prev[2] += vtZ * friction * wB;
  }
}

// Per-shape collision multiplier. The baseline assumes the shape fits inside
// baseRadius visually; the multiplier tightens the sphere used for pair
// separation so stacking feels true to the visible silhouette.
//
// - sphere:  1.00  → exact bounding sphere.
// - capsule: 0.88  → ends match baseRadius on Y; cross-section slightly
//                    tighter so capsules can snuggle side-by-side.
// - box:     0.92  → face distance, not corner — otherwise two cubes would
//                    "float apart" by their diagonal.
// - torus:   0.55  → thin-ring only. Two toruses interlink instead of
//                    pushing off each other; a sphere can drop into the hole.
const SHAPE_COLLISION: Record<ShapeKind, number> = {
  sphere: 1.0,
  capsule: 0.88,
  box: 0.92,
};

// Mirrors the shader's birth scale so physics collisions do not fire before
// the visual silhouette actually touches. Without this, freshly spawned
// slimes (rendered at 0.8× for 0.3s) register phantom contacts and get
// kicked by the separation resolver.
function birthScaleFor(ageSec: number): number {
  if (ageSec >= 0.3) return 1;
  const t = ageSec / 0.3;
  const s = t * t * (3 - 2 * t); // smoothstep
  return 0.8 + 0.2 * s;
}

function collisionRadius(s: Slime): number {
  return s.baseRadius * SHAPE_COLLISION[s.shape] * birthScaleFor(s.ageSec);
}

// Pair-separation mass: "anchor" slimes behave as nearly immovable so upper
// slimes transfer impulses into the stack/earth instead of rattling the
// foundation. A slime is an anchor if either
//  (a) it sits within a generous band above the floor — the threshold is
//      wide enough that a small separation push upward does not flip the
//      status on/off each frame, or
//  (b) it is mature and nearly stationary — covers mid-stack slimes that
//      have already settled on top of another anchor.
const ANCHOR_FLOOR_BAND = 0.05;
const ANCHOR_MATURE_SEC = 0.35;
const ANCHOR_SPEED_MAX = 0.004;
const ANCHOR_MASS_MULT = 500;

function effectiveMass(s: Slime): number {
  const floorGap = s.pos[1] - s.baseRadius;
  if (floorGap < ANCHOR_FLOOR_BAND) return s.mass * ANCHOR_MASS_MULT;
  if (s.ageSec > ANCHOR_MATURE_SEC) {
    const vx = s.pos[0] - s.prev[0];
    const vy = s.pos[1] - s.prev[1];
    const vz = s.pos[2] - s.prev[2];
    if (vx * vx + vy * vy + vz * vz < ANCHOR_SPEED_MAX * ANCHOR_SPEED_MAX) {
      return s.mass * ANCHOR_MASS_MULT;
    }
  }
  return s.mass;
}

// If a clamp has to snap the position back by more than this many world
// units, we assume the slime teleported (e.g. spawned out of bounds) and zero
// its velocity on that axis instead of using (pos - prev) which would now be
// nonsensically huge.
const TELEPORT_THRESHOLD = 0.15;

function reflectAxis(
  pos: number,
  prev: number,
  lo: number,
  hi: number,
  restitution: number,
): [number, number] {
  let newPos = pos;
  let newPrev = prev;
  if (pos < lo) {
    newPos = lo;
    const overshoot = lo - pos;
    if (overshoot > TELEPORT_THRESHOLD || prev < lo) {
      newPrev = newPos;
    } else {
      const v = newPos - prev;
      newPrev = newPos + v * restitution;
    }
  } else if (pos > hi) {
    newPos = hi;
    const overshoot = pos - hi;
    if (overshoot > TELEPORT_THRESHOLD || prev > hi) {
      newPrev = newPos;
    } else {
      const v = newPos - prev;
      newPrev = newPos + v * restitution;
    }
  }
  return [newPos, newPrev];
}

function clampToBounds(s: Slime, bounds: Bounds3): void {
  const rx = s.radii[0];
  const ry = s.radii[1];
  const rz = s.radii[2];

  // Floor at y=0 (no ceiling wall — slimes can spawn above bounds.y briefly).
  if (s.pos[1] < ry) {
    const overshoot = ry - s.pos[1];
    const wasIn = s.prev[1] >= ry;
    s.pos[1] = ry;
    if (overshoot > TELEPORT_THRESHOLD || !wasIn) {
      s.prev[1] = ry;
    } else {
      const vy = s.pos[1] - s.prev[1];
      s.prev[1] = s.pos[1] + vy * FLOOR_RESTITUTION;
    }
  }
  if (s.pos[1] > bounds.y - ry) {
    s.pos[1] = bounds.y - ry;
    s.prev[1] = s.pos[1];
  }

  const [x, px] = reflectAxis(s.pos[0], s.prev[0], -bounds.x + rx, bounds.x - rx, WALL_RESTITUTION);
  s.pos[0] = x;
  s.prev[0] = px;

  const [z, pz] = reflectAxis(s.pos[2], s.prev[2], -bounds.z + rz, bounds.z - rz, WALL_RESTITUTION);
  s.pos[2] = z;
  s.prev[2] = pz;
}

// Utility for max-height score.
export function towerHeight(slimes: Slime[]): number {
  let h = 0;
  for (const s of slimes) {
    const top = s.pos[1] + s.radii[1];
    if (top > h) h = top;
  }
  return h;
}

// Velocity approximation for merge "settled contact" check.
export function speed(s: Slime): number {
  const vx = s.pos[0] - s.prev[0];
  const vy = s.pos[1] - s.prev[1];
  const vz = s.pos[2] - s.prev[2];
  return Math.sqrt(vx * vx + vy * vy + vz * vz);
}
