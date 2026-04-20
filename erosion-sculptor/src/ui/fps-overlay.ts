import { appStore } from '../state/store';

export function mountFpsOverlay(el: HTMLElement): (timeMs: number) => void {
  let lastMs: number | null = null;
  let emaFps = 0;
  const alpha = 0.1;
  let sinceRedrawMs = 0;

  const applyVisibility = () => {
    el.style.display = appStore.getState().perf.showFps ? '' : 'none';
  };
  applyVisibility();
  appStore.subscribe((state, prev) => {
    if (state.perf.showFps !== prev.perf.showFps) applyVisibility();
  });

  return (timeMs: number) => {
    if (lastMs === null) {
      lastMs = timeMs;
      return;
    }
    const dt = timeMs - lastMs;
    lastMs = timeMs;
    if (dt <= 0) return;
    const instFps = 1000 / dt;
    emaFps = emaFps === 0 ? instFps : emaFps + alpha * (instFps - emaFps);
    sinceRedrawMs += dt;
    if (sinceRedrawMs >= 250) {
      sinceRedrawMs = 0;
      const pde = appStore.getState().pde;
      // PDE telemetry only meaningful once the user has actually stepped at
      // least once — before that the volume just contains the bake and the
      // counters are zero, so suppress the noise.
      const pdeBit =
        pde.iterations > 0
          ? ` · iter: ${pde.iterations} · pde: ${pde.lastStepMs.toFixed(2)} ms`
          : '';
      el.textContent = `fps: ${emaFps.toFixed(1)}${pdeBit}`;
    }
  };
}
