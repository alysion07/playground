import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetRipples,
  MAX_RIPPLES,
  getRipples,
  pushRipple,
  tickRipples,
} from '../src/sim/effects';

describe('ripple ring buffer', () => {
  beforeEach(() => _resetRipples());

  it('starts empty', () => {
    expect(getRipples().length).toBe(0);
  });

  it('appends until capacity', () => {
    for (let i = 0; i < MAX_RIPPLES; i++) pushRipple(i, 0, 1);
    expect(getRipples().length).toBe(MAX_RIPPLES);
  });

  it('ring-evicts the oldest entry once full', () => {
    for (let i = 0; i < MAX_RIPPLES; i++) pushRipple(i, 0, 1);
    // Fully fill, then push one more — total count stays at MAX_RIPPLES and
    // the first inserted slot should be overwritten.
    pushRipple(99, 0, 1);
    const r = getRipples();
    expect(r.length).toBe(MAX_RIPPLES);
    expect(r.some((rr) => rr.x === 99)).toBe(true);
    expect(r.some((rr) => rr.x === 0)).toBe(false);
  });

  it('ages ripples with tickRipples', () => {
    pushRipple(0, 0, 1);
    tickRipples(0.1);
    expect(getRipples()[0].ageSec).toBeCloseTo(0.1, 6);
  });

  it('expires ripples past lifetime', () => {
    pushRipple(0, 0, 1);
    tickRipples(1.1);
    expect(getRipples().length).toBe(0);
  });

  it('tickRipples with 0 dt is a no-op', () => {
    pushRipple(0, 0, 1);
    tickRipples(0);
    expect(getRipples().length).toBe(1);
    expect(getRipples()[0].ageSec).toBe(0);
  });
});
