import type { CsgNode, Vec3 } from '../state/types';
import { PRIM_SCHEMAS } from './sdfPrim';

export type Sdf = (x: number, y: number, z: number) => number;

// Build a function that maps a world-space point to the primitive's local frame
// by undoing translate + rotate (Euler XYZ intrinsic).
function makeWorldToLocal(
  translate: Vec3,
  rotate: Vec3,
): (x: number, y: number, z: number, out: Float64Array) => void {
  const [tx, ty, tz] = translate;
  const rotZero = rotate[0] === 0 && rotate[1] === 0 && rotate[2] === 0;
  if (rotZero) {
    return (x, y, z, out) => {
      out[0] = x - tx;
      out[1] = y - ty;
      out[2] = z - tz;
    };
  }
  // World→local is R(rotate)^T applied to (p − t). R = Rz·Ry·Rx.
  // R^T entries precomputed with cos/sin of +angle (not −angle) because we
  // take transpose explicitly rather than inverting via negative angles.
  const cx = Math.cos(rotate[0]),
    sx = Math.sin(rotate[0]);
  const cy = Math.cos(rotate[1]),
    sy = Math.sin(rotate[1]);
  const cz = Math.cos(rotate[2]),
    sz = Math.sin(rotate[2]);
  // R (intrinsic XYZ, i.e. Rz Ry Rx):
  //   R00 = cy*cz,                 R01 = sx*sy*cz − cx*sz,  R02 = cx*sy*cz + sx*sz
  //   R10 = cy*sz,                 R11 = sx*sy*sz + cx*cz,  R12 = cx*sy*sz − sx*cz
  //   R20 = −sy,                   R21 = sx*cy,             R22 = cx*cy
  // Transpose swaps rows/cols.
  const t00 = cy * cz;
  const t01 = cy * sz;
  const t02 = -sy;
  const t10 = sx * sy * cz - cx * sz;
  const t11 = sx * sy * sz + cx * cz;
  const t12 = sx * cy;
  const t20 = cx * sy * cz + sx * sz;
  const t21 = cx * sy * sz - sx * cz;
  const t22 = cx * cy;
  return (x, y, z, out) => {
    const dx = x - tx,
      dy = y - ty,
      dz = z - tz;
    out[0] = t00 * dx + t01 * dy + t02 * dz;
    out[1] = t10 * dx + t11 * dy + t12 * dz;
    out[2] = t20 * dx + t21 * dy + t22 * dz;
  };
}

// Quadratic smooth-min (Inigo Quilez).
function smin(a: number, b: number, k: number): number {
  const kk = Math.max(k, 1e-6);
  const h = Math.max(kk - Math.abs(a - b), 0) / kk;
  return Math.min(a, b) - h * h * kk * 0.25;
}

// Compile a CsgNode tree into a closure `(x,y,z) → signed distance`.
// All parameters and transforms are captured eagerly so the hot path is
// arithmetic only (no tree walking per sample).
export function compileCsg(root: CsgNode): Sdf {
  if (root.kind === 'prim') {
    const schema = PRIM_SCHEMAS[root.type];
    const params = root.params.slice();
    const toLocal = makeWorldToLocal(root.translate, root.rotate);
    const buf = new Float64Array(3);
    const evalFn = schema.eval;
    return (x, y, z) => {
      toLocal(x, y, z, buf);
      return evalFn(buf[0], buf[1], buf[2], params);
    };
  }
  const kids = root.children.map(compileCsg);
  if (kids.length === 0) return () => 1e9;
  if (kids.length === 1) return kids[0];
  const k = root.k;
  switch (root.op) {
    case 'union':
      return (x, y, z) => {
        let acc = kids[0](x, y, z);
        for (let i = 1; i < kids.length; i++) {
          const v = kids[i](x, y, z);
          if (v < acc) acc = v;
        }
        return acc;
      };
    case 'diff':
      return (x, y, z) => {
        let acc = kids[0](x, y, z);
        for (let i = 1; i < kids.length; i++) {
          const v = -kids[i](x, y, z);
          if (v > acc) acc = v;
        }
        return acc;
      };
    case 'intersect':
      return (x, y, z) => {
        let acc = kids[0](x, y, z);
        for (let i = 1; i < kids.length; i++) {
          const v = kids[i](x, y, z);
          if (v > acc) acc = v;
        }
        return acc;
      };
    case 'smoothUnion':
      return (x, y, z) => {
        let acc = kids[0](x, y, z);
        for (let i = 1; i < kids.length; i++) acc = smin(acc, kids[i](x, y, z), k);
        return acc;
      };
  }
}
