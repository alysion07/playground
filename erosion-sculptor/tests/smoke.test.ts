import { describe, expect, it } from 'vitest';
import { generateSceneSDFBody } from '../src/core/sdfGen';
import { fromJSON, type SerializedNode } from '../src/core/csg';

describe('sdfGen', () => {
  it('emits a deterministic body for a single sphere', () => {
    const tree = fromJSON({
      kind: 'prim',
      type: 'sphere',
      params: [0.6],
      translate: [0, 0, 0],
      rotate: [0, 0, 0],
    });
    const body = generateSceneSDFBody(tree);
    // Snapshot the structural pieces, not the exact var names (those depend
    // on tree shape but are stable for this fixed input).
    expect(body).toContain('let n0: vec3<f32> = (p - vec3<f32>(0.0, 0.0, 0.0));');
    expect(body).toContain('length(n0) - 0.6');
    expect(body).toContain('return n1;');
  });

  it('combines two prims with smoothUnion', () => {
    const sphere: SerializedNode = {
      kind: 'prim',
      type: 'sphere',
      params: [0.5],
      translate: [-0.3, 0, 0],
      rotate: [0, 0, 0],
    };
    const box: SerializedNode = {
      kind: 'prim',
      type: 'box',
      params: [0.3, 0.3, 0.3],
      translate: [0.3, 0, 0],
      rotate: [0, 0, 0],
    };
    const tree = fromJSON({
      kind: 'op',
      op: 'smoothUnion',
      k: 0.25,
      children: [sphere, box],
    });
    const body = generateSceneSDFBody(tree);
    // smoothUnion → smin call with the configured k.
    expect(body).toMatch(/smin\(n\d+, n\d+, 0\.25\)/);
    // Both translates show up.
    expect(body).toContain('vec3<f32>(-0.3, 0.0, 0.0)');
    expect(body).toContain('vec3<f32>(0.3, 0.0, 0.0)');
  });

  it('handles diff (A - B) as max(A, -B)', () => {
    const tree = fromJSON({
      kind: 'op',
      op: 'diff',
      k: 0,
      children: [
        { kind: 'prim', type: 'sphere', params: [0.6], translate: [0, 0, 0], rotate: [0, 0, 0] },
        { kind: 'prim', type: 'sphere', params: [0.4], translate: [0.2, 0, 0], rotate: [0, 0, 0] },
      ],
    });
    const body = generateSceneSDFBody(tree);
    expect(body).toMatch(/max\(n\d+, -\(n\d+\)\)/);
  });
});
