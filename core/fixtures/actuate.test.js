// Unit tests for the actuate executor (the interact-channel motor), driven
// directly so the handshake invariants are pinned independent of any behavior:
// wire-in -> dwell -> commit-the-wired-in-target -> release, re-target re-plugs,
// and a commit returns to idle so a re-bid is a fresh contact (never a wedge).

import { describe, it, expect } from 'vitest';
import { createActuator, stepActuate } from './actuate.js';
import { makeFixture } from './fixture.js';
import { createFixtureStore } from './store.js';

const freshStore = () => createFixtureStore([makeFixture({ id: 'a', states: ['x', 'y', 'z'], state: 'x' })]);
const dt = 1 / 60;

describe('actuate executor handshake', () => {
  it('plugs on contact, holds through the dwell, commits the wired-in target, then releases', () => {
    const store = freshStore();
    const act = createActuator();
    const intent = { kind: 'actuate', fixture: store.fixture('a'), to: 'y', dwell: 0.3 };
    expect(stepActuate(act, intent, { store, by: 'bot', dt })).toMatchObject({ kind: 'plug' });
    expect(act.plugged).toBe(true);

    // Feed the intent until the first commit, then stop (a real behavior stops
    // bidding once the fixture reaches its target).
    let committedAt = -1;
    let releasedAt = -1;
    for (let i = 1; i < 60; i++) {
      const r = stepActuate(act, intent, { store, by: 'bot', dt });
      if (store.get('a') === 'y') {
        committedAt = i;
        if (r && r.kind === 'release') releasedAt = i;
        break;
      }
    }
    expect(committedAt).toBeGreaterThan(0);
    expect(store.log[0]).toMatchObject({ to: 'y', by: 'bot' });
    expect(releasedAt).toBe(committedAt); // release fires exactly at commit
    expect(act.plugged).toBe(false); // unplugged the instant it commits
  });

  it('re-targeting mid-dwell re-plugs and commits the NEW target, never the abandoned one', () => {
    const store = freshStore();
    const act = createActuator();
    const fx = store.fixture('a');
    stepActuate(act, { kind: 'actuate', fixture: fx, to: 'y', dwell: 0.3 }, { store, by: 'bot', dt });
    stepActuate(act, { kind: 'actuate', fixture: fx, to: 'y', dwell: 0.3 }, { store, by: 'bot', dt });
    // switch the target before 'y' can commit
    const sw = stepActuate(act, { kind: 'actuate', fixture: fx, to: 'z', dwell: 0.3 }, { store, by: 'bot', dt });
    expect(sw).toMatchObject({ kind: 'plug' }); // fresh contact for the new target
    for (let i = 0; i < 40; i++) stepActuate(act, { kind: 'actuate', fixture: fx, to: 'z', dwell: 0.3 }, { store, by: 'bot', dt });
    expect(store.get('a')).toBe('z');
    expect(store.log.every((r) => r.to !== 'y')).toBe(true); // the abandoned target was never written
  });

  it('re-arms after a commit: a fixture bid again (with no gap) is operated again, not wedged', () => {
    const store = freshStore();
    const act = createActuator();
    const drive = () => ({ kind: 'actuate', fixture: store.fixture('a'), to: 'y', dwell: 0.15 });
    for (let i = 0; i < 12; i++) stepActuate(act, drive(), { store, by: 'bot', dt });
    expect(store.get('a')).toBe('y');
    store.transition('a', 'x'); // an external writer flips it back
    for (let i = 0; i < 12; i++) stepActuate(act, drive(), { store, by: 'bot', dt });
    expect(store.get('a')).toBe('y');
    expect(store.log.filter((r) => r.by === 'bot' && r.to === 'y').length).toBe(2); // operated twice
  });

  it('releases and commits nothing when the intent vanishes mid-dwell (interrupted)', () => {
    const store = freshStore();
    const act = createActuator();
    stepActuate(act, { kind: 'actuate', fixture: store.fixture('a'), to: 'y', dwell: 0.3 }, { store, by: 'bot', dt });
    const r = stepActuate(act, null, { store, by: 'bot', dt }); // e.g. flee stole the byster away
    expect(r).toMatchObject({ kind: 'release' });
    expect(act.plugged).toBe(false);
    expect(store.get('a')).toBe('x'); // never committed
  });
});
