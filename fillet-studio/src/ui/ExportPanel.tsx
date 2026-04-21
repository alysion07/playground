import { useStore } from '../state/store';
import { exportGlb } from '../export/glb';
import { exportStl } from '../export/stl';

export function ExportPanel() {
  const mesh = useStore((s) => s.mesh);
  const disabled = !mesh || mesh.indices.length === 0;
  return (
    <div className="p-3 text-xs space-y-2 border-t border-neutral-800">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">
        Export
      </div>
      <button
        className={`w-full py-1.5 rounded border ${
          disabled
            ? 'border-neutral-800 text-neutral-600 cursor-not-allowed'
            : 'border-neutral-700 text-neutral-200 hover:border-sky-500 hover:text-sky-300'
        }`}
        disabled={disabled}
        onClick={() => mesh && exportGlb(mesh, `fillet-${Date.now()}.glb`)}
      >
        Download GLB
      </button>
      <button
        className={`w-full py-1.5 rounded border ${
          disabled
            ? 'border-neutral-800 text-neutral-600 cursor-not-allowed'
            : 'border-neutral-700 text-neutral-200 hover:border-amber-500 hover:text-amber-300'
        }`}
        disabled={disabled}
        onClick={() => mesh && exportStl(mesh, `fillet-${Date.now()}.stl`)}
      >
        Download STL (binary)
      </button>
    </div>
  );
}
