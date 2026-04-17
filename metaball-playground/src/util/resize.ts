import type { WebGLRenderer } from 'three';
import type { MetaballUniforms } from '../render/material';

const MAX_DPR = 1.5;

export function installResize(
  renderer: WebGLRenderer,
  uniforms: MetaballUniforms,
): () => void {
  const apply = () => {
    const dpr = Math.min(window.devicePixelRatio, MAX_DPR);
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    uniforms.uResolution.value.set(w * dpr, h * dpr);
  };

  apply();

  const ro = new ResizeObserver(apply);
  ro.observe(document.documentElement);
  window.addEventListener('resize', apply);

  return () => {
    ro.disconnect();
    window.removeEventListener('resize', apply);
  };
}
