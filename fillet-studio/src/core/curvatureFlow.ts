import type { Volume } from './sample';

export type FlowParams = {
  // Target fillet radius. The PDE runs until t* = R²/(2α), after which the
  // per-voxel R-cap freezes regions whose local radius of curvature has reached R.
  R: number;
  // Flow strength. Larger α → faster evolution but stricter CFL (smaller dt).
  alpha: number;
  // Enable per-voxel R-cap. When |κ| drops to 1/R, local updates freeze so the
  // solution stabilizes exactly at a fillet radius R rather than over-smoothing.
  capByR: boolean;
  // Optional progress callback (step count, total steps).
  onProgress?: (step: number, total: number) => void;
};

export type FlowResult = {
  volume: Volume;
  iterations: number;
  dt: number;
};

// Mean-curvature flow via explicit Euler on a ψ volume.
//
// Sign convention: ψ<0 inside the solid, ψ>0 outside. Under this convention,
// a convex edge of the solid has positive ∇²ψ locally, and the update
// ψ ← ψ + α·dt·κ·|∇ψ| with κ = ½·∇²ψ/|∇ψ| increases ψ at the edge, causing
// the 0-level set to retract into the solid — i.e., the sharp edge rounds off.
//
// For SDFs (|∇ψ|≈1) this simplifies to the heat equation ψ ← ψ + (α/2)·dt·∇²ψ,
// and the radius of the rounded arc grows as r(t) = √(2αt). At t* = R²/(2α),
// r = R and the R-cap halts further smoothing locally.
//
// Boundary handling: Neumann-zero (copy nearest interior layer after each step)
// so ψ on the cube faces tracks the interior — the bbox acts as an infinite
// extension of the last interior slab.
export function curvatureFlow(vol: Volume, params: FlowParams): FlowResult {
  const { N, voxelSize } = vol;
  const { R, alpha } = params;
  const h = voxelSize;
  // Stability for 3D explicit heat equation with effective diffusion D=α/2:
  //   dt ≤ h²/(6D) = h²/(3α). Use 0.9× safety.
  const dt = (0.9 * h * h) / (3 * alpha);
  const tStar = (R * R) / (2 * alpha);
  const M = Math.max(1, Math.ceil(tStar / dt));
  // When capping is enabled, skip updates whose local |κ| has fallen below 1/R
  // (radius of curvature ≥ R). When disabled, use 0 so the check never fires.
  const invR = params.capByR ? 1 / R : 0;

  let src = new Float32Array(vol.data);
  let dst = new Float32Array(src.length);

  const stride = N;
  const stride2 = N * N;
  const inv2h = 1 / (2 * h);
  const invH2 = 1 / (h * h);
  const scale = alpha * dt;

  for (let step = 0; step < M; step++) {
    // Copy everything first so boundary voxels default to their current value.
    dst.set(src);
    for (let k = 1; k < N - 1; k++) {
      for (let j = 1; j < N - 1; j++) {
        const rowBase = j * stride + k * stride2;
        for (let i = 1; i < N - 1; i++) {
          const p = i + rowBase;
          const c = src[p];
          const xp = src[p + 1];
          const xm = src[p - 1];
          const yp = src[p + stride];
          const ym = src[p - stride];
          const zp = src[p + stride2];
          const zm = src[p - stride2];
          const gx = (xp - xm) * inv2h;
          const gy = (yp - ym) * inv2h;
          const gz = (zp - zm) * inv2h;
          const gmag = Math.sqrt(gx * gx + gy * gy + gz * gz + 1e-12);
          const lap = (xp + xm + yp + ym + zp + zm - 6 * c) * invH2;
          // Mean curvature: κ = ½·∇²ψ / |∇ψ|
          const kappa = (0.5 * lap) / gmag;
          // R-cap: when |κ| < 1/R the local radius of curvature has reached R
          // (or exceeded it); freeze to prevent overshoot past the target fillet.
          if (Math.abs(kappa) < invR) {
            // keep src[p]; already copied via dst.set(src)
            continue;
          }
          // ∂ψ/∂t = α·κ·|∇ψ|
          dst[p] = c + scale * kappa * gmag;
        }
      }
    }
    // Neumann-zero: replicate interior slab onto boundary faces.
    copyNeumannBoundary(dst, N);
    const tmp = src;
    src = dst;
    dst = tmp;
    params.onProgress?.(step + 1, M);
  }

  return {
    volume: { ...vol, data: src },
    iterations: M,
    dt,
  };
}

function copyNeumannBoundary(arr: Float32Array, N: number): void {
  const stride = N;
  const stride2 = N * N;
  // x faces (i = 0 and i = N−1)
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      const base = j * stride + k * stride2;
      arr[base] = arr[1 + base];
      arr[N - 1 + base] = arr[N - 2 + base];
    }
  }
  // y faces (j = 0 and j = N−1)
  for (let k = 0; k < N; k++) {
    const kBase = k * stride2;
    for (let i = 0; i < N; i++) {
      arr[i + kBase] = arr[i + stride + kBase];
      arr[i + (N - 1) * stride + kBase] = arr[i + (N - 2) * stride + kBase];
    }
  }
  // z faces (k = 0 and k = N−1)
  for (let j = 0; j < N; j++) {
    const jBase = j * stride;
    for (let i = 0; i < N; i++) {
      arr[i + jBase] = arr[i + jBase + stride2];
      arr[i + jBase + (N - 1) * stride2] = arr[i + jBase + (N - 2) * stride2];
    }
  }
}
