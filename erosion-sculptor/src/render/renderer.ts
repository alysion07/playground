// Raw WebGPU initialization. Three.js's NodeMaterial path is heavy and
// awkward for dynamic WGSL injection; for Week 1's single fullscreen pass
// we drive the device directly. Three.js stays as a dependency for Week 3
// mesh extraction / display.

export type GPUBundle = {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
};

const MAX_DPR = 1.5;

export class WebGPUUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGPUUnsupportedError';
  }
}

export async function createGPU(canvas: HTMLCanvasElement): Promise<GPUBundle> {
  if (!('gpu' in navigator)) {
    throw new WebGPUUnsupportedError('navigator.gpu unavailable');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new WebGPUUnsupportedError('no GPU adapter');
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new WebGPUUnsupportedError('canvas.getContext("webgpu") returned null');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });
  resizeCanvas(canvas);
  return { device, context, format, canvas };
}

export function resizeCanvas(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio, MAX_DPR);
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { width: w, height: h };
}
