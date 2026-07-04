// M-cast: a cast of bysters with DIFFERENT per-byster launch power. The
// decentralized-interaction tests already prove chase/flee through the full
// loop, but with identical caps on both bodies. This locks the other half of
// the M-cast promise: a nimble byster reaches surfaces a heavy one cannot,
// purely because each byster carries its own caps all the way through the
// stack (Byster -> Stage -> SurfaceMover -> planner). Character-agnostic on
// purpose: the mechanism lives in the framework, not in any one character.

import { describe, it, expect } from 'vitest';
import { Byster } from './byster.js';
import { Stage } from './stage.js';
import { commanded } from './library.js';
import { SurfaceMover } from '../surface-mover.js';
import { surfacesForRect } from '../../dom/collect.js';
import { compileSurfaceGraph } from '../path/compile.js';
import { planRoute, LAUNCH, LAUNCH_AGILE } from '../path/graph.js';

// A minimal jump-capable character (no DOM / Pixi). Same shape the other
// behavior tests use; the numbers only need to make the gait and a ballistic
// arc run headlessly.
const CHAR = {
  name: 'test',
  params: {
    scale: 1, bodyW: 20, bodyH: 16, headW: 40, headH: 32,
    hipX: [8, 4, -4, -8], hipY: 6, footRestX: [10, 5, -5, -10], standH: 20,
    stepThresholdBase: 12, walkSpeed: 160, wanderSpeed: 90, accel: 600,
  },
  palette: { pix: [0, 1, 2, 3] },
  legs: { rings: 4, near: {}, far: {} },
  face: { w: 8, h: 8, animated: [], exprs: { idle: (f) => f.px(1, 1, 1), curious: () => {} } },
  buildBody() {},
  buildHead() {
    return { x: 0, y: 0, w: 8, h: 8 };
  },
};

// Two floating platforms 220px apart, no ground: the only way across is a
// ballistic arc whose min speed sits between the heavy (640) and agile (900)
// launch presets (the exact geometry compile.test proves is agile-only).
function twoPlatforms() {
  const A = { x: 0, y: 200, w: 120, h: 40 };
  const B = { x: 340, y: 200, w: 120, h: 40 };
  const surfaces = [
    ...surfacesForRect(A, ['top'], 'A'),
    ...surfacesForRect(B, ['top'], 'B'),
  ];
  const solids = [
    { x: A.x, y: A.y, w: A.w, h: A.h, el: 'A' },
    { x: B.x, y: B.y, w: B.w, h: B.h, el: 'B' },
  ];
  return compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
}

const surfaceIx = (graph, el) => graph.surfaces.findIndex((s) => s.el === el && s.side === 'top');

describe('M-cast: per-byster caps decide who can cross the same gap', () => {
  it('the agile imp clears an agile-only gap the heavy hero cannot, driven through the whole stack', () => {
    const graph = twoPlatforms();
    const aIx = surfaceIx(graph, 'A');
    const bIx = surfaceIx(graph, 'B');
    const bVertex = graph.vertices.find((v) => v.surface === bIx).id;

    const stage = new Stage(graph);
    const heroMover = new SurfaceMover(CHAR);
    heroMover.spawn(graph, aIx, 60, LAUNCH); // heavy launch: the base contract
    const impMover = new SurfaceMover(CHAR);
    impMover.spawn(graph, aIx, 60, LAUNCH_AGILE); // nimble launch: the compile ceiling
    const hero = stage.add(new Byster('hero', heroMover, [commanded()]));
    const imp = stage.add(new Byster('imp', impMover, [commanded()]));

    // Both are told to go to the same spot on the far platform.
    hero.command(bVertex);
    imp.command(bVertex);
    for (let i = 0; i < 300; i++) stage.step(1 / 60);

    // The imp crossed; the hero never left A. Same graph, same goal: the only
    // difference is the launch power each byster carries.
    expect(impMover.surface).toBe(bIx);
    expect(heroMover.surface).toBe(aIx);
  });

  it('the asymmetry is the planner honoring each byster\'s caps, not luck', () => {
    // Documents WHY the bodies diverge above: from A's launch vertex the route
    // to B exists only at agile launch power.
    const graph = twoPlatforms();
    const aVertex = graph.vertices.find((v) => v.surface === surfaceIx(graph, 'A')).id;
    const bVertex = graph.vertices.find((v) => v.surface === surfaceIx(graph, 'B')).id;
    expect(planRoute(graph, aVertex, bVertex, LAUNCH)).toBeNull();
    expect(planRoute(graph, aVertex, bVertex, LAUNCH_AGILE)).not.toBeNull();
  });
});
