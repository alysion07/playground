import { WebGLRenderer } from 'three';

export type Backend = 'webgpu' | 'webgl2';

export type RendererBundle = {
  renderer: WebGLRenderer;
  backend: Backend;
  webgpuAvailable: boolean;
};

const MAX_DPR = 1.5;

type MinimalGPU = { requestAdapter: () => Promise<unknown> };

async function detectWebGPU(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    const gpu = (navigator as unknown as { gpu: MinimalGPU }).gpu;
    const adapter = await gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

// Week 1: always WebGL2. WebGPU availability is detected and logged for the
// upcoming Week 2 migration (Three.js NodeMaterial + wgslFn). See
// docs/metaball-playground-plan.md §5 Week 2.
export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererBundle> {
  const webgpuAvailable = await detectWebGPU();
  const backend: Backend = 'webgl2';

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  console.info(
    `[renderer] backend=${backend}  webgpuAvailable=${webgpuAvailable}  dpr=${renderer.getPixelRatio()}`,
  );

  return { renderer, backend, webgpuAvailable };
}
