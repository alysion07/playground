import type { Vec3 } from '../state/types';

// Fixed isometric orthographic camera. yaw 45° around +y, pitch 30° looking
// down from horizontal. Good "diorama" read: floor occupies the lower half,
// stacked slimes rise into the upper half.
export const CAMERA_YAW_RAD = (45 * Math.PI) / 180;
export const CAMERA_PITCH_RAD = (30 * Math.PI) / 180;

// World-space point the ray at screen center looks at. Slightly above the
// floor so towers of ~2.4 m height fit vertically.
export const CAMERA_CENTER: Vec3 = [0, 1.1, 0];

// Vertical half-extent of the orthographic frustum in world units. Horizontal
// half-extent = ORTHO_HALF_H * aspect.
export const ORTHO_HALF_H = 2.0;

// How far behind the scene we seed ray origins. Needs to clear the tower
// plus any slimes that drop outside of bounds mid-flight.
export const RAY_PUSHBACK = 6.0;

function rotY(p: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}

function rotX(p: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export type CameraBasis = {
  right: Vec3;
  up: Vec3;
  forward: Vec3; // direction rays travel into the scene
  center: Vec3;
};

export function computeBasis(): CameraBasis {
  // Start with a camera at +z looking toward -z, then tilt and yaw.
  // Camera position: (0,0,dist) rotated by rotX(-pitch) then rotY(yaw).
  // Forward = -cameraPosition direction (through origin).
  const camLocal: Vec3 = [0, 0, 1];
  const tilted = rotX(camLocal, -CAMERA_PITCH_RAD);
  const rotated = rotY(tilted, CAMERA_YAW_RAD);
  const forward = norm([-rotated[0], -rotated[1], -rotated[2]]);
  const worldUp: Vec3 = [0, 1, 0];
  const right = norm(cross(forward, worldUp));
  const up = norm(cross(right, forward));
  return { right, up, forward, center: CAMERA_CENTER };
}

// Project a CSS-pixel canvas coordinate onto a horizontal y = targetY plane.
// Takes the current camera centre so the projection stays consistent with the
// runtime camera (which may be following the tower).
export function screenToFloor(
  canvas: HTMLCanvasElement,
  screenX: number,
  screenY: number,
  targetY: number,
  centerY: number = CAMERA_CENTER[1],
): Vec3 | null {
  const rect = canvas.getBoundingClientRect();
  const nx = (screenX / rect.width) * 2 - 1;
  const ny = 1 - (screenY / rect.height) * 2;
  const aspect = rect.width / Math.max(rect.height, 1);
  const halfH = ORTHO_HALF_H;
  const halfW = halfH * aspect;
  const basis = computeBasis();
  const center: Vec3 = [CAMERA_CENTER[0], centerY, CAMERA_CENTER[2]];

  const ro: Vec3 = [
    center[0] +
      basis.right[0] * nx * halfW +
      basis.up[0] * ny * halfH -
      basis.forward[0] * RAY_PUSHBACK,
    center[1] +
      basis.right[1] * nx * halfW +
      basis.up[1] * ny * halfH -
      basis.forward[1] * RAY_PUSHBACK,
    center[2] +
      basis.right[2] * nx * halfW +
      basis.up[2] * ny * halfH -
      basis.forward[2] * RAY_PUSHBACK,
  ];

  if (Math.abs(basis.forward[1]) < 1e-6) return null;
  const t = (targetY - ro[1]) / basis.forward[1];
  if (t < 0) return null;
  return [ro[0] + basis.forward[0] * t, targetY, ro[2] + basis.forward[2] * t];
}
