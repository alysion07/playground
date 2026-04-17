// Week 1: hardcoded 3 blobs. Storage-buffer driven blobs land in Week 2.
// This file is the reference WGSL port of metaball.glsl. It is used by the
// WebGPU NodeMaterial path via wgslFn (see render/material.ts).

fn sdCircle(p: vec2<f32>, c: vec2<f32>, r: f32) -> f32 {
  return length(p - c) - r;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

fn metaballColor(resolution: vec2<f32>, time: f32, fragCoord: vec2<f32>, k: f32, aa: f32) -> vec4<f32> {
  let uv = fragCoord / resolution;
  let aspect = resolution.x / max(resolution.y, 1.0);
  let p = (uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);

  let t = time * 0.001;
  let c0 = vec2<f32>(-0.22 + 0.05 * sin(t * 0.9), 0.02 + 0.04 * cos(t * 1.1));
  let c1 = vec2<f32>( 0.22 + 0.05 * cos(t * 0.7), 0.10 + 0.04 * sin(t * 1.3));
  let c2 = vec2<f32>( 0.00 + 0.08 * sin(t * 0.5), -0.18 + 0.03 * cos(t * 0.9));
  let r0: f32 = 0.14;
  let r1: f32 = 0.16;
  let r2: f32 = 0.12;

  let col0 = vec3<f32>(1.00, 0.35, 0.20);
  let col1 = vec3<f32>(0.20, 0.70, 1.00);
  let col2 = vec3<f32>(0.95, 0.90, 0.30);

  let d0 = sdCircle(p, c0, r0);
  let d1 = sdCircle(p, c1, r1);
  let d2 = sdCircle(p, c2, r2);

  let d = smin(smin(d0, d1, k), d2, k);

  let softness: f32 = 20.0;
  let w0 = exp(-max(d0, 0.0) * softness);
  let w1 = exp(-max(d1, 0.0) * softness);
  let w2 = exp(-max(d2, 0.0) * softness);
  let wSum = w0 + w1 + w2;
  var color = vec3<f32>(0.05);
  if (wSum > 1e-5) {
    color = (col0 * w0 + col1 * w1 + col2 * w2) / wSum;
  }

  let mask = 1.0 - smoothstep(0.0, aa, d);
  let bg = vec3<f32>(0.03, 0.03, 0.05);
  let outCol = mix(bg, color, mask);

  return vec4<f32>(outCol, 1.0);
}
