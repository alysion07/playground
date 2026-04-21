import type { PrimType } from '../state/types';

// Primitive schema: label + UI hints + pure CPU eval in local space.
// `eval` is called in the primitive's local frame — sdfCpu.ts handles the
// world→local transform (inverse translate/rotate) before dispatching here.
export type PrimSchema = {
  label: string;
  fields: ReadonlyArray<{
    key: string;
    index: number;
    min: number;
    max: number;
    step: number;
    default: number;
  }>;
  eval: (x: number, y: number, z: number, params: readonly number[]) => number;
};

function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}
function len2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

// Inigo Quilez primitive SDFs, direct TS port.
export const PRIM_SCHEMAS: Record<PrimType, PrimSchema> = {
  sphere: {
    label: 'Sphere',
    fields: [{ key: 'r', index: 0, min: 0.05, max: 1.5, step: 0.01, default: 0.35 }],
    eval: (x, y, z, p) => len3(x, y, z) - p[0],
  },
  box: {
    label: 'Box',
    fields: [
      { key: 'hx', index: 0, min: 0.05, max: 1.5, step: 0.01, default: 0.5 },
      { key: 'hy', index: 1, min: 0.05, max: 1.5, step: 0.01, default: 0.5 },
      { key: 'hz', index: 2, min: 0.05, max: 1.5, step: 0.01, default: 0.5 },
    ],
    eval: (x, y, z, p) => {
      const qx = Math.abs(x) - p[0];
      const qy = Math.abs(y) - p[1];
      const qz = Math.abs(z) - p[2];
      const outside = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
      return outside + inside;
    },
  },
  torus: {
    label: 'Torus',
    // Major circle lies in the xz-plane; tube extends along ±y.
    fields: [
      { key: 'R', index: 0, min: 0.1, max: 1.5, step: 0.01, default: 0.5 },
      { key: 'r', index: 1, min: 0.02, max: 0.6, step: 0.01, default: 0.15 },
    ],
    eval: (x, y, z, p) => {
      const qx = len2(x, z) - p[0];
      return len2(qx, y) - p[1];
    },
  },
  capsule: {
    label: 'Capsule',
    fields: [
      { key: 'ax', index: 0, min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'ay', index: 1, min: -1, max: 1, step: 0.01, default: -0.3 },
      { key: 'az', index: 2, min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'bx', index: 3, min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'by', index: 4, min: -1, max: 1, step: 0.01, default: 0.3 },
      { key: 'bz', index: 5, min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'r', index: 6, min: 0.02, max: 0.5, step: 0.01, default: 0.2 },
    ],
    eval: (x, y, z, p) => {
      const ax = p[0],
        ay = p[1],
        az = p[2];
      const bx = p[3],
        by = p[4],
        bz = p[5];
      const r = p[6];
      const pax = x - ax,
        pay = y - ay,
        paz = z - az;
      const bax = bx - ax,
        bay = by - ay,
        baz = bz - az;
      const baLen2 = bax * bax + bay * bay + baz * baz;
      let t = (pax * bax + pay * bay + paz * baz) / Math.max(baLen2, 1e-12);
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = pax - t * bax;
      const dy = pay - t * bay;
      const dz = paz - t * baz;
      return len3(dx, dy, dz) - r;
    },
  },
  roundBox: {
    label: 'Round Box',
    fields: [
      { key: 'hx', index: 0, min: 0.05, max: 1.5, step: 0.01, default: 0.4 },
      { key: 'hy', index: 1, min: 0.05, max: 1.5, step: 0.01, default: 0.4 },
      { key: 'hz', index: 2, min: 0.05, max: 1.5, step: 0.01, default: 0.4 },
      { key: 'r', index: 3, min: 0.0, max: 0.4, step: 0.005, default: 0.08 },
    ],
    eval: (x, y, z, p) => {
      const hx = p[0],
        hy = p[1],
        hz = p[2],
        r = p[3];
      const qx = Math.abs(x) - (hx - r);
      const qy = Math.abs(y) - (hy - r);
      const qz = Math.abs(z) - (hz - r);
      const outside = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
      return outside + inside - r;
    },
  },
};
