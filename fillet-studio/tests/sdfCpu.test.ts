import { describe, it, expect } from 'vitest';
import { compileCsg } from '../src/core/sdfCpu';
import { makeOp, makePrim } from '../src/core/csg';

const EPS = 1e-6;

describe('sdfCpu primitives', () => {
  it('sphere at origin reports correct signed distance', () => {
    const sdf = compileCsg(makePrim('sphere', [0.5]));
    expect(sdf(0, 0, 0)).toBeCloseTo(-0.5, 6);
    expect(sdf(0.5, 0, 0)).toBeCloseTo(0, 6);
    expect(sdf(1, 0, 0)).toBeCloseTo(0.5, 6);
    // isotropy: same distance along every axis
    expect(sdf(0, 0, 0.7)).toBeCloseTo(0.2, 6);
    expect(sdf(0, 0.7, 0)).toBeCloseTo(0.2, 6);
  });

  it('translated sphere respects translate', () => {
    const sdf = compileCsg(makePrim('sphere', [0.3], [1, 0, 0]));
    expect(sdf(1, 0, 0)).toBeCloseTo(-0.3, 6);
    expect(sdf(1.3, 0, 0)).toBeCloseTo(0, 6);
    expect(sdf(0, 0, 0)).toBeCloseTo(0.7, 6);
  });

  it('box half-extents produce expected distance', () => {
    const sdf = compileCsg(makePrim('box', [0.5, 0.5, 0.5]));
    expect(sdf(0, 0, 0)).toBeCloseTo(-0.5, 6);
    expect(sdf(0.5, 0, 0)).toBeCloseTo(0, 6);
    expect(sdf(1, 0, 0)).toBeCloseTo(0.5, 6);
    // diagonal corner: distance to (0.5,0.5,0.5) from (1,1,1) is sqrt(3)*0.5
    expect(sdf(1, 1, 1)).toBeCloseTo(Math.sqrt(3) * 0.5, 6);
  });

  it('torus reports inside/outside correctly', () => {
    // Major R=0.5, tube r=0.15, lies in xz-plane
    const sdf = compileCsg(makePrim('torus', [0.5, 0.15]));
    // On the central circle (R, 0, 0): inside by r
    expect(sdf(0.5, 0, 0)).toBeCloseTo(-0.15, 6);
    // On the tube outer surface (R + r, 0, 0): on surface
    expect(sdf(0.65, 0, 0)).toBeCloseTo(0, 6);
    // Origin: outside (distance = R - r)
    expect(sdf(0, 0, 0)).toBeCloseTo(0.5 - 0.15, 6);
  });

  it('capsule: on segment endpoints sits at surface', () => {
    const sdf = compileCsg(makePrim('capsule', [0, -0.3, 0, 0, 0.3, 0, 0.2]));
    // At point a, distance is -r (inside tube)
    expect(sdf(0, -0.3, 0)).toBeCloseTo(-0.2, 6);
    // Tube surface at midpoint radially
    expect(sdf(0.2, 0, 0)).toBeCloseTo(0, 6);
    // Beyond cap
    expect(sdf(0, 0.6, 0)).toBeCloseTo(0.1, 6);
  });

  it('roundBox equals sdBox(b−r) − r at axis-aligned sample', () => {
    const sdf = compileCsg(makePrim('roundBox', [0.5, 0.5, 0.5, 0.1]));
    // On face center (0.5, 0, 0): outside (hx-r=0.4, then length(max(0.1,0,0))+min(...)−r = 0.1 − 0.1 = 0)
    expect(sdf(0.5, 0, 0)).toBeCloseTo(0, 6);
    // Corner outside: analytical distance from corner of rounded box at (0.5,0.5,0.5) is 0.
    // The inner box half-extents are 0.4 and the corner (0.5,0.5,0.5) is at distance sqrt(3)·0.1 from inner corner,
    // minus r gives sqrt(3)·0.1 − 0.1 ≈ 0.0732.
    expect(sdf(0.5, 0.5, 0.5)).toBeCloseTo(Math.sqrt(3) * 0.1 - 0.1, 6);
  });

  it('union combines two primitives by min', () => {
    const a = makePrim('sphere', [0.3], [-0.3, 0, 0]);
    const b = makePrim('sphere', [0.3], [0.3, 0, 0]);
    const sdf = compileCsg(makeOp('union', [a, b]));
    // Origin: each sphere is at distance 0.3 (surface). min = 0.
    expect(sdf(0, 0, 0)).toBeCloseTo(0, EPS);
    // Center of sphere A: inside A.
    expect(sdf(-0.3, 0, 0)).toBeCloseTo(-0.3, 6);
  });

  it('difference A − B subtracts B from A', () => {
    const a = makePrim('sphere', [0.5]);
    const b = makePrim('sphere', [0.2], [0.5, 0, 0]);
    const sdf = compileCsg(makeOp('diff', [a, b]));
    // Origin: inside A by 0.5 but only 0.3 from B's surface; max(-0.5, -0.3) = -0.3 (nearest boundary is the subtracted cavity wall).
    expect(sdf(0, 0, 0)).toBeCloseTo(-0.3, 6);
    // At (0.5, 0, 0): was on surface of A. B's center there, distance −0.2, so max(0, 0.2) = 0.2 → outside cavity.
    expect(sdf(0.5, 0, 0)).toBeCloseTo(0.2, 6);
    // Far left (−0.5, 0, 0): on A's surface, far from B's influence.
    expect(sdf(-0.5, 0, 0)).toBeCloseTo(0, 6);
  });

  it('smoothUnion with k=0 falls back to min', () => {
    const a = makePrim('sphere', [0.3], [-0.3, 0, 0]);
    const b = makePrim('sphere', [0.3], [0.3, 0, 0]);
    const sharp = compileCsg(makeOp('union', [a, b]));
    const smooth = compileCsg(makeOp('smoothUnion', [a, b], 0));
    // Well away from the blend zone, results should coincide.
    expect(smooth(-1, 0, 0)).toBeCloseTo(sharp(-1, 0, 0), 6);
  });
});
