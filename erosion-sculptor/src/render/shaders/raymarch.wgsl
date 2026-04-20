// Raymarch reads the baked ψ scalar field from a 3D r32float texture.
// Manual trilinear interpolation via `textureLoad` avoids the
// `float32-filterable` device feature dependency. ψ is a true SDF on the
// volume's domain — sphere tracing converges using ψ as the step size.
//
// Outside the volume bbox we fall back to distance-to-bbox (a valid lower
// bound on distance-to-surface as long as the CSG is contained), which lets
// the marcher take big steps in empty space and only sample the texture once
// the ray enters the bbox.

// Raymarch loops contain early-`break` exits, which the WGSL uniformity
// analyzer treats as non-uniform control flow. That makes downstream `dpdx`/
// `dpdy` calls (used by the wireframe edge detector) invalid by the spec's
// strict reading. In practice every pixel in a 2x2 quad takes the same
// number of steps for a smooth SDF, so derivatives are well-defined; we
// silence the diagnostic rather than restructure the marcher.
diagnostic(off, derivative_uniformity);

struct CamU {
  resolution: vec2<f32>,
  stepBudget: f32,
  wireframe: f32,
  ro: vec3<f32>,
  _pad1: f32,
  forward: vec3<f32>,
  _pad2: f32,
  right: vec3<f32>,
  _pad3: f32,
  up: vec3<f32>,
  _pad4: f32,
};

struct GeomU {
  // xyz = world position of the lower-corner voxel boundary.
  // w   = voxelSize = extents / N.
  originVoxel: vec4<f32>,
  // x = grid resolution N. yzw padding.
  sizeWord: vec4<u32>,
};

@group(0) @binding(0) var<uniform> U: CamU;
@group(0) @binding(1) var<uniform> G: GeomU;
@group(0) @binding(2) var psi: texture_3d<f32>;

fn loadPsi(c: vec3<i32>) -> f32 {
  let n = i32(G.sizeWord.x);
  let cc = clamp(c, vec3<i32>(0), vec3<i32>(n - 1));
  return textureLoad(psi, cc, 0).r;
}

fn bboxSDF(p: vec3<f32>) -> f32 {
  let extents = G.originVoxel.w * f32(G.sizeWord.x);
  let half = extents * 0.5;
  let q = abs(p) - vec3<f32>(half);
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn psiSample(p: vec3<f32>) -> f32 {
  let outside = bboxSDF(p);
  if (outside > 0.0) {
    // Bias by one voxelSize so the marcher's hit threshold (eps ≈ 0.4 ×
    // voxelSize) never mistakes the bbox face for a real surface. The actual
    // SDF surface is at least (half_extents − maxRadius) inside the bbox, and
    // primitives are clamped well within the 2.4-extent volume, so this bias
    // remains a strict lower bound on distance-to-surface.
    return outside + G.originVoxel.w;
  }
  // Map world → continuous voxel coords centered at voxel midpoints.
  let voxel = (p - G.originVoxel.xyz) / G.originVoxel.w - vec3<f32>(0.5);
  let i0 = vec3<i32>(i32(floor(voxel.x)), i32(floor(voxel.y)), i32(floor(voxel.z)));
  let f = voxel - vec3<f32>(f32(i0.x), f32(i0.y), f32(i0.z));
  let c000 = loadPsi(i0 + vec3<i32>(0, 0, 0));
  let c100 = loadPsi(i0 + vec3<i32>(1, 0, 0));
  let c010 = loadPsi(i0 + vec3<i32>(0, 1, 0));
  let c110 = loadPsi(i0 + vec3<i32>(1, 1, 0));
  let c001 = loadPsi(i0 + vec3<i32>(0, 0, 1));
  let c101 = loadPsi(i0 + vec3<i32>(1, 0, 1));
  let c011 = loadPsi(i0 + vec3<i32>(0, 1, 1));
  let c111 = loadPsi(i0 + vec3<i32>(1, 1, 1));
  let cx00 = mix(c000, c100, f.x);
  let cx10 = mix(c010, c110, f.x);
  let cx01 = mix(c001, c101, f.x);
  let cx11 = mix(c011, c111, f.x);
  let cxy0 = mix(cx00, cx10, f.y);
  let cxy1 = mix(cx01, cx11, f.y);
  return mix(cxy0, cxy1, f.z);
}

fn estimateNormal(p: vec3<f32>) -> vec3<f32> {
  // Use voxel size as the differentiation step — matches the natural Nyquist
  // limit of the sampled field, suppresses high-frequency noise from trilinear
  // boundaries. Multiply by 0.7 to land slightly inside one voxel of resolution.
  let h: f32 = max(G.originVoxel.w * 0.7, 0.001);
  let dx = psiSample(p + vec3<f32>(h, 0.0, 0.0)) - psiSample(p - vec3<f32>(h, 0.0, 0.0));
  let dy = psiSample(p + vec3<f32>(0.0, h, 0.0)) - psiSample(p - vec3<f32>(0.0, h, 0.0));
  let dz = psiSample(p + vec3<f32>(0.0, 0.0, h)) - psiSample(p - vec3<f32>(0.0, 0.0, h));
  return normalize(vec3<f32>(dx, dy, dz));
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vidx: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out: VsOut;
  let p = positions[vidx];
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.ndc = p;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let aspect = U.resolution.x / max(U.resolution.y, 1.0);
  let uv = vec2<f32>(in.ndc.x * aspect, in.ndc.y);
  let rd = normalize(U.right * uv.x + U.up * uv.y + U.forward * 2.15);
  let ro = U.ro;

  // Hit threshold is roughly half a voxel so we don't oversearch a sub-texel
  // region that the trilinear interpolation can't resolve anyway.
  let eps: f32 = max(G.originVoxel.w * 0.4, 0.001);

  let maxSteps: i32 = i32(clamp(U.stepBudget, 16.0, 256.0));
  var t: f32 = 0.0;
  var hit: bool = false;
  var p: vec3<f32> = ro;
  for (var i: i32 = 0; i < maxSteps; i = i + 1) {
    p = ro + rd * t;
    let d = psiSample(p);
    if (d < eps) { hit = true; break; }
    t = t + max(d * 0.92, eps);
    if (t > 30.0) { break; }
  }

  let n = select(vec3<f32>(0.0, 1.0, 0.0), estimateNormal(p), hit);
  let hitF: f32 = select(0.0, 1.0, hit);

  if (U.wireframe > 0.5) {
    let edgeHit = abs(dpdx(hitF)) + abs(dpdy(hitF));
    var edgeNormal: f32 = 0.0;
    if (hit) {
      edgeNormal = length(dpdx(n)) + length(dpdy(n));
    }
    let edge = clamp(max(edgeHit * 6.0, edgeNormal * 1.8), 0.0, 1.0);
    let bg = vec3<f32>(0.97, 0.96, 0.94);
    let line = vec3<f32>(0.10, 0.10, 0.12);
    return vec4<f32>(mix(bg, line, edge), 1.0);
  }

  if (!hit) {
    let g = clamp(0.5 + 0.5 * rd.y, 0.0, 1.0);
    let bgTop = vec3<f32>(0.74, 0.78, 0.86);
    let bgBot = vec3<f32>(0.96, 0.92, 0.84);
    return vec4<f32>(mix(bgBot, bgTop, g), 1.0);
  }

  let lightDir = normalize(vec3<f32>(0.6, 0.8, 0.4));
  let ndl = max(dot(n, lightDir), 0.0);
  let ambient = vec3<f32>(0.18, 0.20, 0.24);
  let base = vec3<f32>(0.78, 0.62, 0.48) + 0.08 * (n * 0.5 + 0.5);
  let lit = base * (ambient + ndl * vec3<f32>(0.95, 0.92, 0.85));
  let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.25;
  return vec4<f32>(lit + vec3<f32>(rim), 1.0);
}
