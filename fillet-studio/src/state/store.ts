import { create } from 'zustand';
import type { CsgNode, ComputeStatus, FilletParams, MeshData, Vec3 } from './types';
import { addChild, makeOp, makePrim, removeNode, updateAt } from '../core/csg';
import { computeFillet } from '../pipeline/compute';

export type StoreState = {
  tree: CsgNode;
  selectedId: string | null;
  fillet: FilletParams;
  applyFillet: boolean;
  wireframe: boolean;
  status: ComputeStatus;
  mesh: MeshData | null;
  lastStats: { triangles: number; ms: number } | null;

  setSelected: (id: string | null) => void;
  setTree: (tree: CsgNode) => void;
  updateNode: (id: string, replacement: CsgNode) => void;
  removeById: (id: string) => void;
  addPrimToOp: (parentId: string, child: CsgNode) => void;
  setTranslate: (id: string, t: Vec3) => void;
  setRotate: (id: string, r: Vec3) => void;
  setParams: (id: string, params: number[]) => void;
  setOpK: (id: string, k: number) => void;
  setFillet: (patch: Partial<FilletParams>) => void;
  setApplyFillet: (v: boolean) => void;
  setWireframe: (v: boolean) => void;
  run: () => Promise<void>;
};

function defaultTree(): CsgNode {
  const a = makePrim('box', [0.5, 0.35, 0.35]);
  const b = makePrim('sphere', [0.42], [0.15, 0.2, 0.2]);
  return makeOp('smoothUnion', [a, b], 0.08);
}

// Reentrancy guard kept outside the reactive state so flipping it doesn't
// cause subscribers to rerender. `pending` means "another run() was requested
// while a run was in flight — re-trigger once the current one settles".
let runningFlag = false;
let pendingRun = false;

export const useStore = create<StoreState>((set, get) => ({
  tree: defaultTree(),
  selectedId: null,
  fillet: { R: 0.08, alpha: 0.5, N: 49, extents: 1 },
  applyFillet: true,
  wireframe: false,
  status: { kind: 'idle' },
  mesh: null,
  lastStats: null,

  setSelected: (id) => set({ selectedId: id }),
  setTree: (tree) => set({ tree }),
  updateNode: (id, replacement) => set((s) => ({ tree: updateAt(s.tree, id, replacement) })),
  removeById: (id) =>
    set((s) => {
      const next = removeNode(s.tree, id);
      if (!next) return s;
      const nextSel = s.selectedId === id ? null : s.selectedId;
      return { tree: next, selectedId: nextSel };
    }),
  addPrimToOp: (parentId, child) =>
    set((s) => ({
      tree: addChild(s.tree, parentId, child),
      // Auto-select the new node so its parameter editor appears immediately —
      // without this the user has to hunt for it in the tree panel to edit.
      selectedId: child.id,
    })),
  setTranslate: (id, t) =>
    set((s) => {
      const n = findById(s.tree, id);
      if (!n || n.kind !== 'prim') return s;
      return { tree: updateAt(s.tree, id, { ...n, translate: t }) };
    }),
  setRotate: (id, r) =>
    set((s) => {
      const n = findById(s.tree, id);
      if (!n || n.kind !== 'prim') return s;
      return { tree: updateAt(s.tree, id, { ...n, rotate: r }) };
    }),
  setParams: (id, params) =>
    set((s) => {
      const n = findById(s.tree, id);
      if (!n || n.kind !== 'prim') return s;
      return { tree: updateAt(s.tree, id, { ...n, params }) };
    }),
  setOpK: (id, k) =>
    set((s) => {
      const n = findById(s.tree, id);
      if (!n || n.kind !== 'op') return s;
      return { tree: updateAt(s.tree, id, { ...n, k }) };
    }),
  setFillet: (patch) => set((s) => ({ fillet: { ...s.fillet, ...patch } })),
  setApplyFillet: (v) => set({ applyFillet: v }),
  setWireframe: (v) => set({ wireframe: v }),

  run: async () => {
    if (runningFlag) {
      pendingRun = true;
      return;
    }
    runningFlag = true;
    try {
      // Loop so that any run() requests arriving mid-pipeline trigger exactly
      // one follow-up with the latest state — no tasks lost, no queue blowup.
      do {
        pendingRun = false;
        const { tree, fillet, applyFillet } = get();
        set({ status: { kind: 'running', stage: 'sample', progress: 0 } });
        try {
          const { mesh, ms } = await computeFillet(
            tree,
            fillet,
            (p) => set({ status: { kind: 'running', stage: p.stage, progress: p.progress } }),
            applyFillet,
          );
          const triangles = mesh.indices.length / 3;
          set({
            mesh,
            status: { kind: 'done', ms, triangles },
            lastStats: { triangles, ms },
          });
        } catch (err) {
          set({
            status: { kind: 'error', message: err instanceof Error ? err.message : String(err) },
          });
        }
      } while (pendingRun);
    } finally {
      runningFlag = false;
    }
  },
}));

function findById(root: CsgNode, id: string): CsgNode | null {
  if (root.id === id) return root;
  if (root.kind === 'op') {
    for (const c of root.children) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
  }
  return null;
}
