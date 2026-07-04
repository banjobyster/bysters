// FX-5 (TDD 13.4): a state change can cascade to other fixtures, but the POLICY
// lives in a consumer subscriber, never in the framework. The store only offers
// the seam (subscribe) and applies each guarded write synchronously.

import { describe, it, expect } from 'vitest';
import { makeFixture } from './fixture.js';
import { createFixtureStore } from './store.js';

describe('FX-5: cascade is consumer policy over the subscribe seam', () => {
  it('a stage->failed transition drives deploy->error in the same synchronous tick', () => {
    const store = createFixtureStore([
      makeFixture({ id: 'stage', states: ['ok', 'failed'], state: 'ok' }),
      makeFixture({ id: 'deploy', states: ['idle', 'error'], state: 'idle' }),
    ]);
    // Consumer rule, expressed as a subscriber. The framework never sees this.
    const unsub = store.subscribe((fx, from, to) => {
      if (fx.id === 'stage' && to === 'failed') store.transition('deploy', 'error');
    });

    expect(store.transition('stage', 'failed')).toBe(true);
    expect(store.get('deploy')).toBe('error'); // cascaded synchronously, same tick
    expect(store.log.map((r) => r.id)).toEqual(['stage', 'deploy']); // ordered, no loop
    unsub();
  });

  it('a subscriber that unsubscribes stops receiving transitions', () => {
    const store = createFixtureStore([makeFixture({ id: 'f', states: ['a', 'b', 'c'], state: 'a' })]);
    const seen = [];
    const unsub = store.subscribe((fx, from, to) => seen.push(to));
    store.transition('f', 'b');
    unsub();
    store.transition('f', 'c');
    expect(seen).toEqual(['b']); // only the pre-unsub transition
  });
});
