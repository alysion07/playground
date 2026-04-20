import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../state/types';
import { createScene } from './scene';
import { meshFromField } from './meshFromField';

export type ViewportProps = {
  mesh: MeshData | null;
  wireframe?: boolean;
};

// React owns the DOM node; Three.js owns the GL context. We create the
// renderer once per canvas via useEffect, attach OrbitControls, and keep a
// single THREE.Mesh whose geometry is swapped when `mesh` changes.
export function Viewport({ mesh, wireframe = false }: ViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<{
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    partMat: THREE.MeshStandardMaterial;
    wireMat: THREE.MeshBasicMaterial;
    meshRoot: THREE.Group;
    current: THREE.Mesh | null;
    resize: ResizeObserver;
    raf: number;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const { scene, camera, meshRoot, partMat } = createScene();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.minDistance = 0.6;
    controls.maxDistance = 10;

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });

    const fitToHost = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    fitToHost();
    const resize = new ResizeObserver(fitToHost);
    resize.observe(host);

    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      handlesRef.current!.raf = requestAnimationFrame(loop);
    };

    handlesRef.current = {
      renderer,
      controls,
      partMat,
      wireMat,
      meshRoot,
      current: null,
      resize,
      raf: 0,
    };
    handlesRef.current.raf = requestAnimationFrame(loop);

    return () => {
      const h = handlesRef.current;
      if (!h) return;
      cancelAnimationFrame(h.raf);
      h.resize.disconnect();
      h.controls.dispose();
      if (h.current) {
        h.current.geometry.dispose();
        h.meshRoot.remove(h.current);
      }
      h.partMat.dispose();
      h.wireMat.dispose();
      h.renderer.dispose();
      if (h.renderer.domElement.parentNode === host) {
        host.removeChild(h.renderer.domElement);
      }
      handlesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    if (h.current) {
      h.meshRoot.remove(h.current);
      h.current.geometry.dispose();
      h.current = null;
    }
    if (!mesh || mesh.indices.length === 0) return;
    const geom = meshFromField(mesh);
    const material = wireframe ? h.wireMat : h.partMat;
    const obj = new THREE.Mesh(geom, material);
    h.meshRoot.add(obj);
    h.current = obj;
  }, [mesh, wireframe]);

  return <div ref={hostRef} className="absolute inset-0" />;
}
