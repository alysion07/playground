import * as THREE from 'three';

export type SceneHandles = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshRoot: THREE.Group;
  partMat: THREE.MeshStandardMaterial;
  dispose: () => void;
};

// Build a neutral studio-look scene: soft hemi + key directional + subtle fill,
// thin floor grid, and a Group to attach the extracted mesh to. Designed for
// small CAD-style parts centered at origin within [-1,1]³.
export function createScene(): SceneHandles {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f12);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.set(2.4, 1.8, 2.4);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xdfe7f5, 0x10121a, 0.55);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(3, 4, 2);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fb6ff, 0.45);
  fill.position.set(-3, 1.5, -2);
  scene.add(fill);

  const grid = new THREE.GridHelper(4, 40, 0x2a2f3a, 0x1a1d24);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  grid.position.y = -1;
  scene.add(grid);

  const partMat = new THREE.MeshStandardMaterial({
    color: 0xd9dde6,
    metalness: 0.25,
    roughness: 0.35,
    flatShading: false,
  });

  const meshRoot = new THREE.Group();
  scene.add(meshRoot);

  return {
    scene,
    camera,
    meshRoot,
    partMat,
    dispose: () => {
      partMat.dispose();
      (grid.material as THREE.Material).dispose();
      grid.geometry.dispose();
    },
  };
}
