// Marching-Cubes compute pass. One thread per cell (cube), single dispatch.
// Cell grid is one smaller than the voxel grid per axis — a cell spans voxels
// [i..i+1] × [j..j+1] × [k..k+1] — so we dispatch ceil((N-1)/4) workgroups.
//
// Each thread:
//   1. Samples ψ at the 8 corners of its cell, builds an 8-bit cubeIndex.
//   2. Looks up the edge bitmask (12 bits) in EDGE_TABLE[cubeIndex].
//   3. For every edge that crosses the surface, interpolates a vertex
//      position (voxel-space → world-space via the bake origin + h) and a
//      normal (central-difference ∇ψ at each corner, lerped by the same t).
//   4. Walks TRI_TABLE[cubeIndex * 16 ..] in triples and emits triangles,
//      reserving slots with a single atomic add per triangle.
//
// Memory layout for the emit buffers — matches mcPass.ts allocations and
// lit_mesh.wgsl vertex pulling in Step 7.
//   Vertex: 8 × f32 (pos.xyz + _pad + normal.xyz + _pad)  → 32 byte stride
//   Index:  1 × u32 per index                              → 4 byte stride
//
// Overflow handling: we check the reserved offset against the compile-time
// capacity before writing. If either vertex or index reservation falls outside
// the buffer, we set `counter.overflow = 1u` and skip the write. The CPU
// readback path (mcPass.ts) reads this flag and surfaces it in the UI.
//
// Dedupe: intentionally none. Each triangle emits 3 fresh vertices. A shared
// prefix-sum pass could share vertices across cells but complicates the
// pipeline and buys ~3× geometry only at the cost of ~2× compute — a Week 4
// optimization candidate.

struct GeomU {
  originVoxel: vec4<f32>,  // origin.xyz, voxel size h in .w
  sizeWord: vec4<u32>,     // N in .x, rest unused
};

struct Vertex {
  pos: vec3<f32>,
  _p0: f32,
  normal: vec3<f32>,
  _p1: f32,
};

struct Counter {
  vertexCount: atomic<u32>,
  indexCount: atomic<u32>,
  overflow: atomic<u32>,
  _pad: u32,
};

struct LookupTables {
  edgeTable: array<u32, 256>,
  // triTable stored as u32 but treated as i32 via bitcast; -1 sentinel is
  // represented as 0xFFFFFFFF. Storage buffers don't naturally support i32
  // arrays with bit-exact -1 sentinels alongside u32 counts, so we unify.
  triTable: array<i32, 4096>,  // 256 × 16
};

struct McParams {
  maxVerts: u32,   // capacity of vertexBuf in vertices
  maxIndices: u32, // capacity of indexBuf in u32 slots
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> G: GeomU;
@group(0) @binding(1) var psi: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> vertexBuf: array<Vertex>;
@group(0) @binding(3) var<storage, read_write> indexBuf: array<u32>;
@group(0) @binding(4) var<storage, read_write> counter: Counter;
@group(0) @binding(5) var<storage, read> tables: LookupTables;
@group(0) @binding(6) var<uniform> P: McParams;

fn loadPsi(c: vec3<i32>) -> f32 {
  let n = i32(G.sizeWord.x);
  let cc = clamp(c, vec3<i32>(0), vec3<i32>(n - 1));
  return textureLoad(psi, cc, 0).r;
}

// Central-difference outward normal at voxel (x,y,z). Matches CPU reference
// in src/core/mc.ts — any asymmetry in the weights would shift MC verts so
// it's important to keep this identical to the CPU path.
fn sampleNormal(p: vec3<i32>, invH: f32) -> vec3<f32> {
  let gx = (loadPsi(p + vec3<i32>(1, 0, 0)) - loadPsi(p - vec3<i32>(1, 0, 0))) * 0.5 * invH;
  let gy = (loadPsi(p + vec3<i32>(0, 1, 0)) - loadPsi(p - vec3<i32>(0, 1, 0))) * 0.5 * invH;
  let gz = (loadPsi(p + vec3<i32>(0, 0, 1)) - loadPsi(p - vec3<i32>(0, 0, 1))) * 0.5 * invH;
  let g = vec3<f32>(gx, gy, gz);
  let len = length(g);
  if (len < 1e-6) { return vec3<f32>(0.0, 0.0, 1.0); }
  return g / len;
}

// Cube-corner lookup: returns the voxel-space offset of corner i relative
// to the cell's low corner. Matches CORNER_OFFSETS in mcTables.ts.
fn cornerOffset(i: u32) -> vec3<i32> {
  switch i {
    case 0u: { return vec3<i32>(0, 0, 0); }
    case 1u: { return vec3<i32>(1, 0, 0); }
    case 2u: { return vec3<i32>(1, 1, 0); }
    case 3u: { return vec3<i32>(0, 1, 0); }
    case 4u: { return vec3<i32>(0, 0, 1); }
    case 5u: { return vec3<i32>(1, 0, 1); }
    case 6u: { return vec3<i32>(1, 1, 1); }
    default: { return vec3<i32>(0, 1, 1); }  // case 7
  }
}

// Returns (cornerA, cornerB) for the two endpoints of edge `e`. Matches
// EDGE_CORNERS in mcTables.ts exactly.
fn edgeCorners(e: u32) -> vec2<u32> {
  switch e {
    case 0u:  { return vec2<u32>(0u, 1u); }
    case 1u:  { return vec2<u32>(1u, 2u); }
    case 2u:  { return vec2<u32>(2u, 3u); }
    case 3u:  { return vec2<u32>(3u, 0u); }
    case 4u:  { return vec2<u32>(4u, 5u); }
    case 5u:  { return vec2<u32>(5u, 6u); }
    case 6u:  { return vec2<u32>(6u, 7u); }
    case 7u:  { return vec2<u32>(7u, 4u); }
    case 8u:  { return vec2<u32>(0u, 4u); }
    case 9u:  { return vec2<u32>(1u, 5u); }
    case 10u: { return vec2<u32>(2u, 6u); }
    default:  { return vec2<u32>(3u, 7u); }  // case 11
  }
}

fn edgeT(va: f32, vb: f32) -> f32 {
  let d = vb - va;
  if (abs(d) < 1e-8) { return 0.5; }
  return -va / d;
}

@compute @workgroup_size(4, 4, 4)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = G.sizeWord.x;
  // Cell grid is one smaller per axis; threads beyond [0, n-2] do nothing.
  if (gid.x + 1u >= n || gid.y + 1u >= n || gid.z + 1u >= n) { return; }
  let cell = vec3<i32>(gid);
  let h = G.originVoxel.w;
  let invH = 1.0 / h;

  var cornerPsi: array<f32, 8>;
  var cornerWorldX: array<f32, 8>;
  var cornerWorldY: array<f32, 8>;
  var cornerWorldZ: array<f32, 8>;
  var cubeIdx: u32 = 0u;
  for (var i = 0u; i < 8u; i = i + 1u) {
    let ofs = cornerOffset(i);
    let v = cell + ofs;
    let psiV = loadPsi(v);
    cornerPsi[i] = psiV;
    cornerWorldX[i] = G.originVoxel.x + (f32(v.x) + 0.5) * h;
    cornerWorldY[i] = G.originVoxel.y + (f32(v.y) + 0.5) * h;
    cornerWorldZ[i] = G.originVoxel.z + (f32(v.z) + 0.5) * h;
    if (psiV < 0.0) {
      cubeIdx = cubeIdx | (1u << i);
    }
  }

  let edgeMask = tables.edgeTable[cubeIdx];
  if (edgeMask == 0u) { return; }

  // Evaluate each edge's vertex position + normal only if the edge is set
  // in the mask. We still allocate 12 slots unconditionally — WGSL doesn't
  // let us conditionally declare — and rely on the tri-table never indexing
  // an unset edge (guaranteed by construction of the tables).
  var edgePosX: array<f32, 12>;
  var edgePosY: array<f32, 12>;
  var edgePosZ: array<f32, 12>;
  var edgeNrmX: array<f32, 12>;
  var edgeNrmY: array<f32, 12>;
  var edgeNrmZ: array<f32, 12>;
  for (var e = 0u; e < 12u; e = e + 1u) {
    if ((edgeMask & (1u << e)) == 0u) { continue; }
    let pair = edgeCorners(e);
    let ia = pair.x;
    let ib = pair.y;
    let va = cornerPsi[ia];
    let vb = cornerPsi[ib];
    let t = edgeT(va, vb);
    edgePosX[e] = cornerWorldX[ia] + t * (cornerWorldX[ib] - cornerWorldX[ia]);
    edgePosY[e] = cornerWorldY[ia] + t * (cornerWorldY[ib] - cornerWorldY[ia]);
    edgePosZ[e] = cornerWorldZ[ia] + t * (cornerWorldZ[ib] - cornerWorldZ[ia]);
    let na = sampleNormal(cell + cornerOffset(ia), invH);
    let nb = sampleNormal(cell + cornerOffset(ib), invH);
    let nx = na.x + t * (nb.x - na.x);
    let ny = na.y + t * (nb.y - na.y);
    let nz = na.z + t * (nb.z - na.z);
    let nlen = sqrt(nx * nx + ny * ny + nz * nz);
    if (nlen < 1e-6) {
      edgeNrmX[e] = 0.0;
      edgeNrmY[e] = 0.0;
      edgeNrmZ[e] = 1.0;
    } else {
      edgeNrmX[e] = nx / nlen;
      edgeNrmY[e] = ny / nlen;
      edgeNrmZ[e] = nz / nlen;
    }
  }

  // Count triangles for this cell so we reserve all slots in a single
  // atomicAdd — avoids interleaving writes from neighboring cells and keeps
  // each cell's triangles contiguous in the buffer.
  let base = cubeIdx * 16u;
  var triCount: u32 = 0u;
  loop {
    if (triCount >= 5u) { break; }
    if (tables.triTable[base + triCount * 3u] < 0) { break; }
    triCount = triCount + 1u;
  }
  if (triCount == 0u) { return; }

  let needVerts = triCount * 3u;
  let vOffset = atomicAdd(&counter.vertexCount, needVerts);
  let iOffset = atomicAdd(&counter.indexCount, needVerts);
  if (vOffset + needVerts > P.maxVerts || iOffset + needVerts > P.maxIndices) {
    atomicStore(&counter.overflow, 1u);
    return;
  }

  for (var t = 0u; t < triCount; t = t + 1u) {
    let row = base + t * 3u;
    let ea = u32(tables.triTable[row]);
    let eb = u32(tables.triTable[row + 1u]);
    let ec = u32(tables.triTable[row + 2u]);

    let outBase = vOffset + t * 3u;

    var va: Vertex;
    va.pos = vec3<f32>(edgePosX[ea], edgePosY[ea], edgePosZ[ea]);
    va._p0 = 0.0;
    va.normal = vec3<f32>(edgeNrmX[ea], edgeNrmY[ea], edgeNrmZ[ea]);
    va._p1 = 0.0;
    vertexBuf[outBase] = va;
    indexBuf[iOffset + t * 3u] = outBase;

    var vb: Vertex;
    vb.pos = vec3<f32>(edgePosX[eb], edgePosY[eb], edgePosZ[eb]);
    vb._p0 = 0.0;
    vb.normal = vec3<f32>(edgeNrmX[eb], edgeNrmY[eb], edgeNrmZ[eb]);
    vb._p1 = 0.0;
    vertexBuf[outBase + 1u] = vb;
    indexBuf[iOffset + t * 3u + 1u] = outBase + 1u;

    var vc: Vertex;
    vc.pos = vec3<f32>(edgePosX[ec], edgePosY[ec], edgePosZ[ec]);
    vc._p0 = 0.0;
    vc.normal = vec3<f32>(edgeNrmX[ec], edgeNrmY[ec], edgeNrmZ[ec]);
    vc._p1 = 0.0;
    vertexBuf[outBase + 2u] = vc;
    indexBuf[iOffset + t * 3u + 2u] = outBase + 2u;
  }
}
