import { describe, it, expect } from 'vitest';
import {
  addChild,
  findNode,
  makeOp,
  makePrim,
  removeNode,
  updateAt,
  walk,
} from '../src/core/csg';

describe('csg', () => {
  it('walk visits every node parent-first', () => {
    const a = makePrim('sphere', [0.5]);
    const b = makePrim('box', [0.4, 0.4, 0.4]);
    const root = makeOp('union', [a, b]);
    const seen: string[] = [];
    walk(root, (n) => seen.push(n.id));
    expect(seen).toEqual([root.id, a.id, b.id]);
  });

  it('findNode locates by id', () => {
    const a = makePrim('sphere', [0.5]);
    const b = makePrim('box', [0.4, 0.4, 0.4]);
    const root = makeOp('union', [a, b]);
    expect(findNode(root, a.id)).toBe(a);
    expect(findNode(root, b.id)).toBe(b);
    expect(findNode(root, root.id)).toBe(root);
    expect(findNode(root, 'missing')).toBeNull();
  });

  it('updateAt returns a new tree with the node replaced', () => {
    const a = makePrim('sphere', [0.5]);
    const b = makePrim('box', [0.4, 0.4, 0.4]);
    const root = makeOp('union', [a, b]);
    const replacement = makePrim('sphere', [0.9]);
    const next = updateAt(root, a.id, replacement);
    expect(next).not.toBe(root);
    expect(next.kind).toBe('op');
    if (next.kind === 'op') {
      expect(next.children[0]).toBe(replacement);
      expect(next.children[1]).toBe(b);
    }
    // original unchanged
    if (root.kind === 'op') expect(root.children[0]).toBe(a);
  });

  it('removeNode drops a child and preserves siblings', () => {
    const a = makePrim('sphere', [0.5]);
    const b = makePrim('box', [0.4, 0.4, 0.4]);
    const c = makePrim('torus', [0.5, 0.15]);
    const root = makeOp('union', [a, b, c]);
    const next = removeNode(root, b.id);
    expect(next).not.toBeNull();
    if (next?.kind === 'op') {
      expect(next.children).toHaveLength(2);
      expect(next.children[0].id).toBe(a.id);
      expect(next.children[1].id).toBe(c.id);
    }
  });

  it('removeNode returns null when removing root', () => {
    const root = makePrim('sphere', [0.5]);
    expect(removeNode(root, root.id)).toBeNull();
  });

  it('addChild appends to the target op node', () => {
    const a = makePrim('sphere', [0.5]);
    const inner = makeOp('union', [a]);
    const root = makeOp('diff', [inner]);
    const newKid = makePrim('box', [0.3, 0.3, 0.3]);
    const next = addChild(root, inner.id, newKid);
    if (next.kind === 'op' && next.children[0].kind === 'op') {
      expect(next.children[0].children).toHaveLength(2);
      expect(next.children[0].children[1]).toBe(newKid);
    }
  });
});
