import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/state/store';

describe('store gizmoMode', () => {
  beforeEach(() => {
    useStore.setState({ gizmoMode: 'translate' });
  });

  it('defaults to translate', () => {
    expect(useStore.getState().gizmoMode).toBe('translate');
  });

  it('setGizmoMode updates state without touching tree/mesh', () => {
    const before = useStore.getState();
    useStore.getState().setGizmoMode('rotate');
    const after = useStore.getState();
    expect(after.gizmoMode).toBe('rotate');
    expect(after.tree).toBe(before.tree);
    expect(after.mesh).toBe(before.mesh);
  });
});
