import { useEffect } from 'react';
import { Viewport } from './render/Viewport';
import { CsgTreePanel, SelectedNodeEditor } from './ui/CsgTreePanel';
import { FilletControls } from './ui/FilletControls';
import { ExportPanel } from './ui/ExportPanel';
import { useStore } from './state/store';

export default function App() {
  const mesh = useStore((s) => s.mesh);
  const wireframe = useStore((s) => s.wireframe);
  const run = useStore((s) => s.run);
  const tree = useStore((s) => s.tree);
  const fillet = useStore((s) => s.fillet);
  const applyFillet = useStore((s) => s.applyFillet);

  // Auto-recompute on input changes, debounced so continuous slider drags
  // don't queue hundreds of pipeline runs. The store's `run` guards against
  // overlapping invocations, so rapid edits just collapse into the last state.
  useEffect(() => {
    const id = setTimeout(() => {
      run();
    }, 180);
    return () => clearTimeout(id);
  }, [tree, fillet, applyFillet, run]);

  return (
    <div className="h-screen w-screen flex bg-neutral-950 text-neutral-100 overflow-hidden">
      <aside className="w-72 flex-shrink-0 border-r border-neutral-800 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-800">
          <div className="text-sm font-medium">Fillet Studio</div>
          <div className="text-[10px] text-neutral-500">
            CSG · curvature-flow · marching cubes
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <CsgTreePanel />
          <SelectedNodeEditor />
        </div>
      </aside>

      <main className="flex-1 relative min-w-0">
        <Viewport mesh={mesh} wireframe={wireframe} />
      </main>

      <aside className="w-72 flex-shrink-0 border-l border-neutral-800 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <FilletControls />
        </div>
        <ExportPanel />
      </aside>
    </div>
  );
}
