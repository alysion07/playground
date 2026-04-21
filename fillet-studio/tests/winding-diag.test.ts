import { describe, it, expect } from 'vitest';
import { marchingCubes } from '../src/core/marchingCubes';
import { sampleSdf } from '../src/core/sample';
import { makePrim } from '../src/core/csg';

// Regression guard: for a sphere at origin the outward direction at any surface
// point is just the position vector. If MC triangles are wound correctly, their
// geometric normal (AB×AC) dotted with the centroid should be positive.
// With the wrong winding convention every triangle would flip, creating holes
// under FrontSide rendering — so we require the overwhelming majority to be
// outward (a handful of degenerate cases near grid corners are allowed).
describe('marchingCubes winding', () => {
  it('emits outward-wound triangles on a unit sphere', () => {
    const vol = sampleSdf(makePrim('sphere', [0.5]), 33, 1);
    const mesh = marchingCubes(vol);
    let outward = 0;
    let inward = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const ia = mesh.indices[t] * 3;
      const ib = mesh.indices[t + 1] * 3;
      const ic = mesh.indices[t + 2] * 3;
      const ax = mesh.positions[ia],
        ay = mesh.positions[ia + 1],
        az = mesh.positions[ia + 2];
      const bx = mesh.positions[ib],
        by = mesh.positions[ib + 1],
        bz = mesh.positions[ib + 2];
      const cx = mesh.positions[ic],
        cy = mesh.positions[ic + 1],
        cz = mesh.positions[ic + 2];
      const ux = bx - ax,
        uy = by - ay,
        uz = bz - az;
      const vx = cx - ax,
        vy = cy - ay,
        vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const cX = (ax + bx + cx) / 3;
      const cY = (ay + by + cy) / 3;
      const cZ = (az + bz + cz) / 3;
      const dot = nx * cX + ny * cY + nz * cZ;
      if (dot > 0) outward++;
      else inward++;
    }
    const total = outward + inward;
    expect(outward / total).toBeGreaterThan(0.98);
  });
});
