import { beforeEach, describe, expect, it } from 'vitest';
import type { SimParams, Slime } from '../src/state/types';
import { _resetToppleState, findMerge, MERGE_MIN_AGE_SEC, tryTopple } from '../src/sim/rules';

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

  it('births the merged slime as a full-size sphere', () => {
    const a = makeSlime({ id: 'a', pos: [0, 0.16, 0] });
    const b = makeSlime({ id: 'b', pos: [0.1, 0.16, 0] });
    const effect = findMerge(sim, [a, b])!;
    const merged = effect.added;
    expect(merged.impactMag).toBe(0);
    expect(merged.baseRadius).toBeCloseTo(
      Math.cbrt(a.baseRadius ** 3 + b.baseRadius ** 3),
      6,
    );
    expect(merged.radii[0]).toBeCloseTo(merged.baseRadius, 6);
    expect(merged.radii[1]).toBeCloseTo(merged.baseRadius, 6);
    expect(merged.radii[2]).toBeCloseTo(merged.baseRadius, 6);
    expect(merged.pos[1] - merged.radii[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('tryTopple', () => {
  beforeEach(() => _resetToppleState());

  it('returns false when there is no stack', () => {
    const slimes = [makeSlime({ id: 'a', pos: [0, 0.16, 0] })];
    expect(tryTopple(slimes, 1000).toppled).toBe(false);
  });

  it('does not topple a 2-slime stack — that is natural settling, not a tower collapse', () => {
    // Two slimes leaning is handled by separate(); topple is reserved for
    // stacks of 3+. See TOPPLE_MIN_TOWER in rules.ts.
    const base = makeSlime({ id: 'base', pos: [0, 0.16, 0] });
    const offset = makeSlime({ id: 'top', pos: [0.35, 1.0, 0] });
    expect(tryTopple([base, offset], 1000).toppled).toBe(false);
    // Even after dwell elapses, still no fire — the size gate blocks it.
    expect(tryTopple([base, offset], 1300).toppled).toBe(false);
  });

  it('triggers when CoM drifts past the base footprint (3+ slimes, after dwell)', () => {
    // Stack of 3 with the top two leaning past the base. First call arms the
    // dwell timer; subsequent call after TOPPLE_DWELL_MS fires.
    const base = makeSlime({ id: 'base', pos: [0, 0.16, 0] });
    const mid = makeSlime({ id: 'mid', pos: [0.3, 0.5, 0] });
    const top = makeSlime({ id: 'top', pos: [0.35, 1.0, 0] });
    const slimes = [base, mid, top];
    // First call within dwell window — arms timer, does not fire.
    expect(tryTopple(slimes, 1000).toppled).toBe(false);
    // After 200ms dwell, fires.
    expect(tryTopple(slimes, 1250).toppled).toBe(true);
  });

  it('respects the cooldown', () => {
    const base = makeSlime({ id: 'base', pos: [0, 0.16, 0] });
    const mid = makeSlime({ id: 'mid', pos: [0.3, 0.5, 0] });
    const top = makeSlime({ id: 'top', pos: [0.35, 1.0, 0] });
    const slimes = [base, mid, top];
    expect(tryTopple(slimes, 1000).toppled).toBe(false);
    expect(tryTopple(slimes, 1250).toppled).toBe(true);
    // Immediate retry should be blocked by cooldown.
    expect(tryTopple(slimes, 1350).toppled).toBe(false);
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
