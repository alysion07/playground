import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom provides window/location/URL/URLSearchParams/btoa/atob.
// @vitest-environment jsdom

describe('url-sync round-trip', () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState(null, '', '/');
  });

  it('encodes + decodes current state with stable fields', async () => {
    const { appStore } = await import('../src/state/store');
    const { setSim, setRender } = await import('../src/state/store');
    const { encodeCurrentState, hydrateFromUrl } = await import('../src/state/url-sync');

    setSim({ count: 7, gravity: 0.42, boundaryMode: 'wrap' });
    setRender({ palette: 'Neon', bloom: 0.77 });

    const encoded = encodeCurrentState();
    expect(encoded.length).toBeGreaterThan(10);

    // Snapshot expected values before we mutate back to defaults.
    const snap = appStore.getState();

    // Reset to defaults, then hydrate from URL.
    setSim({ count: 3, gravity: 0, boundaryMode: 'bounce' });
    setRender({ palette: 'Default', bloom: 0.2 });

    window.history.replaceState(null, '', `/?s=${encoded}`);
    const ok = hydrateFromUrl();
    expect(ok).toBe(true);

    const restored = appStore.getState();
    expect(restored.sim.count).toBe(snap.sim.count);
    expect(restored.sim.gravity).toBeCloseTo(snap.sim.gravity, 3);
    expect(restored.sim.boundaryMode).toBe(snap.sim.boundaryMode);
    expect(restored.render.palette).toBe(snap.render.palette);
    expect(restored.render.bloom).toBeCloseTo(snap.render.bloom, 3);
    expect(restored.blobs.length).toBe(snap.sim.count);
  });

  it('returns false and leaves state untouched when ?s= is missing', async () => {
    const { hydrateFromUrl } = await import('../src/state/url-sync');
    window.history.replaceState(null, '', '/');
    expect(hydrateFromUrl()).toBe(false);
  });

  it('ignores bogus payloads', async () => {
    const { hydrateFromUrl } = await import('../src/state/url-sync');
    window.history.replaceState(null, '', '/?s=not-base64!!!');
    expect(hydrateFromUrl()).toBe(false);
  });
});
