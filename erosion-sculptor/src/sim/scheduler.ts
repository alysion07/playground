// PDE scheduler. Translates the `pde` slice of the store into compute-pass
// dispatches each render frame. Owns no state of its own — everything lives
// in the store so UI, scheduler, and telemetry stay in sync.

import type { RaymarchMaterial } from '../render/material';
import { appStore, resetPdeProgress, setPde, windDirVector } from '../state/store';

// CFL upper bound for explicit-Euler curvature flow on a 3D regular grid:
// dt < h² / (3α). The actual nonlinear gradMag-weighted update slightly
// tightens this, so we conservatively halve the bound when clamping.
export function cflMaxDt(voxelSize: number, alpha: number): number {
  return (voxelSize * voxelSize) / Math.max(3 * alpha, 1e-6);
}

export function clampDt(dt: number, voxelSize: number, alpha: number): number {
  const safe = 0.5 * cflMaxDt(voxelSize, alpha);
  return Math.min(Math.max(dt, 1e-6), safe);
}

// Drain the pending-reset flag. Returns true if a reset was actually queued
// (caller can use this to short-circuit other PDE work this frame).
export function consumeReset(material: RaymarchMaterial): boolean {
  const pde = appStore.getState().pde;
  if (!pde.pendingReset) return false;
  material.requestInit();
  setPde({ pendingReset: false });
  resetPdeProgress();
  return true;
}

// Run the PDE for this frame: pending single-steps first, then continuous
// playback steps. Records iteration count + CPU encode wall time for the
// FPS overlay. Returns the total number of substeps dispatched.
export function tickPde(material: RaymarchMaterial, encoder: GPUCommandEncoder): number {
  if (!material.volume) return 0;
  const state = appStore.getState();
  const pde = state.pde;
  const wind = state.wind;
  const voxelSize = material.volume.voxelSize;
  const dt = clampDt(pde.dt, voxelSize, pde.alpha);
  // Convert (yaw, elevation) once per frame — the shader consumes the vector
  // form, and all substeps within a frame share the same wind.
  const windDir = windDirVector(wind);

  let total = 0;
  const t0 = performance.now();

  if (pde.pendingSingleSteps > 0) {
    for (let i = 0; i < pde.pendingSingleSteps; i++) {
      material.runErodeStep(encoder, pde.alpha, dt, wind.beta, wind.noise, windDir);
    }
    total += pde.pendingSingleSteps;
  }

  if (pde.playing) {
    const stepsPerFrame = Math.max(1, Math.floor(pde.stepsPerFrame));
    for (let i = 0; i < stepsPerFrame; i++) {
      material.runErodeStep(encoder, pde.alpha, dt, wind.beta, wind.noise, windDir);
    }
    total += stepsPerFrame;
  }

  if (total === 0) return 0;
  const ms = performance.now() - t0;
  // Smooth the wall-time so the overlay doesn't flicker every frame.
  const smoothed = pde.lastStepMs === 0 ? ms : pde.lastStepMs + 0.2 * (ms - pde.lastStepMs);
  setPde({
    iterations: pde.iterations + total,
    lastStepMs: smoothed,
    pendingSingleSteps: 0,
  });
  return total;
}
