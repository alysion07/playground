import { createStore } from 'zustand/vanilla';
import type {
  ModeName,
  PaletteName,
  PerformanceParams,
  PresetName,
  RenderParams,
  RootState,
  ScoreState,
  SimParams,
  Slime,
} from './types';

export const MAX_SLIMES = 24;
export const DEFAULT_SEED = 2024;

// World half-extents. y=0 is floor; +y up, capped by WORLD.y.
export const WORLD = { x: 1.4, y: 3.2, z: 1.4 };

export const DEFAULT_SIM: SimParams = {
  gravity: 3.2,
  damping: 0.6,
  mergeK: 0.4,
  mergeOverlap: 0.35,
  timeScale: 1,
};

export const DEFAULT_RENDER: RenderParams = {
  gridIntensity: 0.35,
  glassRim: 0.55,
  sssDensity: 0.45,
  backgroundTop: [0.82, 0.88, 0.96],
  backgroundBottom: [0.94, 0.94, 0.98],
  halfRes: false,
  stepBudget: 64,
  palette: 'Aquarium',
  cameraFollow: false,
  dropShape: 'random',
  colorMode: 'random',
};

export const DEFAULT_PERF: PerformanceParams = {
  dprCap: 1.5,
  showFps: true,
};

const DEFAULT_SCORE: ScoreState = { maxHeight: 0, topples: 0 };

function initialState(): RootState {
  return {
    sim: { ...DEFAULT_SIM },
    render: { ...DEFAULT_RENDER },
    perf: { ...DEFAULT_PERF },
    slimes: [],
    mode: 'zen',
    seed: DEFAULT_SEED,
    presetName: null,
    score: { ...DEFAULT_SCORE },
  };
}

export const appStore = createStore<RootState>(() => initialState());

// --- mutators ---------------------------------------------------------------

export function setSim(patch: Partial<SimParams>): void {
  appStore.setState({
    sim: { ...appStore.getState().sim, ...patch },
    presetName: null,
  });
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

export function setMode(mode: ModeName): void {
  appStore.setState({ mode });
}

export function setSeed(seed: number): void {
  appStore.setState({ seed });
}

export function setPalette(palette: PaletteName): void {
  setRender({ palette });
}

let nextIdNum = 0;
export function mintSlimeId(): string {
  nextIdNum = (nextIdNum + 1) >>> 0;
  return `s${nextIdNum.toString(36)}`;
}

export function addSlime(slime: Slime): void {
  const { slimes } = appStore.getState();
  if (slimes.length >= MAX_SLIMES) return;
  appStore.setState({ slimes: [...slimes, slime] });
}

export function removeSlime(id: string): void {
  const { slimes } = appStore.getState();
  const next = slimes.filter((s) => s.id !== id);
  if (next.length !== slimes.length) appStore.setState({ slimes: next });
}

export function replaceSlimes(next: Slime[]): void {
  appStore.setState({ slimes: next });
}

export function clearSlimes(): void {
  appStore.setState({ slimes: [], score: { ...DEFAULT_SCORE } });
}

export function setScore(patch: Partial<ScoreState>): void {
  appStore.setState({ score: { ...appStore.getState().score, ...patch } });
}

export function setPreset(name: PresetName | null): void {
  appStore.setState({ presetName: name });
}
