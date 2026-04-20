import type { CsgNode, CsgOp, OpNode, PrimNode, PrimType, Vec3 } from '../state/types';

export type SerializedNode =
  | {
      kind: 'prim';
      type: PrimType;
      params: number[];
      translate: Vec3;
      rotate: Vec3;
    }
  | {
      kind: 'op';
      op: CsgOp;
      k: number;
      children: SerializedNode[];
    };

export function toJSON(node: CsgNode): SerializedNode {
  if (node.kind === 'prim') {
    return {
      kind: 'prim',
      type: node.type,
      params: [...node.params],
      translate: [...node.translate],
      rotate: [...node.rotate],
    };
  }
  return {
    kind: 'op',
    op: node.op,
    k: node.k,
    children: node.children.map(toJSON),
  };
}

let restoreIdCounter = 0;
function restoreId(prefix: string): string {
  return `${prefix}_r${++restoreIdCounter}`;
}

export function fromJSON(s: SerializedNode): CsgNode {
  if (s.kind === 'prim') {
    const node: PrimNode = {
      kind: 'prim',
      id: restoreId('p'),
      type: s.type,
      params: [...s.params],
      translate: [...s.translate],
      rotate: [...s.rotate],
    };
    return node;
  }
  const node: OpNode = {
    kind: 'op',
    id: restoreId('o'),
    op: s.op,
    k: s.k,
    children: s.children.map(fromJSON),
  };
  return node;
}

// Walk the tree calling `visit` for every node (parents first).
export function walk(node: CsgNode, visit: (n: CsgNode) => void): void {
  visit(node);
  if (node.kind === 'op') {
    for (const c of node.children) walk(c, visit);
  }
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
