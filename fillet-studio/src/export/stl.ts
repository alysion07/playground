import type { MeshData } from '../state/types';

// Binary STL layout:
//   80-byte header (ignored by readers, but some slicers display leading bytes)
//   uint32 little-endian triangle count
//   repeat 'triangle count' times:
//     float32×3 face normal
//     float32×3 vertex A
//     float32×3 vertex B
//     float32×3 vertex C
//     uint16 attribute byte count (0)
// Total size per triangle = 50 bytes.
export function buildStlBinary(mesh: MeshData): ArrayBuffer {
  const triCount = mesh.indices.length / 3;
  const size = 80 + 4 + triCount * 50;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);

  // Header — first 40 bytes encode "fillet-studio binary STL" as ASCII.
  const header = 'fillet-studio binary STL';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));

  view.setUint32(80, triCount, true);

  let offset = 84;
  const pos = mesh.positions;
  const idx = mesh.indices;
  for (let t = 0; t < triCount; t++) {
    const ia = idx[t * 3] * 3;
    const ib = idx[t * 3 + 1] * 3;
    const ic = idx[t * 3 + 2] * 3;
    const ax = pos[ia],
      ay = pos[ia + 1],
      az = pos[ia + 2];
    const bx = pos[ib],
      by = pos[ib + 1],
      bz = pos[ib + 2];
    const cx = pos[ic],
      cy = pos[ic + 1],
      cz = pos[ic + 2];
    // Face normal via (b-a) × (c-a), normalized.
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-20) {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    }
    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;
    view.setFloat32(offset, ax, true); offset += 4;
    view.setFloat32(offset, ay, true); offset += 4;
    view.setFloat32(offset, az, true); offset += 4;
    view.setFloat32(offset, bx, true); offset += 4;
    view.setFloat32(offset, by, true); offset += 4;
    view.setFloat32(offset, bz, true); offset += 4;
    view.setFloat32(offset, cx, true); offset += 4;
    view.setFloat32(offset, cy, true); offset += 4;
    view.setFloat32(offset, cz, true); offset += 4;
    view.setUint16(offset, 0, true); offset += 2;
  }
  return buf;
}

export function exportStl(mesh: MeshData, filename = 'fillet.stl'): void {
  const buf = buildStlBinary(mesh);
  triggerDownload(new Blob([buf], { type: 'model/stl' }), filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
