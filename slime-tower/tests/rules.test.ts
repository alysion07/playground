import { beforeEach, describe, expect, it } from 'vitest';
import type { SimParams, Slime } from '../src/state/types';
import { _resetToppleState, findMerge, MERGE_MIN_AGE_SEC, tryTopple } from '../src/sim/rules';
import { applySquish, computeLoads } from '../src/sim/support';

const sim: SimParams = {
  gravity: 3.2,
  damping: 0.6,
  mergeK: 0.18,
  mergeOverlap: 0.35,
  timeScale: 1,
};

function makeSlime(partial: Partial<Slime> & { id: string; pos: [number, number, number] }): Slime {
  const r = partial.baseRadius ?? 0.16;
  const pos: [number, number, number] = [partial.pos[0], partial.pos[1], partial.pos[2]];
  const prev: [number, number, number] = partial.prev
    ? [partial.prev[0], partial.prev[1], partial.prev[2]]
    : [pos[0], pos[1], pos[2]];
  const color: [number, number, number] = partial.color
    ? [partial.color[0], partial.color[1], partial.color[2]]
    : [0.5, 0.8, 0.9];
  return {
    id: partial.id,
    pos,
    prev,
    radii: [r, r, r],
    baseRadius: r,
    color,
    mass: (4 / 3) * Math.PI * r * r * r,
    shape: partial.shape ?? 'sphere',
    // Default to "mature" so merge tests don't have to set this explicitly.
    ageSec: partial.ageSec ?? MERGE_MIN_AGE_SEC + 0.1,
    impactSec: partial.impactSec ?? 0,
    impactMag: partial.impactMag ?? 0,
    strandPartnerId: partial.strandPartnerId ?? null,
    strandSec: partial.strandSec ?? 0,
  };
}

describe('findMerge', () => {
  it('merges two settled same-colour overlapping slimes', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0] });
    const b = makeSlime({ id: 'b', pos: [0.1, 0.16, 0] });
    const effect = findMerge(sim, [a, b]);
    expect(effect).not.toBeNull();
    expect(effect!.removed.sort()).toEqual(['a', 'b']);
    expect(effect!.added.baseRadius).toBeGreaterThan(a.baseRadius);
  });

  it('does not merge moving slimes', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0], prev: [0, 0.25, 0] });
    const b = makeSlime({ id: 'b', pos: [0.1, 0.16, 0] });
    expect(findMerge(sim, [a, b])).toBeNull();
  });

  it('does not merge different colours', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0], color: [1, 0, 0] });
    const b = makeSlime({ id: 'b', pos: [0.1, 0.16, 0], color: [0, 0, 1] });
    expect(findMerge(sim, [a, b])).toBeNull();
  });

  it('births the merged slime pre-squished and stamps an impact pulse', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0] });
    const b = makeSlime({ id: 'b', pos: [0.1, 0.16, 0] });
    const effect = findMerge(sim, [a, b])!;
    const merged = effect.added;
    // Impact pulse fires at birth, driving the wobble from disc → sphere.
    expect(merged.impactMag).toBe(1);
    expect(merged.impactSec).toBe(0);
    // Initial shape is a disc: ry < baseRadius, rx/rz > baseRadius.
    expect(merged.radii[1]).toBeLessThan(merged.baseRadius);
    expect(merged.radii[0]).toBeGreaterThan(merged.baseRadius);
    // Volume-preserving against baseRadius (matches applySquish invariant).
    const vol = merged.radii[0] * merged.radii[1] * merged.radii[2];
    expect(vol).toBeCloseTo(merged.baseRadius ** 3, 5);
    // Bottom of the squished disc should be at/above floor (no clipping).
    expect(merged.pos[1] - merged.radii[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('computeLoads', () => {
  it('assigns zero load to a lone slime', () => {
    const slimes = [makeSlime({ id: 'a', pos: [0, 0.16, 0] })];
    expect(Array.from(computeLoads(slimes))).toEqual([0]);
  });

  it('accumulates mass of slimes above in XZ footprint', () => {
    const bottom = makeSlime({ id: 'bot', pos: [0, 0.16, 0] });
    const top = makeSlime({ id: 'top', pos: [0.02, 0.48, 0] });
    const loads = computeLoads([bottom, top]);
    expect(loads[0]).toBeCloseTo(top.mass, 6);
    expect(loads[1]).toBe(0);
  });

  it('skips slimes outside the XZ footprint', () => {
    const bottom = makeSlime({ id: 'bot', pos: [0, 0.16, 0] });
    const distant = makeSlime({ id: 'far', pos: [2, 0.48, 0] });
    const loads = computeLoads([bottom, distant]);
    expect(loads[0]).toBe(0);
  });

  it('ignores airborne slimes — contact check', () => {
    const bottom = makeSlime({ id: 'bot', pos: [0, 0.16, 0] });
    const airborne = makeSlime({ id: 'air', pos: [0, 2.6, 0] });
    const loads = computeLoads([bottom, airborne]);
    expect(loads[0]).toBe(0);
  });

  it('propagates cumulative load through a stack', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0] });
    const b = makeSlime({ id: 'b', pos: [0, 0.48, 0] });
    const c = makeSlime({ id: 'c', pos: [0, 0.8, 0] });
    const loads = computeLoads([a, b, c]);
    expect(loads[0]).toBeCloseTo(b.mass + c.mass, 6);
    expect(loads[1]).toBeCloseTo(c.mass, 6);
    expect(loads[2]).toBe(0);
  });
});

describe('applySquish', () => {
  it('preserves baseRadius when unloaded', () => {
    const slimes = [makeSlime({ id: 'a', pos: [0, 0.16, 0] })];
    applySquish(slimes, computeLoads(slimes));
    expect(slimes[0].radii[1]).toBeCloseTo(slimes[0].baseRadius, 6);
    expect(slimes[0].radii[0]).toBeCloseTo(slimes[0].baseRadius, 6);
  });

  it('compresses ry and expands rx/rz under load', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0] });
    const b = makeSlime({ id: 'b', pos: [0, 0.48, 0] });
    const slimes = [a, b];
    applySquish(slimes, computeLoads(slimes));
    expect(slimes[0].radii[1]).toBeLessThan(slimes[0].baseRadius);
    expect(slimes[0].radii[0]).toBeGreaterThan(slimes[0].baseRadius);
  });

  it('volume-preserves (rx*ry*rz = baseRadius^3)', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0] });
    const b = makeSlime({ id: 'b', pos: [0, 0.48, 0] });
    const c = makeSlime({ id: 'c', pos: [0, 0.8, 0] });
    const slimes = [a, b, c];
    applySquish(slimes, computeLoads(slimes));
    for (const s of slimes) {
      const vol = s.radii[0] * s.radii[1] * s.radii[2];
      const baseVol = s.baseRadius ** 3;
      expect(vol).toBeCloseTo(baseVol, 5);
    }
  });

  it('impact pulse pushes ry below the unloaded baseline', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0], impactMag: 1, impactSec: 0 });
    applySquish([a], new Float32Array([0]));
    expect(a.radii[1]).toBeLessThan(a.baseRadius);
  });

  it('impact pulse volume-preserves mid-wobble', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0], impactMag: 1, impactSec: 0 });
    applySquish([a], new Float32Array([0]));
    const vol = a.radii[0] * a.radii[1] * a.radii[2];
    expect(vol).toBeCloseTo(a.baseRadius ** 3, 5);
  });

  it('impact pulse decays — far-future t approaches unloaded radii', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0], impactMag: 1, impactSec: 2.0 });
    applySquish([a], new Float32Array([0]));
    // exp(-2/0.12) ≈ 1e-7 → negligible pulse, so ry ≈ baseRadius.
    expect(Math.abs(a.radii[1] - a.baseRadius)).toBeLessThan(1e-4);
  });
});

describe('tryTopple', () => {
  beforeEach(() => _resetToppleState());

  it('returns false when there is no stack', () => {
    const slimes = [makeSlime({ id: 'a', pos: [0, 0.16, 0] })];
    expect(tryTopple(slimes, 1000).toppled).toBe(false);
  });

  it('triggers when CoM drifts past the base footprint', () => {
    // Base slime at origin. Top slime offset so far in X that CoM exits.
    const base = makeSlime({ id: 'base', pos: [0, 0.16, 0] });
    const offset = makeSlime({ id: 'top', pos: [0.35, 1.0, 0] });
    const slimes = [base, offset];
    expect(tryTopple(slimes, 1000).toppled).toBe(true);
  });

  it('respects the cooldown', () => {
    const base = makeSlime({ id: 'base', pos: [0, 0.16, 0] });
    const offset = makeSlime({ id: 'top', pos: [0.35, 1.0, 0] });
    const slimes = [base, offset];
    expect(tryTopple(slimes, 1000).toppled).toBe(true);
    // Immediate retry should be blocked by cooldown.
    expect(tryTopple(slimes, 1100).toppled).toBe(false);
  });

  it('does not topple when a newly spawned slime is airborne and far from the base', () => {
    // Reproduces: slime 1 sitting on floor, user drops slime 2 at a different
    // XZ → slime 2 flies out because the topple CoM check was treating the
    // airborne drop as part of the stack.
    const base = makeSlime({ id: 'base', pos: [0, 0.16, 0] });
    const airborne = makeSlime({ id: 'air', pos: [1.0, 2.6, 1.0], ageSec: 0 });
    expect(tryTopple([base, airborne], 1000).toppled).toBe(false);
  });
});
