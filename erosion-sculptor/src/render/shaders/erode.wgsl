// Mean-curvature flow on the ψ scalar field. One dispatch performs one
// explicit-Euler substep:  ψ_new(x) = ψ(x) + α · dt · H · |∇ψ|
// where H = (½ · ∇²ψ) / |∇ψ|  is the mean curvature in the level-set sense
// (sphere of radius R has H = 1/R, giving dR/dt = −α/R and R²(t) = R₀² − 2αt).
//
// Boundary handling: voxel coords are clamped to [0, N-1], so finite differences
// on a boundary voxel pull from the same voxel on both sides → ∇ψ = 0 there.
// This is a no-flux (Neumann-zero) boundary, which is appropriate since the
// volume bbox is sized to enclose the CSG with margin.
//
// CFL bound for explicit Euler on a 3D Laplacian:  dt < h² / (3α).
// The scheduler clamps dt to ½ × this bound for safety.

struct GeomU {
  originVoxel: vec4<f32>,
  sizeWord: vec4<u32>,
};

struct ErodeU {
  alpha: f32,
  dt: f32,
  _pad0: f32,
  _pad1: f32,
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
  let gradMag = sqrt(gx * gx + gy * gy + gz * gz);

  let lap = (xp + xm + yp + ym + zp + zm - 6.0 * c) / (h * h);

  // H = ½ · ∇²ψ / |∇ψ|  is mean curvature in the level-set form (Osher-Sethian).
  // Using max(gradMag, 1e-4) guards against the degenerate case where ψ is
  // locally flat; in that region there is no surface to evolve anyway.
  let H = (0.5 * lap) / max(gradMag, 1e-4);
  let next = c + E.alpha * E.dt * H * gradMag;

  textureStore(psi_out, i, vec4<f32>(next, 0.0, 0.0, 0.0));
}
