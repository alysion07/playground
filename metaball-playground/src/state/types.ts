export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type Blob = {
  id: string;
  pos: Vec2;
  prev: Vec2; // Verlet previous-position
  radius: number;
  color: Vec3; // 0..1
  mass: number;
};

export type BoundaryMode = 'bounce' | 'wrap' | 'soft';

export type SimParams = {
  count: number;
  blobSmoothness: number; // 0..1 → mapped to shader k
  gravity: number; // -1..1 (1 = strong downward, negative = upward)
  damping: number; // 0..1 linear velocity damping per second
  attraction: number; // 0..1 pairwise attraction
  mouseForce: number; // 0..10 spring pull toward pointer
  boundaryMode: BoundaryMode;
  timeScale: number; // 0..3
};

export type PaletteName = 'Default' | 'Warm' | 'Cool' | 'Pastel' | 'Neon';

export type RenderParams = {
  aa: number; // 0..4 (px)
  colorSoftness: number; // 0..10 (higher = sharper per-blob color)
  backgroundColor: Vec3;
  palette: PaletteName;
  bloom: number; // 0..1 (fake post)
  vignette: number; // 0..1
  rimLight: number; // 0..1
};

export type PerformanceParams = {
  dprCap: number; // 0.5..2
  showFps: boolean;
};

export type PresetName = 'Lava' | 'Jelly' | 'Mercury' | 'SoapBubble' | 'Galaxy';

export type RootState = {
  sim: SimParams;
  render: RenderParams;
  perf: PerformanceParams;
  blobs: Blob[];
  seed: number;
  presetName: PresetName | null;
};
