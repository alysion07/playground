import { Pane } from 'tweakpane';
import {
  appStore,
  clearSlimes,
  setPalette,
  setPerf,
  setRender,
  setSim,
} from '../state/store';
import type { PaletteName, ShapeChoice } from '../state/types';
import { THEMES } from '../design/tokens';
import { buildShareUrl } from '../state/url-sync';

export function mountControls(host: HTMLElement): () => void {
  const { sim, render, perf } = appStore.getState();

  const simProxy = { ...sim };
  const renderProxy = { ...render };
  const perfProxy = { ...perf };
  const paletteProxy: { palette: PaletteName } = { palette: render.palette };

  const pane = new Pane({ container: host, title: 'Slime Tower' });

  const fSim = pane.addFolder({ title: 'Simulation' });
  fSim.addBinding(simProxy, 'gravity', { min: 0.5, max: 10, step: 0.1 }).on('change', (ev) =>
    setSim({ gravity: ev.value }),
  );
  fSim.addBinding(simProxy, 'damping', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setSim({ damping: ev.value }),
  );
  fSim.addBinding(simProxy, 'mergeK', { min: 0, max: 0.5, step: 0.005 }).on('change', (ev) =>
    setSim({ mergeK: ev.value }),
  );
  fSim.addBinding(simProxy, 'mergeOverlap', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setSim({ mergeOverlap: ev.value }),
  );
  fSim.addBinding(simProxy, 'timeScale', { min: 0, max: 2, step: 0.05 }).on('change', (ev) =>
    setSim({ timeScale: ev.value }),
  );

  const fRender = pane.addFolder({ title: 'Render' });
  fRender.addBinding(renderProxy, 'gridIntensity', { min: 0, max: 1, step: 0.01 }).on(
    'change',
    (ev) => setRender({ gridIntensity: ev.value }),
  );
  fRender.addBinding(renderProxy, 'glassRim', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setRender({ glassRim: ev.value }),
  );
  fRender.addBinding(renderProxy, 'sssDensity', { min: 0, max: 1, step: 0.01 }).on(
    'change',
    (ev) => setRender({ sssDensity: ev.value }),
  );
  fRender
    .addBinding(renderProxy, 'stepBudget', { min: 24, max: 128, step: 1 })
    .on('change', (ev) => setRender({ stepBudget: ev.value }));
  fRender.addBinding(renderProxy, 'halfRes').on('change', (ev) =>
    setRender({ halfRes: ev.value }),
  );
  fRender.addBinding(renderProxy, 'cameraFollow', { label: 'camera follow' }).on(
    'change',
    (ev) => setRender({ cameraFollow: ev.value }),
  );

  const fPalette = pane.addFolder({ title: 'Palette' });
  fPalette
    .addBinding(paletteProxy, 'palette', {
      options: {
        Aquarium: 'Aquarium',
        Caramel: 'Caramel',
        Lab: 'Lab',
        Mono: 'Mono',
        Tetris: 'Tetris',
      } as Record<string, PaletteName>,
    })
    .on('change', (ev) => applyPalette(ev.value as PaletteName));

  const fSlimes = pane.addFolder({ title: 'Slimes' });
  fSlimes
    .addBinding(renderProxy, 'dropShape', {
      label: 'shape',
      options: {
        Random: 'random',
        Sphere: 'sphere',
        Capsule: 'capsule',
        Box: 'box',
      } as Record<string, ShapeChoice>,
    })
    .on('change', (ev) => setRender({ dropShape: ev.value as ShapeChoice }));
  fSlimes
    .addBinding(renderProxy, 'colorMode', {
      label: 'color',
      options: {
        'Random (all)': 'random',
        'Palette': 'palette',
      } as Record<string, 'palette' | 'random'>,
    })
    .on('change', (ev) => setRender({ colorMode: ev.value as 'palette' | 'random' }));
  fSlimes.addButton({ title: 'Clear' }).on('click', () => {
    clearSlimes();
  });

  const fShare = pane.addFolder({ title: 'Share' });
  fShare.addButton({ title: 'Copy share URL' }).on('click', async () => {
    const url = buildShareUrl();
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      flashToast('Share URL copied');
    } catch {
      prompt('Copy share URL:', url);
    }
  });
  fShare.addButton({ title: 'Save PNG' }).on('click', () => {
    saveCanvasPng();
  });

  const fPerf = pane.addFolder({ title: 'Performance' });
  fPerf.addBinding(perfProxy, 'dprCap', { min: 0.5, max: 2, step: 0.1 }).on('change', (ev) =>
    setPerf({ dprCap: ev.value }),
  );
  fPerf.addBinding(perfProxy, 'showFps').on('change', (ev) => setPerf({ showFps: ev.value }));

  const syncProxiesFromStore = (): void => {
    const s = appStore.getState();
    Object.assign(simProxy, s.sim);
    Object.assign(renderProxy, s.render);
    Object.assign(perfProxy, s.perf);
    paletteProxy.palette = s.render.palette;
  };

  const unsubscribe = appStore.subscribe((state, prev) => {
    if (
      state.sim !== prev.sim ||
      state.render !== prev.render ||
      state.perf !== prev.perf
    ) {
      syncProxiesFromStore();
      pane.refresh();
    }
  });

  return () => {
    unsubscribe();
    pane.dispose();
  };
}

function applyPalette(name: PaletteName): void {
  const theme = THEMES[name];
  setPalette(name);
  setRender({
    palette: name,
    backgroundTop: theme.backgroundTop,
    backgroundBottom: theme.backgroundBottom,
    glassRim: theme.glassRim,
    sssDensity: theme.sssDensity,
    gridIntensity: theme.gridIntensity,
  });
}

function saveCanvasPng(): void {
  const canvas = document.getElementById('gl');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  canvas.toBlob((blob) => {
    if (!blob) {
      flashToast('Screenshot failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slime-tower-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | null = null;
function flashToast(message: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(20,20,28,.92);color:#fff;padding:8px 16px;border-radius:6px;font:13px/1.4 system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .2s;z-index:9999';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.style.opacity = '1';
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.style.opacity = '0';
  }, 1800);
}
