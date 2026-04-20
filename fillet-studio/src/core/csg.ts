import type { CsgNode, CsgOp, OpNode, PrimNode, PrimType, Vec3 } from '../state/types';

let idCounter = 0;
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function makePrim(
  type: PrimType,
  params: number[],
  translate: Vec3 = [0, 0, 0],
  rotate: Vec3 = [0, 0, 0],
): PrimNode {
  return { kind: 'prim', id: makeId('p'), type, params, translate, rotate };
}

export function makeOp(op: CsgOp, children: CsgNode[], k = 0.1): OpNode {
  return { kind: 'op', id: makeId('o'), op, k, children };
}

export function walk(node: CsgNode, visit: (n: CsgNode, parent: OpNode | null) => void): void {
  function go(n: CsgNode, parent: OpNode | null): void {
    visit(n, parent);
    if (n.kind === 'op') for (const c of n.children) go(c, n);
  }
  go(node, null);
}

export function findNode(root: CsgNode, id: string): CsgNode | null {
  if (root.id === id) return root;
  if (root.kind === 'op') {
    for (const c of root.children) {
      const hit = findNode(c, id);
      if (hit) return hit;
    }
  }
  return null;
}

// Immutable update: returns a new tree with the node at `id` replaced.
// If the id is not found, returns the original root unchanged.
export function updateAt(root: CsgNode, id: string, replacement: CsgNode): CsgNode {
  if (root.id === id) return replacement;
  if (root.kind === 'op') {
    return { ...root, children: root.children.map((c) => updateAt(c, id, replacement)) };
  }
  return root;
}

// Immutable remove: returns a new tree with the node at `id` removed.
// Returns null if the root itself is removed.
export function removeNode(root: CsgNode, id: string): CsgNode | null {
  if (root.id === id) return null;
  if (root.kind === 'op') {
    const kept: CsgNode[] = [];
    for (const c of root.children) {
      const r = removeNode(c, id);
      if (r !== null) kept.push(r);
    }
    return { ...root, children: kept };
  }
  return root;
}

// Immutable add: appends `child` to the op node at `parentId`.
export function addChild(root: CsgNode, parentId: string, child: CsgNode): CsgNode {
  if (root.id === parentId && root.kind === 'op') {
    return { ...root, children: [...root.children, child] };
  }
  if (root.kind === 'op') {
    return { ...root, children: root.children.map((c) => addChild(c, parentId, child)) };
  }
  return root;
}
