import type { AppContext } from './bootstrap';
import { appStore, BOUNDS } from '../state/store';
import { step } from '../sim/physics';

export function startLoop(ctx: AppContext): () => void {
  let frameId = 0;
  let stopped = false;
  let lastMs: number | null = null;

  const tick = (timeMs: number) => {
    if (stopped) return;

    const dt = lastMs === null ? 1 / 60 : Math.min(0.05, (timeMs - lastMs) / 1000);
    lastMs = timeMs;

    const { sim, render, blobs } = appStore.getState();

    step(dt, sim, blobs, BOUNDS, { pos: ctx.pointer.pos, active: ctx.pointer.active });

    // Upload uniforms from store.
    ctx.uniforms.uCount.value = blobs.length;
    // k (shader smoothing) mapped from sim.blobSmoothness (0..1) to 0..0.5 world units.
    ctx.uniforms.uK.value = 0.001 + sim.blobSmoothness * 0.5;
    ctx.uniforms.uAA.value = render.aa;
    ctx.uniforms.uColorSoftness.value = render.colorSoftness;
    ctx.uniforms.uBackground.value.set(
      render.backgroundColor[0],
      render.backgroundColor[1],
      render.backgroundColor[2],
    );
    ctx.uniforms.uBloom.value = render.bloom;
    ctx.uniforms.uVignette.value = render.vignette;
    ctx.uniforms.uRim.value = render.rimLight;

    const xyzr = ctx.uniforms.uBlobsXYZR.value;
    const colors = ctx.uniforms.uColors.value;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      xyzr[i].set(b.pos[0], b.pos[1], b.radius, 0);
      colors[i].set(b.color[0], b.color[1], b.color[2]);
    }

    ctx.onFrame(timeMs);
    ctx.renderer.render(ctx.scene, ctx.camera);
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
  };
}
