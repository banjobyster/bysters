// Fixture foundation acceptance tests (TDD Section 13.4, FX-1 and FX-2). Pure,
// headless: a Fixture is a plain multi-state object, the store is a synchronous
// guarded observable. The framework is value-neutral - it enforces the state
// machine and records who moved what, but never interprets what a state means.

import { describe, it, expect } from 'vitest';
import { makeFixture, canTransition } from './fixture.js';
import { createFixtureStore } from './store.js';

const states = ['neutral', 'failed', 'fixed'];

describe('FX-1: opaque states + parity (human and agent writes are identical)', () => {
  it('a human transition and an agent transition to the same state leave identical store state', () => {
    const human = createFixtureStore([makeFixture({ id: 'f', states, state: 'neutral' })]);
    const agent = createFixtureStore([makeFixture({ id: 'f', states, state: 'neutral' })]);
    expect(human.transition('f', 'failed')).toBe(true); // human: no byAgent
    expect(agent.transition('f', 'failed', 'botA')).toBe(true); // agent
    expect(human.get('f')).toBe('failed');
    expect(agent.get('f')).toBe('failed'); // identical resulting state
  });

  it('records WHO moved a fixture (byAgent) and WHEN (a monotonic seq), never WHAT the state means', () => {
    const store = createFixtureStore([makeFixture({ id: 'f', states, state: 'neutral' })]);
    store.transition('f', 'failed'); // human
    store.transition('f', 'fixed', 'blue');
    expect(store.log.map((r) => [r.from, r.to, r.by])).toEqual([
      ['neutral', 'failed', null],
      ['failed', 'fixed', 'blue'],
    ]);
    expect(store.log[0].seq).toBeLessThan(store.log[1].seq); // monotonic "when"
    // Nothing on the store or fixture flags 'failed' as bad: it is just a string.
    expect(store.fixture('f').states).toContain('failed');
  });

  it('notifies subscribers with (fixture, from, to, byAgent) on every applied transition', () => {
    const store = createFixtureStore([makeFixture({ id: 'f', states, state: 'neutral' })]);
    const seen = [];
    store.subscribe((fx, from, to, by) => seen.push([fx.id, from, to, by]));
    store.transition('f', 'failed', 'red');
    expect(seen).toEqual([['f', 'neutral', 'failed', 'red']]);
  });
});

describe('FX-2: transition guards restrict from>to moves', () => {
  const guards = [['neutral', 'failed'], ['failed', 'fixed'], ['fixed', 'neutral']];

  it('canTransition is false for a move the guards do not allow, and the write is refused', () => {
    const store = createFixtureStore([makeFixture({ id: 'f', states, state: 'fixed', guards })]);
    // From 'fixed' the only allowed move is fixed>neutral; fixed>failed is not listed.
    expect(store.canTransition('f', 'failed')).toBe(false);
    expect(store.transition('f', 'failed')).toBe(false);
    expect(store.get('f')).toBe('fixed'); // unchanged
  });

  it('canTransition is true for an allowed move, and the write applies', () => {
    const store = createFixtureStore([makeFixture({ id: 'f', states, state: 'neutral', guards })]);
    expect(store.canTransition('f', 'failed')).toBe(true);
    expect(store.transition('f', 'failed')).toBe(true);
    expect(store.get('f')).toBe('failed');
  });

  it('with no guards declared, any declared state is reachable from any other (but not itself)', () => {
    const fx = makeFixture({ id: 'f', states, state: 'neutral' });
    expect(canTransition(fx, 'fixed')).toBe(true);
    expect(canTransition(fx, 'neutral')).toBe(false); // no-op is not a transition
    expect(canTransition(fx, 'exploded')).toBe(false); // undeclared state
  });
});
