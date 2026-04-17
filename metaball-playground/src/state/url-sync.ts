import { appStore, DEFAULT_RENDER, DEFAULT_SIM, MAX_BLOBS, BOUNDS } from './store';
import type { PaletteName, PresetName, RenderParams, SimParams, Vec3 } from './types';
import { mulberry32 } from '../util/rng';
import { populate } from '../sim/blob';

const SCHEMA_VERSION = 1;
const QUERY_KEY = 's';

type Encoded = {
  v: number;
  sim: SimParams;
  render: RenderParams;
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
    count: Math.max(1, Math.min(MAX_BLOBS, Math.floor(s.count))),
    blobSmoothness: round(s.blobSmoothness),
    gravity: round(s.gravity),
    damping: round(s.damping),
    attraction: round(s.attraction),
    mouseForce: round(s.mouseForce, 2),
    boundaryMode: s.boundaryMode,
    timeScale: round(s.timeScale, 2),
  };
}

function roundRender(r: RenderParams): RenderParams {
  const bg = r.backgroundColor;
  return {
    aa: round(r.aa, 2),
    colorSoftness: round(r.colorSoftness, 2),
    backgroundColor: [round(bg[0]), round(bg[1]), round(bg[2])] as Vec3,
    palette: r.palette,
    bloom: round(r.bloom),
    vignette: round(r.vignette),
    rimLight: round(r.rimLight),
  };
}

export function encodeCurrentState(): string {
  const { sim, render, seed, presetName } = appStore.getState();
  const payload: Encoded = {
    v: SCHEMA_VERSION,
    sim: roundSim(sim),
    render: roundRender(render),
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
  return v === 'Default' || v === 'Warm' || v === 'Cool' || v === 'Pastel' || v === 'Neon';
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
    return {
      v: SCHEMA_VERSION,
      sim: roundSim(sim),
      render: roundRender(render),
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

  const rng = mulberry32(decoded.seed);
  appStore.setState({
    sim: decoded.sim,
    render: decoded.render,
    blobs: populate(rng, decoded.sim.count, BOUNDS, undefined, decoded.render.palette),
    seed: decoded.seed,
    presetName: decoded.preset,
  });
  console.info('[url-sync] hydrated from ?s=');
  return true;
}
