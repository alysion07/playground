import {
  appStore,
  DEFAULT_RENDER,
  DEFAULT_SIM,
  setMode,
  setPreset,
} from './store';
import type { ModeName, PaletteName, PresetName, RenderParams, SimParams } from './types';

const SCHEMA_VERSION = 1;
const QUERY_KEY = 's';

type Encoded = {
  v: number;
  sim: SimParams;
  render: RenderParams;
  mode: ModeName;
  seed: number;
  preset: PresetName | null;
};

function base64UrlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return decodeURIComponent(escape(atob(b64)));
}

function round(n: number, digits = 3): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function roundSim(s: SimParams): SimParams {
  return {
    gravity: round(s.gravity, 2),
    damping: round(s.damping),
    mergeK: round(s.mergeK),
    mergeOverlap: round(s.mergeOverlap),
    timeScale: round(s.timeScale, 2),
  };
}

function roundRender(r: RenderParams): RenderParams {
  return {
    gridIntensity: round(r.gridIntensity),
    glassRim: round(r.glassRim),
    sssDensity: round(r.sssDensity),
    backgroundTop: [round(r.backgroundTop[0]), round(r.backgroundTop[1]), round(r.backgroundTop[2])],
    backgroundBottom: [
      round(r.backgroundBottom[0]),
      round(r.backgroundBottom[1]),
      round(r.backgroundBottom[2]),
    ],
    halfRes: r.halfRes,
    stepBudget: Math.max(16, Math.min(128, Math.round(r.stepBudget))),
    palette: r.palette,
    cameraFollow: r.cameraFollow,
    dropShape: r.dropShape,
    colorMode: r.colorMode,
  };
}

export function encodeCurrentState(): string {
  const { sim, render, mode, seed, presetName } = appStore.getState();
  const payload: Encoded = {
    v: SCHEMA_VERSION,
    sim: roundSim(sim),
    render: roundRender(render),
    mode,
    seed,
    preset: presetName,
  };
  return base64UrlEncode(JSON.stringify(payload));
}

export function buildShareUrl(): string {
  const encoded = encodeCurrentState();
  const url = new URL(window.location.href);
  url.searchParams.set(QUERY_KEY, encoded);
  return url.toString();
}

function isPalette(v: unknown): v is PaletteName {
  return (
    v === 'Aquarium' || v === 'Caramel' || v === 'Lab' || v === 'Mono' || v === 'Tetris'
  );
}

function isMode(v: unknown): v is ModeName {
  return v === 'zen' || v === 'tower';
}

function decode(raw: string): Encoded | null {
  try {
    const json = base64UrlDecode(raw);
    const parsed = JSON.parse(json) as Partial<Encoded>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== SCHEMA_VERSION) {
      console.warn(`[url-sync] unknown schema version v=${parsed.v}, ignoring`);
      return null;
    }
    if (!parsed.sim || !parsed.render || typeof parsed.seed !== 'number') return null;
    const sim: SimParams = { ...DEFAULT_SIM, ...parsed.sim };
    const render: RenderParams = { ...DEFAULT_RENDER, ...parsed.render };
    if (!isPalette(render.palette)) render.palette = DEFAULT_RENDER.palette;
    const mode: ModeName = isMode(parsed.mode) ? parsed.mode : 'zen';
    return {
      v: SCHEMA_VERSION,
      sim: roundSim(sim),
      render: roundRender(render),
      mode,
      seed: parsed.seed,
      preset: parsed.preset ?? null,
    };
  } catch (err) {
    console.warn('[url-sync] decode failed', err);
    return null;
  }
}

export function hydrateFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(QUERY_KEY);
  if (!raw) return false;
  const decoded = decode(raw);
  if (!decoded) return false;

  appStore.setState({
    sim: decoded.sim,
    render: decoded.render,
    seed: decoded.seed,
  });
  setMode(decoded.mode);
  setPreset(decoded.preset);
  console.info('[url-sync] hydrated from ?s=');
  return true;
}
