import type { Slime } from '../state/types';

// Indices of slimes currently touching the floor (within a tolerance of their
// vertical radius). Used by topple to determine the support hull.
export function findFloorContacts(slimes: Slime[], tolerance = 0.02): number[] {
  const out: number[] = [];
  for (let i = 0; i < slimes.length; i++) {
    const s = slimes[i];
    if (s.pos[1] - s.radii[1] <= tolerance) out.push(i);
  }
  return out;
}
