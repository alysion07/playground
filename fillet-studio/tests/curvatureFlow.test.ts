import { describe, it, expect } from 'vitest';
import { curvatureFlow } from '../src/core/curvatureFlow';
import { sampleSdf } from '../src/core/sample';
import { makePrim } from '../src/core/csg';
import type { Volume } from '../src/core/sample';

// Synthetic 2D-in-3D field: ψ = max(x, y). Interior (ψ<0) is the third quadrant
// with a sharp 90° convex corner at origin. Under mean-curvature flow this corner
// rounds out (interior retreats), so ψ at origin grows from 0 to a positive value
// proportional to the rounding radius.
function makeCornerVolume(N: number, extents: number): Volume {
  const voxelSize = (2 * extents) / (N - 1);
  const origin: [number, number, number] = [-extents, -extents, -extents];
  const data = new Float32Array(N * N * N);
  let p = 0;
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      const y = origin[1] + j * voxelSize;
      for (let i = 0; i < N; i++) {
        const x = origin[0] + i * voxelSize;
        data[p++] = Math.max(x, y);
      }
    }
  }
  return { N, extents, origin, voxelSize, data };
}

describe('curvatureFlow — shrinking sphere (closed-form check)', () => {
  // For an SDF of a sphere ψ = r − R₀, mean-curvature flow under our PDE
  // ∂ψ/∂t = α·κ·|∇ψ| = α·H·|∇ψ| gives dR/dt = −α·H = −α/R, i.e.
  //   R(t)² = R₀² − 2αt.
  // This is the cleanest analytical case to pin the flow rate.
  it('R(t)² ≈ R₀² − 2αt with R-cap disabled', () => {
    const N = 65;
    const extents = 1;
    const R0 = 0.6;
    const alpha = 0.5;
    // Target: shrink sphere from R₀=0.6 to R≈0.5. Need t = (R₀² − R²)/(2α) = (0.36 − 0.25)/1 = 0.11.
    // Encode this as "R-parameter" = √(2α·t) ≈ √0.11 ≈ 0.332. Flow runs for t* = 0.11.
    const Rparam = Math.sqrt(0.11);
    const vol = sampleSdf(makePrim('sphere', [R0]), N, extents);
    const { volume } = curvatureFlow(vol, { R: Rparam, alpha, capByR: false });
    // Measure post-flow sphere radius by scanning ψ along +x from origin until it crosses 0.
    const N_ = volume.N;
    const c = (N_ - 1) / 2;
    const h = volume.voxelSize;
    let crossed = -1;
    for (let i = Math.floor(c); i < N_ - 1; i++) {
      const p0 = volume.data[i + c * N_ + c * N_ * N_];
      const p1 = volume.data[i + 1 + c * N_ + c * N_ * N_];
      if (p0 <= 0 && p1 > 0) {
        // Linear interpolation.
        const frac = -p0 / (p1 - p0);
        crossed = (i - c + frac) * h;
        break;
      }
    }
    const expectedR = Math.sqrt(R0 * R0 - 2 * alpha * 0.11); // = 0.5
    expect(crossed).toBeGreaterThan(0);
    expect(crossed).toBeCloseTo(expectedR, 1); // within 0.05
    // Discretization bound: ~1.5h (voxel spacing ≈ 0.031 here).
    expect(Math.abs(crossed - expectedR)).toBeLessThan(2 * h);
  });
});

describe('curvatureFlow — sharp corner rounding (qualitative)', () => {
  const N = 65;
  const extents = 1;
  const alpha = 0.5;
  const c = (N - 1) / 2;
  const originIdx = c + c * N + c * N * N;

  it('ψ at origin grows from 0 to a positive value as the corner rounds', () => {
    const R = 0.25;
    const vol = makeCornerVolume(N, extents);
    expect(vol.data[originIdx]).toBe(0);
    const { volume } = curvatureFlow(vol, { R, alpha, capByR: true });
    expect(volume.data[originIdx]).toBeGreaterThan(0);
  });

  it('larger R produces larger ψ at origin (monotonicity)', () => {
    const volSmall = makeCornerVolume(N, extents);
    const volLarge = makeCornerVolume(N, extents);
    const rSmall = curvatureFlow(volSmall, { R: 0.1, alpha, capByR: true });
    const rLarge = curvatureFlow(volLarge, { R: 0.25, alpha, capByR: true });
    expect(rSmall.volume.data[originIdx]).toBeGreaterThan(0);
    expect(rLarge.volume.data[originIdx]).toBeGreaterThan(rSmall.volume.data[originIdx]);
  });

  it('iterations M grows with R² (with ceiling discretization noise)', () => {
    const vol = makeCornerVolume(33, 1);
    const r1 = curvatureFlow(vol, { R: 0.2, alpha: 0.5, capByR: true });
    const r2 = curvatureFlow(vol, { R: 0.4, alpha: 0.5, capByR: true });
    // (0.4/0.2)² = 4. Allow ±15% for ceil() rounding.
    expect(r2.iterations / r1.iterations).toBeGreaterThan(3.4);
    expect(r2.iterations / r1.iterations).toBeLessThan(4.6);
  });

  it('flat ramp ψ = x stays within numerical noise (no curvature → no flow)', () => {
    const smallN = 33;
    const ext = 1;
    const h = (2 * ext) / (smallN - 1);
    const data = new Float32Array(smallN * smallN * smallN);
    let p = 0;
    for (let k = 0; k < smallN; k++)
      for (let j = 0; j < smallN; j++)
        for (let i = 0; i < smallN; i++) data[p++] = -ext + i * h;
    const vol: Volume = {
      N: smallN,
      extents: ext,
      voxelSize: h,
      origin: [-ext, -ext, -ext],
      data,
    };
    const { volume } = curvatureFlow(vol, { R: 0.2, alpha: 0.5, capByR: true });
    const cc = (smallN - 1) / 2;
    const iIdx = cc + cc * smallN + cc * smallN * smallN;
    expect(Math.abs(volume.data[iIdx] - 0)).toBeLessThan(1e-3);
  });
});
