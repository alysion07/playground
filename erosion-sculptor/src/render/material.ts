import raymarchTemplate from './shaders/raymarch.wgsl?raw';
import initTemplate from './shaders/init-psi.wgsl?raw';
import erodeTemplate from './shaders/erode.wgsl?raw';
import commonWGSL from './shaders/common.wgsl?raw';
import { generateSceneSDF } from '../core/sdfGen';
import type { CsgNode } from '../state/types';
import { PsiVolume, VOLUME_GEOMETRY_UNIFORM_SIZE } from '../sim/volume';

export type RaymarchPipeline = {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  uniformBuffer: GPUBuffer;
};

// Camera + render uniforms layout (std140-ish via WGSL alignment rules):
// resolution(vec2) + stepBudget(f32) + wireframe(f32)         16
// ro(vec3) + pad                                              16
// forward(vec3) + pad                                         16
// right(vec3) + pad                                           16
// up(vec3) + pad                                              16
// total: 80 bytes
export const UNIFORM_FLOAT_COUNT = 20;
const UNIFORM_BYTE_SIZE = UNIFORM_FLOAT_COUNT * 4;

function composeWithCsg(template: string, csg: CsgNode): string {
  return template
    .replace('// __COMMON__', commonWGSL)
    .replace('// __SDF_FN__', generateSceneSDF(csg));
}

export class RaymarchMaterial {
  private device: GPUDevice;
  private format: GPUTextureFormat;

  // Raymarch pipeline. Now CSG-independent — it samples the baked ψ volume,
  // so the same pipeline survives every CSG edit. Bind groups come in pairs
  // (one per ping-pong side); the loop picks the side currently holding fresh
  // ψ via `bindGroup` getter.
  private raymarchBgl: GPUBindGroupLayout;
  private uniformBuffer: GPUBuffer;
  // Wind uniforms are owned by the material because both raymarch (surface-
  // pressure overlay) and, later, the mesh lit pipeline (Step 7) read them.
  // The erode compute has its own separate uniform buffer — different
  // visibility class (COMPUTE vs FRAGMENT) and different update frequency
  // (per-substep vs per-frame).
  private windBuffer!: GPUBuffer;
  pipeline: GPURenderPipeline | null = null;
  private raymarchBindGroups: [GPUBindGroup, GPUBindGroup] | null = null;

  // ψ volume + bake (init) compute. The volume is allocated by `setGrid` and
  // re-initialized whenever the CSG tree or grid resolution changes. `needsInit`
  // is consumed by `runInitIfNeeded` once per rebuild — the next render frame
  // dispatches the bake before the raymarch pass runs.
  volume: PsiVolume | null = null;
  private geomBuffer: GPUBuffer;
  private initBgl: GPUBindGroupLayout;
  private initPipeline: GPUComputePipeline | null = null;
  private initBindGroup: GPUBindGroup | null = null;
  private needsInit = false;

  // Erode (curvature flow) compute. The pipeline is CSG-independent, so it's
  // built once. Two bind groups handle ping-pong: AB reads side 0 / writes 1,
  // BA reads side 1 / writes 0. `runErodeStep` selects based on currentIndex
  // and swaps the volume after dispatch.
  private erodeBgl: GPUBindGroupLayout;
  private erodeBuffer: GPUBuffer;
  private erodePipeline: GPUComputePipeline | null = null;
  private erodeBindGroups: [GPUBindGroup, GPUBindGroup] | null = null;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.format = format;

    this.raymarchBgl = device.createBindGroupLayout({
      label: 'raymarch-bgl',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            sampleType: 'unfilterable-float',
            viewDimension: '3d',
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.uniformBuffer = device.createBuffer({
      label: 'raymarch-uniforms',
      size: UNIFORM_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.geomBuffer = device.createBuffer({
      label: 'volume-geom-uniforms',
      size: VOLUME_GEOMETRY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.windBuffer = device.createBuffer({
      label: 'wind-uniforms',
      // 32 bytes: dir.xyz, viz, noise, _pad*3 — matches WindU in raymarch.wgsl.
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.initBgl = device.createBindGroupLayout({
      label: 'init-bgl',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            format: 'r32float',
            access: 'write-only',
            viewDimension: '3d',
          },
        },
      ],
    });
    this.erodeBgl = device.createBindGroupLayout({
      label: 'erode-bgl',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: {
            sampleType: 'unfilterable-float',
            viewDimension: '3d',
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            format: 'r32float',
            access: 'write-only',
            viewDimension: '3d',
          },
        },
      ],
    });
    this.erodeBuffer = device.createBuffer({
      label: 'erode-uniforms',
      // 32 bytes: alpha, dt, beta, windNoise, windDir.xyz, _pad
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const erodeModule = device.createShaderModule({
      label: 'erode',
      code: erodeTemplate,
    });
    const erodePL = device.createPipelineLayout({
      bindGroupLayouts: [this.erodeBgl],
    });
    this.erodePipeline = device.createComputePipeline({
      label: 'erode-pipeline',
      layout: erodePL,
      compute: { module: erodeModule, entryPoint: 'cs_main' },
    });

    // Raymarch pipeline can be built up front; it has no CSG dependency.
    const raymarchModule = device.createShaderModule({
      label: 'raymarch',
      code: raymarchTemplate,
    });
    const raymarchPL = device.createPipelineLayout({
      bindGroupLayouts: [this.raymarchBgl],
    });
    this.pipeline = device.createRenderPipeline({
      label: 'raymarch-pipeline',
      layout: raymarchPL,
      vertex: { module: raymarchModule, entryPoint: 'vs_main' },
      fragment: {
        module: raymarchModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  // Selects the raymarch bind group whose ψ texture currently holds the
  // most-recently-written field. Loop reads this each frame so swaps in the
  // erode pass are picked up automatically.
  get bindGroup(): GPUBindGroup | null {
    if (!this.raymarchBindGroups || !this.volume) return null;
    return this.raymarchBindGroups[this.volume.currentIndex];
  }

  // Exposed for McPass (Step 6) and the mesh render pipeline (Step 7). The
  // ψ volume geometry is owned here — other passes bind it read-only so they
  // share a single source of truth for origin / voxel size / grid resolution.
  get geometryBuffer(): GPUBuffer {
    return this.geomBuffer;
  }

  // (Re)allocate the ψ volume at the given grid size. Destroys the previous
  // volume. Idempotent on identical sizes. Must be called at least once before
  // the first `rebuild`. Init + raymarch bind groups are rebuilt against the
  // new texture and a fresh bake is queued.
  setGrid(size: number): void {
    if (this.volume && this.volume.size === size) return;
    this.volume?.dispose();
    this.volume = new PsiVolume(this.device, size);
    // Init always writes to side 0 of the ping-pong; rebinding here means the
    // erode pass (Step 3) is free to swap sides without invalidating init.
    this.initBindGroup = this.device.createBindGroup({
      label: 'init-bg',
      layout: this.initBgl,
      entries: [
        { binding: 0, resource: { buffer: this.geomBuffer } },
        { binding: 1, resource: this.volume.views[0] },
      ],
    });
    // Pre-create both raymarch bind groups, one per ping-pong side. The
    // `bindGroup` getter selects the right one based on which side is current.
    this.raymarchBindGroups = [
      this.makeRaymarchBindGroup(this.volume.views[0], 'raymarch-bg-a'),
      this.makeRaymarchBindGroup(this.volume.views[1], 'raymarch-bg-b'),
    ];
    // Erode bind groups: index `i` reads side `i` and writes side `i^1`.
    // After dispatch we swap the volume so the freshly written side is current.
    this.erodeBindGroups = [
      this.makeErodeBindGroup(this.volume.views[0], this.volume.views[1], 'erode-bg-ab'),
      this.makeErodeBindGroup(this.volume.views[1], this.volume.views[0], 'erode-bg-ba'),
    ];
    this.device.queue.writeBuffer(this.geomBuffer, 0, this.volume.packGeometryUniform());
    this.needsInit = true;
  }

  private makeRaymarchBindGroup(view: GPUTextureView, label: string): GPUBindGroup {
    return this.device.createBindGroup({
      label,
      layout: this.raymarchBgl,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.geomBuffer } },
        { binding: 2, resource: view },
        { binding: 3, resource: { buffer: this.windBuffer } },
      ],
    });
  }

  private makeErodeBindGroup(
    inView: GPUTextureView,
    outView: GPUTextureView,
    label: string,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      label,
      layout: this.erodeBgl,
      entries: [
        { binding: 0, resource: { buffer: this.geomBuffer } },
        { binding: 1, resource: { buffer: this.erodeBuffer } },
        { binding: 2, resource: inView },
        { binding: 3, resource: outView },
      ],
    });
  }

  // Build the init compute pipeline from the current CSG tree. Raymarch is
  // unaffected — it samples ψ from the volume regardless of source.
  rebuild(csg: CsgNode): void {
    if (!this.volume) {
      throw new Error('[material] setGrid must be called before rebuild');
    }
    const initCode = composeWithCsg(initTemplate, csg);
    const initModule = this.device.createShaderModule({
      label: 'init-psi',
      code: initCode,
    });
    const initPL = this.device.createPipelineLayout({
      bindGroupLayouts: [this.initBgl],
    });
    this.initPipeline = this.device.createComputePipeline({
      label: 'init-pipeline',
      layout: initPL,
      compute: { module: initModule, entryPoint: 'cs_main' },
    });
    this.needsInit = true;
  }

  // Dispatch a bake into the volume if one is pending. Caller supplies the
  // current command encoder so the bake submits in the same frame as the render
  // pass that depends on it. Returns true if a bake actually ran.
  runInitIfNeeded(encoder: GPUCommandEncoder): boolean {
    if (!this.needsInit || !this.initPipeline || !this.initBindGroup || !this.volume) {
      return false;
    }
    const N = this.volume.size;
    const wg = Math.ceil(N / 4);
    const pass = encoder.beginComputePass({ label: 'init-pass' });
    pass.setPipeline(this.initPipeline);
    pass.setBindGroup(0, this.initBindGroup);
    pass.dispatchWorkgroups(wg, wg, wg);
    pass.end();
    this.volume.setCurrent(0);
    this.needsInit = false;
    return true;
  }

  // Force a fresh bake on the next frame without rebuilding the pipeline. Used
  // by the "Reset" button after parameter-only changes that don't recompile.
  requestInit(): void {
    this.needsInit = true;
  }

  // Run one explicit-Euler PDE substep. The caller is responsible for clamping
  // dt to the CFL bound; this method just dispatches with the supplied values.
  // beta=0 + any windDir recovers the Week 2 pure-curvature behavior, letting
  // the scheduler call this unconditionally without a separate code path.
  // After return, `volume.currentIndex` points to the freshly written side and
  // the raymarch bind group will sample from it on the next frame.
  runErodeStep(
    encoder: GPUCommandEncoder,
    alpha: number,
    dt: number,
    beta: number,
    windNoise: number,
    windDir: [number, number, number],
  ): void {
    if (!this.erodePipeline || !this.erodeBindGroups || !this.volume) return;
    const u = new Float32Array([
      alpha, dt, beta, windNoise,
      windDir[0], windDir[1], windDir[2], 0,
    ]);
    this.device.queue.writeBuffer(this.erodeBuffer, 0, u.buffer, u.byteOffset, u.byteLength);
    const N = this.volume.size;
    const wg = Math.ceil(N / 4);
    const pass = encoder.beginComputePass({ label: 'erode-pass' });
    pass.setPipeline(this.erodePipeline);
    pass.setBindGroup(0, this.erodeBindGroups[this.volume.currentIndex]);
    pass.dispatchWorkgroups(wg, wg, wg);
    pass.end();
    this.volume.swap();
  }

  writeUniforms(values: Float32Array): void {
    if (values.length !== UNIFORM_FLOAT_COUNT) {
      throw new Error(
        `uniform write expected ${UNIFORM_FLOAT_COUNT} floats, got ${values.length}`,
      );
    }
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      values.buffer,
      values.byteOffset,
      values.byteLength,
    );
  }

  // Packed as (dir.xyz, viz, noise, pad, pad, pad). Caller converts
  // (yaw, elevation) → dir via store.windDirVector to keep raymarch and
  // erode pointing at the same wind direction.
  writeWindUniforms(dir: [number, number, number], viz: number, noise: number): void {
    const u = new Float32Array([dir[0], dir[1], dir[2], viz, noise, 0, 0, 0]);
    this.device.queue.writeBuffer(
      this.windBuffer,
      0,
      u.buffer,
      u.byteOffset,
      u.byteLength,
    );
  }

  dispose(): void {
    this.volume?.dispose();
    this.volume = null;
  }
}
