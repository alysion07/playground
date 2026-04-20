import type { CsgNode, FilletParams, MeshData } from '../state/types';
import { sampleSdf } from '../core/sample';
import { curvatureFlow } from '../core/curvatureFlow';
import { marchingCubes } from '../core/marchingCubes';

export type ComputeProgress =
  | { stage: 'sample'; progress: number }
  | { stage: 'flow'; progress: number }
  | { stage: 'mc'; progress: number };

export type ComputeResult = {
  mesh: MeshData;
  iterations: number;
  ms: number;
};

// End-to-end CPU pipeline: sample the CSG into a ψ volume, run mean-curvature
// flow to the R-determined stopping time, then extract the iso-surface via
// marching cubes. Yields control via setTimeout chunks inside curvatureFlow's
// progress callback so the UI remains responsive during long runs.
export async function computeFillet(
  tree: CsgNode,
  params: FilletParams,
  onProgress?: (p: ComputeProgress) => void,
  applyFillet: boolean = true,
): Promise<ComputeResult> {
  const t0 = performance.now();
  onProgress?.({ stage: 'sample', progress: 0 });
  const vol = sampleSdf(tree, params.N, params.extents);
  onProgress?.({ stage: 'sample', progress: 1 });
  await tick();

  let flowed = vol;
  if (applyFillet && params.R > 0) {
    const { volume } = curvatureFlow(vol, {
      R: params.R,
      alpha: params.alpha,
      capByR: true,
      onProgress: (step, total) => {
        if (step % 4 === 0 || step === total) {
          onProgress?.({ stage: 'flow', progress: step / total });
        }
      },
    });
    flowed = volume;
    await tick();
  }

  onProgress?.({ stage: 'mc', progress: 0 });
  const mesh = marchingCubes(flowed);
  onProgress?.({ stage: 'mc', progress: 1 });

  return {
    mesh,
    iterations: 0,
    ms: performance.now() - t0,
  };
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
