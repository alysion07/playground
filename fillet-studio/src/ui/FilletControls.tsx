import { useStore } from '../state/store';

export function FilletControls() {
  const fillet = useStore((s) => s.fillet);
  const applyFillet = useStore((s) => s.applyFillet);
  const wireframe = useStore((s) => s.wireframe);
  const setFillet = useStore((s) => s.setFillet);
  const setApplyFillet = useStore((s) => s.setApplyFillet);
  const setWireframe = useStore((s) => s.setWireframe);
  const run = useStore((s) => s.run);
  const status = useStore((s) => s.status);
  const lastStats = useStore((s) => s.lastStats);

  const running = status.kind === 'running';
  const tStar = fillet.R > 0 ? (fillet.R * fillet.R) / (2 * fillet.alpha) : 0;

  return (
    <div className="p-3 text-xs space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">
        Fillet PDE
      </div>

      <label className="flex items-center gap-2 text-neutral-300 select-none">
        <input
          type="checkbox"
          checked={applyFillet}
          onChange={(e) => setApplyFillet(e.target.checked)}
          className="accent-sky-500"
        />
        <span>Apply mean-curvature flow</span>
      </label>

      <Slider
        label="R (fillet radius)"
        min={0.01}
        max={0.3}
        step={0.005}
        value={fillet.R}
        disabled={!applyFillet}
        onChange={(v) => setFillet({ R: v })}
      />
      <Slider
        label="α (flow strength)"
        min={0.05}
        max={2.0}
        step={0.05}
        value={fillet.alpha}
        disabled={!applyFillet}
        onChange={(v) => setFillet({ alpha: v })}
      />
      <Slider
        label="N (resolution)"
        min={25}
        max={97}
        step={2}
        value={fillet.N}
        onChange={(v) => setFillet({ N: v | 0 })}
        fmt={(v) => `${v | 0}³`}
      />
      <Slider
        label="bbox half-side"
        min={0.5}
        max={2}
        step={0.05}
        value={fillet.extents}
        onChange={(v) => setFillet({ extents: v })}
      />

      <div className="text-[11px] text-neutral-500 tabular-nums">
        t* = R²/(2α) = {tStar.toFixed(4)}
      </div>

      <label className="flex items-center gap-2 text-neutral-300 select-none pt-2 border-t border-neutral-800">
        <input
          type="checkbox"
          checked={wireframe}
          onChange={(e) => setWireframe(e.target.checked)}
          className="accent-sky-500"
        />
        <span>Wireframe</span>
      </label>

      <button
        className={`w-full py-1.5 rounded font-medium transition ${
          running
            ? 'bg-neutral-800 text-neutral-500 cursor-wait'
            : 'bg-sky-600 hover:bg-sky-500 text-white'
        }`}
        onClick={() => run()}
        disabled={running}
      >
        {running ? stageLabel(status) : 'Compute'}
      </button>

      <StatusLine />
      {lastStats && (
        <div className="text-[11px] text-neutral-500 tabular-nums">
          {lastStats.triangles.toLocaleString()} tris · {lastStats.ms.toFixed(0)} ms
        </div>
      )}
    </div>
  );
}

function StatusLine() {
  const status = useStore((s) => s.status);
  if (status.kind === 'idle') return null;
  if (status.kind === 'error') {
    return <div className="text-rose-400 text-[11px]">Error: {status.message}</div>;
  }
  if (status.kind === 'running') {
    const pct = Math.round(status.progress * 100);
    return (
      <div className="text-[11px] text-neutral-400">
        {stageLabel(status)} · {pct}%
      </div>
    );
  }
  return null;
}

function stageLabel(s: { kind: 'running'; stage: string }): string {
  if (s.stage === 'sample') return 'Sampling…';
  if (s.stage === 'flow') return 'Flowing…';
  if (s.stage === 'mc') return 'Extracting…';
  return 'Running…';
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  disabled,
  fmt,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  fmt?: (v: number) => string;
}) {
  return (
    <label className={`block ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-500 tabular-nums">
          {fmt ? fmt(value) : value.toFixed(3)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-500"
      />
    </label>
  );
}
