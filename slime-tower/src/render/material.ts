import { ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import slimeIsoGLSL from './shaders/slime-iso.glsl?raw';
import { MAX_SLIMES } from '../state/store';
import { MAX_RIPPLES } from '../sim/effects';

export type SlimeUniforms = {
  uResolution: { value: Vector2 };
  uCount: { value: number };
  uMergeK: { value: number };
  uStepBudget: { value: number };
  uCamRight: { value: Vector3 };
  uCamUp: { value: Vector3 };
  uCamForward: { value: Vector3 };
  uCamCenter: { value: Vector3 };
  uOrthoHalfH: { value: number };
  uRayPushback: { value: number };
  uSlimePos: { value: Vector4[] };
  uSlimeRadii: { value: Vector4[] };
  uSlimeColor: { value: Vector3[] };
  // Per-slime impact + strand packet: (impactSec, impactMag, strandIdx, strandSec).
  // strandIdx is the other slime's index in uSlimePos, or -1 if no strand.
  uSlimeImpact: { value: Vector4[] };
  // Ripple ring buffer: (x, z, ageSec, mag). uRippleCount entries are live.
  uRipples: { value: Vector4[] };
  uRippleCount: { value: number };
  uGridIntensity: { value: number };
  uGlassRim: { value: number };
  uSssDensity: { value: number };
  uBgTop: { value: Vector3 };
  uBgBottom: { value: Vector3 };
  uPreviewXZ: { value: Vector3 };
  uPreviewActive: { value: number };
};

export type SlimeMaterialBundle = {
  material: ShaderMaterial;
  uniforms: SlimeUniforms;
};

const VERTEX_GLSL = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function makeVec4Array(n: number): Vector4[] {
  const arr: Vector4[] = [];
  for (let i = 0; i < n; i++) arr.push(new Vector4(0, 0, 0, 0));
  return arr;
}

function makeVec3Array(n: number): Vector3[] {
  const arr: Vector3[] = [];
  for (let i = 0; i < n; i++) arr.push(new Vector3(0, 0, 0));
  return arr;
}

export function createSlimeMaterial(): SlimeMaterialBundle {
  const uniforms: SlimeUniforms = {
    uResolution: { value: new Vector2(1, 1) },
    uCount: { value: 0 },
    uMergeK: { value: 0.18 },
    uStepBudget: { value: 64 },
    uCamRight: { value: new Vector3(1, 0, 0) },
    uCamUp: { value: new Vector3(0, 1, 0) },
    uCamForward: { value: new Vector3(0, 0, -1) },
    uCamCenter: { value: new Vector3(0, 1.1, 0) },
    uOrthoHalfH: { value: 2.0 },
    uRayPushback: { value: 6.0 },
    uSlimePos: { value: makeVec4Array(MAX_SLIMES) },
    uSlimeRadii: { value: makeVec4Array(MAX_SLIMES) },
    uSlimeColor: { value: makeVec3Array(MAX_SLIMES) },
    uSlimeImpact: { value: makeVec4Array(MAX_SLIMES) },
    uRipples: { value: makeVec4Array(MAX_RIPPLES) },
    uRippleCount: { value: 0 },
    uGridIntensity: { value: 0.35 },
    uGlassRim: { value: 0.55 },
    uSssDensity: { value: 0.45 },
    uBgTop: { value: new Vector3(0.82, 0.88, 0.96) },
    uBgBottom: { value: new Vector3(0.94, 0.94, 0.98) },
    uPreviewXZ: { value: new Vector3(0, 0, 0) },
    uPreviewActive: { value: 0 },
  };

  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: VERTEX_GLSL,
    fragmentShader: slimeIsoGLSL,
    defines: { MAX_SLIMES: String(MAX_SLIMES), MAX_RIPPLES: String(MAX_RIPPLES) },
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });

  return { material, uniforms };
}
