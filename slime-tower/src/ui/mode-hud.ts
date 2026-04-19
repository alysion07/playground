import { appStore, setMode } from '../state/store';
import type { ModeName } from '../state/types';
import { MODES, MODE_ORDER } from '../sim/modes';

export function mountModeHud(host: HTMLElement): () => void {
  host.innerHTML = '';
  host.className =
    'fixed top-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none select-none';

  const chipRow = document.createElement('div');
  chipRow.className =
    'flex gap-1 bg-black/30 backdrop-blur-md border border-white/10 rounded-full p-1 pointer-events-auto';

  const chips = new Map<ModeName, HTMLButtonElement>();
  for (const name of MODE_ORDER) {
    const def = MODES[name];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label;
    btn.title = def.hint;
    btn.className = chipClass(false);
    btn.addEventListener('click', () => setMode(name));
    chips.set(name, btn);
    chipRow.appendChild(btn);
  }

  const readout = document.createElement('div');
  readout.className =
    'font-mono text-[11px] text-white/70 bg-black/30 backdrop-blur-md border border-white/10 rounded-full px-3 py-1';

  host.appendChild(chipRow);
  host.appendChild(readout);

  const applyMode = (mode: ModeName) => {
    for (const [name, btn] of chips) btn.className = chipClass(name === mode);
  };

  const applyReadout = (mode: ModeName) => {
    const { score, slimes } = appStore.getState();
    const currentH = slimes.reduce((m, s) => Math.max(m, s.pos[1] + s.radii[1]), 0);
    switch (mode) {
      case 'zen':
        readout.textContent = `${slimes.length} slimes · h ${currentH.toFixed(2)}m`;
        break;
      case 'tower':
        readout.textContent = `now ${currentH.toFixed(2)}m · best ${score.maxHeight.toFixed(2)}m · topples ${score.topples}`;
        break;
      case 'vessel':
        readout.textContent = `vessel mode — 소스 스캐폴드 (v2)`;
        break;
    }
  };

  applyMode(appStore.getState().mode);
  applyReadout(appStore.getState().mode);

  const unsubscribe = appStore.subscribe((state, prev) => {
    if (state.mode !== prev.mode) applyMode(state.mode);
    if (
      state.mode !== prev.mode ||
      state.slimes !== prev.slimes ||
      state.score !== prev.score
    ) {
      applyReadout(state.mode);
    }
  });

  // Also refresh readout on an rAF cadence so the "now height" field animates
  // as slimes fall even when the slime array reference is the same.
  let raf = 0;
  const tick = () => {
    applyReadout(appStore.getState().mode);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    unsubscribe();
    cancelAnimationFrame(raf);
    host.innerHTML = '';
  };
}

function chipClass(active: boolean): string {
  const base =
    'px-3 py-1 text-[11px] font-mono rounded-full transition-colors cursor-pointer';
  return active
    ? `${base} bg-white/90 text-black`
    : `${base} text-white/70 hover:text-white hover:bg-white/10`;
}
