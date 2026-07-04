// mount() degradation contract (TDD Section 10). The frame loop needs a real
// DOM + WebGL, so it is exercised live in the sandbox/playground; here we pin
// the additive-and-degradable guarantee: with no window (the node test env, and
// the same path taken under prefers-reduced-motion / no-WebGL), mount() creates
// nothing and returns a no-op handle whose every method is safe to call.

import { describe, it, expect } from 'vitest';
import { mount } from './mount-dom.js';

describe('mount degrades to a safe no-op when the page cannot host bysters', () => {
  it('returns a no-op handle (no Pixi, no throw) with no window', async () => {
    const handle = await mount({ bysters: [{ name: 'x', character: {} }] });
    expect(handle.degraded).toBe(true);
    expect(handle.stage).toBeNull();
    expect(handle.store).toBeNull();
    expect(handle.cast).toEqual([]);
    // every method is callable and harmless
    expect(() => handle.rebuild()).not.toThrow();
    expect(() => handle.step()).not.toThrow();
    expect(() => handle.unmount()).not.toThrow();
    expect(handle.goto('x', {})).toBe(false);
    expect(typeof handle.on('rebuild', () => {})).toBe('function');
  });
});
