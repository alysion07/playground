// CPU reference implementation of Marching Cubes on a ψ scalar field.
// Mirrors `march.wgsl` line-for-line in spirit: same edge/corner/tri tables,
// same linear-interpolation step, same voxel-space → world-space mapping.
// Used by `tests/mc.test.ts` for a ±10% vertex-count comparison against
// the GPU output on simple inputs (sphere, empty volume, half-filled box).
//
// Not used at runtime — the render loop dispatches the compute shader.
// Keep the arithmetic identical so tests catch drift between the two.

import { CORNER_OFFSETS, EDGE_CORNERS, EDGE_TABLE, TRI_TABLE } from './mcTables';

export type McMesh = {
  positions: Float32Array; // xyz × vertexCount
  normals: Float32Array;   // xyz × vertexCount
  indices: Uint32Array;    // triangle index list (one u32 per vertex)
  vertexCount: number;
  indexCount: number;
};

// Central-difference gradient sampler with clamp-to-edge (matches shader).
// Returns negative of the gradient, which points from inside (ψ<0) toward
// outside (ψ>0) — i.e. outward along the surface normal.
function sampleNormal(
  psi: Float32Array,
  N: number,
  x: number,
  y: number,
  z: number,
  invH: number,
): [number, number, number] {
  const at = (ix: number, iy: number, iz: number): number => {
    const cx = Math.max(0, Math.min(N - 1, ix));
    const cy = Math.max(0, Math.min(N - 1, iy));
    const cz = Math.max(0, Math.min(N - 1, iz));
    return psi[cx + cy * N + cz * N * N];
  };
  const gx = (at(x + 1, y, z) - at(x - 1, y, z)) * 0.5 * invH;
  const gy = (at(x, y + 1, z) - at(x, y - 1, z)) * 0.5 * invH;
  const gz = (at(x, y, z + 1) - at(x, y, z - 1)) * 0.5 * invH;
  const len = Math.hypot(gx, gy, gz);
  if (len < 1e-6) return [0, 0, 1];
  // Outward normal points from inside (ψ<0) to outside (ψ>0); ∇ψ already
  // points that way since ψ is a signed distance with negative interior.
  return [gx / len, gy / len, gz / len];
}

// Linear interpolation along an edge between two corners; returns the
// fractional position `t` ∈ [0,1] such that ψ(a) + t·(ψ(b) − ψ(a)) = 0.
function edgeT(va: number, vb: number): number {
  const d = vb - va;
  if (Math.abs(d) < 1e-8) return 0.5;
  return -va / d;
}

// Run MC on a scalar field. `origin` and `h` place the voxel lattice in world
// space (voxel [i,j,k] center sits at origin + (i+0.5)*h in each axis, matching
// the bake's convention). Output positions and normals are in world space.
// Returns an indexed mesh with a triangle list.
//
// This implementation does NOT dedupe vertices across cells — each triangle
// emits 3 fresh vertices. That matches the GPU pass (which can't easily share
// vertices across workgroups without a prefix-sum stage) so the vertex counts
// line up. For higher-quality CPU meshes the caller can weld after.
export function extractMesh(
  psi: Float32Array,
  N: number,
  origin: [number, number, number],
  h: number,
): McMesh {
  // Pre-size for the worst case: at most 5 triangles per cell × 3 verts.
  // (N-1)³ cells. For N=32 that's ~29 791 cells × 15 ≈ 447K floats per axis;
  // a single `new Float32Array` allocation stays cheap.
  const nCells = (N - 1) * (N - 1) * (N - 1);
  const maxVerts = nCells * 15;
  const positions = new Float32Array(maxVerts * 3);
  const normals = new Float32Array(maxVerts * 3);
  const indices = new Uint32Array(maxVerts);
  let vtx = 0;

  const invH = 1 / h;

  // Corner ψ and position buffers reused each cell.
  const corners = new Float64Array(8);
  const cornerPos: Array<[number, number, number]> = [
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ];

  for (let z = 0; z < N - 1; z++) {
    for (let y = 0; y < N - 1; y++) {
      for (let x = 0; x < N - 1; x++) {
        let cubeIdx = 0;
        for (let i = 0; i < 8; i++) {
          const ox = CORNER_OFFSETS[i][0];
          const oy = CORNER_OFFSETS[i][1];
          const oz = CORNER_OFFSETS[i][2];
          const cx = x + ox;
          const cy = y + oy;
          const cz = z + oz;
          const v = psi[cx + cy * N + cz * N * N];
          corners[i] = v;
          cornerPos[i][0] = origin[0] + (cx + 0.5) * h;
          cornerPos[i][1] = origin[1] + (cy + 0.5) * h;
          cornerPos[i][2] = origin[2] + (cz + 0.5) * h;
          if (v < 0) cubeIdx |= 1 << i;
        }
        const edgeMask = EDGE_TABLE[cubeIdx];
        if (edgeMask === 0) continue;

        // For each of the 12 edges that's crossed, compute the vertex position
        // and normal. Store in a local 12-slot array indexed by edge number.
        const edgePos: Array<[number, number, number]> = new Array(12);
        const edgeNrm: Array<[number, number, number]> = new Array(12);
        for (let e = 0; e < 12; e++) {
          if ((edgeMask & (1 << e)) === 0) continue;
          const [ia, ib] = EDGE_CORNERS[e];
          const va = corners[ia];
          const vb = corners[ib];
          const t = edgeT(va, vb);
          const pa = cornerPos[ia];
          const pb = cornerPos[ib];
          const px = pa[0] + t * (pb[0] - pa[0]);
          const py = pa[1] + t * (pb[1] - pa[1]);
          const pz = pa[2] + t * (pb[2] - pa[2]);
          edgePos[e] = [px, py, pz];
          // Normal: blend the two corner normals. Corners are referenced by
          // voxel-space indices so the gradient sample uses those — not the
          // interpolated world pos. Matches shader behavior.
          const na = sampleNormal(
            psi, N,
            x + CORNER_OFFSETS[ia][0],
            y + CORNER_OFFSETS[ia][1],
            z + CORNER_OFFSETS[ia][2],
            invH,
          );
          const nb = sampleNormal(
            psi, N,
            x + CORNER_OFFSETS[ib][0],
            y + CORNER_OFFSETS[ib][1],
            z + CORNER_OFFSETS[ib][2],
            invH,
          );
          const nx = na[0] + t * (nb[0] - na[0]);
          const ny = na[1] + t * (nb[1] - na[1]);
          const nz = na[2] + t * (nb[2] - na[2]);
          const nlen = Math.hypot(nx, ny, nz);
          if (nlen < 1e-6) edgeNrm[e] = [0, 0, 1];
          else edgeNrm[e] = [nx / nlen, ny / nlen, nz / nlen];
        }

        // Emit triangles from TRI_TABLE. Up to 5 triangles × 3 vertices.
        const triStart = cubeIdx * 16;
        for (let t = triStart; TRI_TABLE[t] !== -1; t += 3) {
          const ea = TRI_TABLE[t];
          const eb = TRI_TABLE[t + 1];
          const ec = TRI_TABLE[t + 2];
          const pa = edgePos[ea];
          const pb = edgePos[eb];
          const pc = edgePos[ec];
          const na = edgeNrm[ea];
          const nb = edgeNrm[eb];
          const nc = edgeNrm[ec];
          const baseIdx = vtx * 3;
          positions[baseIdx]     = pa[0]; positions[baseIdx + 1] = pa[1]; positions[baseIdx + 2] = pa[2];
          normals[baseIdx]       = na[0]; normals[baseIdx + 1]   = na[1]; normals[baseIdx + 2]   = na[2];
          indices[vtx] = vtx;
          vtx++;
          const baseIdx2 = vtx * 3;
          positions[baseIdx2]     = pb[0]; positions[baseIdx2 + 1] = pb[1]; positions[baseIdx2 + 2] = pb[2];
          normals[baseIdx2]       = nb[0]; normals[baseIdx2 + 1]   = nb[1]; normals[baseIdx2 + 2]   = nb[2];
          indices[vtx] = vtx;
          vtx++;
          const baseIdx3 = vtx * 3;
          positions[baseIdx3]     = pc[0]; positions[baseIdx3 + 1] = pc[1]; positions[baseIdx3 + 2] = pc[2];
          normals[baseIdx3]       = nc[0]; normals[baseIdx3 + 1]   = nc[1]; normals[baseIdx3 + 2]   = nc[2];
          indices[vtx] = vtx;
          vtx++;
        }
      }
    }
  }

  return {
    positions: positions.slice(0, vtx * 3),
    normals: normals.slice(0, vtx * 3),
    indices: indices.slice(0, vtx),
    vertexCount: vtx,
    indexCount: vtx,
  };
}
