import type { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { createRenderer, type Backend } from '../render/renderer';
import { createMetaballMaterial, type MetaballUniforms } from '../render/material';
import { createFullscreenQuad } from '../render/fullscreen-quad';
import { installResize } from '../util/resize';
import { mountFpsOverlay } from '../ui/fps-overlay';
import { installPointer, type PointerRuntime } from '../util/pointer';
import { mountControls } from '../ui/controls';

export type AppContext = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  uniforms: MetaballUniforms;
  backend: Backend;
  pointer: PointerRuntime;
  onFrame: (timeMs: number) => void;
};

function getCanvas(): HTMLCanvasElement {
  const el = document.getElementById('gl');
  if (!(el instanceof HTMLCanvasElement)) {
    throw new Error('[bootstrap] <canvas id="gl"> not found');
  }
  return el;
}

export async function bootstrap(): Promise<AppContext> {
  const canvas = getCanvas();
  const { renderer, backend } = await createRenderer(canvas);
  const { material, uniforms } = createMetaballMaterial(backend);
  const { scene, camera } = createFullscreenQuad(material);

  installResize(renderer, uniforms);

  const fpsEl = document.getElementById('fps');
  const tickFps = fpsEl instanceof HTMLElement ? mountFpsOverlay(fpsEl) : () => {};

  const pointer = installPointer(canvas);

  const panelEl = document.getElementById('panel');
  if (panelEl instanceof HTMLElement) mountControls(panelEl);

  const onFrame = (timeMs: number) => {
    tickFps(timeMs);
  };

  return { renderer, scene, camera, uniforms, backend, pointer, onFrame };
}
