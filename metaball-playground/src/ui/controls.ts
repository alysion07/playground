import { Pane } from 'tweakpane';
import {
  addBlob,
  appStore,
  clearBlobs,
  loadPreset,
  randomize,
  setPerf,
  setRender,
  setSim,
} from '../state/store';
import type { BoundaryMode, PaletteName, PresetName } from '../state/types';
import { PRESET_NAMES } from '../sim/presets';
import { PALETTES, hexToRgb, rgbToHex } from '../util/color';

type ColorProxy = { backgroundHex: string };

type PresetProxy = { preset: PresetName | '—' };

export function mountControls(host: HTMLElement): () => void {
  const { sim, render, perf } = appStore.getState();

  // Mutable proxies so tweakpane can bind directly. We re-sync from store below.
  const simProxy = { ...sim };
  const renderProxy = { ...render };
  const perfProxy = { ...perf };
  const colorProxy: ColorProxy = { backgroundHex: rgbToHex(render.backgroundColor) };
  const presetProxy: PresetProxy = { preset: '—' };

  const pane = new Pane({ container: host, title: 'Metaball Playground' });

  // --- Simulation ------------------------------------------------------------
  const fSim = pane.addFolder({ title: 'Simulation' });
  fSim.addBinding(simProxy, 'count', { min: 1, max: 32, step: 1 }).on('change', (ev) =>
    setSim({ count: ev.value }),
  );
  fSim
    .addBinding(simProxy, 'blobSmoothness', { min: 0, max: 1, step: 0.01 })
    .on('change', (ev) => setSim({ blobSmoothness: ev.value }));
  fSim.addBinding(simProxy, 'gravity', { min: -1, max: 1, step: 0.01 }).on('change', (ev) =>
    setSim({ gravity: ev.value }),
  );
  fSim.addBinding(simProxy, 'damping', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setSim({ damping: ev.value }),
  );
  fSim.addBinding(simProxy, 'attraction', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setSim({ attraction: ev.value }),
  );
  fSim.addBinding(simProxy, 'mouseForce', { min: 0, max: 10, step: 0.1 }).on('change', (ev) =>
    setSim({ mouseForce: ev.value }),
  );
  fSim
    .addBinding(simProxy, 'boundaryMode', {
      options: { bounce: 'bounce', wrap: 'wrap', soft: 'soft' } as Record<string, BoundaryMode>,
    })
    .on('change', (ev) => setSim({ boundaryMode: ev.value as BoundaryMode }));
  fSim.addBinding(simProxy, 'timeScale', { min: 0, max: 3, step: 0.05 }).on('change', (ev) =>
    setSim({ timeScale: ev.value }),
  );

  // --- Render ----------------------------------------------------------------
  const fRender = pane.addFolder({ title: 'Render' });
  fRender
    .addBinding(renderProxy, 'aa', { min: 0, max: 4, step: 0.1 })
    .on('change', (ev) => setRender({ aa: ev.value }));
  fRender
    .addBinding(renderProxy, 'colorSoftness', { min: 0, max: 10, step: 0.1 })
    .on('change', (ev) => setRender({ colorSoftness: ev.value }));
  fRender.addBinding(colorProxy, 'backgroundHex', { label: 'background' }).on('change', (ev) =>
    setRender({ backgroundColor: hexToRgb(ev.value) }),
  );
  fRender
    .addBinding(renderProxy, 'palette', {
      options: {
        Default: 'Default',
        Warm: 'Warm',
        Cool: 'Cool',
        Pastel: 'Pastel',
        Neon: 'Neon',
      } as Record<string, PaletteName>,
    })
    .on('change', (ev) => {
      setRender({ palette: ev.value as PaletteName });
      // Recolor existing blobs using the new palette without reseeding positions.
      recolorBlobsWithPalette(ev.value as PaletteName);
    });
  fRender.addBinding(renderProxy, 'bloom', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setRender({ bloom: ev.value }),
  );
  fRender.addBinding(renderProxy, 'vignette', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setRender({ vignette: ev.value }),
  );
  fRender.addBinding(renderProxy, 'rimLight', { min: 0, max: 1, step: 0.01 }).on('change', (ev) =>
    setRender({ rimLight: ev.value }),
  );

  // --- Blobs -----------------------------------------------------------------
  const fBlobs = pane.addFolder({ title: 'Blobs' });
  fBlobs.addButton({ title: 'Randomize' }).on('click', () => {
    randomize();
    syncProxiesFromStore();
    pane.refresh();
  });
  fBlobs.addButton({ title: 'Add blob' }).on('click', () => {
    addBlob();
    syncProxiesFromStore();
    pane.refresh();
  });
  fBlobs.addButton({ title: 'Clear' }).on('click', () => {
    clearBlobs();
    syncProxiesFromStore();
    pane.refresh();
  });

  // --- Presets ---------------------------------------------------------------
  const fPresets = pane.addFolder({ title: 'Presets' });
  const presetOptions: Record<string, PresetName | '—'> = { '—': '—' };
  for (const n of PRESET_NAMES) presetOptions[n] = n;
  fPresets.addBinding(presetProxy, 'preset', { options: presetOptions }).on('change', (ev) => {
    if (ev.value === '—') return;
    loadPreset(ev.value as PresetName);
    syncProxiesFromStore();
    pane.refresh();
  });

  // --- Performance -----------------------------------------------------------
  const fPerf = pane.addFolder({ title: 'Performance' });
  fPerf
    .addBinding(perfProxy, 'dprCap', { min: 0.5, max: 2, step: 0.1 })
    .on('change', (ev) => setPerf({ dprCap: ev.value }));
  fPerf.addBinding(perfProxy, 'showFps').on('change', (ev) => setPerf({ showFps: ev.value }));

  // --- Sync helpers ----------------------------------------------------------
  function syncProxiesFromStore(): void {
    const s = appStore.getState();
    Object.assign(simProxy, s.sim);
    Object.assign(renderProxy, s.render);
    Object.assign(perfProxy, s.perf);
    colorProxy.backgroundHex = rgbToHex(s.render.backgroundColor);
    presetProxy.preset = s.presetName ?? '—';
  }

  // Push store changes (e.g. programmatic loadPreset, syncBlobCount) into UI.
  const unsubscribe = appStore.subscribe((state, prev) => {
    if (state.sim !== prev.sim || state.render !== prev.render || state.perf !== prev.perf) {
      syncProxiesFromStore();
      pane.refresh();
    }
  });

  return () => {
    unsubscribe();
    pane.dispose();
  };
}

function recolorBlobsWithPalette(palette: PaletteName): void {
  const { blobs } = appStore.getState();
  if (blobs.length === 0) return;
  const colors = PALETTES[palette];
  const next = blobs.map((b, i) => {
    const c = colors[i % colors.length];
    return { ...b, color: [c[0], c[1], c[2]] as [number, number, number] };
  });
  appStore.setState({ blobs: next });
}
