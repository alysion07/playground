// ψ scalar field on a regular cubic grid, stored as two `r32float` 3D textures
// for ping-pong PDE updates. The "current" texture is the one most recently
// *written* — both raymarching (sampled binding) and the next erode step's
// *read* input pull from it. The "next" texture is the storage write target.
//
// We deliberately do not use sampled-filterable filtering on r32float (that
// requires the `float32-filterable` feature). The raymarch and erode shaders
// do manual trilinear interpolation via `textureLoad`, which works on any
// 32-bit float texture without extension.

const DEFAULT_EXTENTS = 2.4;

export class PsiVolume {
  readonly device: GPUDevice;
  readonly size: number;
  readonly extents: number;
  readonly voxelSize: number;
  // World-space coordinate of the lower corner of voxel (0,0,0)'s cell.
  // World pos of voxel center (i,j,k) = origin + (i+0.5, j+0.5, k+0.5)*voxelSize.
  readonly origin: [number, number, number];
  readonly textures: [GPUTexture, GPUTexture];
  readonly views: [GPUTextureView, GPUTextureView];
  private current: 0 | 1 = 0;

  constructor(device: GPUDevice, size: number, extents: number = DEFAULT_EXTENTS) {
    this.device = device;
    this.size = size;
    this.extents = extents;
    this.voxelSize = extents / size;
    const half = extents / 2;
    this.origin = [-half, -half, -half];
    const make = (label: string): GPUTexture =>
      device.createTexture({
        label,
        size: [size, size, size],
        dimension: '3d',
        format: 'r32float',
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });
    this.textures = [make('psi_a'), make('psi_b')];
    this.views = [this.textures[0].createView(), this.textures[1].createView()];
  }

  get currentIndex(): 0 | 1 {
    return this.current;
  }

  // Sampled view (read with textureLoad) of the most recently written ψ.
  get currentView(): GPUTextureView {
    return this.views[this.current];
  }

  // Storage view (write target) for the upcoming PDE step.
  get nextView(): GPUTextureView {
    return this.views[this.current ^ 1];
  }

  swap(): void {
    this.current = (this.current ^ 1) as 0 | 1;
  }

  // Reset which side is "current" without touching texture contents. Used after
  // a fresh init pass that wrote to side 0.
  setCurrent(idx: 0 | 1): void {
    this.current = idx;
  }

  // Pack the geometry uniform buffer (origin xyz + voxelSize w, then size u32).
  // 32-byte std140-friendly layout used by init/erode/raymarch shaders.
  packGeometryUniform(): ArrayBuffer {
    const buf = new ArrayBuffer(32);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = this.origin[0];
    f[1] = this.origin[1];
    f[2] = this.origin[2];
    f[3] = this.voxelSize;
    u[4] = this.size;
    u[5] = 0;
    u[6] = 0;
    u[7] = 0;
    return buf;
  }

  dispose(): void {
    this.textures[0].destroy();
    this.textures[1].destroy();
  }
}

export const VOLUME_GEOMETRY_UNIFORM_SIZE = 32;
