import type { WebGLRenderer } from 'three';
import type { SlimeUniforms } from '../render/material';
import { appStore } from '../state/store';

export function installResize(renderer: WebGLRenderer, uniforms: SlimeUniforms): () => void {
  const apply = () => {
    const cap = appStore.getState().perf.dprCap;
    const dpr = Math.max(0.5, Math.min(cap, window.devicePixelRatio));
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    uniforms.uResolution.value.set(w * dpr, h * dpr);
  };

  apply();

  const unsubscribePerf = appStore.subscribe((state, prev) => {
    if (state.perf.dprCap !== prev.perf.dprCap) apply();
  });

  const ro = new ResizeObserver(apply);
  ro.observe(document.documentElement);
  window.addEventListener('resize', apply);

  return () => {
    ro.disconnect();
    window.removeEventListener('resize', apply);
    unsubscribePerf();
  };
}
