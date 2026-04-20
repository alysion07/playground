import { resizeCanvas } from '../render/renderer';

export function installResize(canvas: HTMLCanvasElement, onResize: (w: number, h: number) => void): () => void {
  const apply = () => {
    const { width, height } = resizeCanvas(canvas);
    onResize(width, height);
  };
  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(document.documentElement);
  window.addEventListener('resize', apply);
  return () => {
    ro.disconnect();
    window.removeEventListener('resize', apply);
  };
}
