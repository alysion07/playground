import { describe, expect, it } from 'vitest';
import { smin } from '../src/util/smin';
import { combinedRadius } from '../src/sim/slime';

describe('smin', () => {
  it('falls back to min() when k is zero', () => {
    expect(smin(1, 2, 0)).toBe(1);
    expect(smin(-3, -2, 0)).toBe(-3);
  });

  it('smooths near equal inputs', () => {
    const sharp = Math.min(0.0, 0.01);
    const smooth = smin(0.0, 0.01, 0.2);
    expect(smooth).toBeLessThanOrEqual(sharp);
  });
});

describe('combinedRadius', () => {
  it('preserves volume', () => {
    const r = combinedRadius(1, 1);
    // Two unit spheres combined → radius = 2^(1/3) ≈ 1.2599
    expect(r).toBeCloseTo(Math.cbrt(2), 5);
  });
});
