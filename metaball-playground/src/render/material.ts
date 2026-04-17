import { ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import metaballGLSL from './shaders/metaball.glsl?raw';
import type { Backend } from './renderer';
import { MAX_BLOBS } from '../state/store';

export type MetaballUniforms = {
  uResolution: { value: Vector2 };
  uCount: { value: number };
  uK: { value: number };
  uAA: { value: number };
  uColorSoftness: { value: number };
  uBackground: { value: Vector3 };
  uBloom: { value: number };
  uVignette: { value: number };
  uRim: { value: number };
  uBlobsXYZR: { value: Vector4[] };
  uColors: { value: Vector3[] };
};

export type MetaballMaterial = {
  material: ShaderMaterial;
  uniforms: MetaballUniforms;
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

export function createMetaballMaterial(backend: Backend): MetaballMaterial {
  if (backend !== 'webgl2') {
    throw new Error(`[material] backend "${backend}" not yet implemented`);
  }

  const uniforms: MetaballUniforms = {
    uResolution: { value: new Vector2(1, 1) },
    uCount: { value: 0 },
    uK: { value: 0.15 },
    uAA: { value: 1.5 },
    uColorSoftness: { value: 6 },
    uBackground: { value: new Vector3(0.03, 0.03, 0.05) },
    uBloom: { value: 0.2 },
    uVignette: { value: 0.25 },
    uRim: { value: 0.3 },
    uBlobsXYZR: { value: makeVec4Array(MAX_BLOBS) },
    uColors: { value: makeVec3Array(MAX_BLOBS) },
  };

  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: VERTEX_GLSL,
    fragmentShader: metaballGLSL,
    defines: { MAX_BLOBS: String(MAX_BLOBS) },
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });

  return { material, uniforms };
}
