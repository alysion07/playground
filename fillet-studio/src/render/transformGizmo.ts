import * as THREE from 'three';
import type { PrimNode } from '../state/types';

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
