import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  type Material,
} from 'three';

export type FullscreenQuad = {
  scene: Scene;
  camera: OrthographicCamera;
  mesh: Mesh;
};

export function createFullscreenQuad(material: Material): FullscreenQuad {
  // NDC-space triangle covering [-1, 3] on both axes (Blackman / Bavoil trick).
  const positions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
  const uvs = new Float32Array([0, 0, 2, 0, 0, 2]);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  const scene = new Scene();
  scene.add(mesh);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return { scene, camera, mesh };
}
