import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CsgNode, MeshData, PrimNode, Vec3 } from '../state/types';
import { createScene } from './scene';
import { meshFromField } from './meshFromField';
import { createTransformGizmo, type GizmoHandles, type GizmoMode } from './transformGizmo';

export type ViewportProps = {
  mesh: MeshData | null;
  wireframe?: boolean;
  tree: CsgNode;
  selectedId: string | null;
  gizmoMode: GizmoMode;
  setGizmoMode: (m: GizmoMode) => void;
  onCommitTransform: (id: string, translate: Vec3, rotate: Vec3) => void;
  setSelected: (id: string | null) => void;
};

// React owns the DOM node; Three.js owns the GL context. We create the
// renderer once per canvas via useEffect, attach OrbitControls, and keep a
// single THREE.Mesh whose geometry is swapped when `mesh` changes.
export function Viewport({
  mesh,
  wireframe = false,
  tree,
  selectedId,
  gizmoMode,
  setGizmoMode,
  onCommitTransform,
  setSelected,
}: ViewportProps) {
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
    gizmo: GizmoHandles;
  } | null>(null);

  // Long-lived event handlers (keyboard, gizmo commit) are registered once in
  // the mount useEffect. Stashing the latest prop callbacks in a ref lets them
  // always call the current store action without re-binding on every render.
  const propsRef = useRef({
    onCommitTransform: (_id: string, _t: Vec3, _r: Vec3) => {},
    setGizmoMode: (_m: GizmoMode) => {},
    setSelected: (_id: string | null) => {},
  });
  const currentSelectedId = useRef<string | null>(null);

  propsRef.current.onCommitTransform = onCommitTransform;
  propsRef.current.setGizmoMode = setGizmoMode;
  propsRef.current.setSelected = setSelected;
  currentSelectedId.current = selectedId;

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

    host.tabIndex = 0;

    const gizmo = createTransformGizmo({
      scene,
      camera,
      domElement: renderer.domElement,
      orbit: controls,
      onCommit: (t, r) => {
        const id = currentSelectedId.current;
        if (id) propsRef.current.onCommitTransform(id, t, r);
      },
      onDragStart: () => {
        meshRoot.visible = false;
      },
      onDragEnd: () => {
        meshRoot.visible = true;
      },
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') propsRef.current.setGizmoMode('translate');
      else if (e.key === 'e' || e.key === 'E') propsRef.current.setGizmoMode('rotate');
      else if (e.key === 'Escape') propsRef.current.setSelected(null);
    };
    host.addEventListener('keydown', onKey);

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
      gizmo,
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
      host.removeEventListener('keydown', onKey);
      h.gizmo.dispose();
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

  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    h.gizmo.attachTo(findPrim(tree, selectedId));
  }, [selectedId, tree]);

  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    h.gizmo.setMode(gizmoMode);
  }, [gizmoMode]);

  return <div ref={hostRef} className="absolute inset-0" />;
}

function findPrim(root: CsgNode, id: string | null): PrimNode | null {
  if (!id) return null;
  if (root.kind === 'prim') return root.id === id ? root : null;
  for (const c of root.children) {
    const hit = findPrim(c, id);
    if (hit) return hit;
  }
  return null;
}
