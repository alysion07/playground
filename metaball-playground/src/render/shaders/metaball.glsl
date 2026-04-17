precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uK;
uniform float uAA;

float sdCircle(vec2 p, vec2 c, float r) {
  return length(p - c) - r;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uResolution;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - vec2(0.5)) * vec2(aspect, 1.0);

  float t = uTime * 0.001;
  vec2 c0 = vec2(-0.22 + 0.05 * sin(t * 0.9), 0.02 + 0.04 * cos(t * 1.1));
  vec2 c1 = vec2(0.22 + 0.05 * cos(t * 0.7), 0.10 + 0.04 * sin(t * 1.3));
  vec2 c2 = vec2(0.00 + 0.08 * sin(t * 0.5), -0.18 + 0.03 * cos(t * 0.9));
  float r0 = 0.14;
  float r1 = 0.16;
  float r2 = 0.12;

  vec3 col0 = vec3(1.00, 0.35, 0.20);
  vec3 col1 = vec3(0.20, 0.70, 1.00);
  vec3 col2 = vec3(0.95, 0.90, 0.30);

  float d0 = sdCircle(p, c0, r0);
  float d1 = sdCircle(p, c1, r1);
  float d2 = sdCircle(p, c2, r2);

  float d = smin(smin(d0, d1, uK), d2, uK);

  float softness = 20.0;
  float w0 = exp(-max(d0, 0.0) * softness);
  float w1 = exp(-max(d1, 0.0) * softness);
  float w2 = exp(-max(d2, 0.0) * softness);
  float wSum = w0 + w1 + w2;
  vec3 color = (wSum > 1e-5) ? (col0 * w0 + col1 * w1 + col2 * w2) / wSum : vec3(0.05);

  float mask = 1.0 - smoothstep(0.0, uAA, d);
  vec3 bg = vec3(0.03, 0.03, 0.05);
  vec3 outCol = mix(bg, color, mask);

  gl_FragColor = vec4(outCol, 1.0);
}
