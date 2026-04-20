import { createGPU, WebGPUUnsupportedError, type GPUBundle } from '../render/renderer';
import { RaymarchMaterial } from '../render/material';
import { McPass } from '../render/mcPass';
import { MeshPipeline } from '../render/meshPipeline';
import { applyDragYawPitch, applyZoom } from '../render/camera';
import { installResize } from '../util/resize';
import { installPointer } from '../util/pointer';
import { mountFpsOverlay } from '../ui/fps-overlay';
import { mountCsgBuilder } from '../ui/csg-builder';
import { mountWindCompass } from '../ui/wind-compass';
import { appStore, resetPdeProgress, setCamera, setWind } from '../state/store';

export type AppContext = {
  canvas: HTMLCanvasElement;
  gpu: GPUBundle;
  material: RaymarchMaterial;
  mcPass: McPass;
  meshPipeline: MeshPipeline;
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

  const mcPass = new McPass(gpu.device);
  // Bind MC against the freshly-allocated ψ volume + shared GeomU buffer.
  // `setBindings` is idempotent — every grid change triggers the same call
  // below so the bind groups always reference the current volume views.
  if (material.volume) mcPass.setBindings(material.volume, material.geometryBuffer);

  // Mesh renderer shares the wind uniform buffer with the raymarch pass so a
  // single `writeWindUniforms` call drives both pipelines in lockstep.
  const meshPipeline = new MeshPipeline(gpu.device, gpu.format, material.windUniformBuffer);

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
      if (gridChanged) {
        material.setGrid(state.grid.size);
        // Volume views were recreated — MC must rebind before its next dispatch.
        if (material.volume) mcPass.setBindings(material.volume, material.geometryBuffer);
      }
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

  const compassEl = document.getElementById('compass');
  if (compassEl instanceof HTMLElement) mountWindCompass(compassEl);

  // Global W → toggle wind viz. Filter out W typed into form inputs (tweakpane
  // text entries, number fields) so the user can still use 'w' inside those.
  // No modifier shortcuts on this key, so we explicitly skip any modifier
  // combo to stay out of the way of browser/system bindings.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'w' && e.key !== 'W') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    setWind({ viz: !appStore.getState().wind.viz });
  };
  window.addEventListener('keydown', onKey);

  const onFrame = (timeMs: number) => tickFps(timeMs);

  return { canvas, gpu, material, mcPass, meshPipeline, resolution, onFrame };
}
