import type { AppContext } from './bootstrap';
import { computeBasis } from '../render/camera';
import { UNIFORM_FLOAT_COUNT } from '../render/material';
import { consumeReset, tickPde } from '../sim/scheduler';
import { appStore, windDirVector } from '../state/store';

export function startLoop(ctx: AppContext): () => void {
  let stopped = false;
  let frameId = 0;
  const uniforms = new Float32Array(UNIFORM_FLOAT_COUNT);

  const tick = (timeMs: number) => {
    if (stopped) return;
    const state = appStore.getState();

    // Pack uniforms in Std140 layout matching shader struct.
    uniforms[0] = ctx.resolution.width;
    uniforms[1] = ctx.resolution.height;
    uniforms[2] = state.render.stepBudget;
    uniforms[3] = state.render.wireframe ? 1 : 0;
    const basis = computeBasis(state.camera);
    uniforms[4] = basis.ro[0];
    uniforms[5] = basis.ro[1];
    uniforms[6] = basis.ro[2];
    uniforms[7] = 0;
    uniforms[8] = basis.forward[0];
    uniforms[9] = basis.forward[1];
    uniforms[10] = basis.forward[2];
    uniforms[11] = 0;
    uniforms[12] = basis.right[0];
    uniforms[13] = basis.right[1];
    uniforms[14] = basis.right[2];
    uniforms[15] = 0;
    uniforms[16] = basis.up[0];
    uniforms[17] = basis.up[1];
    uniforms[18] = basis.up[2];
    uniforms[19] = 0;
    ctx.material.writeUniforms(uniforms);
    ctx.material.writeWindUniforms(
      windDirVector(state.wind),
      state.wind.viz ? 1 : 0,
      state.wind.noise,
    );

    if (ctx.material.pipeline && ctx.material.bindGroup) {
      const encoder = ctx.gpu.device.createCommandEncoder({ label: 'frame' });
      // Reset request → flag a re-init. Then run the bake if anything (CSG
      // edit, grid change, or this frame's reset) marked the volume stale.
      // Erode passes that follow read the freshly written ψ via WebGPU's
      // automatic barriers between passes in the same submit.
      consumeReset(ctx.material);
      ctx.material.runInitIfNeeded(encoder);
      tickPde(ctx.material, encoder);
      const view = ctx.gpu.context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1 },
          },
        ],
      });
      pass.setPipeline(ctx.material.pipeline);
      pass.setBindGroup(0, ctx.material.bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
      ctx.gpu.device.queue.submit([encoder.finish()]);
    }

    ctx.onFrame(timeMs);
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
  };
}
