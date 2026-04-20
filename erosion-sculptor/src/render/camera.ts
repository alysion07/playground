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
