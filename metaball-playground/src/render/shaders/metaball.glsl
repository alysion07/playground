precision highp float;

// MAX_BLOBS is injected via ShaderMaterial.defines.
#ifndef MAX_BLOBS
#define MAX_BLOBS 32
#endif

uniform vec2 uResolution;
uniform int uCount;
uniform float uK;
uniform float uAA;
uniform float uColorSoftness;
uniform vec3 uBackground;
uniform float uBloom;
uniform float uVignette;
uniform float uRim;
// xy = position in world units, z = radius, w = unused.
uniform vec4 uBlobsXYZR[MAX_BLOBS];
uniform vec3 uColors[MAX_BLOBS];

varying vec2 vNdc;

float sdCircle(vec2 p, vec2 c, float r) {
  return length(p - c) - r;
}

float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

void main() {
  // World-space p: NDC.x scaled by aspect so x unit = y unit.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2(vNdc.x * aspect * 0.5, vNdc.y * 0.5);

  float d = 1e9;
  vec3 cAcc = vec3(0.0);
  float wAcc = 0.0;

  int count = uCount;
  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= count) break;
    vec4 b = uBlobsXYZR[i];
    float di = sdCircle(p, b.xy, b.z);
    d = smin(d, di, uK);
    float w = exp(-max(di, 0.0) * uColorSoftness);
    cAcc += uColors[i] * w;
    wAcc += w;
  }

  vec3 blobColor = (wAcc > 1e-5) ? (cAcc / wAcc) : uBackground;

  // Fake normal from gradient for rim lighting — we cheat and use screen-space
  // distance derivative magnitude. For SDF this would be ∇d; here we approximate
  // using dFdx/dFdy via smoothstep falloff on d itself.
  float aaPx = max(uAA, 0.0001);
  float aaWorld = aaPx * (1.0 / max(uResolution.y, 1.0));
  float inside = 1.0 - smoothstep(0.0, aaWorld, d);

  // Rim: brighten where |d| is near zero but on the inside half.
  float rimBand = exp(-pow(d / (aaWorld * 6.0), 2.0));
  vec3 rim = vec3(1.0) * rimBand * uRim * inside;

  // Fake bloom: extra glow outside the mask, falling off with distance.
  float glow = exp(-max(d, 0.0) * (40.0 / max(uBloom * 2.0 + 0.2, 0.01)));
  vec3 bloom = blobColor * glow * uBloom * (1.0 - inside);

  // Background + blob core + rim + bloom.
  vec3 col = mix(uBackground, blobColor + rim, inside) + bloom;

  // Vignette based on NDC distance from center.
  float vig = 1.0 - uVignette * smoothstep(0.6, 1.4, length(vNdc));
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}
