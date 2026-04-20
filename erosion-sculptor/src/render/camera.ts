import type { CameraState } from '../state/types';

export type CameraBasis = {
  // World-space camera origin.
  ro: [number, number, number];
  // Orthonormal basis. forward points from camera toward target.
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
};

const TARGET: [number, number, number] = [0, 0, 0];

// Compute camera basis from yaw/pitch/dist around the target.
// yaw rotates around world +Y; pitch tilts forward vector.
export function computeBasis(state: CameraState): CameraBasis {
  const cy = Math.cos(state.yaw);
  const sy = Math.sin(state.yaw);
  const cp = Math.cos(state.pitch);
  const sp = Math.sin(state.pitch);
  // Spherical → cartesian (yaw=0,pitch=0 looks down -Z from +Z axis)
  const dirX = sy * cp;
  const dirY = sp;
  const dirZ = cy * cp;
  const ro: [number, number, number] = [
    TARGET[0] + dirX * state.dist,
    TARGET[1] + dirY * state.dist,
    TARGET[2] + dirZ * state.dist,
  ];
  const forward: [number, number, number] = [-dirX, -dirY, -dirZ];
  // Right is forward × worldUp (left-handed correction by negation).
  const worldUp: [number, number, number] = [0, 1, 0];
  const right = normalize(cross(forward, worldUp));
  const up = normalize(cross(right, forward));
  return { ro, forward, right, up };
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Drag handlers map mouse delta to yaw/pitch.
export function applyDragYawPitch(
  state: CameraState,
  dxPx: number,
  dyPx: number,
): { yaw: number; pitch: number } {
  const sensitivity = 0.005;
  // Drag right → scene rotates right → camera orbits left (yaw decreases).
  const yaw = state.yaw - dxPx * sensitivity;
  const PITCH_LIMIT = Math.PI / 2 - 0.05;
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.pitch + dyPx * sensitivity));
  return { yaw, pitch };
}

export function applyZoom(state: CameraState, deltaY: number): { dist: number } {
  const factor = Math.pow(1.0015, deltaY);
  const dist = Math.max(1.5, Math.min(15, state.dist * factor));
  return { dist };
}

// Build a column-major view matrix from the camera basis. The raymarch uses
// the basis directly (right/up/forward as a local frame around ro), but the
// mesh pipeline rasterizes triangles and needs a proper world→view transform.
// WebGPU view space is right-handed looking down −z, so z_view = −forward.
export function computeViewMatrix(basis: CameraBasis): Float32Array {
  const r = basis.right;
  const u = basis.up;
  const f = basis.forward;
  const eye = basis.ro;
  const m = new Float32Array(16);
  // Row-representation: rows are (r, u, −f, 0) with −(basis·eye) in col 3.
  // Column-major layout → m[col * 4 + row].
  m[0] = r[0]; m[1] = u[0]; m[2] = -f[0]; m[3] = 0;
  m[4] = r[1]; m[5] = u[1]; m[6] = -f[1]; m[7] = 0;
  m[8] = r[2]; m[9] = u[2]; m[10] = -f[2]; m[11] = 0;
  m[12] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
  m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  m[14] = (f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]);
  m[15] = 1;
  return m;
}

// WebGPU perspective projection. NDC is [-1,1]² × [0,1] (not GL's [-1,1]³) —
// only the depth mapping differs from textbook GL code. Column-major.
export function computePerspective(
  fovyRadians: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1.0 / Math.tan(fovyRadians * 0.5);
  const nf = 1.0 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far * nf;
  m[11] = -1;
  m[14] = near * far * nf;
  // m[15] stays 0 — this is a perspective matrix, not affine.
  return m;
}

// Column-major 4×4 multiply: c = a * b.
// c[col][row] = Σ_k a[k][row] * b[col][k] → c[col*4+row] = Σ_k a[k*4+row] * b[col*4+k].
export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + row] * b[col * 4 + k];
      }
      r[col * 4 + row] = s;
    }
  }
  return r;
}

// Convenience: full view-projection for the mesh renderer. Default FOV picked
// so the 2.4-extent volume fills the frame at dist≈4 — matches the look of the
// raymarch preview where `forward * 2.15` plays the same role.
export function computeViewProj(
  basis: CameraBasis,
  aspect: number,
  fovyRadians: number = Math.PI / 3.5,
  near: number = 0.1,
  far: number = 100.0,
): Float32Array {
  const view = computeViewMatrix(basis);
  const proj = computePerspective(fovyRadians, aspect, near, far);
  return mat4Multiply(proj, view);
}
