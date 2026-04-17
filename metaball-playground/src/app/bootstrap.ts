import type { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { createRenderer, type Backend } from '../render/renderer';
import { createMetaballMaterial, type MetaballUniforms } from '../render/material';
import { createFullscreenQuad } from '../render/fullscreen-quad';
import { installResize } from '../util/resize';
import { mountFpsOverlay } from '../ui/fps-overlay';

export type AppContext = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  uniforms: MetaballUniforms;
  backend: Backend;
  onFrame: (timeMs: number) => void;
};

function getCanvas(): HTMLCanvasElement {
  const el = document.getElementById('gl');
  if (!(el instanceof HTMLCanvasElement)) {
    throw new Error('[bootstrap] <canvas id="gl"> not found');
  }
  return el;
}

function getFpsElement(): HTMLElement | null {
  return document.getElementById('fps');
}

export async function bootstrap(): Promise<AppContext> {
  const canvas = getCanvas();
  const { renderer, backend } = await createRenderer(canvas);
  const { material, uniforms } = createMetaballMaterial(backend);
  const { scene, camera } = createFullscreenQuad(material);

  installResize(renderer, uniforms);

  const fpsEl = getFpsElement();
  const tickFps = fpsEl ? mountFpsOverlay(fpsEl) : () => {};

  const onFrame = (timeMs: number) => {
    uniforms.uTime.value = timeMs;
    tickFps(timeMs);
  };

  return { renderer, scene, camera, uniforms, backend, onFrame };
}
