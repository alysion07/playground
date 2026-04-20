import { Pane } from 'tweakpane';
import type { FolderApi } from 'tweakpane';
import {
  addPrim,
  appStore,
  removeNode,
  requestMeshBuild,
  requestReset,
  requestSingleSteps,
  setGrid,
  setOpK,
  setOpKind,
  setPde,
  setRender,
  setWind,
  updatePrim,
} from '../state/store';
import { walk } from '../core/csg';
import { PRIM_SCHEMAS } from '../core/sdfPrim';
import type { CsgNode, CsgOp, GridSize, OpNode, PrimNode, PrimType } from '../state/types';

const PRIM_TYPES: PrimType[] = ['sphere', 'box', 'torus', 'capsule', 'roundBox'];
const OP_TYPES: CsgOp[] = ['union', 'diff', 'intersect', 'smoothUnion'];
const GRID_SIZES: GridSize[] = [32, 64, 96, 128];

// Mounts the CSG editor into the panel element. Rebuilds the pane every time
// the tree structure changes so addPrim/removeNode reflect immediately. Pure
// parameter edits skip the rebuild via a manual refresh path.
export function mountCsgBuilder(host: HTMLElement): () => void {
  let pane: Pane | null = null;
  // Kept in closure so the mesh-state subscriber below can mutate it without
  // rebuilding the pane. Tweakpane re-reads bag values on `pane.refresh()`.
  const meshBag = { vertexCount: 0, overflow: 'ok' };

  const render = () => {
    if (pane) pane.dispose();
    pane = new Pane({ container: host, title: 'Erosion Sculptor' });
    const state = appStore.getState();

    // --- top-level controls
    const top = pane.addFolder({ title: 'Render' });
    const renderBag = {
      mode: state.render.mode,
      stepBudget: state.render.stepBudget,
      wireframe: state.render.wireframe,
    };
    // Mode radio: raymarch is the live SDF preview; mesh draws the MC output.
    // v1 is exclusive — switching to mesh assumes the user has clicked Rebuild
    // at least once, otherwise the mesh pass draws an empty frame.
    top
      .addBinding(renderBag, 'mode', {
        label: 'mode',
        options: { raymarch: 'raymarch', mesh: 'mesh' },
      })
      .on('change', (e) => setRender({ mode: e.value as 'raymarch' | 'mesh' }));
    top
      .addBinding(renderBag, 'stepBudget', { min: 16, max: 256, step: 1 })
      .on('change', (e) => setRender({ stepBudget: e.value }));
    top.addBinding(renderBag, 'wireframe').on('change', (e) => setRender({ wireframe: e.value }));

    // --- erosion (PDE) controls
    const erosion = pane.addFolder({ title: 'Erosion' });
    const erosionBag = {
      playing: state.pde.playing,
      stepsPerFrame: state.pde.stepsPerFrame,
      alpha: state.pde.alpha,
      dt: state.pde.dt,
      grid: state.grid.size,
    };
    erosion
      .addBinding(erosionBag, 'playing', { label: 'play' })
      .on('change', (e) => setPde({ playing: e.value }));
    erosion
      .addBinding(erosionBag, 'stepsPerFrame', { label: 'steps/frame', min: 1, max: 16, step: 1 })
      .on('change', (e) => setPde({ stepsPerFrame: e.value }));
    erosion
      .addBinding(erosionBag, 'alpha', { label: 'α (strength)', min: 0.05, max: 1.5, step: 0.01 })
      .on('change', (e) => setPde({ alpha: e.value }));
    // Slider goes well past the CFL cap; the scheduler clamps internally so the
    // user sees the requested value and can read effective dt via iter count.
    erosion
      .addBinding(erosionBag, 'dt', { label: 'dt (CFL clamped)', min: 1e-5, max: 5e-3, step: 1e-5 })
      .on('change', (e) => setPde({ dt: e.value }));
    erosion
      .addBinding(erosionBag, 'grid', {
        label: 'grid',
        options: Object.fromEntries(GRID_SIZES.map((g) => [`${g}³`, g])),
      })
      .on('change', (e) => setGrid({ size: e.value as GridSize }));
    erosion.addButton({ title: 'Step ×1' }).on('click', () => requestSingleSteps(1));
    erosion.addButton({ title: 'Step ×10' }).on('click', () => requestSingleSteps(10));
    erosion.addButton({ title: 'Reset' }).on('click', () => requestReset());

    // --- wind controls
    const wind = pane.addFolder({ title: 'Wind' });
    const windBag = {
      beta: state.wind.beta,
      yaw: state.wind.yaw,
      elevation: state.wind.elevation,
      noise: state.wind.noise,
      viz: state.wind.viz,
    };
    wind
      .addBinding(windBag, 'beta', { label: 'β (strength)', min: 0, max: 1.2, step: 0.01 })
      .on('change', (e) => setWind({ beta: e.value }));
    wind
      .addBinding(windBag, 'yaw', { label: 'yaw', min: 0, max: 2 * Math.PI, step: 0.01 })
      .on('change', (e) => setWind({ yaw: e.value }));
    wind
      .addBinding(windBag, 'elevation', {
        label: 'elevation',
        min: -Math.PI / 2,
        max: Math.PI / 2,
        step: 0.01,
      })
      .on('change', (e) => setWind({ elevation: e.value }));
    wind
      .addBinding(windBag, 'noise', { label: 'noise', min: 0, max: 1, step: 0.01 })
      .on('change', (e) => setWind({ noise: e.value }));
    wind
      .addBinding(windBag, 'viz', { label: 'viz (W)' })
      .on('change', (e) => setWind({ viz: e.value }));

    // --- mesh extraction (Marching Cubes)
    const meshFolder = pane.addFolder({ title: 'Mesh' });
    meshBag.vertexCount = state.mesh.vertexCount;
    meshBag.overflow = state.mesh.overflow ? 'OVERFLOW' : 'ok';
    meshFolder.addButton({ title: 'Rebuild Mesh' }).on('click', () => requestMeshBuild());
    meshFolder.addBinding(meshBag, 'vertexCount', { readonly: true, label: 'vertices' });
    meshFolder.addBinding(meshBag, 'overflow', { readonly: true, label: 'status' });

    // --- add primitive buttons
    const adders = pane.addFolder({ title: 'Add Primitive' });
    for (const t of PRIM_TYPES) {
      adders.addButton({ title: PRIM_SCHEMAS[t].label }).on('click', () => addPrim(t));
    }

    // --- recursive tree section
    const treeFolder = pane.addFolder({ title: 'CSG Tree' });
    renderTree(treeFolder, state.csg, 0);
  };

  const renderTree = (parent: FolderApi, node: CsgNode, depth: number): void => {
    if (node.kind === 'op') {
      const op = node as OpNode;
      const folder = parent.addFolder({
        title: `${'  '.repeat(depth)}● ${op.op}  (${op.children.length})`,
        expanded: depth < 1,
      });
      const bag = { op: op.op, k: op.k };
      folder
        .addBinding(bag, 'op', { options: Object.fromEntries(OP_TYPES.map((o) => [o, o])) })
        .on('change', (e) => setOpKind(op.id, e.value as CsgOp));
      if (op.op === 'smoothUnion') {
        folder
          .addBinding(bag, 'k', { min: 0.0, max: 0.6, step: 0.005 })
          .on('change', (e) => setOpK(op.id, e.value));
      }
      for (const child of op.children) renderTree(folder, child, depth + 1);
      return;
    }
    const prim = node as PrimNode;
    const schema = PRIM_SCHEMAS[prim.type];
    const folder = parent.addFolder({
      title: `${'  '.repeat(depth)}◆ ${schema.label}`,
      expanded: depth < 2,
    });
    const tBag = { x: prim.translate[0], y: prim.translate[1], z: prim.translate[2] };
    folder.addBinding(tBag, 'x', { min: -1.5, max: 1.5, step: 0.01 }).on('change', (e) =>
      updatePrim(prim.id, { translate: [e.value, prim.translate[1], prim.translate[2]] }),
    );
    folder.addBinding(tBag, 'y', { min: -1.5, max: 1.5, step: 0.01 }).on('change', (e) =>
      updatePrim(prim.id, { translate: [prim.translate[0], e.value, prim.translate[2]] }),
    );
    folder.addBinding(tBag, 'z', { min: -1.5, max: 1.5, step: 0.01 }).on('change', (e) =>
      updatePrim(prim.id, { translate: [prim.translate[0], prim.translate[1], e.value] }),
    );
    const pBag: Record<string, number> = {};
    for (const f of schema.fields) pBag[f.key] = prim.params[f.index] ?? f.default;
    for (const f of schema.fields) {
      folder
        .addBinding(pBag, f.key, { min: f.min, max: f.max, step: f.step })
        .on('change', (e) => {
          const params = [...prim.params];
          params[f.index] = e.value;
          updatePrim(prim.id, { params });
        });
    }
    folder.addButton({ title: 'remove' }).on('click', () => removeNode(prim.id));
  };

  render();

  // Re-render the pane whenever the structural shape of the tree changes
  // (a node added or removed, op kind toggled). For parameter-only changes
  // we let tweakpane keep its existing widgets; the shader is rebuilt every
  // change anyway because the SDF is generated from the tree.
  let lastSignature = signatureOf(appStore.getState().csg);
  const unsubscribe = appStore.subscribe((state, prev) => {
    const sig = signatureOf(state.csg);
    if (sig !== lastSignature) {
      lastSignature = sig;
      render();
      return;
    }
    // Mesh readout: mutate bag in place + refresh so the user sees new vertex
    // counts without losing scroll position / focus in the pane.
    if (state.mesh !== prev.mesh) {
      meshBag.vertexCount = state.mesh.vertexCount;
      meshBag.overflow = state.mesh.overflow ? 'OVERFLOW' : 'ok';
      pane?.refresh();
    }
  });

  return () => {
    unsubscribe();
    if (pane) pane.dispose();
  };
}

// Stable string fingerprint of the tree's *shape* — node ids, op kinds, child
// counts. Excludes parameter values so slider drags don't rebuild the pane.
function signatureOf(root: CsgNode): string {
  const parts: string[] = [];
  walk(root, (n) => {
    if (n.kind === 'prim') parts.push(`p:${n.id}:${n.type}`);
    else parts.push(`o:${n.id}:${n.op}:${n.children.length}`);
  });
  return parts.join('|');
}
