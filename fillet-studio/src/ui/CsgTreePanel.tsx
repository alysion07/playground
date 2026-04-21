import { useStore } from '../state/store';
import type { CsgNode, CsgOp, OpNode, PrimNode, PrimType, Vec3 } from '../state/types';

import { makeOp, makePrim } from '../core/csg';
import { PRIM_SCHEMAS } from '../core/sdfPrim';

const PRIM_TYPES: PrimType[] = ['sphere', 'box', 'torus', 'capsule', 'roundBox'];
const OP_TYPES: CsgOp[] = ['union', 'diff', 'intersect', 'smoothUnion'];

export function CsgTreePanel() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  return (
    <div className="p-3 text-xs">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">
        CSG Tree
      </div>
      <NodeView node={tree} depth={0} selectedId={selectedId} isRoot />
    </div>
  );
}

function NodeView({
  node,
  depth,
  selectedId,
  isRoot,
}: {
  node: CsgNode;
  depth: number;
  selectedId: string | null;
  isRoot?: boolean;
}) {
  const setSelected = useStore((s) => s.setSelected);
  const removeById = useStore((s) => s.removeById);
  const isSel = node.id === selectedId;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer group ${
          isSel ? 'bg-sky-900/40 text-sky-200' : 'hover:bg-neutral-800/60 text-neutral-200'
        }`}
        style={{ marginLeft: depth * 10 }}
        onClick={() => setSelected(node.id)}
      >
        <span className="w-3 text-center text-neutral-500">
          {node.kind === 'op' ? '◆' : '•'}
        </span>
        <span className="flex-1 truncate">
          {node.kind === 'op'
            ? `${opLabel(node.op)} (k=${node.k.toFixed(2)})`
            : PRIM_SCHEMAS[node.type].label}
        </span>
        {!isRoot && (
          <button
            className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-rose-400 transition"
            onClick={(e) => {
              e.stopPropagation();
              removeById(node.id);
            }}
          >
            ✕
          </button>
        )}
      </div>
      {node.kind === 'op' && (
        <>
          {node.children.map((c) => (
            <NodeView key={c.id} node={c} depth={depth + 1} selectedId={selectedId} />
          ))}
          <AddMenu parent={node} depth={depth + 1} />
        </>
      )}
    </div>
  );
}

function AddMenu({ parent, depth }: { parent: OpNode; depth: number }) {
  const addPrimToOp = useStore((s) => s.addPrimToOp);
  // Place each new primitive on a small ring in the xz plane so it stays well
  // inside the default sampling cube (extents=1 → [-1,1]³) and doesn't pile
  // on top of siblings. Origin defaults would be subsumed under (smooth-)union;
  // a straight +x stagger escaped the sampling cube after a couple of adds.
  const n = parent.children.length;
  const angle = n * 1.2;
  const radius = 0.55;
  const spawnOffset: Vec3 = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
  return (
    <div
      className="flex flex-wrap items-center gap-1 py-1 text-[10px] text-neutral-500"
      style={{ marginLeft: depth * 10 }}
    >
      <span className="mr-1">+</span>
      {PRIM_TYPES.map((t) => (
        <button
          key={t}
          className="px-1.5 py-0.5 rounded border border-neutral-800 hover:border-sky-500 hover:text-sky-300"
          onClick={() =>
            addPrimToOp(
              parent.id,
              makePrim(
                t,
                PRIM_SCHEMAS[t].fields.map((f) => f.default),
                spawnOffset,
              ),
            )
          }
        >
          {PRIM_SCHEMAS[t].label}
        </button>
      ))}
      <span className="mx-1 text-neutral-700">|</span>
      {OP_TYPES.map((op) => (
        <button
          key={op}
          className="px-1.5 py-0.5 rounded border border-neutral-800 hover:border-amber-500 hover:text-amber-300"
          onClick={() => addPrimToOp(parent.id, makeOp(op, []))}
        >
          {opLabel(op)}
        </button>
      ))}
    </div>
  );
}

function opLabel(op: CsgOp): string {
  return op === 'smoothUnion' ? 'Smooth Union' : op.charAt(0).toUpperCase() + op.slice(1);
}

export function SelectedNodeEditor() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  if (!selectedId) return null;
  const node = findById(tree, selectedId);
  if (!node) return null;
  return node.kind === 'prim' ? (
    <PrimEditor node={node} />
  ) : (
    <OpEditor node={node} />
  );
}

function PrimEditor({ node }: { node: PrimNode }) {
  const setParams = useStore((s) => s.setParams);
  const setTranslate = useStore((s) => s.setTranslate);
  const setRotate = useStore((s) => s.setRotate);
  const schema = PRIM_SCHEMAS[node.type];
  return (
    <div className="p-3 text-xs border-t border-neutral-800 space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">
        {schema.label}
      </div>
      {schema.fields.map((f) => (
        <Slider
          key={f.key}
          label={f.key}
          min={f.min}
          max={f.max}
          step={f.step}
          value={node.params[f.index] ?? f.default}
          onChange={(v) => {
            const next = node.params.slice();
            next[f.index] = v;
            setParams(node.id, next);
          }}
        />
      ))}
      <Vec3Editor
        label="translate"
        value={node.translate}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => setTranslate(node.id, v)}
      />
      <Vec3Editor
        label="rotate"
        value={node.rotate}
        min={-Math.PI}
        max={Math.PI}
        step={0.01}
        onChange={(v) => setRotate(node.id, v)}
      />
    </div>
  );
}

function OpEditor({ node }: { node: OpNode }) {
  const setOpK = useStore((s) => s.setOpK);
  const isSmooth = node.op === 'smoothUnion';
  return (
    <div className="p-3 text-xs border-t border-neutral-800 space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">
        {opLabel(node.op)}
      </div>
      {isSmooth ? (
        <Slider
          label="smoothness k"
          min={0.0}
          max={0.4}
          step={0.005}
          value={node.k}
          onChange={(v) => setOpK(node.id, v)}
        />
      ) : (
        <div className="text-neutral-500">No tunable parameters.</div>
      )}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-500 tabular-nums">{value.toFixed(3)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-500"
      />
    </label>
  );
}

function Vec3Editor({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: readonly [number, number, number];
  min: number;
  max: number;
  step: number;
  onChange: (v: [number, number, number]) => void;
}) {
  return (
    <div>
      <div className="text-neutral-300 mb-1">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <div key={axis}>
            <div className="text-[10px] text-neutral-500 mb-0.5">{axis}</div>
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={value[i]}
              onChange={(e) => {
                const next = [...value] as [number, number, number];
                next[i] = Number(e.target.value);
                onChange(next);
              }}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-neutral-200 tabular-nums"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

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
