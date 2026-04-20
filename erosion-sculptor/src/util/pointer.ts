// Tracks pointer drag for camera orbit + wheel for zoom. Reports raw deltas
// via the provided callbacks; consumers do their own state updates.

export type PointerHandlers = {
  onDrag: (dxPx: number, dyPx: number) => void;
  onWheel: (deltaY: number) => void;
};

export function installPointer(canvas: HTMLCanvasElement, handlers: PointerHandlers): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    handlers.onDrag(dx, dy);
  };
  const onUp = (e: PointerEvent) => {
    canvas.releasePointerCapture?.(e.pointerId);
    dragging = false;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    handlers.onWheel(e.deltaY);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}
