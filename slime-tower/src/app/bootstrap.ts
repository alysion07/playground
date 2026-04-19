import type { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { createRenderer } from '../render/renderer';
import { createSlimeMaterial, type SlimeUniforms } from '../render/material';
import { createFullscreenQuad } from '../render/fullscreen-quad';
import { installResize } from '../util/resize';
import { mountFpsOverlay } from '../ui/fps-overlay';
import { installPointer, type PointerRuntime } from '../util/pointer';
import { mountControls } from '../ui/controls';
import { mountModeHud } from '../ui/mode-hud';
import { hydrateFromUrl } from '../state/url-sync';
import { computeBasis, ORTHO_HALF_H, RAY_PUSHBACK } from '../render/camera';

export type AppContext = {
  canvas: HTMLCanvasElement;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  uniforms: SlimeUniforms;
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
  hydrateFromUrl();
  const canvas = getCanvas();
  const { renderer } = await createRenderer(canvas);
  const { material, uniforms } = createSlimeMaterial();
  const { scene, camera } = createFullscreenQuad(material);

  const basis = computeBasis();
  uniforms.uCamRight.value.set(basis.right[0], basis.right[1], basis.right[2]);
  uniforms.uCamUp.value.set(basis.up[0], basis.up[1], basis.up[2]);
  uniforms.uCamForward.value.set(basis.forward[0], basis.forward[1], basis.forward[2]);
  uniforms.uCamCenter.value.set(basis.center[0], basis.center[1], basis.center[2]);
  uniforms.uOrthoHalfH.value = ORTHO_HALF_H;
  uniforms.uRayPushback.value = RAY_PUSHBACK;

  installResize(renderer, uniforms);

  const fpsEl = document.getElementById('fps');
  const tickFps = fpsEl instanceof HTMLElement ? mountFpsOverlay(fpsEl) : () => {};

  const pointer = installPointer(canvas);

  const panelEl = document.getElementById('panel');
  if (panelEl instanceof HTMLElement) mountControls(panelEl);

  const hudEl = document.getElementById('hud');
  if (hudEl instanceof HTMLElement) mountModeHud(hudEl);

  const onFrame = (timeMs: number) => {
    tickFps(timeMs);
  };

  return { canvas, renderer, scene, camera, uniforms, pointer, onFrame };
}
