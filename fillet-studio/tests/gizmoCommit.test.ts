import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// On drag commit the gizmo reads back proxy.quaternion and converts to XYZ
// Euler before writing to the store's `rotate: Vec3`. This test pins down
// that Three.js's Euler→Quaternion→Euler round-trip is lossless for the
// angle ranges we exercise (well inside the Gimbal-lock singularity near
// ±π/2 on Y). If a future Three.js upgrade breaks the round-trip, this
// fires before users see jumping rotations.
describe('Euler XYZ <-> Quaternion round-trip (drag commit safety)', () => {
  const cases: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.1, 0, 0],
    [0, 0.5, 0],
    [0, 0, -0.7],
    [0.3, -0.4, 0.2],
    [-1.0, 0.6, -0.3],
  ];

  for (const r of cases) {
    it(`round-trip preserves [${r.join(',')}]`, () => {
      const e1 = new THREE.Euler(r[0], r[1], r[2], 'XYZ');
      const q = new THREE.Quaternion().setFromEuler(e1);
      const e2 = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      expect(e2.x).toBeCloseTo(r[0], 5);
      expect(e2.y).toBeCloseTo(r[1], 5);
      expect(e2.z).toBeCloseTo(r[2], 5);
    });
  }
});
