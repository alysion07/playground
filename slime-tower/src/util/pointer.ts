import type { Vec2 } from '../state/types';

export type PointerRuntime = {
  // Screen-space pos in canvas CSS pixels. null when pointer has never entered.
  screen: Vec2 | null;
  // true while pressed.
  active: boolean;
  // true on the first frame of a press (consumed by the loop).
  tapConsumed: boolean;
  justPressed: boolean;
  dispose: () => void;
};

// Captures raw pointer events; world-space (XZ) projection is done by
// render/camera.ts since it needs the ortho matrices.
export function installPointer(canvas: HTMLCanvasElement): PointerRuntime {
  const runtime: PointerRuntime = {
    screen: null,
    active: false,
    tapConsumed: false,
    justPressed: false,
    dispose: () => {},
  };

  const mapEvent = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    runtime.screen = [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onMove = (e: PointerEvent) => mapEvent(e);
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture?.(e.pointerId);
    runtime.active = true;
    runtime.justPressed = true;
    runtime.tapConsumed = false;
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
