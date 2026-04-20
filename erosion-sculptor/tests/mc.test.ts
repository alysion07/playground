import { describe, it, expect } from 'vitest';
import { extractMesh } from '../src/core/mc';

// CPU reference for Marching Cubes. The GPU path (`march.wgsl` +
// `src/render/mcPass.ts`) uses the same case tables and the same
// interpolation formula, so a triangle count and a radial residual measured
// on the CPU give us a sanity check that the pipeline will match on simple
// inputs. The test only covers the *arithmetic* half — it doesn't exercise
// the GPU atomics path, which is validated manually via the "Rebuild Mesh"
// button in the browser.
//
// Three tests:
//   1. Unit sphere → triangle count on the expected order of magnitude and
//      every emitted vertex lies within 1.5h of the true radius.
//   2. Empty volume (all ψ > 0) → vertex count 0, no allocation surprises.
//   3. Axis-aligned half-space (ψ = x) → roughly 2 · (N-1)² vertices (two
//      triangles per cell on the interface plane), all lying on x ≈ 0.

function makeIdx(N: number) {
  return (x: number, y: number, z: number): number => x + y * N + z * N * N;
}

function bakeSphere(N: number, h: number, origin: number, R: number): Float32Array {
  const psi = new Float32Array(N * N * N);
  const at = makeIdx(N);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = origin + (x + 0.5) * h;
        const py = origin + (y + 0.5) * h;
        const pz = origin + (z + 0.5) * h;
        psi[at(x, y, z)] = Math.sqrt(px * px + py * py + pz * pz) - R;
      }
    }
  }
  return psi;
}

function bakeOutsideEverywhere(N: number): Float32Array {
  // ψ = 1 everywhere → no surface → MC must emit zero geometry.
  return new Float32Array(N * N * N).fill(1);
}

function bakeHalfspace(N: number, h: number, origin: number): Float32Array {
  // ψ = world-x, so the zero set is the plane x = 0. Gives a predictable
  // quad-per-cell layout across the middle slab.
  const psi = new Float32Array(N * N * N);
  const at = makeIdx(N);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = origin + (x + 0.5) * h;
        psi[at(x, y, z)] = px;
      }
    }
  }
  return psi;
}

describe('marching cubes CPU reference', () => {
  it('unit sphere → vertices lie near the true radius', () => {
    const N = 32;
    const extents = 2.4;
    const h = extents / N;
    const origin = -extents / 2;
    const R = 0.6;

    const psi = bakeSphere(N, h, origin, R);
    const mesh = extractMesh(psi, N, [origin, origin, origin], h);

    // Vertex count non-zero and below the hard 1M cap. Exact count varies by
    // voxel alignment — we're checking "there are triangles on the sphere".
    expect(mesh.vertexCount).toBeGreaterThan(100);
    expect(mesh.vertexCount).toBeLessThan(1_000_000);
    // Triangle list: index count must be divisible by 3.
    expect(mesh.indexCount % 3).toBe(0);

    // Measure the residual |length(v) − R| for every emitted vertex. MC
    // linear interpolation at a cell with a roughly linear ψ should bring
    // each vertex within ~0.5h of the true surface, but clamping at the
    // volume boundary + noise from the central-difference normal smoothing
    // can push it a little. 1.5h is the plan's spec'd tolerance.
    let maxErr = 0;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      const r = Math.sqrt(x * x + y * y + z * z);
      const err = Math.abs(r - R);
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(1.5 * h);

    // Normals should point radially outward — for a sphere, n(v) ≈ v/|v|.
    // A random vertex is sufficient as a sanity check since the whole mesh
    // inherits from the same gradient kernel.
    const i = Math.floor(mesh.vertexCount / 2);
    const vx = mesh.positions[i * 3];
    const vy = mesh.positions[i * 3 + 1];
    const vz = mesh.positions[i * 3 + 2];
    const nx = mesh.normals[i * 3];
    const ny = mesh.normals[i * 3 + 1];
    const nz = mesh.normals[i * 3 + 2];
    const dot = (vx * nx + vy * ny + vz * nz) / R;
    // Dot product near 1 means the normal points along the position vector.
    expect(dot).toBeGreaterThan(0.9);
  });

  it('empty volume → no vertices emitted', () => {
    const N = 16;
    const psi = bakeOutsideEverywhere(N);
    const mesh = extractMesh(psi, N, [-1, -1, -1], 2 / N);
    expect(mesh.vertexCount).toBe(0);
    expect(mesh.indexCount).toBe(0);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it('half-space ψ = x → planar mesh at x ≈ 0, two triangles per cell on the interface', () => {
    const N = 16;
    const extents = 2.0;
    const h = extents / N;
    const origin = -extents / 2;
    const psi = bakeHalfspace(N, h, origin);
    const mesh = extractMesh(psi, N, [origin, origin, origin], h);

    // A plane x = 0 cuts through the middle slab of cells along the x axis.
    // Each affected cell produces two triangles (one quad) → 6 vertices/cell.
    // Affected cell count: roughly (N-1)² for the central x-slab column.
    const expectedCells = (N - 1) * (N - 1);
    expect(mesh.vertexCount).toBeGreaterThan(expectedCells * 3);
    expect(mesh.vertexCount).toBeLessThan(expectedCells * 12);

    // All emitted vertices should sit very close to x = 0 — within half a
    // voxel at worst, because the linear interpolation on ψ = x has t=0.5
    // for cells where both corners flip sign across x.
    let maxAbsX = 0;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = Math.abs(mesh.positions[i * 3]);
      if (x > maxAbsX) maxAbsX = x;
    }
    expect(maxAbsX).toBeLessThan(h);
  });
});
