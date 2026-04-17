import type { Blob, SimParams, Vec2 } from '../state/types';
import type { Bounds } from './blob';

export type PointerState = {
  pos: Vec2 | null;
  active: boolean; // true while pressed
};

const MAX_SUBSTEPS = 3;
const FIXED_DT = 1 / 120;

// Public entry: advance physics by wall-clock dt, subdivided into fixed sub-steps.
// Mutates blob.pos / blob.prev in place. The store's array reference is unchanged.
export function step(
  dtSeconds: number,
  sim: SimParams,
  blobs: Blob[],
  bounds: Bounds,
  pointer: PointerState,
): void {
  if (blobs.length === 0 || dtSeconds <= 0) return;
  const scaled = dtSeconds * Math.max(0, sim.timeScale);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(scaled / FIXED_DT)));
  const h = scaled / steps;
  for (let s = 0; s < steps; s++) substep(h, sim, blobs, bounds, pointer);
}

function substep(
  h: number,
  sim: SimParams,
  blobs: Blob[],
  bounds: Bounds,
  pointer: PointerState,
): void {
  const n = blobs.length;
  const ax = new Array<number>(n).fill(0);
  const ay = new Array<number>(n).fill(0);

  // Gravity (positive = downward screen, -y in world).
  const g = sim.gravity * 1.2;
  for (let i = 0; i < n; i++) ay[i] -= g;

  // Pairwise attraction (soft). O(n²), n ≤ 32.
  const attractStrength = sim.attraction * 2.0;
  if (attractStrength > 0) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = blobs[i];
        const b = blobs[j];
        const dx = b.pos[0] - a.pos[0];
        const dy = b.pos[1] - a.pos[1];
        const d2 = dx * dx + dy * dy + 1e-4;
        const d = Math.sqrt(d2);
        const rSum = a.radius + b.radius;
        // smoothly fade out beyond 3× the combined radius.
        const falloff = Math.max(0, 1 - d / (rSum * 3));
        const f = (attractStrength * falloff) / d;
        const fx = dx * f;
        const fy = dy * f;
        ax[i] += fx / Math.max(a.mass, 1e-3);
        ay[i] += fy / Math.max(a.mass, 1e-3);
        ax[j] -= fx / Math.max(b.mass, 1e-3);
        ay[j] -= fy / Math.max(b.mass, 1e-3);
      }
    }
  }

  // Pointer spring (pulls ALL blobs toward pointer while active).
  if (pointer.active && pointer.pos && sim.mouseForce > 0) {
    const [px, py] = pointer.pos;
    const k = sim.mouseForce * 3.5;
    for (let i = 0; i < n; i++) {
      const b = blobs[i];
      const dx = px - b.pos[0];
      const dy = py - b.pos[1];
      const d2 = dx * dx + dy * dy + 1e-3;
      const d = Math.sqrt(d2);
      const falloff = Math.max(0, 1 - d / 1.2);
      ax[i] += (dx / d) * k * falloff;
      ay[i] += (dy / d) * k * falloff;
    }
  }

  // Velocity-Verlet via position-Verlet trick with velocity damping.
  // v ≈ (pos - prev) / h → apply damping → integrate.
  const dampPerSec = Math.max(0, Math.min(1, sim.damping));
  const dampFactor = Math.pow(1 - dampPerSec, h);
  for (let i = 0; i < n; i++) {
    const b = blobs[i];
    const vx = (b.pos[0] - b.prev[0]) * dampFactor;
    const vy = (b.pos[1] - b.prev[1]) * dampFactor;
    const nx = b.pos[0] + vx + ax[i] * h * h;
    const ny = b.pos[1] + vy + ay[i] * h * h;
    b.prev[0] = b.pos[0];
    b.prev[1] = b.pos[1];
    b.pos[0] = nx;
    b.pos[1] = ny;
  }

  // Boundary handling.
  switch (sim.boundaryMode) {
    case 'bounce':
      for (let i = 0; i < n; i++) reflectBounce(blobs[i], bounds);
      break;
    case 'wrap':
      for (let i = 0; i < n; i++) wrapBounds(blobs[i], bounds);
      break;
    case 'soft':
      for (let i = 0; i < n; i++) softPush(blobs[i], bounds, h);
      break;
  }
}

function reflectBounce(b: Blob, bounds: Bounds): void {
  const r = b.radius * 0.7;
  const restitution = 0.85;
  if (b.pos[0] < -bounds.x + r) {
    const over = -bounds.x + r - b.pos[0];
    b.pos[0] = -bounds.x + r + over;
    const v = b.pos[0] - b.prev[0];
    b.prev[0] = b.pos[0] + v / restitution;
  } else if (b.pos[0] > bounds.x - r) {
    const over = b.pos[0] - (bounds.x - r);
    b.pos[0] = bounds.x - r - over;
    const v = b.pos[0] - b.prev[0];
    b.prev[0] = b.pos[0] + v / restitution;
  }
  if (b.pos[1] < -bounds.y + r) {
    const over = -bounds.y + r - b.pos[1];
    b.pos[1] = -bounds.y + r + over;
    const v = b.pos[1] - b.prev[1];
    b.prev[1] = b.pos[1] + v / restitution;
  } else if (b.pos[1] > bounds.y - r) {
    const over = b.pos[1] - (bounds.y - r);
    b.pos[1] = bounds.y - r - over;
    const v = b.pos[1] - b.prev[1];
    b.prev[1] = b.pos[1] + v / restitution;
  }
}

function wrapBounds(b: Blob, bounds: Bounds): void {
  const wx = bounds.x * 2;
  const wy = bounds.y * 2;
  if (b.pos[0] < -bounds.x) {
    b.pos[0] += wx;
    b.prev[0] += wx;
  } else if (b.pos[0] > bounds.x) {
    b.pos[0] -= wx;
    b.prev[0] -= wx;
  }
  if (b.pos[1] < -bounds.y) {
    b.pos[1] += wy;
    b.prev[1] += wy;
  } else if (b.pos[1] > bounds.y) {
    b.pos[1] -= wy;
    b.prev[1] -= wy;
  }
}

function softPush(b: Blob, bounds: Bounds, h: number): void {
  const r = b.radius * 0.7;
  const k = 6.0;
  let fx = 0;
  let fy = 0;
  if (b.pos[0] < -bounds.x + r) fx += (-bounds.x + r - b.pos[0]) * k;
  else if (b.pos[0] > bounds.x - r) fx += (bounds.x - r - b.pos[0]) * k;
  if (b.pos[1] < -bounds.y + r) fy += (-bounds.y + r - b.pos[1]) * k;
  else if (b.pos[1] > bounds.y - r) fy += (bounds.y - r - b.pos[1]) * k;
  b.pos[0] += fx * h * h;
  b.pos[1] += fy * h * h;
}
