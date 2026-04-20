import litMeshTemplate from './shaders/lit_mesh.wgsl?raw';

// MeshCamU layout: 16-float column-major viewProj + 3-float ro + 1 pad = 80 B.
// The origin is carried separately so the fragment stage can compute view
// direction for rim lighting without inverting the matrix.
const MESH_CAM_SIZE = 80;

// Draws the MC-extracted mesh with Lambert + triplanar shading. Owns its own
// camera uniform (a pre-multiplied view-projection matrix, not the raymarch
// basis) and the depth texture — the fullscreen raymarch pass doesn't need
// one, so this is the only pipeline that cares about Z-testing.
//
// The wind uniform buffer is *borrowed* from the material so toggling W still
// drives both pipelines from a single upload. Same story for the MC vertex +
// index buffers borrowed from `McPass` at draw time.
export class MeshPipeline {
  private device: GPUDevice;
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;

  private bgl: GPUBindGroupLayout;
  private camBuffer: GPUBuffer;

  // Depth attachment. (Re)created lazily in `ensureDepth` when the canvas
  // resolution changes so the pipeline tolerates window resizes without an
  // explicit teardown hook.
  private depthTexture: GPUTexture | null = null;
  private depthWidth: number = 0;
  private depthHeight: number = 0;

  // 20-float scratch for cam uploads: 16 matrix + 3 ro + 1 pad. Reused each
  // frame to avoid per-frame allocation churn inside the RAF loop.
  private camScratch = new Float32Array(20);

  constructor(device: GPUDevice, format: GPUTextureFormat, windBuffer: GPUBuffer) {
    this.device = device;

    this.bgl = device.createBindGroupLayout({
      label: 'mesh-bgl',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.camBuffer = device.createBuffer({
      label: 'mesh-cam',
      size: MESH_CAM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = device.createBindGroup({
      label: 'mesh-bg',
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.camBuffer } },
        { binding: 1, resource: { buffer: windBuffer } },
      ],
    });

    const module = device.createShaderModule({ label: 'lit-mesh', code: litMeshTemplate });
    this.pipeline = device.createRenderPipeline({
      label: 'mesh-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bgl] }),
      vertex: {
        module,
        entryPoint: 'vs_main',
        // Vertex buffer layout mirrors march.wgsl's Vertex struct:
        // pos(vec3) + pad + normal(vec3) + pad, stride 32.
        buffers: [
          {
            arrayStride: 32,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 16, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      // Paul Bourke's TRI_TABLE is ordered so the winding is CCW when viewed
      // from outside (ψ>0 half-space). WebGPU's default frontFace='ccw' +
      // cullMode='back' therefore draws just the outward-facing surface.
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  // Pack the camera into the uniform buffer. `viewProj` is column-major
  // 16 floats; `ro` is the world-space camera origin for rim shading.
  writeCam(viewProj: Float32Array, ro: [number, number, number]): void {
    this.camScratch.set(viewProj, 0);
    this.camScratch[16] = ro[0];
    this.camScratch[17] = ro[1];
    this.camScratch[18] = ro[2];
    this.camScratch[19] = 0;
    this.device.queue.writeBuffer(
      this.camBuffer,
      0,
      this.camScratch.buffer,
      this.camScratch.byteOffset,
      this.camScratch.byteLength,
    );
  }

  // Returns a depth view sized to the current canvas. Reallocates the texture
  // only when the resolution actually changes; otherwise the previous one is
  // reused across frames.
  ensureDepth(width: number, height: number): GPUTextureView {
    if (!this.depthTexture || this.depthWidth !== width || this.depthHeight !== height) {
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        label: 'mesh-depth',
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depthWidth = width;
      this.depthHeight = height;
    }
    return this.depthTexture.createView();
  }

  dispose(): void {
    this.depthTexture?.destroy();
    this.depthTexture = null;
  }
}
