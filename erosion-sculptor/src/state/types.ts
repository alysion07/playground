export type Vec3 = [number, number, number];

export type PrimType = 'sphere' | 'box' | 'torus' | 'capsule' | 'roundBox';

export type CsgOp = 'union' | 'diff' | 'intersect' | 'smoothUnion';

export type PrimNode = {
  kind: 'prim';
  id: string;
  type: PrimType;
  // Per-primitive parameters; layout depends on `type`.
  // sphere:   [r]
  // box:      [hx, hy, hz]
  // torus:    [R, r]
  // capsule:  [ax, ay, az, bx, by, bz, r]
  // roundBox: [hx, hy, hz, r]
  params: number[];
  translate: Vec3;
  rotate: Vec3;
};

export type OpNode = {
  kind: 'op';
  id: string;
  op: CsgOp;
  // Smoothness factor for smoothUnion. Ignored otherwise.
  k: number;
  children: CsgNode[];
};

export type CsgNode = PrimNode | OpNode;

export type CameraState = {
  yaw: number;
  pitch: number;
  dist: number;
};

export type RenderParams = {
  // Maximum raymarch steps per pixel. Higher = sharper silhouettes, lower fps.
  stepBudget: number;
  // When true, render silhouette + crease edges as line art instead of shading.
  // True wireframe needs marching cubes (Week 3) — this approximates it via
  // screen-space derivatives.
  wireframe: boolean;
};

export type PerformanceParams = {
  dprCap: number;
  showFps: boolean;
};

// Grid resolution for the ψ volume. We allow a few discrete sizes so users can
// trade fidelity for speed; smaller grids run dramatically faster and use less
// VRAM (4 bytes × N³ × 2 ping-pong textures).
export type GridSize = 32 | 64 | 96 | 128;

export type GridParams = {
  size: GridSize;
};

// Wind-advection parameters. Drives the β·dot(w, ∇ψ) term in erode.wgsl and
// the surface pressure shading in raymarch.wgsl. `dir` is derived from
// (yaw, elevation) inside the store before uniform upload — UI sliders
// expose the two angles rather than a raw 3D vector because users think in
// terms of "where is the wind coming from".
export type WindParams = {
  // Wind advection strength. 0 disables the wind term entirely (erode.wgsl
  // falls back to pure curvature flow). Slider cap is 1.2 — past that the
  // centered-difference advection becomes visibly oscillatory even with α
  // pinning things down.
  beta: number;
  // Horizontal angle in radians, [0, 2π). 0 = +x.
  yaw: number;
  // Vertical angle in radians, [−π/2, π/2]. 0 = horizontal.
  elevation: number;
  // Procedural value-noise modulation amplitude on the wind field, [0, 1].
  // 0 = perfectly uniform direction everywhere; 1 = heavy per-voxel jitter.
  noise: number;
  // Surface-pressure color overlay + SVG compass visibility. Toggled by
  // the tweakpane "viz" checkbox or the global `W` key.
  viz: boolean;
};

// Curvature-flow PDE state. `playing` drives the RAF loop. UI events that
// need GPU work (manual stepping, resetting the volume) push pending counters /
// flags here; the scheduler consumes them inside the render loop where it has
// access to a command encoder.
export type PdeState = {
  playing: boolean;
  // Number of PDE substeps per render frame while playing.
  stepsPerFrame: number;
  // CFL-bounded timestep (per substep). Scheduler clamps to grid.h²/(3α).
  dt: number;
  // Isotropic curvature-flow strength α. ∂ψ/∂t = −α·κ·|∇ψ|.
  alpha: number;
  // Monotonic counter of substeps applied since the last reset; for telemetry.
  iterations: number;
  // Last erode dispatch wall time in ms (CPU encoding side); for FPS overlay.
  lastStepMs: number;
  // One-shot step requests from the UI ("Step" button). The scheduler drains
  // this counter each frame and resets it to 0 after dispatching.
  pendingSingleSteps: number;
  // One-shot reset request ("Reset" button). The scheduler re-bakes ψ from
  // the current CSG and zeroes the iteration counter.
  pendingReset: boolean;
};

export type RootState = {
  csg: CsgNode;
  camera: CameraState;
  render: RenderParams;
  perf: PerformanceParams;
  grid: GridParams;
  pde: PdeState;
  wind: WindParams;
};
