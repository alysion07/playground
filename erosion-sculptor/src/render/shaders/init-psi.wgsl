// Bake the analytic CSG SDF into the ψ volume. Run once after each CSG edit.
// Each voxel writes its signed-distance value at its cell-center world position.

struct GeomU {
  // xyz: world position of the volume's lower-corner voxel boundary.
  // w:   voxelSize = extents / N.
  originVoxel: vec4<f32>,
  // x: grid resolution N. Other lanes pad to 16 bytes.
  sizeWord: vec4<u32>,
};

@group(0) @binding(0) var<uniform> U: GeomU;
@group(0) @binding(1) var psi: texture_storage_3d<r32float, write>;

// __COMMON__
// __SDF_FN__

@compute @workgroup_size(4, 4, 4)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.sizeWord.x;
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let p = U.originVoxel.xyz + (vec3<f32>(gid) + vec3<f32>(0.5)) * U.originVoxel.w;
  let v = sdCsg(p);
  textureStore(psi, vec3<i32>(gid), vec4<f32>(v, 0.0, 0.0, 0.0));
}
