import { describe, it, expect } from 'vitest';
import { marchingCubes } from '../src/core/marchingCubes';
import { sampleSdf } from '../src/core/sample';
import { makePrim } from '../src/core/csg';

// Sum over triangles of ½|(b−a) × (c−a)| gives the total surface area.
function triArea(positions: Float32Array, indices: Uint32Array): number {
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    area += 0.5 * Math.hypot(nx, ny, nz);
  }
  return area;
}

// A closed manifold triangle mesh has every interior edge shared by exactly two
// triangles. Count edges by canonicalising (min,max) vertex pair and check all
// occurrence counts are 2.
function checkWatertight(indices: Uint32Array): {
  watertight: boolean;
  totalEdges: number;
  badEdges: number;
} {
  const edgeCount = new Map<number, number>();
  function keyOf(a: number, b: number): number {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return lo * 0x40000000 + hi;
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = keyOf(x, y);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const n of edgeCount.values()) if (n !== 2) bad++;
  return { watertight: bad === 0, totalEdges: edgeCount.size, badEdges: bad };
}

describe('marchingCubes', () => {
  it('returns empty mesh when the volume does not cross iso', () => {
    const vol = sampleSdf(makePrim('sphere', [0.3], [10, 10, 10]), 8, 1);
    const mesh = marchingCubes(vol);
    expect(mesh.indices.length).toBe(0);
    expect(mesh.positions.length).toBe(0);
  });

  it('unit sphere produces a watertight mesh with area ≈ 4πr²', () => {
    const r = 0.5;
    const vol = sampleSdf(makePrim('sphere', [r]), 33, 1);
    const mesh = marchingCubes(vol);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    const area = triArea(mesh.positions, mesh.indices);
    const exact = 4 * Math.PI * r * r;
    // MC at N=33 under-shoots the continuum area; expect within ~10%.
    expect(area).toBeGreaterThan(exact * 0.9);
    expect(area).toBeLessThan(exact * 1.1);
    const wt = checkWatertight(mesh.indices);
    expect(wt.watertight).toBe(true);
  });

  it('higher resolution improves sphere area accuracy', () => {
    const r = 0.5;
    const low = sampleSdf(makePrim('sphere', [r]), 17, 1);
    const high = sampleSdf(makePrim('sphere', [r]), 49, 1);
    const aLow = triArea(marchingCubes(low).positions, marchingCubes(low).indices);
    const aHigh = triArea(marchingCubes(high).positions, marchingCubes(high).indices);
    const exact = 4 * Math.PI * r * r;
    expect(Math.abs(aHigh - exact)).toBeLessThan(Math.abs(aLow - exact));
  });

  it('vertex normals agree with the SDF gradient direction on a sphere', () => {
    const r = 0.5;
    const vol = sampleSdf(makePrim('sphere', [r]), 33, 1);
    const mesh = marchingCubes(vol);
    // For a sphere at origin, the outward normal at (x,y,z) should point radially.
    let maxMisalign = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const px = mesh.positions[i];
      const py = mesh.positions[i + 1];
      const pz = mesh.positions[i + 2];
      const pl = Math.hypot(px, py, pz);
      if (pl < 1e-6) continue;
      const expX = px / pl,
        expY = py / pl,
        expZ = pz / pl;
      const nx = mesh.normals[i];
      const ny = mesh.normals[i + 1];
      const nz = mesh.normals[i + 2];
      const dot = nx * expX + ny * expY + nz * expZ;
      if (dot < maxMisalign || maxMisalign === 0) maxMisalign = dot;
    }
    // Averaged gradients can drift a little from the exact radial; insist all
    // vertices at least point outward (dot product > 0.9 with radial).
    expect(maxMisalign).toBeGreaterThan(0.9);
  });
});
