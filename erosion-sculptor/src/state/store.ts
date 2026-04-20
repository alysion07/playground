import { createStore } from 'zustand/vanilla';
import type {
  CameraState,
  CsgNode,
  CsgOp,
  GridParams,
  OpNode,
  PdeState,
  PerformanceParams,
  PrimNode,
  PrimType,
  RenderParams,
  RootState,
  WindParams,
} from './types';

let nextIdNum = 0;
export function mintNodeId(prefix: string): string {
  return `${prefix}_${++nextIdNum}`;
}

export const DEFAULT_CAMERA: CameraState = {
  yaw: 0.6,
  pitch: 0.4,
  dist: 4.0,
};

export const DEFAULT_RENDER: RenderParams = {
  stepBudget: 96,
  wireframe: false,
};

export const DEFAULT_PERF: PerformanceParams = {
  dprCap: 1.5,
  showFps: true,
};

export const DEFAULT_GRID: GridParams = {
  size: 64,
};

// Default α = 0.4 and dt computed for grid 64 → h ≈ 2.4/64 ≈ 0.0375. CFL bound
// is h²/(3α) ≈ 1.17e-3. Pick 5e-4 to stay comfortably stable. The scheduler
// re-clamps dt whenever grid or α changes.
export const DEFAULT_PDE: PdeState = {
  playing: false,
  stepsPerFrame: 4,
  dt: 5e-4,
  alpha: 0.4,
  iterations: 0,
  lastStepMs: 0,
  pendingSingleSteps: 0,
  pendingReset: false,
};

// Wind defaults: β=0 so Week 3 lands with pure curvature flow unchanged from
// Week 2. User opts in by dragging the slider up. yaw/elevation pick an
// arbitrary non-axis-aligned direction so a non-zero β immediately produces
// visible asymmetry; noise 0.25 gives a gentle spatial variation that breaks
// perfect symmetry without being distracting.
export const DEFAULT_WIND: WindParams = {
  beta: 0.0,
  yaw: 0.3,
  elevation: 0.0,
  noise: 0.25,
  viz: true,
};

const PRIM_DEFAULTS: Record<PrimType, { params: number[] }> = {
  sphere: { params: [0.6] },
  box: { params: [0.5, 0.5, 0.5] },
  torus: { params: [0.6, 0.18] },
  capsule: { params: [0.0, -0.3, 0.0, 0.0, 0.3, 0.0, 0.2] },
  roundBox: { params: [0.4, 0.4, 0.4, 0.1] },
};

export function makePrim(type: PrimType): PrimNode {
  return {
    kind: 'prim',
    id: mintNodeId('p'),
    type,
    params: [...PRIM_DEFAULTS[type].params],
    translate: [0, 0, 0],
    rotate: [0, 0, 0],
  };
}

export function makeOp(op: CsgOp, children: CsgNode[]): OpNode {
  return {
    kind: 'op',
    id: mintNodeId('o'),
    op,
    k: 0.25,
    children,
  };
}

function defaultTree(): CsgNode {
  return makePrim('sphere');
}

export const appStore = createStore<RootState>(() => ({
  csg: defaultTree(),
  camera: { ...DEFAULT_CAMERA },
  render: { ...DEFAULT_RENDER },
  perf: { ...DEFAULT_PERF },
  grid: { ...DEFAULT_GRID },
  pde: { ...DEFAULT_PDE },
  wind: { ...DEFAULT_WIND },
}));

// --- mutators ---------------------------------------------------------------

export function replaceCsg(next: CsgNode): void {
  appStore.setState({ csg: next });
}

function mapTree(node: CsgNode, fn: (n: CsgNode) => CsgNode): CsgNode {
  const replaced = fn(node);
  if (replaced.kind === 'op') {
    return { ...replaced, children: replaced.children.map((c) => mapTree(c, fn)) };
  }
  return replaced;
}

function removeFromTree(node: CsgNode, id: string): CsgNode | null {
  if (node.id === id) return null;
  if (node.kind === 'op') {
    const kept = node.children
      .map((c) => removeFromTree(c, id))
      .filter((c): c is CsgNode => c !== null);
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0];
    return { ...node, children: kept };
  }
  return node;
}

export function updatePrim(id: string, patch: Partial<Omit<PrimNode, 'id' | 'kind'>>): void {
  const next = mapTree(appStore.getState().csg, (n) => {
    if (n.kind !== 'prim' || n.id !== id) return n;
    return { ...n, ...patch };
  });
  appStore.setState({ csg: next });
}

export function setOpKind(id: string, op: CsgOp): void {
  const next = mapTree(appStore.getState().csg, (n) => {
    if (n.kind !== 'op' || n.id !== id) return n;
    return { ...n, op };
  });
  appStore.setState({ csg: next });
}

export function setOpK(id: string, k: number): void {
  const next = mapTree(appStore.getState().csg, (n) => {
    if (n.kind !== 'op' || n.id !== id) return n;
    return { ...n, k };
  });
  appStore.setState({ csg: next });
}

// Push a new primitive into the root op. If the root is a single primitive,
// auto-promote to a smoothUnion op so additions stay legal.
export function addPrim(type: PrimType): void {
  const root = appStore.getState().csg;
  const next = makePrim(type);
  if (root.kind === 'op') {
    const updated: OpNode = { ...root, children: [...root.children, next] };
    appStore.setState({ csg: updated });
  } else {
    const merged = makeOp('smoothUnion', [root, next]);
    appStore.setState({ csg: merged });
  }
}

export function removeNode(id: string): void {
  const next = removeFromTree(appStore.getState().csg, id);
  if (next === null) {
    // Tree would be empty — replace with a default sphere.
    appStore.setState({ csg: defaultTree() });
    return;
  }
  appStore.setState({ csg: next });
}

export function setCamera(patch: Partial<CameraState>): void {
  appStore.setState({ camera: { ...appStore.getState().camera, ...patch } });
}

export function setRender(patch: Partial<RenderParams>): void {
  appStore.setState({ render: { ...appStore.getState().render, ...patch } });
}

export function setPerf(patch: Partial<PerformanceParams>): void {
  appStore.setState({ perf: { ...appStore.getState().perf, ...patch } });
}

export function setGrid(patch: Partial<GridParams>): void {
  appStore.setState({ grid: { ...appStore.getState().grid, ...patch } });
}

export function setPde(patch: Partial<PdeState>): void {
  appStore.setState({ pde: { ...appStore.getState().pde, ...patch } });
}

export function setWind(patch: Partial<WindParams>): void {
  appStore.setState({ wind: { ...appStore.getState().wind, ...patch } });
}

// Convert (yaw, elevation) into a unit 3-vector in world space. Sign convention
// follows raymarch.wgsl — +y is up, +x is right, +z is forward. yaw=0
// elevation=0 → +x axis. Used by both the erode compute (advection direction)
// and raymarch (surface-pressure dot product), so colocating the conversion
// here keeps the two in sync.
export function windDirVector(wind: WindParams): [number, number, number] {
  const ce = Math.cos(wind.elevation);
  const se = Math.sin(wind.elevation);
  const cy = Math.cos(wind.yaw);
  const sy = Math.sin(wind.yaw);
  return [ce * cy, se, ce * sy];
}

// Reset PDE iteration counter and step telemetry. Called after a fresh bake.
export function resetPdeProgress(): void {
  const pde = appStore.getState().pde;
  appStore.setState({ pde: { ...pde, iterations: 0, lastStepMs: 0 } });
}

// Queue manual PDE substeps to run on the next render frame. Accumulates if
// pressed multiple times before the loop drains.
export function requestSingleSteps(n: number = 1): void {
  const pde = appStore.getState().pde;
  appStore.setState({ pde: { ...pde, pendingSingleSteps: pde.pendingSingleSteps + n } });
}

// Queue a volume reset (re-bake from CSG + iteration counter to 0).
export function requestReset(): void {
  setPde({ pendingReset: true });
}
