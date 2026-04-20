// Mesh renderer for the Marching Cubes output. The MC compute pass writes a
// vertex buffer (pos + normal, stride 32) and index buffer; this pipeline
// rasterizes them with Lambert shading, a procedural triplanar fbm for
// surface variation, and the shared wind-pressure tint so the mesh view
// stays visually consistent with the raymarch preview.
//
// Camera comes in as a pre-multiplied view × projection matrix so we don't
// have to invert the basis or rebuild a projection in the shader. `ro` is
// carried separately for view-dependent rim lighting.

struct MeshCamU {
  viewProj: mat4x4<f32>,
  ro: vec3<f32>,
  // Wireframe toggle: 0 = lit surface only, 1 = overlay triangle edges on the
  // lit shading. Reuses the trailing pad slot so the uniform buffer stays
  // 80 bytes. Float (not bool) so the fragment can mix fractionally without
  // branching, keeping dpdx/dpdy uniformity trivially valid.
  wireframe: f32,
};

// Matches WindU in raymarch.wgsl byte-for-byte so the same uniform buffer
// feeds both pipelines. dir · n → signed pressure (+1 windward, −1 leeward).
struct WindU {
  dir: vec3<f32>,
  viz: f32,
  noise: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> U: MeshCamU;
@group(0) @binding(1) var<uniform> W: WindU;

struct VsIn {
  @location(0) pos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  // MC emits triangle soup: each triangle's three vertices are at sequential
  // indices in both buffers, so `vertex_index % 3` recovers the per-corner ID
  // (0, 1, 2). That lets us synthesize barycentric coords without an extra
  // attribute — the shader-side corner ID interpolates to real bary in the
  // fragment stage exactly as a hand-authored `(1,0,0)/(0,1,0)/(0,0,1)`
  // attribute would.
  @builtin(vertex_index) vertIdx: u32,
};

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) bary: vec3<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = U.viewProj * vec4<f32>(in.pos, 1.0);
  out.worldPos = in.pos;
  out.normal = in.normal;
  let corner = in.vertIdx % 3u;
  out.bary = vec3<f32>(
    select(0.0, 1.0, corner == 0u),
    select(0.0, 1.0, corner == 1u),
    select(0.0, 1.0, corner == 2u),
  );
  return out;
}

// Scalar lattice hash. Low-quality but bandwidth-free — fine for a single fbm.
fn hash31(p: vec3<f32>) -> f32 {
  let h = dot(p, vec3<f32>(127.1, 311.7, 74.7));
  return fract(sin(h) * 43758.5453);
}

// Trilinear value noise with Perlin fade. Period-1 lattice in world units.
fn valueNoise(p: vec3<f32>) -> f32 {
  let pi = floor(p);
  let pf = fract(p);
  let w = pf * pf * (3.0 - 2.0 * pf);
  let c000 = hash31(pi);
  let c100 = hash31(pi + vec3<f32>(1.0, 0.0, 0.0));
  let c010 = hash31(pi + vec3<f32>(0.0, 1.0, 0.0));
  let c110 = hash31(pi + vec3<f32>(1.0, 1.0, 0.0));
  let c001 = hash31(pi + vec3<f32>(0.0, 0.0, 1.0));
  let c101 = hash31(pi + vec3<f32>(1.0, 0.0, 1.0));
  let c011 = hash31(pi + vec3<f32>(0.0, 1.0, 1.0));
  let c111 = hash31(pi + vec3<f32>(1.0, 1.0, 1.0));
  let x00 = mix(c000, c100, w.x);
  let x10 = mix(c010, c110, w.x);
  let x01 = mix(c001, c101, w.x);
  let x11 = mix(c011, c111, w.x);
  let y0 = mix(x00, x10, w.y);
  let y1 = mix(x01, x11, w.y);
  return mix(y0, y1, w.z);
}

// 3-octave fractional Brownian motion. Amplitude geometric halving, frequency
// geometric doubling (×2.05 to desync octave alignment and reduce banding).
fn fbm3(p: vec3<f32>) -> f32 {
  var f: f32 = 0.0;
  var a: f32 = 0.5;
  var q: vec3<f32> = p;
  for (var i: i32 = 0; i < 3; i = i + 1) {
    f = f + a * valueNoise(q);
    q = q * 2.05;
    a = a * 0.5;
  }
  return f;
}

// Per-axis slice of the volume, lifted to 3D. Using the full fbm3 on a (uv, 0)
// probe keeps the three slices stylistically identical without a separate 2D
// kernel. Frequency ×3 gives a rock-grain feel at the 2.4-extent volume.
fn stoneSlice(uv: vec2<f32>) -> f32 {
  return fbm3(vec3<f32>(uv, 0.0) * 3.0);
}

// Project world position onto the three cardinal planes, weighted by the
// surface normal raised to a high power so each face's texture only shows
// where that face genuinely dominates. 1e-5 in the denom keeps degenerate
// zero-normal pixels (shouldn't exist post-normalize but cheap insurance)
// from producing NaN.
fn triplanar(p: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let blend = pow(abs(n), vec3<f32>(4.0));
  let wsum = blend.x + blend.y + blend.z + 1e-5;
  let bw = blend / wsum;
  let cx = stoneSlice(p.yz);
  let cy = stoneSlice(p.zx);
  let cz = stoneSlice(p.xy);
  let g = cx * bw.x + cy * bw.y + cz * bw.z;
  // Remap [0,1] noise to a narrow stone-beige band so it reads as texture
  // variation, not a dominant color signal. Matches the raymarch albedo range.
  let low  = vec3<f32>(0.70, 0.56, 0.42);
  let high = vec3<f32>(0.84, 0.70, 0.54);
  return mix(low, high, g);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let viewDir = normalize(U.ro - in.worldPos);
  let lightDir = normalize(vec3<f32>(0.6, 0.8, 0.4));
  let ambient = vec3<f32>(0.18, 0.20, 0.24);
  let ndl = max(dot(n, lightDir), 0.0);
  let albedo = triplanar(in.worldPos, n);

  // Wind-pressure tint mirrors raymarch.wgsl line-for-line so toggling between
  // preview and mesh doesn't shift the color story. viz=0 suppresses overlay.
  let pressure = clamp(-dot(n, W.dir), -1.0, 1.0);
  let warm = vec3<f32>(0.95, 0.30, 0.22);
  let cool = vec3<f32>(0.22, 0.40, 0.95);
  let pColor = select(cool, warm, pressure > 0.0);
  let base = mix(albedo, pColor, W.viz * abs(pressure) * 0.6);

  let lit = base * (ambient + ndl * vec3<f32>(0.95, 0.92, 0.85));
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.22;
  let surface = lit + vec3<f32>(rim);

  // Triangle wireframe via distance-to-nearest-edge in barycentric space.
  // `fwidth` gives the per-pixel magnitude of bary's change, which we use as
  // the smoothstep width so the line thickness stays ≈1.5 pixels at any zoom
  // level. U.wireframe ∈ {0,1} gates the overlay without a branch.
  let e = min(in.bary.x, min(in.bary.y, in.bary.z));
  let aa = fwidth(e) * 1.5;
  let wire = 1.0 - smoothstep(0.0, aa, e);
  let wireColor = vec3<f32>(0.06, 0.06, 0.08);
  let final = mix(surface, wireColor, U.wireframe * wire);
  return vec4<f32>(final, 1.0);
}
