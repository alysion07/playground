import { describe, expect, it } from 'vitest';
import { smin } from '../src/util/smin';

describe('smin', () => {
  it('returns min when k is 0', () => {
    expect(smin(1, 2, 0)).toBe(1);
    expect(smin(-3, 4, 0)).toBe(-3);
  });

  it('is symmetric in its two args', () => {
    expect(smin(0.3, -0.1, 0.2)).toBeCloseTo(smin(-0.1, 0.3, 0.2), 10);
  });

  it('is <= plain min (blending only pulls result down)', () => {
    const a = 0.5;
    const b = 0.6;
    const k = 0.3;
    expect(smin(a, b, k)).toBeLessThanOrEqual(Math.min(a, b));
  });

  it('equals plain min when inputs are far apart relative to k', () => {
    expect(smin(0, 10, 0.1)).toBe(0);
  });

  it('blends when inputs are within k of each other', () => {
    const a = 0;
    const b = 0;
    const k = 0.2;
    // h = (0.2 - 0) / 0.2 = 1, result = 0 - 1 * 1 * 0.2 * 0.25 = -0.05
    expect(smin(a, b, k)).toBeCloseTo(-0.05, 10);
  });
});
