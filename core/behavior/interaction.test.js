// Decentralized interaction (TDD Section 13.3). One byster reacts to another
// purely from its OWN behavior reading world.bysters. No coordinator module.

import { describe, it, expect, afterEach } from 'vitest';
import { buildWorld, makeNav } from './world.js';
import { flee, approach } from './library.js';
import { Byster } from './byster.js';
import { Stage } from './stage.js';
import { SurfaceMover } from '../surface-mover.js';
import { surfaceForSide } from '../../dom/collect.js';
import { compileSurfaceGraph } from '../path/compile.js';
import { LAUNCH_AGILE } from '../path/graph.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHAR = {
  name: 'test',
  params: {
    scale: 1, bodyW: 20, bodyH: 16, headW: 40, headH: 32,
    hipX: [8, 4, -4, -8], hipY: 6, footRestX: [10, 5, -5, -10], standH: 20,
    stepThresholdBase: 12, walkSpeed: 160, wanderSpeed: 90, accel: 600,
  },
  palette: { pix: [0, 1, 2, 3] },
  legs: { rings: 4, near: {}, far: {} },
  face: { w: 8, h: 8, animated: [], exprs: { idle: (f) => f.px(1, 1, 1), curious: () => {}, glitch: () => {} } },
  buildBody() {},
  buildHead() {
    return { x: 0, y: 0, w: 8, h: 8 };
  },
};

const groundGraph = () =>
  compileSurfaceGraph([surfaceForSide({ x: -100, y: 400, w: 1000, h: 0 }, 'top', null, { ground: true })], [], LAUNCH_AGILE);

const d2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const afterEachCleanup = { r: Math.random };
afterEach(() => {
  Math.random = afterEachCleanup.r;
});

describe('DI-1: emergent chase/flee from each byster\'s own behavior', () => {
  it('the imp targets away from the hero and the hero targets toward the imp', () => {
    const g = groundGraph();
    const nav = makeNav(g);
    const hero = { name: 'hero', x: 200, bodyY: 390, surface: 0, state: 'idle' };
    const imp = { name: 'imp', x: 250, bodyY: 390, surface: 0, state: 'idle' };
    const world = buildWorld({ agents: [{ view: () => hero }, { view: () => imp }], graph: g, nav });

    const selfOf = (a) => {
      const vId = nav.nearestVertex(a).id;
      return { ...a, caps: LAUNCH_AGILE, vertexId: vId, reachable: nav.reachableFrom(vId, LAUNCH_AGILE) };
    };

    const fleeTarget = nav.vertexPoint(flee((v) => v.name === 'hero').update(world, selfOf(imp)).locomotion.vertex);
    const chaseTarget = nav.vertexPoint(approach((v) => v.name === 'imp').update(world, selfOf(hero)).locomotion.vertex);

    // imp flees: its target is farther from the hero than it currently is
    expect(d2(fleeTarget.x, fleeTarget.y, hero.x, hero.bodyY)).toBeGreaterThan(d2(imp.x, imp.bodyY, hero.x, hero.bodyY));
    // hero chases: its target is nearer the imp than it currently is
    expect(d2(chaseTarget.x, chaseTarget.y, imp.x, imp.bodyY)).toBeLessThan(d2(hero.x, hero.bodyY, imp.x, imp.bodyY));
  });
});

describe('DI-2: adding a byster is inert', () => {
  it('a third (non-matching) byster does not change the imp\'s flee target', () => {
    const g = groundGraph();
    const nav = makeNav(g);
    const hero = { name: 'hero', x: 200, bodyY: 390, surface: 0, state: 'idle' };
    const imp = { name: 'imp', x: 250, bodyY: 390, surface: 0, state: 'idle' };
    const bystander = { name: 'bystander', x: 800, bodyY: 390, surface: 0, state: 'idle' };
    const vId = nav.nearestVertex(imp).id;
    const impSelf = { ...imp, caps: LAUNCH_AGILE, vertexId: vId, reachable: nav.reachableFrom(vId, LAUNCH_AGILE) };
    const fleeB = flee((v) => v.name === 'hero');

    const t2 = fleeB.update(buildWorld({ agents: [{ view: () => hero }, { view: () => imp }], graph: g, nav }), impSelf).locomotion.vertex;
    const t3 = fleeB.update(
      buildWorld({ agents: [{ view: () => hero }, { view: () => imp }, { view: () => bystander }], graph: g, nav }),
      impSelf,
    ).locomotion.vertex;
    expect(t3).toBe(t2);
  });
});

describe('integration: the whole loop moves the bodies', () => {
  it('the imp actually flees the hero across the ground', () => {
    Math.random = mulberry32(11);
    const g = groundGraph();
    const stage = new Stage(g);
    const heroMover = new SurfaceMover(CHAR);
    heroMover.spawn(g, 0, 300, LAUNCH_AGILE);
    const impMover = new SurfaceMover(CHAR);
    impMover.spawn(g, 0, 360, LAUNCH_AGILE); // 60px to the hero's right
    stage.add(new Byster('hero', heroMover, [approach((v) => v.name === 'imp')]));
    stage.add(new Byster('imp', impMover, [flee((v) => v.name === 'hero')]));

    const impStartX = impMover.x;
    for (let i = 0; i < 240; i++) stage.step(1 / 60);
    // the imp bolted to the right, away from the hero on its left
    expect(impMover.x).toBeGreaterThan(impStartX + 40);
  });
});
