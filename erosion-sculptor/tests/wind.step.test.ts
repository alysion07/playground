import { describe, it, expect } from 'vitest';

// CPU reference for the wind-advection term added to erode.wgsl in Step 2.
// Mirrors the WGSL line-for-line:
//   ∂ψ/∂t = −α · (½·∇²ψ / max(|∇ψ|, 1e-4)) · |∇ψ|  −  β · dot(w(p), ∇ψ)
// Clamp-to-edge boundaries. Wind noise is disabled in the reference kernel
// (pass noise=0) so the advection direction is exactly w — value-noise
// hashing isn't part of the physics check, only a spatial decoration on
// the GPU side.
//
// Three regression checks:
//   1. β = 0 → output bit-exact matches the pure-curvature kernel from
//      erode.step.test.ts. Guarantees the Week 2 behavior is untouched.
//   2. α = 0, β > 0, uniform w = +x → a blob's zero-crossing translates
//      along +x by β·t, unchanged in shape (pure translation under linear
//      advection of a signed-distance field).
//   3. α > 0, β > 0, w = +x → windward (+x) radius shrinks faster than
//      leeward (−x) radius. Direction-dependent asymmetry is the whole
//      point of the Week 3 wind term.

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

function erodeCurvatureStepCPU(
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

function erodeWindStepCPU(
  psi: Float32Array,
  N: number,
  h: number,
  alpha: number,
  beta: number,
  dt: number,
  wx: number,
  wy: number,
  wz: number,
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
        const curvature = alpha * H * gradMag;
        const advect = beta * (gx * wx + gy * wy + gz * wz);
        next[at(x, y, z)] = c + dt * (curvature - advect);
      }
    }
  }
  return next;
}

function measureRadiusAxis(
  psi: Float32Array,
  N: number,
  origin: number,
  h: number,
  axis: 'x' | 'y' | 'z',
  sign: 1 | -1,
): number {
  const mid = N >> 1;
  const sample = (i: number): number => {
    // Walk outward from the center along the chosen axis. `i` ∈ [0, N/2).
    const step = sign === 1 ? mid + i : mid - 1 - i;
    if (axis === 'x') return psi[step + mid * N + mid * N * N];
    if (axis === 'y') return psi[mid + step * N + mid * N * N];
    return psi[mid + mid * N + step * N * N];
  };
  for (let i = 0; i < N / 2 - 1; i++) {
    const a = sample(i);
    const b = sample(i + 1);
    if (a < 0 && b >= 0) {
      const t = -a / (b - a);
      const r = (i + 0.5 + t) * h;
      return r;
    }
  }
  return Number.NaN;
}

describe('wind-advection erode kernel (CPU reference)', () => {
  it('β=0 recovers the curvature-only result bit-exact', () => {
    // Small N keeps the test fast; the equivalence we're checking is
    // arithmetic, not physical.
    const N = 32;
    const extents = 2.4;
    const h = extents / N;
    const origin = -extents / 2;
    const R0 = 0.6;
    const alpha = 0.4;
    const dt = 0.4 * (h * h) / (3 * alpha);

    const base = bakeSphere(N, h, origin, R0);
    const curvatureOnly = erodeCurvatureStepCPU(base, N, h, alpha, dt);
    const windZero = erodeWindStepCPU(base, N, h, alpha, 0, dt, 1, 0, 0);

    for (let i = 0; i < base.length; i++) {
      // The two kernels share the clamp constants and arithmetic; with β=0
      // the advect branch reduces to (c + dt*curvature), which is the same
      // formula and same evaluation order as the curvature-only kernel.
      // Expect exact bit equality.
      expect(windZero[i]).toBe(curvatureOnly[i]);
    }
  });

  it('α=0, uniform wind → blob translates by β·t along the wind direction', () => {
    const N = 64;
    const extents = 2.4;
    const h = extents / N;
    const origin = -extents / 2;
    const R0 = 0.5;
    const alpha = 0;
    const beta = 0.3;
    const dt = 0.5 * h; // Advection CFL-ish: dt·β ≲ h keeps shifts within a voxel.
    const steps = 40;

    let psi = bakeSphere(N, h, origin, R0);
    const R_plus_before = measureRadiusAxis(psi, N, origin, h, 'x', 1);

    for (let s = 0; s < steps; s++) {
      psi = erodeWindStepCPU(psi, N, h, alpha, beta, dt, 1, 0, 0);
    }

    const R_plus_after = measureRadiusAxis(psi, N, origin, h, 'x', 1);
    const R_minus_after = measureRadiusAxis(psi, N, origin, h, 'x', -1);

    // For a pure linear advection of ψ with velocity +β·w, the sphere
    // translates by β·t·wx along +x. The windward radius (measured from
    // the original origin to the +x crossing) grows by that amount; the
    // leeward radius (toward −x) shrinks by the same amount. Total width
    // (R+ + R−) stays equal to 2·R₀ within discretization noise.
    const shift = beta * dt * steps;
    expect(R_plus_after - R_plus_before).toBeGreaterThan(shift - 2 * h);
    expect(R_plus_after - R_plus_before).toBeLessThan(shift + 2 * h);
    // Total diameter conservation — the field doesn't diffuse (α=0).
    expect(Math.abs(R_plus_after + R_minus_after - 2 * R0)).toBeLessThan(2 * h);
  });

  it('α>0, β>0 → windward side erodes faster than leeward side', () => {
    // Same discretization as the curvature test in erode.step.test.ts.
    const N = 64;
    const extents = 2.4;
    const h = extents / N;
    const origin = -extents / 2;
    const R0 = 0.6;
    const alpha = 0.4;
    const beta = 0.3;
    const dt = 0.4 * (h * h) / (3 * alpha);
    const steps = 400;

    let psi = bakeSphere(N, h, origin, R0);
    for (let s = 0; s < steps; s++) {
      psi = erodeWindStepCPU(psi, N, h, alpha, beta, dt, 1, 0, 0);
    }

    const R_leeward = measureRadiusAxis(psi, N, origin, h, 'x', 1);
    const R_windward = measureRadiusAxis(psi, N, origin, h, 'x', -1);

    // With w = +x̂, the entire level set transports in +x. The +x face
    // (leeward, sheltered — downwind of the blob) gets pushed *outward* by
    // the wind, partially cancelling the inward curvature motion. The −x
    // face (windward — where wind first strikes) sees both the curvature
    // pull and the wind pulling the blob *away from it*, so its distance
    // to the origin shrinks faster. Net: R_windward < R_leeward, with a
    // gap of O(β·t).
    expect(R_windward).toBeLessThan(R_leeward);
    // Asymmetry should be comfortably above discretization noise.
    expect(R_leeward - R_windward).toBeGreaterThan(2 * h);
  });
});
