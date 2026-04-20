import { describe, it, expect } from 'vitest';

// CPU reference for src/render/shaders/erode.wgsl. Mirrors the WGSL formula
// line-for-line: clamp-to-edge boundaries, central-difference ∇ψ, six-point
// Laplacian, H = ½·∇²ψ / max(|∇ψ|, 1e-4), ψ_new = ψ + α·dt·H·|∇ψ|.
//
// Verifying the same math on the same sample data (without a real GPU) gives
// us confidence that the WGSL kernel implements mean-curvature flow correctly:
// for a sphere of radius R, this should produce R²(t) = R₀² − 2αt.

function makeIdx(N: number) {
  return (x: number, y: number, z: number): number => {
    const cx = Math.max(0, Math.min(N - 1, x));
    const cy = Math.max(0, Math.min(N - 1, y));
    const cz = Math.max(0, Math.min(N - 1, z));
    return cx + cy * N + cz * N * N;
  };
}

function bakeSphere(N: number, h: number, origin: number, R: number): Float32Array {
  const psi = new Float32Array(N * N * N);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = origin + (x + 0.5) * h;
        const py = origin + (y + 0.5) * h;
        const pz = origin + (z + 0.5) * h;
        psi[x + y * N + z * N * N] = Math.sqrt(px * px + py * py + pz * pz) - R;
      }
    }
  }
  return psi;
}

function erodeStepCPU(
  psi: Float32Array,
  N: number,
  h: number,
  alpha: number,
  dt: number,
): Float32Array {
  const next = new Float32Array(psi.length);
  const at = makeIdx(N);
  const inv2h = 0.5 / h;
  const invH2 = 1 / (h * h);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = psi[at(x, y, z)];
        const xp = psi[at(x + 1, y, z)];
        const xm = psi[at(x - 1, y, z)];
        const yp = psi[at(x, y + 1, z)];
        const ym = psi[at(x, y - 1, z)];
        const zp = psi[at(x, y, z + 1)];
        const zm = psi[at(x, y, z - 1)];
        const gx = (xp - xm) * inv2h;
        const gy = (yp - ym) * inv2h;
        const gz = (zp - zm) * inv2h;
        const gradMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
        const lap = (xp + xm + yp + ym + zp + zm - 6 * c) * invH2;
        const H = (0.5 * lap) / Math.max(gradMag, 1e-4);
        next[at(x, y, z)] = c + alpha * dt * H * gradMag;
      }
    }
  }
  return next;
}

// Find the radius along +x axis by locating where ψ(x, N/2, N/2) crosses zero,
// then linearly interpolating between the two straddling voxels.
function measureRadiusPlusX(psi: Float32Array, N: number, origin: number, h: number): number {
  const yc = N >> 1;
  const zc = N >> 1;
  const at = (x: number) => psi[x + yc * N + zc * N * N];
  for (let x = 0; x < N - 1; x++) {
    const a = at(x);
    const b = at(x + 1);
    if (a < 0 && b >= 0) {
      const t = -a / (b - a);
      return origin + (x + 0.5 + t) * h;
    }
  }
  return Number.NaN;
}

describe('curvature-flow erode kernel (CPU reference)', () => {
  it('shrinks a sphere following R²(t) = R₀² − 2αt', () => {
    // 96³ grid gives h ≈ 0.025 — enough resolution to measure ~6 voxels of
    // shrinkage and stay below the discretization noise floor.
    const N = 96;
    const extents = 2.4;
    const h = extents / N;
    const origin = -extents / 2;
    const R0 = 0.6;
    const alpha = 0.5;
    // dt safely below CFL bound h²/(3α). Half the bound is the scheduler's
    // policy; the test mirrors it.
    const dtMax = (h * h) / (3 * alpha);
    const dt = 0.5 * dtMax;
    const steps = 600;

    let psi = bakeSphere(N, h, origin, R0);
    const R0meas = measureRadiusPlusX(psi, N, origin, h);
    expect(R0meas).toBeCloseTo(R0, 2);

    for (let s = 0; s < steps; s++) {
      psi = erodeStepCPU(psi, N, h, alpha, dt);
    }

    const tTotal = steps * dt;
    const Rexpected = Math.sqrt(R0 * R0 - 2 * alpha * tTotal);
    const Rmeasured = measureRadiusPlusX(psi, N, origin, h);

    // The discrete six-point Laplacian slightly *over*-estimates curvature on
    // a coarse grid, so the simulated radius shrinks a touch faster than the
    // analytic limit. Allow ~1 voxel of slop (h ≈ 0.025) — empirically the
    // CPU run is within 0.65·h of the analytic radius. Larger N tightens this
    // but slows the test linearly in N³.
    expect(Math.abs(Rmeasured - Rexpected)).toBeLessThan(1.0 * h);
    // Sanity: surface actually moved inward by several voxels.
    expect(R0 - Rmeasured).toBeGreaterThan(4 * h);
  });

  it('refuses to advance past the singularity (sphere fully erodes to zero)', () => {
    // Once R² < 2αt the analytic radius is undefined; the discrete simulation
    // should converge toward an empty volume rather than producing NaNs or
    // negative blowups.
    const N = 48;
    const extents = 2.4;
    const h = extents / N;
    const origin = -extents / 2;
    const R0 = 0.3;
    const alpha = 1.0;
    const dt = 0.4 * (h * h) / (3 * alpha);
    const steps = 1500;

    let psi = bakeSphere(N, h, origin, R0);
    for (let s = 0; s < steps; s++) {
      psi = erodeStepCPU(psi, N, h, alpha, dt);
    }
    // No NaN escape, no extreme negative values.
    let nans = 0;
    let minVal = Infinity;
    for (const v of psi) {
      if (Number.isNaN(v)) nans++;
      if (v < minVal) minVal = v;
    }
    expect(nans).toBe(0);
    expect(minVal).toBeGreaterThan(-1);
  });
});
