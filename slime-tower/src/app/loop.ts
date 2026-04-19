import type { AppContext } from './bootstrap';
import {
  addSlime,
  appStore,
  mintSlimeId,
  MAX_SLIMES,
  replaceSlimes,
  setScore,
  WORLD,
} from '../state/store';
import { SHAPE_INDEX } from '../state/types';
import { step, towerHeight } from '../sim/physics3d';
import { applySquish, computeLoads } from '../sim/support';
import { CAMERA_CENTER, ORTHO_HALF_H } from '../render/camera';
import { findMerge, tryTopple } from '../sim/rules';
import { paletteBodyColor, randomRadius, resolveShape } from '../sim/slime';
import { pickAnyColor } from '../util/color';
import { mulberry32 } from '../util/rng';
import { screenToFloor } from '../render/camera';
import type { Slime } from '../state/types';

const DROP_HEIGHT = 2.6;
// Minimum vertical clearance between a new drop and the highest existing
// slime in its column. Prevents mid-air overlap that pair-separation would
// otherwise resolve as a violent sideways teleport.
const SPAWN_CLEARANCE = 0.3;
// Never spawn outside the world box (physics would immediately clamp + kick).
const SPAWN_CEILING = 3.0;

export function startLoop(ctx: AppContext): () => void {
  let frameId = 0;
  let stopped = false;
  let lastMs: number | null = null;

  const tick = (timeMs: number) => {
    if (stopped) return;

    const dt = lastMs === null ? 1 / 60 : Math.min(0.05, (timeMs - lastMs) / 1000);
    lastMs = timeMs;

    handlePointerDrop(ctx);

    const state = appStore.getState();
    const slimes = state.slimes;

    step(dt, state.sim, slimes, WORLD);

    // Apply squish after physics — load is driven by current XZ positions.
    const loads = computeLoads(slimes);
    applySquish(slimes, loads);

    const effect = findMerge(state.sim, slimes);
    if (effect) {
      const removed = new Set(effect.removed);
      const next = slimes.filter((s) => !removed.has(s.id));
      next.push(effect.added);
      replaceSlimes(next);
    }

    const toppled = tryTopple(appStore.getState().slimes, timeMs);
    if (toppled.toppled) {
      setScore({ topples: state.score.topples + 1 });
    }

    const h = towerHeight(appStore.getState().slimes);
    if (h > state.score.maxHeight) setScore({ maxHeight: h });

    if (state.render.cameraFollow) {
      // Keep the tower in frame without losing the floor. Lerp slowly so the
      // view doesn't jolt per drop.
      const targetY = Math.max(
        CAMERA_CENTER[1] * 0.55,
        Math.min(ORTHO_HALF_H - 0.25, h * 0.42 + 0.6),
      );
      const u = ctx.uniforms.uCamCenter.value;
      u.y += (targetY - u.y) * 0.08;
    }

    uploadPreview(ctx);
    uploadUniforms(ctx);

    ctx.onFrame(timeMs);
    ctx.renderer.render(ctx.scene, ctx.camera);
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
  };
}

// Resolve the world-space XZ where the cursor is currently pointing on the
// floor. Returns null if the ray misses the plane (pointer above horizon).
// Always clamped to world bounds so preview + drop land inside the arena.
function pointerFloorXZ(ctx: AppContext): [number, number] | null {
  const p = ctx.pointer;
  if (!p.screen) return null;
  const centerY = ctx.uniforms.uCamCenter.value.y;
  const floor = screenToFloor(ctx.canvas, p.screen[0], p.screen[1], 0, centerY);
  if (!floor) return null;
  const margin = 0.25;
  const x = Math.max(-WORLD.x + margin, Math.min(WORLD.x - margin, floor[0]));
  const z = Math.max(-WORLD.z + margin, Math.min(WORLD.z - margin, floor[2]));
  return [x, z];
}

// Find the highest point among slimes overlapping the target XZ column so we
// can spawn above them instead of into them.
function highestInColumn(
  slimes: readonly Slime[],
  xz: readonly [number, number],
  radius: number,
): number {
  let maxTop = 0;
  for (const s of slimes) {
    const dx = s.pos[0] - xz[0];
    const dz = s.pos[2] - xz[1];
    const footprint = (s.baseRadius + radius) * 1.1;
    if (dx * dx + dz * dz > footprint * footprint) continue;
    const top = s.pos[1] + s.baseRadius;
    if (top > maxTop) maxTop = top;
  }
  return maxTop;
}

function handlePointerDrop(ctx: AppContext): void {
  const p = ctx.pointer;
  if (!p.justPressed) {
    p.justPressed = false;
    return;
  }
  p.justPressed = false;

  const { slimes, render, seed } = appStore.getState();
  if (slimes.length >= MAX_SLIMES) return;

  const xz = pointerFloorXZ(ctx);
  if (!xz) return;

  // Seed a tiny rng per-drop so the chosen radius/colour are deterministic
  // from (seed, slimeCount). Keeps URL sharing reproducible even though drop
  // positions come from the user.
  const rng = mulberry32(seed + slimes.length * 73 + 1);
  const radius = randomRadius(rng);
  const color =
    render.colorMode === 'random'
      ? pickAnyColor(rng)
      : paletteBodyColor(rng, render.palette);
  const shape = resolveShape(render.dropShape, rng);

  // Start above any slime already occupying this XZ column, with a small
  // clearance. If the column is so tall that a clean spawn would exceed the
  // world ceiling, reject the drop — clamping Y down would spawn the new
  // slime *inside* the existing stack and send it flying.
  const columnTop = highestInColumn(slimes, xz, radius);
  const minSpawnY = Math.max(DROP_HEIGHT, columnTop + radius + SPAWN_CLEARANCE);
  const maxSpawnY = SPAWN_CEILING - radius;
  if (minSpawnY > maxSpawnY) return;
  const spawnY = minSpawnY;

  const slime: Slime = {
    id: mintSlimeId(),
    pos: [xz[0], spawnY, xz[1]],
    prev: [xz[0], spawnY + 0.005, xz[1]],
    radii: [radius, radius, radius],
    baseRadius: radius,
    color,
    mass: (4 / 3) * Math.PI * radius * radius * radius,
    shape,
    ageSec: 0,
  };
  addSlime(slime);
}

function uploadPreview(ctx: AppContext): void {
  const u = ctx.uniforms;
  const xz = pointerFloorXZ(ctx);
  if (!xz) {
    u.uPreviewActive.value = 0;
    return;
  }
  u.uPreviewXZ.value.set(xz[0], 0, xz[1]);
  u.uPreviewActive.value = 1;
}

function uploadUniforms(ctx: AppContext): void {
  const { slimes, sim, render } = appStore.getState();
  const u = ctx.uniforms;

  u.uCount.value = slimes.length;
  u.uMergeK.value = sim.mergeK;
  u.uStepBudget.value = Math.max(24, Math.min(128, Math.round(render.stepBudget)));

  u.uGridIntensity.value = render.gridIntensity;
  u.uGlassRim.value = render.glassRim;
  u.uSssDensity.value = render.sssDensity;
  u.uBgTop.value.set(render.backgroundTop[0], render.backgroundTop[1], render.backgroundTop[2]);
  u.uBgBottom.value.set(
    render.backgroundBottom[0],
    render.backgroundBottom[1],
    render.backgroundBottom[2],
  );

  const posArr = u.uSlimePos.value;
  const radArr = u.uSlimeRadii.value;
  const colArr = u.uSlimeColor.value;
  for (let i = 0; i < slimes.length; i++) {
    const s = slimes[i];
    // Pack birth progress (0→1 over BIRTH_DURATION) into posArr[i].w so the
    // shader can scale radii and mask the radius pop on merge.
    const birthT = Math.min(1, s.ageSec / 0.3);
    posArr[i].set(s.pos[0], s.pos[1], s.pos[2], birthT);
    // Shape index packed into radii.w so the shader can dispatch between
    // sphere / capsule / box / torus SDFs without another uniform array.
    radArr[i].set(s.radii[0], s.radii[1], s.radii[2], SHAPE_INDEX[s.shape]);
    colArr[i].set(s.color[0], s.color[1], s.color[2]);
  }
}
