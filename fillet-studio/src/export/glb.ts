import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { MeshData } from '../state/types';
import { meshFromField } from '../render/meshFromField';

// Write the current mesh as a GLB (binary glTF 2.0) via Three's exporter.
// We build a disposable BufferGeometry+Mesh wrapper so the exporter sees a
// proper scene graph — no Three state leaks out.
export async function exportGlb(mesh: MeshData, filename = 'fillet.glb'): Promise<void> {
  const geom = meshFromField(mesh);
  const material = new THREE.MeshStandardMaterial({ color: 0xd9dde6, metalness: 0.25, roughness: 0.35 });
  const object = new THREE.Mesh(geom, material);
  const scene = new THREE.Scene();
  scene.add(object);

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });

  try {
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('GLTFExporter returned JSON instead of GLB — binary: true was ignored.');
    }
    triggerDownload(new Blob([result], { type: 'model/gltf-binary' }), filename);
  } finally {
    geom.dispose();
    material.dispose();
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
