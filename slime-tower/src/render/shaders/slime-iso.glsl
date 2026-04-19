precision highp float;

#ifndef MAX_SLIMES
#define MAX_SLIMES 24
#endif
#ifndef MAX_RIPPLES
#define MAX_RIPPLES 12
#endif

// Strand lifetime — keep in sync with physics3d.ts STRAND_LIFE_SEC.
#define STRAND_LIFE 0.35
// Ripple params — keep in sync with effects.ts RIPPLE_LIFE_SEC.
#define RIPPLE_LIFE 1.0
#define RIPPLE_SPEED 0.9

uniform vec2 uResolution;
uniform int uCount;
uniform float uMergeK;
uniform int uStepBudget;

// Camera basis (orthographic iso).
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform vec3 uCamCenter;
uniform float uOrthoHalfH;
uniform float uRayPushback;

// Slime data: xyz = center, w = unused. radii.xyz = per-axis radii.
uniform vec4 uSlimePos[MAX_SLIMES];
uniform vec4 uSlimeRadii[MAX_SLIMES];
uniform vec3 uSlimeColor[MAX_SLIMES];
// Per-slime impact + strand: (impactSec, impactMag, strandIdx, strandSec).
uniform vec4 uSlimeImpact[MAX_SLIMES];
// Ripple ring buffer: (x, z, ageSec, mag). Only first uRippleCount slots are live.
uniform vec4 uRipples[MAX_RIPPLES];
uniform int uRippleCount;

// Design tokens.
uniform float uGridIntensity;
uniform float uGlassRim;
uniform float uSssDensity;
uniform vec3 uBgTop;
uniform vec3 uBgBottom;

// Cursor ghost on floor.
uniform vec3 uPreviewXZ;
uniform float uPreviewActive;

varying vec2 vNdc;

// --- SDFs ------------------------------------------------------------------

float sdEllipsoid(vec3 p, vec3 r) {
  vec3 q = p / r;
  float k0 = length(q);
  float k1 = length(q / r);
  return (k0 * (k0 - 1.0)) / max(k1, 1e-5);
}

float sdCapsule(vec3 p, float h, float rr) {
  p.y -= clamp(p.y, -h, h);
  return length(p) - rr;
}

// Capsule between arbitrary endpoints a and b with radius rr. Used by the
// goo strand that stretches between two separating slimes along any axis.
float sdCapsuleAB(vec3 p, vec3 a, vec3 b, float rr) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - rr;
}

float sdRoundBox(vec3 p, vec3 b, float rad) {
  vec3 q = abs(p) - b + rad;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - rad;
}

// Dispatcher: 0=ellipsoid, 1=capsule, 2=roundbox.
// pc is the point in the slime's local space (already p - center).
float sdShape(int idx, vec3 pc, vec3 r) {
  if (idx == 1) {
    float rr = (r.x + r.z) * 0.5 * 0.85;
    float h = max(r.y - rr, 0.02);
    return sdCapsule(pc, h, rr);
  }
  if (idx == 2) {
    vec3 b = r * 0.82;
    float rad = 0.16 * min(r.x, min(r.y, r.z));
    return sdRoundBox(pc, b, rad);
  }
  return sdEllipsoid(pc, r);
}

float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sceneSDF(vec3 p) {
  float d = 1e6;
  int count = uCount;
  float strandK = uMergeK * 2.0;
  for (int i = 0; i < MAX_SLIMES; i++) {
    if (i >= count) break;
    vec3 c = uSlimePos[i].xyz;
    vec3 r = uSlimeRadii[i].xyz;
    int shape = int(uSlimeRadii[i].w + 0.5);
    float di = sdShape(shape, p - c, r);
    d = smin(d, di, uMergeK);

    // Goo strand: while a just-separated pair is still young, thread a
    // thinning capsule between this slime and its partner. One-sided union
    // (only the lower-index side draws the strand) keeps k consistent.
    float strandSec = uSlimeImpact[i].w;
    int partnerIdx = int(uSlimeImpact[i].z + (uSlimeImpact[i].z >= 0.0 ? 0.5 : -0.5));
    if (strandSec > 0.0 && strandSec < STRAND_LIFE && partnerIdx > i && partnerIdx < count) {
      vec3 cp = uSlimePos[partnerIdx].xyz;
      vec3 rp = uSlimeRadii[partnerIdx].xyz;
      float minR = min(min(r.x, r.y), min(r.z, min(rp.x, min(rp.y, rp.z))));
      float t = strandSec / STRAND_LIFE;
      float rr = minR * 0.45 * (1.0 - t);
      if (rr > 0.003) {
        float ds = sdCapsuleAB(p, c, cp, rr);
        d = smin(d, ds, strandK);
      }
    }
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
    sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
    sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
  ));
}

// --- Color blending --------------------------------------------------------

vec3 blendColor(vec3 p) {
  vec3 cAcc = vec3(0.0);
  float wAcc = 0.0;
  int count = uCount;
  for (int i = 0; i < MAX_SLIMES; i++) {
    if (i >= count) break;
    vec3 c = uSlimePos[i].xyz;
    vec3 r = uSlimeRadii[i].xyz;
    int shape = int(uSlimeRadii[i].w + 0.5);
    float di = sdShape(shape, p - c, r);
    // Colour weight concentrates near the contributing slime's surface.
    float w = exp(-max(di, -0.25) * 8.0);
    cAcc += uSlimeColor[i] * w;
    wAcc += w;
  }
  return (wAcc > 1e-5) ? cAcc / wAcc : vec3(1.0);
}

// --- Grid floor ------------------------------------------------------------

float gridLine(vec2 p, float spacing, float width) {
  vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
  float line = min(g.x, g.y);
  return 1.0 - smoothstep(0.0, width, line);
}

// Stacked drop shadow: each slime darkens the floor with a Gaussian disc
// whose radius grows slightly with height and whose intensity fades with it.
// Bottom slimes anchor the tower; stacked ones barely contribute.
float groundShadow(vec2 floorXZ) {
  float acc = 0.0;
  int count = uCount;
  for (int i = 0; i < MAX_SLIMES; i++) {
    if (i >= count) break;
    vec3 c = uSlimePos[i].xyz;
    vec3 r = uSlimeRadii[i].xyz;
    vec2 d = floorXZ - c.xz;
    float dist2 = dot(d, d);
    float h = max(c.y, 0.0);
    float r2 = r.x * r.z * (1.4 + h * 0.35);
    float heightFalloff = exp(-h * 0.9);
    acc += exp(-dist2 / max(r2, 1e-4)) * heightFalloff;
  }
  return clamp(acc, 0.0, 0.9);
}

vec3 renderFloor(vec3 hitPos, float dist) {
  vec2 floorXZ = hitPos.xz;
  // Extended fade range — grid reads across most of the visible floor instead
  // of vanishing two units from centre.
  float fade = 1.0 - smoothstep(2.5, 8.0, length(floorXZ));

  float fine = gridLine(floorXZ, 0.25, 0.008);
  float major = gridLine(floorXZ, 1.0, 0.014);

  vec3 base = mix(uBgBottom, uBgTop * 0.92, 0.35);
  vec3 gridCol = mix(base, vec3(0.2, 0.3, 0.46), 0.7);

  float intensity = uGridIntensity * fade;
  float gridMask = max(fine * 0.5, major * 1.0) * intensity;
  vec3 col = mix(base, gridCol, gridMask);

  // Soft centre spot where the action is.
  float spot = 1.0 - smoothstep(0.0, 2.8, length(floorXZ));
  col += vec3(0.04, 0.06, 0.1) * spot * 0.35;

  // Contact shadow under stacked slimes.
  float shadow = groundShadow(floorXZ);
  col *= 1.0 - shadow * 0.55;

  // Impact ripples: expanding rings centred where slimes hit the floor.
  // Each ripple emits a single thin annulus whose radius grows with age and
  // whose intensity envelopes out over its lifetime.
  for (int k = 0; k < MAX_RIPPLES; k++) {
    if (k >= uRippleCount) break;
    vec4 rp = uRipples[k];
    float age = rp.z;
    if (age <= 0.0 || age >= RIPPLE_LIFE) continue;
    float R = age * RIPPLE_SPEED;
    vec2 d2 = floorXZ - rp.xy;
    float dist = length(d2);
    float band = 0.06;
    float ring = exp(-pow((dist - R) / band, 2.0));
    float envelope = exp(-age / 0.45);
    float intensity = ring * envelope * rp.w * 0.55;
    vec3 rippleCol = mix(base, vec3(0.18, 0.45, 0.7), 0.9);
    col = mix(col, rippleCol, clamp(intensity, 0.0, 0.9));
  }

  // Drop preview: ring + centre dot marking where the next slime will land.
  if (uPreviewActive > 0.5) {
    vec2 pd = floorXZ - uPreviewXZ.xz;
    float pr = length(pd);
    // Ring band between inner radius 0.16 and outer 0.18 with soft edges.
    float ring = clamp(
      smoothstep(0.14, 0.16, pr) - smoothstep(0.18, 0.20, pr),
      0.0,
      1.0
    );
    float centreDot = clamp(1.0 - smoothstep(0.025, 0.045, pr), 0.0, 1.0);
    vec3 ringCol = vec3(0.12, 0.38, 0.6);
    col = mix(col, ringCol, ring * 0.55);
    col = mix(col, ringCol, centreDot * 0.5);
  }

  // Depth fade into the background horizon.
  float horizon = smoothstep(5.0, 11.0, dist);
  col = mix(col, uBgBottom, horizon);
  return col;
}

// --- Glass shading ---------------------------------------------------------

vec3 shadeSlime(vec3 p, vec3 n, vec3 albedo) {
  vec3 lightDir = normalize(vec3(0.35, 0.85, 0.25));
  float ndl = dot(n, lightDir);
  float diff = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(n, -uCamForward), 0.0, 1.0), 3.0);
  vec3 ref = reflect(-lightDir, n);
  float spec = pow(max(0.0, dot(ref, -uCamForward)), 28.0);
  // Fake SSS: energy leaks through when the surface faces away from light.
  float sss = pow(max(0.0, -ndl) * 0.5 + 0.5, 2.0) * uSssDensity;

  vec3 col = albedo * diff;
  col += albedo * sss * 0.6;
  col += vec3(1.0) * fres * uGlassRim;
  col += vec3(1.0) * spec * 0.5;
  // Subtle ground reflection tint from below (floor bounce).
  float bounce = clamp(-n.y * 0.5 + 0.5, 0.0, 1.0) * 0.15;
  col += albedo * bounce;
  return col;
}

// --- Main ------------------------------------------------------------------

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float halfH = uOrthoHalfH;
  float halfW = halfH * aspect;

  vec3 ro = uCamCenter +
            uCamRight * vNdc.x * halfW +
            uCamUp * vNdc.y * halfH -
            uCamForward * uRayPushback;
  vec3 rd = uCamForward;

  // Background gradient (vertical NDC lerp).
  float bgT = vNdc.y * 0.5 + 0.5;
  vec3 bg = mix(uBgBottom, uBgTop, bgT);

  // Raymarch.
  float t = 0.0;
  float tMax = uRayPushback + 10.0;
  float hit = -1.0;
  vec3 p = ro;
  int budget = uStepBudget;
  for (int i = 0; i < 128; i++) {
    if (i >= budget) break;
    p = ro + rd * t;
    float d = sceneSDF(p);
    if (d < 0.0012) {
      hit = t;
      break;
    }
    t += max(d * 0.95, 0.004);
    if (t > tMax) break;
  }

  // Floor intersection (y = 0).
  float tFloor = -1.0;
  if (abs(rd.y) > 1e-4) {
    float tf = (0.0 - ro.y) / rd.y;
    if (tf > 0.0) tFloor = tf;
  }

  vec3 col = bg;
  bool slimeHit = (hit > 0.0 && (tFloor < 0.0 || hit < tFloor));
  bool floorHit = (tFloor > 0.0 && (hit < 0.0 || tFloor < hit));

  if (slimeHit) {
    vec3 n = calcNormal(p);
    vec3 albedo = blendColor(p);
    col = shadeSlime(p, n, albedo);
    // Soft edge into background on grazing angles.
    float edge = pow(1.0 - clamp(dot(n, -uCamForward), 0.0, 1.0), 2.5);
    col = mix(col, bg, edge * 0.12);
  } else if (floorHit) {
    vec3 fp = ro + rd * tFloor;
    col = renderFloor(fp, tFloor);
  }

  // Subtle vignette.
  float vig = 1.0 - 0.18 * smoothstep(0.85, 1.6, length(vNdc));
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}
