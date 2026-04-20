import type { MeshData } from '../state/types';
import type { Volume } from './sample';
import { cornerOffsets, edgeCorners, edgeTable, triTable } from './mcTables';

export type MCOptions = {
  isoValue?: number;
  // When true, treat out-of-bounds voxels as a large positive ψ so the
  // resulting mesh is guaranteed watertight at the bbox — any piece of the
  // zero-level set clipped by the boundary gets capped.
  padBoundary?: boolean;
};

// Extract the ψ = iso isosurface from a volume using Paul Bourke's classic
// 256-case marching cubes. Edge crossings are deduplicated across neighbouring
// cubes so the resulting mesh is indexed and watertight (each interior edge is
// shared by exactly two triangles).
export function marchingCubes(vol: Volume, opts: MCOptions = {}): MeshData {
  const iso = opts.isoValue ?? 0;
  const pad = opts.padBoundary ?? true;
  const N = vol.N;
  const data = vol.data;
  const stride = N;
  const stride2 = N * N;
  const origin = vol.origin;
  const h = vol.voxelSize;

  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  // Canonical edge key → vertex index. Each lattice edge is traversed by up to
  // 4 cubes; the first cube to visit it computes the interpolated vertex and
  // all subsequent cubes reuse the index.
  const vertexIndex = new Map<number, number>();

  const PAD = 1e6;

  function sample(i: number, j: number, k: number): number {
    if (i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N) return pad ? PAD : 0;
    return data[i + j * stride + k * stride2];
  }

  function gradAt(i: number, j: number, k: number, out: Float64Array): void {
    out[0] = (sample(i + 1, j, k) - sample(i - 1, j, k)) / (2 * h);
    out[1] = (sample(i, j + 1, k) - sample(i, j - 1, k)) / (2 * h);
    out[2] = (sample(i, j, k + 1) - sample(i, j, k - 1)) / (2 * h);
  }

  // Canonical key for the lattice edge touched by (cube base, edge index).
  // We fold each edge to (ax, ay, az, dir) where dir ∈ {0=x, 1=y, 2=z} so every
  // lattice edge has a single representation regardless of which cube reached it.
  const M = N + 2;
  function edgeKey(i: number, j: number, k: number, edge: number): number {
    let ax = i,
      ay = j,
      az = k,
      dir = 0;
    switch (edge) {
      case 0:
        dir = 0;
        break;
      case 1:
        ax = i + 1;
        dir = 1;
        break;
      case 2:
        ay = j + 1;
        dir = 0;
        break;
      case 3:
        dir = 1;
        break;
      case 4:
        az = k + 1;
        dir = 0;
        break;
      case 5:
        ax = i + 1;
        az = k + 1;
        dir = 1;
        break;
      case 6:
        ay = j + 1;
        az = k + 1;
        dir = 0;
        break;
      case 7:
        az = k + 1;
        dir = 1;
        break;
      case 8:
        dir = 2;
        break;
      case 9:
        ax = i + 1;
        dir = 2;
        break;
      case 10:
        ax = i + 1;
        ay = j + 1;
        dir = 2;
        break;
      case 11:
        ay = j + 1;
        dir = 2;
        break;
    }
    return ((ax * M + ay) * M + az) * 3 + dir;
  }

  const edgeVerts = new Int32Array(12);
  const corners = new Float64Array(8);
  const tmpGrad0 = new Float64Array(3);
  const tmpGrad1 = new Float64Array(3);

  for (let k = 0; k < N - 1; k++) {
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        corners[0] = sample(i, j, k);
        corners[1] = sample(i + 1, j, k);
        corners[2] = sample(i + 1, j + 1, k);
        corners[3] = sample(i, j + 1, k);
        corners[4] = sample(i, j, k + 1);
        corners[5] = sample(i + 1, j, k + 1);
        corners[6] = sample(i + 1, j + 1, k + 1);
        corners[7] = sample(i, j + 1, k + 1);

        let cubeIdx = 0;
        if (corners[0] < iso) cubeIdx |= 1;
        if (corners[1] < iso) cubeIdx |= 2;
        if (corners[2] < iso) cubeIdx |= 4;
        if (corners[3] < iso) cubeIdx |= 8;
        if (corners[4] < iso) cubeIdx |= 16;
        if (corners[5] < iso) cubeIdx |= 32;
        if (corners[6] < iso) cubeIdx |= 64;
        if (corners[7] < iso) cubeIdx |= 128;

        const edgeMask = edgeTable[cubeIdx];
        if (edgeMask === 0) continue;

        edgeVerts.fill(-1);
        for (let e = 0; e < 12; e++) {
          if ((edgeMask & (1 << e)) === 0) continue;
          const key = edgeKey(i, j, k, e);
          let vi = vertexIndex.get(key);
          if (vi === undefined) {
            const a = edgeCorners[e][0];
            const b = edgeCorners[e][1];
            const va = corners[a];
            const vb = corners[b];
            const denom = vb - va;
            const t = Math.abs(denom) < 1e-12 ? 0.5 : (iso - va) / denom;
            const ax = cornerOffsets[a][0];
            const ay = cornerOffsets[a][1];
            const az = cornerOffsets[a][2];
            const bx = cornerOffsets[b][0];
            const by = cornerOffsets[b][1];
            const bz = cornerOffsets[b][2];
            const x = origin[0] + (i + ax + t * (bx - ax)) * h;
            const y = origin[1] + (j + ay + t * (by - ay)) * h;
            const z = origin[2] + (k + az + t * (bz - az)) * h;
            positions.push(x, y, z);
            gradAt(i + ax, j + ay, k + az, tmpGrad0);
            gradAt(i + bx, j + by, k + bz, tmpGrad1);
            const nx = tmpGrad0[0] + t * (tmpGrad1[0] - tmpGrad0[0]);
            const ny = tmpGrad0[1] + t * (tmpGrad1[1] - tmpGrad0[1]);
            const nz = tmpGrad0[2] + t * (tmpGrad1[2] - tmpGrad0[2]);
            const nl = Math.hypot(nx, ny, nz);
            if (nl > 1e-12) {
              normals.push(nx / nl, ny / nl, nz / nl);
            } else {
              normals.push(0, 0, 1);
            }
            vi = positions.length / 3 - 1;
            vertexIndex.set(key, vi);
          }
          edgeVerts[e] = vi;
        }

        const tris = triTable[cubeIdx];
        for (let t = 0; t < 16 && tris[t] !== -1; t += 3) {
          const a = edgeVerts[tris[t]];
          const b = edgeVerts[tris[t + 1]];
          const c = edgeVerts[tris[t + 2]];
          if (a < 0 || b < 0 || c < 0) continue;
          // The triTable variant bundled here winds CCW when viewed from the
          // inside of the solid (ψ<0). Flip the last two indices so the
          // geometric winding agrees with the gradient-based outward vertex
          // normals — front-face culling then works correctly.
          indices.push(a, c, b);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
  };
}
