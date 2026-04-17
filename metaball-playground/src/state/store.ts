import { createStore } from 'zustand/vanilla';
import type {
  Blob,
  PerformanceParams,
  PresetName,
  RenderParams,
  RootState,
  SimParams,
} from './types';
import { mulberry32 } from '../util/rng';
import { populate, createBlob } from '../sim/blob';
import { getPreset } from '../sim/presets';

export const MAX_BLOBS = 32;
export const DEFAULT_SEED = 1337;

export const DEFAULT_SIM: SimParams = {
  count: 5,
  blobSmoothness: 0.5,
  gravity: 0,
  damping: 0.2,
  attraction: 0.05,
  mouseForce: 2,
  boundaryMode: 'bounce',
  timeScale: 1,
};

export const DEFAULT_RENDER: RenderParams = {
  aa: 1.5,
  colorSoftness: 6,
  backgroundColor: [0.03, 0.03, 0.05],
  palette: 'Default',
  bloom: 0.2,
  vignette: 0.25,
  rimLight: 0.3,
};

export const DEFAULT_PERF: PerformanceParams = {
  dprCap: 1.5,
  showFps: true,
};

const UNIT_BOUNDS = { x: 0.6, y: 0.5 };

function initialState(): RootState {
  const seed = DEFAULT_SEED;
  const rng = mulberry32(seed);
  return {
    sim: { ...DEFAULT_SIM },
    render: { ...DEFAULT_RENDER },
    perf: { ...DEFAULT_PERF },
    blobs: populate(rng, DEFAULT_SIM.count, UNIT_BOUNDS),
    seed,
    presetName: null,
  };
}

export const appStore = createStore<RootState>(() => initialState());

// --- mutators / actions -----------------------------------------------------

export function setSim(patch: Partial<SimParams>): void {
  const prev = appStore.getState().sim;
  const next = { ...prev, ...patch };
  appStore.setState({ sim: next, presetName: null });
  if (patch.count !== undefined && patch.count !== prev.count) {
    syncBlobCount(patch.count);
  }
}

export function setRender(patch: Partial<RenderParams>): void {
  appStore.setState({
    render: { ...appStore.getState().render, ...patch },
    presetName: null,
  });
}

export function setPerf(patch: Partial<PerformanceParams>): void {
  appStore.setState({
    perf: { ...appStore.getState().perf, ...patch },
  });
}

export function setSeed(seed: number): void {
  appStore.setState({ seed });
}

function syncBlobCount(targetCount: number): void {
  const clamped = Math.max(1, Math.min(MAX_BLOBS, Math.floor(targetCount)));
  const { blobs, seed } = appStore.getState();
  if (clamped === blobs.length) return;
  if (clamped < blobs.length) {
    appStore.setState({ blobs: blobs.slice(0, clamped) });
    return;
  }
  const rng = mulberry32(seed + blobs.length * 31);
  const extra: Blob[] = [];
  for (let i = 0; i < clamped - blobs.length; i++) {
    extra.push(createBlob(rng, UNIT_BOUNDS));
  }
  appStore.setState({ blobs: [...blobs, ...extra] });
}

export function addBlob(): void {
  const { blobs, sim, seed } = appStore.getState();
  if (blobs.length >= MAX_BLOBS) return;
  const rng = mulberry32(seed + blobs.length * 31 + 7);
  const next = [...blobs, createBlob(rng, UNIT_BOUNDS)];
  appStore.setState({ blobs: next, sim: { ...sim, count: next.length } });
}

export function removeBlob(id: string): void {
  const { blobs, sim } = appStore.getState();
  const next = blobs.filter((b) => b.id !== id);
  if (next.length === blobs.length) return;
  appStore.setState({ blobs: next, sim: { ...sim, count: next.length } });
}

export function clearBlobs(): void {
  appStore.setState({ blobs: [], sim: { ...appStore.getState().sim, count: 0 } });
}

export function randomize(seed?: number): void {
  const { sim } = appStore.getState();
  const useSeed = seed ?? Math.floor(Math.random() * 2 ** 30);
  const rng = mulberry32(useSeed);
  appStore.setState({
    blobs: populate(rng, sim.count, UNIT_BOUNDS),
    seed: useSeed,
    presetName: null,
  });
}

export function loadPreset(name: PresetName): void {
  const p = getPreset(name);
  const rng = mulberry32(p.seed);
  appStore.setState({
    sim: { ...DEFAULT_SIM, ...p.sim },
    render: { ...DEFAULT_RENDER, ...p.render },
    blobs: populate(rng, p.sim.count ?? DEFAULT_SIM.count, UNIT_BOUNDS, p.radiusRange, p.palette),
    seed: p.seed,
    presetName: name,
  });
}

export const BOUNDS = UNIT_BOUNDS;
