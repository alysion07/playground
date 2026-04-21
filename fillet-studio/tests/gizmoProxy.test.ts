import { describe, it, expect } from 'vitest';
import { buildProxyGeometry } from '../src/render/transformGizmo';
import { makePrim } from '../src/core/csg';

function bbox(geom: any): { min: [number, number, number]; max: [number, number, number] } {
  geom.computeBoundingBox();
  const b = geom.boundingBox!;
  return {
    min: [b.min.x, b.min.y, b.min.z],
    max: [b.max.x, b.max.y, b.max.z],
  };
}

describe('buildProxyGeometry', () => {
  it('sphere bbox is ±r', () => {
    const prim = makePrim('sphere', [0.4]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(min[0]).toBeCloseTo(-0.4, 2);
    expect(max[0]).toBeCloseTo(0.4, 2);
    expect(min[1]).toBeCloseTo(-0.4, 2);
    expect(max[2]).toBeCloseTo(0.4, 2);
  });

  it('box bbox is ±hx, ±hy, ±hz', () => {
    const prim = makePrim('box', [0.5, 0.3, 0.2]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(max[0]).toBeCloseTo(0.5, 5);
    expect(max[1]).toBeCloseTo(0.3, 5);
    expect(max[2]).toBeCloseTo(0.2, 5);
    expect(min[0]).toBeCloseTo(-0.5, 5);
  });

  it('torus bbox is ±(R+tubeR) in xz, ±tubeR in y', () => {
    const prim = makePrim('torus', [0.6, 0.1]);
    const g = buildProxyGeometry(prim);
    const { max } = bbox(g);
    expect(max[0]).toBeCloseTo(0.7, 1);
    expect(max[2]).toBeCloseTo(0.7, 1);
    expect(Math.abs(max[1])).toBeLessThanOrEqual(0.11);
  });

  it('roundBox bbox is ±hx (r is ignored — proxy matches face extents, slightly over-estimates at corners)', () => {
    const prim = makePrim('roundBox', [0.4, 0.4, 0.4, 0.05]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(max[0]).toBeCloseTo(0.4, 5);
    expect(min[0]).toBeCloseTo(-0.4, 5);
  });

  it('capsule bbox spans endpoints expanded by r (axis-aligned case)', () => {
    // a=(0,-0.3,0), b=(0,0.3,0), r=0.15 → bbox y: [-0.45, 0.45], xz: [-0.15, 0.15]
    const prim = makePrim('capsule', [0, -0.3, 0, 0, 0.3, 0, 0.15]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(max[1]).toBeCloseTo(0.45, 1);
    expect(min[1]).toBeCloseTo(-0.45, 1);
    expect(max[0]).toBeCloseTo(0.15, 1);
  });

  it('capsule bbox spans endpoints expanded by r (diagonal case)', () => {
    // a=(0,0,0), b=(0.3,0.3,0), r=0.1 — exercises setFromUnitVectors rotation
    // midpoint=(0.15,0.15,0); axis dir=(1/√2,1/√2,0); halfLen=hypot(0.3,0.3)/2≈0.2121
    // max[0] ≈ midpoint.x + halfLen*(1/√2) + r = 0.15+0.15+0.1 = 0.40
    const prim = makePrim('capsule', [0, 0, 0, 0.3, 0.3, 0, 0.1]);
    const g = buildProxyGeometry(prim);
    const { max } = bbox(g);
    const halfLen = Math.hypot(0.3, 0.3) / 2;
    const midX = 0.15;
    const projX = halfLen / Math.SQRT2; // axis is at 45°
    // upper bound: midpoint + projected half-length + radius + small tolerance
    const upperBound = midX + projX + 0.1 + 0.01;
    expect(max[0]).toBeGreaterThan(0);
    expect(max[1]).toBeGreaterThan(0);
    expect(max[0]).toBeLessThan(upperBound);
  });

  it('capsule with coincident endpoints (degenerate a==b) does not throw and falls back to a sphere', () => {
    const prim = makePrim('capsule', [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.15]);
    expect(() => buildProxyGeometry(prim)).not.toThrow();
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    // Sphere of r=0.15 centered at (0.2,0.2,0.2) → diameter on each axis ≈ 0.3
    expect(max[0] - min[0]).toBeCloseTo(0.3, 1);
    expect(max[1] - min[1]).toBeCloseTo(0.3, 1);
  });
});
