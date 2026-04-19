export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type ShapeKind = 'sphere' | 'capsule' | 'box';
export type ShapeChoice = ShapeKind | 'random';

export const SHAPE_KINDS: ShapeKind[] = ['sphere', 'capsule', 'box'];

export const SHAPE_INDEX: Record<ShapeKind, number> = {
  sphere: 0,
  capsule: 1,
  box: 2,
};

export type Slime = {
  id: string;
  // World-space center, meters. y=0 is the floor plane; +y is up.
  pos: Vec3;
  // Verlet previous-position (world units, same scale as pos).
  prev: Vec3;
  // Per-axis radii (rx, ry, rz). Derived per-frame from baseRadius and the
  // accumulated vertical load via src/sim/support.ts.
  radii: Vec3;
  // Undeformed spherical radius. Merged slimes get a new baseRadius computed
  // from combined volume.
  baseRadius: number;
  color: Vec3;
  mass: number;
  shape: ShapeKind;
  // Wall-clock seconds since spawn. Used for merge-cooldown and drop animation.
  ageSec: number;
};

export type ModeName = 'zen' | 'tower' | 'vessel';

export type PresetName = 'Aquarium' | 'Caramel' | 'Lab' | 'Mono' | 'Tetris';

export type PaletteName = PresetName;

export type SimParams = {
  // World-unit gravity along -y, in m/s². 9.8 maps to "earth-like", smaller
  // values feel like honey.
  gravity: number;
  // Per-second velocity damping 0..1.
  damping: number;
  // Smooth-min kernel width for CSG merge visual, in world units.
  mergeK: number;
  // Two slimes overlap by this fraction of the smaller radius before counting
  // as a "merge candidate" (Week 2 will add dwell-time).
  mergeOverlap: number;
  timeScale: number;
};

export type RenderParams = {
  // Ground grid line intensity 0..1.
  gridIntensity: number;
  // Fresnel rim highlight strength 0..1.
  glassRim: number;
  // Inside-SDF tint density for fake SSS 0..1.
  sssDensity: number;
  // Background gradient top colour (sky).
  backgroundTop: Vec3;
  // Background gradient bottom colour (horizon).
  backgroundBottom: Vec3;
  // Half-resolution raymarch + upscale on low-end devices.
  halfRes: boolean;
  // Raymarch step budget (cap for shader loop).
  stepBudget: number;
  palette: PaletteName;
  // Slide camera Y to track tower height. Off = camera stays at initial centre.
  cameraFollow: boolean;
  // Shape used for newly dropped slimes. 'random' picks uniformly per drop.
  dropShape: ShapeChoice;
  // Colour selection for new drops.
  //   'palette' — restrict to the current palette's body colours (coherent).
  //   'random'  — pick from every palette's full range (chaotic, varied).
  colorMode: 'palette' | 'random';
};

export type PerformanceParams = {
  dprCap: number;
  showFps: boolean;
};

export type ScoreState = {
  // Max stacked height achieved this session (world units).
  maxHeight: number;
  // Topples this session (Week 2+).
  topples: number;
};

export type RootState = {
  sim: SimParams;
  render: RenderParams;
  perf: PerformanceParams;
  slimes: Slime[];
  mode: ModeName;
  seed: number;
  presetName: PresetName | null;
  score: ScoreState;
};
