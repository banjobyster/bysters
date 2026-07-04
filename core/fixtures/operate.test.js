// The agent side of Fixtures (TDD 13.4): the actuate handshake (FX-3) and the
// headline mirror-config rivalry (FX-4). Character-agnostic, headless: one
// generic operateFixtures behavior, run with plain vs mirrored { match, drive }
// config, is the whole saboteur-vs-repairer story. Nothing here says good/bad.

import { describe, it, expect } from 'vitest';
import { Byster } from '../behavior/byster.js';
import { Stage } from '../behavior/stage.js';
import { operateFixtures } from '../behavior/library.js';
import { SurfaceMover } from '../surface-mover.js';
import { surfaceForSide } from '../../dom/collect.js';
import { compileSurfaceGraph } from '../path/compile.js';
import { LAUNCH_AGILE } from '../path/graph.js';
import { makeFixture } from './fixture.js';
import { createFixtureStore } from './store.js';

const CHAR = {
  name: 'test',
  params: {
    scale: 1, bodyW: 20, bodyH: 16, headW: 40, headH: 32,
    hipX: [8, 4, -4, -8], hipY: 6, footRestX: [10, 5, -5, -10], standH: 20,
    stepThresholdBase: 12, walkSpeed: 200, wanderSpeed: 90, accel: 900,
  },
  palette: { pix: [0, 1, 2, 3] },
  legs: { rings: 4, near: {}, far: {} },
  face: { w: 8, h: 8, animated: [], exprs: { idle: (f) => f.px(1, 1, 1), sync: () => {} } },
  buildBody() {},
  buildHead() {
    return { x: 0, y: 0, w: 8, h: 8 };
  },
};

const groundGraph = () =>
  compileSurfaceGraph([surfaceForSide({ x: -100, y: 400, w: 1000, h: 0 }, 'top', null, { ground: true })], [], LAUNCH_AGILE);

const byster = (g, name, along, behaviors) => {
  const mover = new SurfaceMover(CHAR);
  mover.spawn(g, 0, along, LAUNCH_AGILE);
  return new Byster(name, mover, behaviors);
};

describe('FX-3: the actuate handshake (approach -> plug -> dwell -> guarded commit -> release)', () => {
  it('operateFixtures routes to the fixture, plugs on arrival, dwells, commits with byAgent=self, then releases', () => {
    const g = groundGraph();
    const store = createFixtureStore([makeFixture({ id: 'rack', states: ['broken', 'fixed'], state: 'broken', x: 600, y: 400 })]);
    const stage = new Stage(g, { store });
    const b = byster(g, 'blue', 120, [operateFixtures({ match: (fx) => fx.state === 'broken', drive: 'fixed', dwell: 0.3 })]);
    stage.add(b);

    const at = { approached: -1, plugged: -1, committed: -1, released: -1 };
    let wasPlugged = false;
    for (let i = 0; i < 700; i++) {
      stage.step(1 / 60);
      if (at.approached < 0 && b.mover.state === 'walk') at.approached = i;
      if (at.plugged < 0 && b.actuator.plugged) at.plugged = i;
      if (at.committed < 0 && store.get('rack') === 'fixed') at.committed = i;
      if (at.released < 0 && wasPlugged && !b.actuator.plugged && store.get('rack') === 'fixed') at.released = i;
      wasPlugged = b.actuator.plugged;
      if (at.committed >= 0 && at.released >= 0) break;
    }

    expect(at.approached).toBeGreaterThanOrEqual(0); // routed toward the fixture
    expect(at.plugged).toBeGreaterThan(at.approached); // wired in only after arriving
    expect(at.committed).toBeGreaterThan(at.plugged); // committed only after the dwell
    expect(at.released).toBe(at.committed); // unplugged at the moment of commit
    expect(store.log[0]).toMatchObject({ id: 'rack', from: 'broken', to: 'fixed', by: 'blue' });
  });

  it('a fixture already at the drive state is skipped: no candidate, no bid, no write', () => {
    // match holds but canTransition is false (already at target), so
    // operateFixtures filters it out and never bids.
    const g = groundGraph();
    const store = createFixtureStore([makeFixture({ id: 'rack', states: ['broken', 'fixed'], state: 'fixed', x: 400, y: 400 })]);
    const stage = new Stage(g, { store });
    stage.add(byster(g, 'blue', 300, [operateFixtures({ match: () => true, drive: 'fixed', dwell: 0.2 })]));
    for (let i = 0; i < 300; i++) stage.step(1 / 60);
    expect(store.log).toHaveLength(0); // nothing to do -> no write
    expect(store.get('rack')).toBe('fixed');
  });

  it('with two operators on one byster, only the interact-channel WINNER commits (the loser never writes)', () => {
    // Both operators match the same fixture and could legally drive it, but they
    // want different targets. Per-channel arbitration hands interact to the
    // higher-priority one; the loser's target must never reach the store.
    const g = groundGraph();
    const store = createFixtureStore([makeFixture({ id: 'gate', states: ['neutral', 'up', 'down'], state: 'neutral', x: 500, y: 400 })]);
    const stage = new Stage(g, { store });
    stage.add(byster(g, 'solo', 300, [
      operateFixtures({ match: (fx) => fx.state === 'neutral', drive: 'up', priority: 60, dwell: 0.2 }),
      operateFixtures({ match: (fx) => fx.state === 'neutral', drive: 'down', priority: 40, dwell: 0.2 }),
    ]));
    for (let i = 0; i < 500; i++) stage.step(1 / 60);
    expect(store.get('gate')).toBe('up'); // the higher-priority operator won interact
    expect(store.log.every((r) => r.to !== 'down')).toBe(true); // the loser never committed
  });

  it('re-operates a fixture a cascade keeps re-breaking (no one-and-done wedge)', () => {
    // The exact wedge scenario: a consumer subscriber re-breaks the rack the
    // instant it is fixed. The fixer must keep re-plugging and re-fixing, not
    // operate it once and stall.
    const g = groundGraph();
    const store = createFixtureStore([makeFixture({ id: 'r', states: ['broken', 'fixed'], state: 'broken', x: 500, y: 400 })]);
    let rebreaks = 0;
    store.subscribe((fx, from, to) => {
      if (to === 'fixed' && rebreaks < 3) {
        rebreaks++;
        store.transition('r', 'broken', 'gremlin');
      }
    });
    const stage = new Stage(g, { store });
    stage.add(byster(g, 'fixer', 300, [operateFixtures({ match: (fx) => fx.state === 'broken', drive: 'fixed', dwell: 0.2 })]));
    for (let i = 0; i < 2000; i++) stage.step(1 / 60);
    const fixes = store.log.filter((r) => r.by === 'fixer' && r.to === 'fixed').length;
    expect(fixes).toBeGreaterThanOrEqual(3); // kept fixing across re-breaks
  });
});

describe('FX-4: the rivalry is mirror config, not two byster types', () => {
  const field = () => [
    makeFixture({ id: 'a', states: ['fixed', 'failed'], state: 'fixed', x: 150, y: 400 }),
    makeFixture({ id: 'b', states: ['fixed', 'failed'], state: 'fixed', x: 450, y: 400 }),
    makeFixture({ id: 'c', states: ['fixed', 'failed'], state: 'fixed', x: 750, y: 400 }),
  ];

  // A and B run the SAME behavior with mirrored config. `run` returns the store
  // log so we can see who moved what.
  const run = ({ matchA, driveA, matchB, driveB }) => {
    const g = groundGraph();
    const store = createFixtureStore(field());
    const stage = new Stage(g, { store });
    const mA = new SurfaceMover(CHAR);
    mA.spawn(g, 0, 200, LAUNCH_AGILE);
    const mB = new SurfaceMover(CHAR);
    mB.spawn(g, 0, 800, LAUNCH_AGILE);
    stage.add(new Byster('A', mA, [operateFixtures({ match: matchA, drive: driveA, dwell: 0.15 })]));
    stage.add(new Byster('B', mB, [operateFixtures({ match: matchB, drive: driveB, dwell: 0.15 })]));
    for (let i = 0; i < 4000; i++) stage.step(1 / 60);
    return store.log;
  };

  it('both bysters act and a fixture oscillates, purely from two mirrored configs', () => {
    const log = run({
      matchA: (fx) => fx.state !== 'failed', driveA: 'failed', // reads as the saboteur
      matchB: (fx) => fx.state === 'failed', driveB: 'fixed', // reads as the repairer
    });
    expect(log.some((r) => r.by === 'A' && r.to === 'failed')).toBe(true);
    expect(log.some((r) => r.by === 'B' && r.to === 'fixed')).toBe(true);
    const aStates = log.filter((r) => r.id === 'a').map((r) => r.to);
    expect(aStates).toContain('failed'); // broken...
    expect(aStates).toContain('fixed'); // ...and repaired: it oscillated
  });

  it('swapping the drive values swaps the apparent roles with no other change', () => {
    const log = run({
      matchA: (fx) => fx.state !== 'fixed', driveA: 'fixed', // A now reads as the repairer
      matchB: (fx) => fx.state === 'fixed', driveB: 'failed', // B now reads as the saboteur
    });
    expect(log.some((r) => r.by === 'A' && r.to === 'fixed')).toBe(true);
    expect(log.some((r) => r.by === 'B' && r.to === 'failed')).toBe(true);
  });
});
