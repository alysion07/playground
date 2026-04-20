// Level-set evolution for the ψ scalar field. One dispatch performs one
// explicit-Euler substep of:
//   ∂ψ/∂t  =  −α · κ · |∇ψ|  −  β · dot(w(p), ∇ψ)
//
// First term is mean-curvature flow (smoothing / erosion of pointy bits).
// Second term is wind advection — β=0 disables it entirely, collapsing this
// kernel to the Week 2 curvature-only form. Both terms share the same seven
// central-difference samples, so combining them in one pass costs almost
// nothing versus running them as two separate dispatches.
//
// Curvature derivation (as in Week 2):
//   H = (½ · ∇²ψ) / |∇ψ|  → for a sphere of radius R, H = 1/R, giving
//   dR/dt = −α/R, i.e. R²(t) = R₀² − 2αt.
//
// Wind term: w(p) is a *base uniform direction* modulated by a procedural
// value-noise field, so the resulting direction varies gently across space.
// We keep this in-shader instead of a 3D texture — Week 3 decision — to
// avoid the ~24 MB of VRAM a per-voxel vec3 field would cost.
//
// Boundary handling: voxel coords clamp to [0, N-1], so finite differences on
// boundary voxels pull from the same voxel on both sides → ∇ψ = 0 there.
// This is a no-flux (Neumann-zero) boundary, appropriate since the volume
// bbox is sized to enclose the CSG with margin.
//
// CFL bound for explicit Euler on a 3D Laplacian: dt < h² / (3α). The wind
// term adds a smaller O(β·h) advection constraint which, in practice, is
// tighter only at very large β. The scheduler clamps dt to ½ × the curvature
// bound; when β is large users are advised to also drop α.

struct GeomU {
  originVoxel: vec4<f32>,
  sizeWord: vec4<u32>,
};

// 32 bytes total. Layout:
//   alpha, dt, beta, windNoise  — 16 bytes
//   windDir.xyz, _pad           — 16 bytes
struct ErodeU {
  alpha: f32,
  dt: f32,
  beta: f32,
  windNoise: f32,
  windDir: vec3<f32>,
  _pad0: f32,
};

@group(0) @binding(0) var<uniform> G: GeomU;
@group(0) @binding(1) var<uniform> E: ErodeU;
@group(0) @binding(2) var psi_in: texture_3d<f32>;
@group(0) @binding(3) var psi_out: texture_storage_3d<r32float, write>;

fn loadPsi(c: vec3<i32>) -> f32 {
  let n = i32(G.sizeWord.x);
  let cc = clamp(c, vec3<i32>(0), vec3<i32>(n - 1));
  return textureLoad(psi_in, cc, 0).r;
}

// Hash-based 3D value noise. Returns a float in [-1, 1] per input cell.
// Deterministic, cheap, no table lookup. Used only to jitter the wind
// direction — not the erosion rate — so moderate quality is fine.
fn hash31(p: vec3<f32>) -> f32 {
  let q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  let r = q + dot(q, q.yzx + vec3<f32>(33.33));
  return fract((r.x + r.y) * r.z) * 2.0 - 1.0;
}

fn valueNoise3(p: vec3<f32>) -> vec3<f32> {
  // Three independent hashes using spatial offsets; cheaper than sampling a
  // table three times. The offsets are arbitrary but non-aligned to avoid
  // correlated directions along the principal axes.
  return vec3<f32>(
    hash31(p),
    hash31(p + vec3<f32>(17.1, 5.3, 9.7)),
    hash31(p + vec3<f32>(3.9, 23.1, 11.4)),
  );
}

// Returns a (not necessarily unit) wind vector at world position p. Base is
// E.windDir; noise adds a per-voxel-scale jitter whose amplitude is E.windNoise.
// When E.windNoise == 0 this degenerates to a perfectly uniform field.
fn windFieldAt(p: vec3<f32>) -> vec3<f32> {
  let freq = 2.5;
  let jitter = valueNoise3(p * freq);
  return E.windDir + E.windNoise * jitter;
}

@compute @workgroup_size(4, 4, 4)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = G.sizeWord.x;
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let i = vec3<i32>(gid);
  let h = G.originVoxel.w;

  let c = loadPsi(i);
  let xp = loadPsi(i + vec3<i32>(1, 0, 0));
  let xm = loadPsi(i + vec3<i32>(-1, 0, 0));
  let yp = loadPsi(i + vec3<i32>(0, 1, 0));
  let ym = loadPsi(i + vec3<i32>(0, -1, 0));
  let zp = loadPsi(i + vec3<i32>(0, 0, 1));
  let zm = loadPsi(i + vec3<i32>(0, 0, -1));

  let inv2h = 0.5 / h;
  let gx = (xp - xm) * inv2h;
  let gy = (yp - ym) * inv2h;
  let gz = (zp - zm) * inv2h;
  let grad = vec3<f32>(gx, gy, gz);
  let gradMag = length(grad);

  let lap = (xp + xm + yp + ym + zp + zm - 6.0 * c) / (h * h);

  // Curvature-flow contribution.  max(gradMag, 1e-4) guards against flat
  // regions where H is formally undefined; in those regions there's no
  // surface to evolve anyway so the clamp is harmless.
  let H = (0.5 * lap) / max(gradMag, 1e-4);
  let curvatureTerm = E.alpha * H * gradMag;

  // Wind advection contribution. World position of this voxel's center is
  // used so the noise is consistent across frames (a function of space, not
  // index). advect = dot(w, ∇ψ); a single dispatch does centered differences
  // which are non-upwind, so large β without α is numerically oscillatory —
  // CFL clamp + the curvature term together keep it in check in practice.
  let worldPos = G.originVoxel.xyz + (vec3<f32>(gid) + vec3<f32>(0.5)) * h;
  let w = windFieldAt(worldPos);
  let advectTerm = E.beta * dot(w, grad);

  let next = c + E.dt * (curvatureTerm - advectTerm);

  textureStore(psi_out, i, vec4<f32>(next, 0.0, 0.0, 0.0));
}
