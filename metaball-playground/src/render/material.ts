import { ShaderMaterial, Vector2 } from 'three';
import metaballGLSL from './shaders/metaball.glsl?raw';
import type { Backend } from './renderer';

export type MetaballUniforms = {
  uResolution: { value: Vector2 };
  uTime: { value: number };
  uK: { value: number };
  uAA: { value: number };
};

export type MetaballMaterial = {
  material: ShaderMaterial;
  uniforms: MetaballUniforms;
};

const VERTEX_GLSL = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export function createMetaballMaterial(backend: Backend): MetaballMaterial {
  if (backend !== 'webgl2') {
    // Week 2: will return a MeshBasicNodeMaterial + wgslFn-based material here.
    throw new Error(`[material] backend "${backend}" not yet implemented`);
  }

  const uniforms: MetaballUniforms = {
    uResolution: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uK: { value: 0.15 },
    uAA: { value: 0.0015 },
  };

  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: VERTEX_GLSL,
    fragmentShader: metaballGLSL,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });

  return { material, uniforms };
}
