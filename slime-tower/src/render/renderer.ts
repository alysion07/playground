import { WebGLRenderer } from 'three';

export type RendererBundle = {
  renderer: WebGLRenderer;
};

const MAX_DPR = 1.5;

export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererBundle> {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  console.info(`[renderer] backend=webgl2 dpr=${renderer.getPixelRatio()}`);
  return { renderer };
}
