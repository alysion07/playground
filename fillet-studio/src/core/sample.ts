import type { CsgNode } from '../state/types';
import { compileCsg } from './sdfCpu';

export type Volume = {
  N: number;
  // Half-side of the sampling cube (centered at origin by default).
  extents: number;
  origin: [number, number, number];
  // World-space spacing between adjacent voxel centers. Uses (N-1) so that
  // voxel 0 sits at origin[i] and voxel N−1 sits at origin[i]+2*extents.
  voxelSize: number;
  // Flat ψ array, length N³, indexed as i + j*N + k*N*N (i=x, j=y, k=z).
  data: Float32Array;
};

export function sampleSdf(root: CsgNode, N: number, extents: number): Volume {
  const sdf = compileCsg(root);
  const voxelSize = (2 * extents) / (N - 1);
  const origin: [number, number, number] = [-extents, -extents, -extents];
  const data = new Float32Array(N * N * N);
  let p = 0;
  for (let k = 0; k < N; k++) {
    const z = origin[2] + k * voxelSize;
    for (let j = 0; j < N; j++) {
      const y = origin[1] + j * voxelSize;
      for (let i = 0; i < N; i++) {
        const x = origin[0] + i * voxelSize;
        data[p++] = sdf(x, y, z);
      }
    }
  }
  return { N, extents, origin, voxelSize, data };
}

export function idx(N: number, i: number, j: number, k: number): number {
  return i + j * N + k * N * N;
}
