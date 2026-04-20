import type { PrimType } from '../state/types';

export type PrimSchema = {
  // Display label for UI.
  label: string;
  // Per-parameter UI hints.
  fields: ReadonlyArray<{
    key: string;
    index: number;
    min: number;
    max: number;
    step: number;
    default: number;
  }>;
  // Returns a WGSL expression for the SDF distance at point `pName`.
  // The expression must reference `pName` for the local-space sample point.
  emit: (pName: string, params: ReadonlyArray<string>) => string;
};

export const PRIM_SCHEMAS: Record<PrimType, PrimSchema> = {
  sphere: {
    label: 'Sphere',
    fields: [{ key: 'r', index: 0, min: 0.05, max: 1.5, step: 0.01, default: 0.6 }],
    emit: (p, [r]) => `length(${p}) - ${r}`,
  },
  box: {
    label: 'Box',
    fields: [
      { key: 'hx', index: 0, min: 0.05, max: 1.5, step: 0.01, default: 0.5 },
      { key: 'hy', index: 1, min: 0.05, max: 1.5, step: 0.01, default: 0.5 },
      { key: 'hz', index: 2, min: 0.05, max: 1.5, step: 0.01, default: 0.5 },
    ],
    emit: (p, [hx, hy, hz]) => {
      // sdBox: q = abs(p) - b; length(max(q,0)) + min(max(q.x,max(q.y,q.z)),0)
      return (
        `(length(max(abs(${p}) - vec3<f32>(${hx}, ${hy}, ${hz}), vec3<f32>(0.0))) ` +
        `+ min(max((abs(${p}).x - ${hx}), max((abs(${p}).y - ${hy}), (abs(${p}).z - ${hz}))), 0.0))`
      );
    },
  },
  torus: {
    label: 'Torus',
    fields: [
      { key: 'R', index: 0, min: 0.1, max: 1.5, step: 0.01, default: 0.6 },
      { key: 'r', index: 1, min: 0.02, max: 0.6, step: 0.01, default: 0.18 },
    ],
    emit: (p, [R, r]) => {
      // sdTorus: q = vec2(length(p.xz)-R, p.y); length(q) - r
      return `(length(vec2<f32>(length(${p}.xz) - ${R}, ${p}.y)) - ${r})`;
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
    emit: (p, [ax, ay, az, bx, by, bz, r]) => {
      return `sdCapsule(${p}, vec3<f32>(${ax}, ${ay}, ${az}), vec3<f32>(${bx}, ${by}, ${bz}), ${r})`;
    },
  },
  roundBox: {
    label: 'Round Box',
    fields: [
      { key: 'hx', index: 0, min: 0.05, max: 1.5, step: 0.01, default: 0.4 },
      { key: 'hy', index: 1, min: 0.05, max: 1.5, step: 0.01, default: 0.4 },
      { key: 'hz', index: 2, min: 0.05, max: 1.5, step: 0.01, default: 0.4 },
      { key: 'r', index: 3, min: 0.0, max: 0.4, step: 0.005, default: 0.1 },
    ],
    emit: (p, [hx, hy, hz, r]) => {
      // sdBox(p, b - r) - r — gives rounded corners.
      return (
        `(length(max(abs(${p}) - vec3<f32>(${hx} - ${r}, ${hy} - ${r}, ${hz} - ${r}), vec3<f32>(0.0))) ` +
        `+ min(max((abs(${p}).x - (${hx} - ${r})), max((abs(${p}).y - (${hy} - ${r})), (abs(${p}).z - (${hz} - ${r})))), 0.0) ` +
        `- ${r})`
      );
    },
  },
};
