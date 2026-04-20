import marchTemplate from './shaders/march.wgsl?raw';
import { EDGE_TABLE, TRI_TABLE } from '../core/mcTables';
import type { PsiVolume } from '../sim/volume';

// Pre-allocated output buffer capacity. 1M vertices × 32B = 32MB; 1M indices
// × 4B = 4MB. Sized for dense, high-resolution inputs — a 128³ volume at
// peak complexity is ~983k vertices by the back-of-envelope (see plan §6).
// Users running N=96 / N=64 grids sit well under the cap. If we overflow,
// the shader sets the `overflow` flag which surfaces in the UI; the visible
// mesh will be clipped but the render doesn't crash.
export const MAX_VERTS = 1_000_000;
export const MAX_INDICES = 1_000_000;

// Counter struct size in bytes: 4 u32 (vertexCount, indexCount, overflow, pad).
const COUNTER_SIZE = 16;
// LookupTables: 256 u32 edge entries + 4096 i32 tri entries = 17408 bytes.
const TABLES_SIZE = 256 * 4 + 4096 * 4;
// McParams uniform: maxVerts, maxIndices, _pad0, _pad1 = 16 bytes.
const PARAMS_SIZE = 16;

export type McCounts = {
  vertexCount: number;
  indexCount: number;
  overflow: boolean;
};

// Marching Cubes compute pass. Owns all MC-specific GPU resources (pipeline,
// vertex/index/counter/tables buffers, readback staging). The `material` owns
// the ψ volume + GeomU buffer and passes them into `setBindings` whenever the
// ping-pong texture identities change (i.e. after `setGrid`).
//
// Lifecycle:
//   1. Construct at app bootstrap (creates pipeline + all fixed-size buffers,
//      uploads the lookup tables + params once).
//   2. Material calls `setBindings(volume, geomBuffer)` after every `setGrid`.
//   3. Scheduler drains `mesh.pendingBuild` → `dispatch(encoder, readIdx)` on
//      the current ψ side.
//   4. After `device.queue.submit`, scheduler awaits `readbackCounter()` which
//      resolves when `mapAsync` on the staging buffer completes. Result is
//      pushed into the store via `setMesh({vertexCount, overflow, ...})`.
//
// Readback strategy: use a pool of staging buffers + pending promises instead
// of a single buffer. With a pool, a new dispatch can queue before the
// previous mapAsync resolves (no stall); we just pick the oldest-completed
// slot. For Week 3 the user-driven cadence (button click) makes contention
// vanishingly unlikely so we use a single staging buffer and serialize.
export class McPass {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bgl: GPUBindGroupLayout;

  private vertexBuffer: GPUBuffer;
  private indexBuffer: GPUBuffer;
  private counterBuffer: GPUBuffer;
  private tablesBuffer: GPUBuffer;
  private paramsBuffer: GPUBuffer;
  private stagingBuffer: GPUBuffer;

  // One bind group per ping-pong side of the ψ volume — same pattern as
  // material's raymarch/erode pairs. Rebuilt on every `setBindings`.
  private bindGroups: [GPUBindGroup, GPUBindGroup] | null = null;
  private gridN: number = 0;

  // Guards the mapAsync promise so concurrent dispatches don't trample each
  // other's readbacks. `inFlight` is non-null while a readback is pending.
  private inFlight: Promise<McCounts> | null = null;

  constructor(device: GPUDevice) {
    this.device = device;

    this.bgl = device.createBindGroupLayout({
      label: 'mc-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float', viewDimension: '3d' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.vertexBuffer = device.createBuffer({
      label: 'mc-vertices',
      size: MAX_VERTS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });
    this.indexBuffer = device.createBuffer({
      label: 'mc-indices',
      size: MAX_INDICES * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
    });
    this.counterBuffer = device.createBuffer({
      label: 'mc-counter',
      size: COUNTER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.tablesBuffer = device.createBuffer({
      label: 'mc-tables',
      size: TABLES_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.paramsBuffer = device.createBuffer({
      label: 'mc-params',
      size: PARAMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.stagingBuffer = device.createBuffer({
      label: 'mc-counter-staging',
      size: COUNTER_SIZE,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Upload tables once. The shader reads `edgeTable` + `triTable` from a
    // single read-only storage buffer; their layouts are concatenated with
    // `edgeTable` first (256 × 4B) then `triTable` (4096 × 4B).
    const tablesData = new ArrayBuffer(TABLES_SIZE);
    new Uint32Array(tablesData, 0, 256).set(EDGE_TABLE);
    new Int32Array(tablesData, 256 * 4, 4096).set(TRI_TABLE);
    device.queue.writeBuffer(this.tablesBuffer, 0, tablesData);

    // Upload McParams once (capacities are compile-time constants).
    const params = new Uint32Array([MAX_VERTS, MAX_INDICES, 0, 0]);
    device.queue.writeBuffer(this.paramsBuffer, 0, params);

    const module = device.createShaderModule({ label: 'march', code: marchTemplate });
    this.pipeline = device.createComputePipeline({
      label: 'mc-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bgl] }),
      compute: { module, entryPoint: 'cs_main' },
    });
  }

  // Rebuilds the per-side bind groups against the given volume + the material's
  // GeomU buffer. Must be called at least once before `dispatch`.
  setBindings(volume: PsiVolume, geomBuffer: GPUBuffer): void {
    this.gridN = volume.size;
    this.bindGroups = [
      this.makeBindGroup(geomBuffer, volume.views[0], 'mc-bg-a'),
      this.makeBindGroup(geomBuffer, volume.views[1], 'mc-bg-b'),
    ];
  }

  private makeBindGroup(
    geomBuffer: GPUBuffer,
    psiView: GPUTextureView,
    label: string,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      label,
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: geomBuffer } },
        { binding: 1, resource: psiView },
        { binding: 2, resource: { buffer: this.vertexBuffer } },
        { binding: 3, resource: { buffer: this.indexBuffer } },
        { binding: 4, resource: { buffer: this.counterBuffer } },
        { binding: 5, resource: { buffer: this.tablesBuffer } },
        { binding: 6, resource: { buffer: this.paramsBuffer } },
      ],
    });
  }

  // Dispatch MC on the indicated ping-pong side. Zeroes the counter, runs the
  // compute pass, copies the counter to staging. After `device.queue.submit`,
  // call `readbackCounter()` to await the mapped result.
  dispatch(encoder: GPUCommandEncoder, currentIndex: 0 | 1): void {
    if (!this.bindGroups) {
      throw new Error('[McPass] dispatch before setBindings');
    }
    // Zero the counter buffer (vertexCount=0, indexCount=0, overflow=0).
    const zero = new Uint32Array([0, 0, 0, 0]);
    this.device.queue.writeBuffer(this.counterBuffer, 0, zero);

    // Cell grid is one smaller per axis — dispatch covers ceil((N-1)/4)^3.
    const cellN = this.gridN - 1;
    const wg = Math.ceil(cellN / 4);
    const pass = encoder.beginComputePass({ label: 'mc-pass' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroups[currentIndex]);
    pass.dispatchWorkgroups(wg, wg, wg);
    pass.end();

    encoder.copyBufferToBuffer(this.counterBuffer, 0, this.stagingBuffer, 0, COUNTER_SIZE);
  }

  // Awaits the staging buffer's mapAsync completion and returns the counts.
  // Must be called *after* `device.queue.submit` that included the dispatch.
  // Serializes with any in-flight readback so callers can fire-and-forget.
  readbackCounter(): Promise<McCounts> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.stagingBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const view = new Uint32Array(this.stagingBuffer.getMappedRange().slice(0));
        this.stagingBuffer.unmap();
        const result: McCounts = {
          vertexCount: view[0],
          indexCount: view[1],
          overflow: view[2] !== 0,
        };
        return result;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  // True while a readback promise is outstanding. The staging buffer is
  // mapped during this window — queueing another copyBufferToBuffer into it
  // would be a WebGPU validation error, so callers (scheduler.tickMesh,
  // loop.ts auto-rebuild) gate dispatch on this flag.
  isReadbackPending(): boolean {
    return this.inFlight !== null;
  }

  // Public handles for the Step 7 mesh render pipeline.
  get verts(): GPUBuffer { return this.vertexBuffer; }
  get indices(): GPUBuffer { return this.indexBuffer; }
}
