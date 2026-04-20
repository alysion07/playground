import type { AppContext } from './bootstrap';
import { computeBasis, computeViewProj } from '../render/camera';
import { UNIFORM_FLOAT_COUNT } from '../render/material';
import { consumeReset, tickMesh, tickPde } from '../sim/scheduler';
import { appStore, requestMeshBuild, setMesh, windDirVector } from '../state/store';

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
      const substeps = tickPde(ctx.material, encoder);
      // Auto-rebuild the mesh while ψ keeps evolving. Only meaningful in
      // mesh mode — raymarch reads ψ directly every frame and doesn't need
      // an intermediate mesh. tickMesh itself gates on mcPass.isReadbackPending
      // so requesting each frame is safe: the flag simply sits until the
      // prior readback resolves, then gets consumed on the next eligible
      // frame. Without this, mesh mode showed a frozen snapshot from the
      // last Rebuild click.
      if (substeps > 0 && state.render.mode === 'mesh') {
        requestMeshBuild();
      }
      // MC dispatch runs on whatever ψ side the erode pass just wrote into,
      // so the mesh reflects the most recent simulation state. Readback
      // wait happens *after* queue.submit below.
      const mcStart = tickMesh(ctx.material, ctx.mcPass, encoder);
      const view = ctx.gpu.context.getCurrentTexture().createView();
      const clearValue = { r: 0.04, g: 0.04, b: 0.06, a: 1 };

      if (state.render.mode === 'mesh') {
        // Rasterize the MC output. Camera is uploaded as a view-projection
        // matrix (not the raymarch basis) so the vertex stage can skip the
        // fullscreen-triangle setup and do a standard MVP transform.
        const aspect = ctx.resolution.width / Math.max(ctx.resolution.height, 1);
        const viewProj = computeViewProj(basis, aspect);
        ctx.meshPipeline.writeCam(viewProj, basis.ro);
        const depthView = ctx.meshPipeline.ensureDepth(
          ctx.resolution.width,
          ctx.resolution.height,
        );
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue }],
          depthStencilAttachment: {
            view: depthView,
            depthLoadOp: 'clear',
            depthClearValue: 1.0,
            depthStoreOp: 'store',
          },
        });
        // indexCount lags the GPU by the readback latency, so on the frames
        // right after a Rebuild the draw call uses the *previous* mesh's
        // count. Visually that's a few frames of stale indices before the
        // store catches up — acceptable at user-driven cadence.
        if (state.mesh.indexCount > 0) {
          // Wireframe toggle picks the X-ray wire pipeline (no depth test,
          // no cull, edges-only). Same vertex buffer + bind group as the lit
          // path, so it's a drop-in swap.
          const pipeline = state.render.wireframe
            ? ctx.meshPipeline.wirePipeline
            : ctx.meshPipeline.pipeline;
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, ctx.meshPipeline.bindGroup);
          pass.setVertexBuffer(0, ctx.mcPass.verts);
          pass.setIndexBuffer(ctx.mcPass.indices, 'uint32');
          pass.drawIndexed(state.mesh.indexCount, 1, 0, 0, 0);
        }
        pass.end();
      } else {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue }],
        });
        pass.setPipeline(ctx.material.pipeline);
        pass.setBindGroup(0, ctx.material.bindGroup);
        pass.draw(3, 1, 0, 0);
        pass.end();
      }
      ctx.gpu.device.queue.submit([encoder.finish()]);

      if (mcStart !== null) {
        // Fire-and-forget: the promise resolves when the staging buffer maps,
        // usually a few frames later. setMesh triggers a pane refresh that
        // shows the new vertex count + overflow badge.
        ctx.mcPass.readbackCounter().then((counts) => {
          setMesh({
            vertexCount: counts.vertexCount,
            indexCount: counts.indexCount,
            overflow: counts.overflow,
            lastBuildMs: performance.now() - mcStart,
          });
        }).catch((err) => {
          console.error('[mc.readback] failed:', err);
        });
      }
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
