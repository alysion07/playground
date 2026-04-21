export type Vec3 = [number, number, number];

export type PrimType = 'sphere' | 'box' | 'torus' | 'capsule' | 'roundBox';

export type CsgOp = 'union' | 'diff' | 'intersect' | 'smoothUnion';

export type PrimNode = {
  kind: 'prim';
  id: string;
  type: PrimType;
  // Per-primitive parameter slots; layout defined by PRIM_SCHEMAS[type].fields:
  //   sphere:   [r]
  //   box:      [hx, hy, hz]
  //   torus:    [R, r]
  //   capsule:  [ax, ay, az, bx, by, bz, r]
  //   roundBox: [hx, hy, hz, r]
  params: number[];
  translate: Vec3;
  rotate: Vec3;
};

export type OpNode = {
  kind: 'op';
  id: string;
  op: CsgOp;
  // Smoothness for smoothUnion; ignored by other ops.
  k: number;
  children: CsgNode[];
};

export type CsgNode = PrimNode | OpNode;

export type FilletParams = {
  // Target fillet radius. PDE halts at t* = R² / (2α).
  R: number;
  // Curvature-flow strength. Larger α = faster convergence, smaller dt.
  alpha: number;
  // Grid resolution per side (N³ total voxels).
  N: number;
  // Half-side of the sampling cube centered at origin.
  extents: number;
};

export type MeshData = {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
};

export type ComputeStatus =
  | { kind: 'idle' }
  | { kind: 'running'; stage: 'sample' | 'flow' | 'mc'; progress: number }
  | { kind: 'done'; ms: number; triangles: number }
  | { kind: 'error'; message: string };
