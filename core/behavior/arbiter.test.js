// Per-channel arbitration acceptance tests (TDD Section 13.2). Pure, headless.

import { describe, it, expect } from 'vitest';
import { Arbiter } from './arbiter.js';

const b = (id, priority, bid) => ({ id, priority, update: () => bid });

describe('BA-1: per-channel coexistence', () => {
  it('grants locomotion to flee AND gaze to curiosity in the same frame', () => {
    const flee = b('flee', 90, { locomotion: { kind: 'goto', vertex: 1 } });
    const curiosity = b('curiosity', 30, { gaze: { kind: 'look', point: { x: 0, y: 0 } } });
    const w = new Arbiter().resolve([flee, curiosity], {}, {}, 1 / 60);
    expect(w.locomotion.vertex).toBe(1);
    expect(w.gaze.kind).toBe('look');
  });
});

describe('BA-2: priority on a contested channel', () => {
  it('the higher priority wins the channel; the lower still runs', () => {
    let lowRan = false;
    const high = b('high', 90, { locomotion: { kind: 'goto', vertex: 1 } });
    const low = {
      id: 'low',
      priority: 50,
      update: () => {
        lowRan = true;
        return { locomotion: { kind: 'goto', vertex: 2 } };
      },
    };
    const w = new Arbiter().resolve([high, low], {}, {}, 1 / 60);
    expect(w.locomotion.vertex).toBe(1);
    expect(lowRan).toBe(true);
  });
});

describe('BA-3: hysteresis / min-hold', () => {
  it('an incumbent is not stolen by a rival that only barely outranks it', () => {
    const arb = new Arbiter();
    const A = b('A', 50, { locomotion: { kind: 'goto', vertex: 1 } });
    const B = b('B', 52, { locomotion: { kind: 'goto', vertex: 2 } }); // < 50 + bump
    expect(arb.resolve([A], {}, {}, 1 / 60).locomotion.vertex).toBe(1); // A takes it
    expect(arb.resolve([B, A], {}, {}, 1 / 60).locomotion.vertex).toBe(1); // A keeps it
  });

  it('a clearly higher rival takes the channel once the min-hold expires', () => {
    const arb = new Arbiter();
    const A = b('A', 50, { locomotion: { kind: 'goto', vertex: 1 } });
    const C = b('C', 70, { locomotion: { kind: 'goto', vertex: 3 } }); // > 50 + bump
    arb.resolve([A], {}, {}, 1 / 60); // A owns, hold starts
    // within the hold window, A still holds even against C
    expect(arb.resolve([C, A], {}, {}, 0.05).locomotion.vertex).toBe(1);
    // a big dt expires the hold; now C wins
    expect(arb.resolve([C, A], {}, {}, 0.5).locomotion.vertex).toBe(3);
  });
});

describe('BA-4: tags are advertised (unioned), not arbitrated', () => {
  it('unions every bidder tags, deduped, regardless of who won a channel', () => {
    const winner = b('a', 90, { locomotion: { kind: 'stop' }, tags: { kind: 'tag', names: ['caught'] } });
    const loser = b('b', 40, { tags: { kind: 'tag', names: ['busy', 'caught'] } }); // wins no channel
    const w = new Arbiter().resolve([winner, loser], {}, {}, 1 / 60);
    expect([...w.tags].sort()).toEqual(['busy', 'caught']); // both bidders' tags, deduped
    expect(w.locomotion.kind).toBe('stop');
  });

  it('is an empty set when no behavior tags', () => {
    const only = b('g', 30, { gaze: { kind: 'look', point: { x: 0, y: 0 } } });
    expect(new Arbiter().resolve([only], {}, {}, 1 / 60).tags.size).toBe(0);
  });
});
