import * as THREE from 'three';
import type { PrimNode } from '../state/types';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec3 } from '../state/types';

export type GizmoMode = 'translate' | 'rotate';

export type GizmoHandles = {
  attachTo: (prim: PrimNode | null) => void;
  setMode: (mode: GizmoMode) => void;
  dispose: () => void;
};

export type GizmoArgs = {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  orbit: OrbitControls;
  onCommit: (t: Vec3, r: Vec3) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

// Builds a Three.js BufferGeometry that approximates the primitive's surface
// in its LOCAL frame (i.e. before prim.translate/prim.rotate).
// Caller wraps in a Mesh and applies prim.translate/rotate at the Object3D
// level so the gizmo can edit those world transforms directly.
//
// For capsule the SDF takes two arbitrary endpoints; we build a Y-aligned
// CapsuleGeometry of length |b-a| and bake the (midpoint translation +
// Y → (b-a) rotation) directly into the geometry vertices via applyMatrix4
// so the outer Mesh's transform stays purely (translate, rotate).
export function buildProxyGeometry(prim: PrimNode): THREE.BufferGeometry {
  const p = prim.params;
  switch (prim.type) {
    case 'sphere': {
      const r = p[0];
      return new THREE.SphereGeometry(r, 32, 16);
    }
    case 'box': {
      const [hx, hy, hz] = [p[0], p[1], p[2]];
      return new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz);
    }
    case 'torus': {
      const [R, tubeR] = [p[0], p[1]];
      // TorusGeometry default lies in xy-plane; sdfPrim.ts puts the major
      // circle in xz, tube along y. Rotate -90° about X to match.
      const g = new THREE.TorusGeometry(R, tubeR, 16, 48);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case 'capsule': {
      const [ax, ay, az, bx, by, bz, r] = [p[0], p[1], p[2], p[3], p[4], p[5], p[6]];
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const L = Math.hypot(dx, dy, dz);
      const g = new THREE.CapsuleGeometry(r, L, 8, 16);
      // CapsuleGeometry is centered at origin and aligned to Y axis.
      // Build a quaternion that rotates Y → (b-a)/L, then translate to midpoint.
      const dir = new THREE.Vector3(dx, dy, dz);
      if (dir.lengthSq() > 1e-12) dir.normalize();
      else dir.set(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      return g;
    }
    case 'roundBox': {
      const [hx, hy, hz] = [p[0], p[1], p[2]];
      // Radius is intentionally ignored; the proxy is a rough placement aid.
      return new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz);
    }
    default: {
      const _exhaustive: never = prim.type;
      throw new Error(`Unknown primitive type: ${_exhaustive}`);
    }
  }
}

export function createTransformGizmo(args: GizmoArgs): GizmoHandles {
  const { scene, camera, domElement, orbit, onCommit, onDragStart, onDragEnd } = args;

  // The proxy mesh holds prim.translate as position and prim.rotate as
  // rotation (XYZ Euler). The gizmo edits these directly during drag; on
  // mouseUp we read them back and forward to the store via onCommit.
  const proxyMaterial = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const proxyRoot = new THREE.Group();
  proxyRoot.name = 'gizmo-proxy-root';
  scene.add(proxyRoot);

  let proxy: THREE.Mesh | null = null;
  let attachedPrimId: string | null = null;

  const controls = new TransformControls(camera, domElement);
  controls.setSpace('world');
  controls.setMode('translate');
  // In the current @types/three, TransformControls extends Controls (not
  // Object3D); the visual root is obtained via getHelper(). Add the helper
  // to the scene instead of the controls themselves.
  const controlsHelper = controls.getHelper();
  scene.add(controlsHelper);

  const onDraggingChanged = (e: { value: boolean }) => {
    orbit.enabled = !e.value;
    if (e.value) onDragStart();
    else onDragEnd();
  };
  controls.addEventListener('dragging-changed', onDraggingChanged as any);

  const onMouseUp = () => {
    if (!proxy) return;
    const t: Vec3 = [proxy.position.x, proxy.position.y, proxy.position.z];
    const e = new THREE.Euler().setFromQuaternion(proxy.quaternion, 'XYZ');
    const r: Vec3 = [e.x, e.y, e.z];
    if (
      Number.isFinite(t[0]) && Number.isFinite(t[1]) && Number.isFinite(t[2]) &&
      Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2])
    ) {
      onCommit(t, r);
    }
  };
  controls.addEventListener('mouseUp', onMouseUp as any);

  function clearProxy() {
    if (!proxy) return;
    controls.detach();
    proxyRoot.remove(proxy);
    proxy.geometry.dispose();
    proxy = null;
    attachedPrimId = null;
  }

  function attachTo(prim: PrimNode | null) {
    // Mid-drag re-attach is unsafe — wait for the user to release.
    if ((controls as any).dragging === true) return;
    if (!prim) {
      clearProxy();
      return;
    }
    if (proxy && attachedPrimId === prim.id) {
      // Same prim re-selected (e.g., slider edit) — just sync transforms.
      proxy.position.fromArray(prim.translate);
      proxy.rotation.set(prim.rotate[0], prim.rotate[1], prim.rotate[2], 'XYZ');
      return;
    }
    clearProxy();
    const geom = buildProxyGeometry(prim);
    const m = new THREE.Mesh(geom, proxyMaterial);
    m.position.fromArray(prim.translate);
    m.rotation.set(prim.rotate[0], prim.rotate[1], prim.rotate[2], 'XYZ');
    proxyRoot.add(m);
    proxy = m;
    attachedPrimId = prim.id;
    controls.attach(m);
  }

  function setMode(mode: GizmoMode) {
    controls.setMode(mode);
  }

  function dispose() {
    controls.removeEventListener('dragging-changed', onDraggingChanged as any);
    controls.removeEventListener('mouseUp', onMouseUp as any);
    clearProxy();
    controls.detach();
    scene.remove(controlsHelper);
    (controls as any).dispose?.();
    scene.remove(proxyRoot);
    proxyMaterial.dispose();
  }

  return { attachTo, setMode, dispose };
}
