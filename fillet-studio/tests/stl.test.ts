import { describe, it, expect } from 'vitest';
import { buildStlBinary } from '../src/export/stl';

// Build a single-triangle mesh and verify the binary STL layout: 80-byte header
// + uint32 tri count + 50 bytes per triangle, with the face normal recovered.
describe('buildStlBinary', () => {
  it('encodes a triangle with correct layout and face normal', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const buf = buildStlBinary({ positions, indices, normals });
    const view = new DataView(buf);
    expect(buf.byteLength).toBe(80 + 4 + 50);
    expect(view.getUint32(80, true)).toBe(1);
    const nx = view.getFloat32(84, true);
    const ny = view.getFloat32(88, true);
    const nz = view.getFloat32(92, true);
    expect(nx).toBeCloseTo(0, 6);
    expect(ny).toBeCloseTo(0, 6);
    expect(nz).toBeCloseTo(1, 6);
    const ax = view.getFloat32(96, true);
    const ay = view.getFloat32(100, true);
    const az = view.getFloat32(104, true);
    expect(ax).toBe(0);
    expect(ay).toBe(0);
    expect(az).toBe(0);
  });

  it('handles an empty mesh (zero triangles)', () => {
    const buf = buildStlBinary({
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      normals: new Float32Array(0),
    });
    const view = new DataView(buf);
    expect(buf.byteLength).toBe(80 + 4);
    expect(view.getUint32(80, true)).toBe(0);
  });
});
