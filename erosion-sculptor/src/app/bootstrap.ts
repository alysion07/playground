import { createGPU, WebGPUUnsupportedError, type GPUBundle } from '../render/renderer';
import { RaymarchMaterial } from '../render/material';
import { applyDragYawPitch, applyZoom } from '../render/camera';
import { installResize } from '../util/resize';
import { installPointer } from '../util/pointer';
import { mountFpsOverlay } from '../ui/fps-overlay';
import { mountCsgBuilder } from '../ui/csg-builder';
import { appStore, resetPdeProgress, setCamera } from '../state/store';

export type AppContext = {
  canvas: HTMLCanvasElement;
  gpu: GPUBundle;
  material: RaymarchMaterial;
  resolution: { width: number; height: number };
  onFrame: (timeMs: number) => void;
};

function getCanvas(): HTMLCanvasElement {
  const el = document.getElementById('gl');
  if (!(el instanceof HTMLCanvasElement)) {
    throw new Error('[bootstrap] <canvas id="gl"> not found');
  }
  return el;
}

function showUnsupportedMessage(): void {
  const el = document.getElementById('unsupported');
  const canvas = document.getElementById('gl');
  if (el) el.classList.add('show');
  if (canvas) (canvas as HTMLElement).style.display = 'none';
}

export async function bootstrap(): Promise<AppContext | null> {
  const canvas = getCanvas();
  let gpu: GPUBundle;
  try {
    gpu = await createGPU(canvas);
  } catch (err) {
    if (err instanceof WebGPUUnsupportedError) {
      console.warn('[bootstrap] WebGPU unsupported:', err.message);
      showUnsupportedMessage();
      return null;
    }
    throw err;
  }

  const material = new RaymarchMaterial(gpu.device, gpu.format);
  material.setGrid(appStore.getState().grid.size);
  material.rebuild(appStore.getState().csg);

  // Rebuild the shader pipeline every time the CSG tree or grid resolution
  // changes. Even pure parameter edits trigger a rebuild because parameter
  // values are baked into the WGSL source. A grid-size change reallocates the
  // ψ volume and re-binds before rebuilding so the bake targets the new texture.
  // Either change resets the iteration counter — editing the source CSG voids
  // any prior erosion progress (WYSIWYG: what you see is what's been eroded).
  appStore.subscribe((state, prev) => {
    const gridChanged = state.grid.size !== prev.grid.size;
    const csgChanged = state.csg !== prev.csg;
    if (!gridChanged && !csgChanged) return;
    try {
      if (gridChanged) material.setGrid(state.grid.size);
      if (csgChanged || gridChanged) {
        material.rebuild(state.csg);
        resetPdeProgress();
      }
    } catch (err) {
      console.error('[material.rebuild] failed:', err);
    }
  });

  const resolution = { width: canvas.width, height: canvas.height };
  installResize(canvas, (w, h) => {
    resolution.width = w;
    resolution.height = h;
  });

  installPointer(canvas, {
    onDrag: (dx, dy) => {
      const cam = appStore.getState().camera;
      setCamera(applyDragYawPitch(cam, dx, dy));
    },
    onWheel: (dy) => {
      const cam = appStore.getState().camera;
      setCamera(applyZoom(cam, dy));
    },
  });

  const fpsEl = document.getElementById('fps');
  const tickFps = fpsEl instanceof HTMLElement ? mountFpsOverlay(fpsEl) : () => {};

  const panelEl = document.getElementById('panel');
  if (panelEl instanceof HTMLElement) mountCsgBuilder(panelEl);

  const onFrame = (timeMs: number) => tickFps(timeMs);

  return { canvas, gpu, material, resolution, onFrame };
}
