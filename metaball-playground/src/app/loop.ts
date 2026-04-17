import type { AppContext } from './bootstrap';

export function startLoop(ctx: AppContext): () => void {
  let frameId = 0;
  let stopped = false;

  const tick = (timeMs: number) => {
    if (stopped) return;
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
