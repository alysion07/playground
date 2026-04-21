import * as THREE from 'three';
import type { MeshData } from '../state/types';

// Build a THREE.BufferGeometry from our raw MeshData. No copy of the typed
// arrays — Three will hold references, so the same buffers can be GC'd
// together when the geometry is disposed.
export function meshFromField(mesh: MeshData): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
