// Transient visual effects that live outside per-slime state. Currently just
// ground ripples from floor impacts — a fixed-capacity ring buffer so a burst
// of drops can't allocate unboundedly and shader uniform size stays constant.

export type Ripple = {
  x: number;
  z: number;
  ageSec: number;
  mag: number;
};

export const MAX_RIPPLES = 12;
const RIPPLE_LIFE_SEC = 1.0;

const buffer: Ripple[] = [];
let writeIdx = 0;

export function pushRipple(x: number, z: number, mag: number): void {
  if (buffer.length < MAX_RIPPLES) {
    buffer.push({ x, z, ageSec: 0, mag });
    writeIdx = buffer.length % MAX_RIPPLES;
    return;
  }
  // Ring overwrite: replaces the oldest slot. Simpler than sorting by age and
  // the cadence of floor hits is low enough that we rarely evict a young one.
  buffer[writeIdx] = { x, z, ageSec: 0, mag };
  writeIdx = (writeIdx + 1) % MAX_RIPPLES;
}

export function tickRipples(dtSec: number): void {
  if (dtSec <= 0) return;
  // Age every live ripple, drop dead ones in-place. Iterate backwards so
  // splice doesn't skip neighbours.
  for (let i = buffer.length - 1; i >= 0; i--) {
    buffer[i].ageSec += dtSec;
    if (buffer[i].ageSec >= RIPPLE_LIFE_SEC) {
      buffer.splice(i, 1);
    }
  }
  writeIdx = buffer.length % MAX_RIPPLES;
}

export function getRipples(): readonly Ripple[] {
  return buffer;
}

// Test hook — wipes the buffer so tests don't leak state.
export function _resetRipples(): void {
  buffer.length = 0;
  writeIdx = 0;
}
