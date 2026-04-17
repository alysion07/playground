import type { Vec2 } from '../state/types';

export type PointerRuntime = {
  pos: Vec2 | null;
  active: boolean;
  dispose: () => void;
};

// Convert client (x, y) to world-space using aspect-correct NDC in [-0.5, 0.5]
// to match the fragment shader's world projection.
export function installPointer(canvas: HTMLCanvasElement): PointerRuntime {
  const runtime: PointerRuntime = {
    pos: null,
    active: false,
    dispose: () => {},
  };

  const mapEvent = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width; // 0..1
    const ny = (e.clientY - rect.top) / rect.height; // 0..1
    const aspect = rect.width / Math.max(rect.height, 1);
    const wx = (nx - 0.5) * aspect;
    const wy = (0.5 - ny); // flip Y: screen down → world down negative
    runtime.pos = [wx, wy];
  };

  const onMove = (e: PointerEvent) => mapEvent(e);
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture?.(e.pointerId);
    runtime.active = true;
    mapEvent(e);
  };
  const onUp = (e: PointerEvent) => {
    canvas.releasePointerCapture?.(e.pointerId);
    runtime.active = false;
  };
  const onLeave = () => {
    runtime.active = false;
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);

  runtime.dispose = () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
  };

  return runtime;
}
