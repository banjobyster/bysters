// Graph-creator acceptance tests: the general locomotion model. Pure, headless.
// The through-line: declared side => walk up it (climb is walk); top-only => you
// must jump; occlusion is enforced here, not by the motor; caps gate jumps.

import { describe, it, expect } from 'vitest';
import { surfacesForRect, surfaceForSide } from '../../dom/collect.js';
import { compileSurfaceGraph } from './compile.js';
import { planRoute, reachableVertexIds, edgeAllowed, LAUNCH, LAUNCH_AGILE } from './graph.js';

const WALK_ONLY = { maxLaunch: 0, gravity: 2400 }; // no jumps: pure walk reachability

function groundSurface(y, x0, x1) {
  return surfaceForSide({ x: x0, y, w: x1 - x0, h: 0 }, 'top', null, { ground: true });
}

// boxes: [{ id, x, y, w, h, sides }] where sides=null means a solid with no
// walkable faces (a pure obstacle). Boxes with base y+h === groundY sit on it.
function build(boxes, groundY, span) {
  const surfaces = [];
  const solids = [];
  for (const b of boxes) {
    solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, el: b.id });
    if (b.sides && b.sides.length) {
      for (const s of surfacesForRect({ x: b.x, y: b.y, w: b.w, h: b.h }, b.sides, b.id)) surfaces.push(s);
    }
  }
  if (groundY != null) surfaces.push(groundSurface(groundY, span[0], span[1]));
  return { surfaces, solids };
}

const groundVertexIds = (graph) =>
  graph.vertices.filter((v) => graph.surfaces[v.surface].meta?.ground).map((v) => v.id);
const topVertsOf = (graph, elId) =>
  graph.vertices.filter((v) => {
    const s = graph.surfaces[v.surface];
    return s.el === elId && s.side === 'top';
  });
const anyReachable = (reach, verts) => verts.some((v) => reach.has(v.id));

describe('climb is walk: a declared side is walked up, no special climb code', () => {
  it('a box on the ground with left/right walls has its top reachable by WALK alone', () => {
    const { surfaces, solids } = build(
      [{ id: 'box', x: 200, y: 230, w: 120, h: 70, sides: ['top', 'left', 'right'] }],
      300,
      [-100, 600],
    );
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const reach = reachableVertexIds(graph, groundVertexIds(graph), WALK_ONLY);
    // With jumps disabled entirely, the top is still reachable: ground -> wall
    // -> top is one chain of walk edges across shared corners.
    expect(anyReachable(reach, topVertsOf(graph, 'box'))).toBe(true);
  });
});

describe('top-only surface: you must jump to reach it', () => {
  it('a top-only box on the ground is NOT walk-reachable but IS jump-reachable', () => {
    const { surfaces, solids } = build(
      [{ id: 'box', x: 200, y: 250, w: 120, h: 50, sides: ['top'] }],
      300,
      [-100, 600],
    );
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const seeds = groundVertexIds(graph);
    const walkReach = reachableVertexIds(graph, seeds, WALK_ONLY);
    const jumpReach = reachableVertexIds(graph, seeds, LAUNCH_AGILE);
    const top = topVertsOf(graph, 'box');
    expect(anyReachable(walkReach, top)).toBe(false); // no wall to walk up
    expect(anyReachable(jumpReach, top)).toBe(true); // a jump gets you there
  });
});

describe('occlusion is enforced by the compiler', () => {
  const A = { id: 'A', x: 0, y: 200, w: 120, h: 40, sides: ['top'] };
  const C = { id: 'C', x: 400, y: 200, w: 120, h: 40, sides: ['top'] };

  it('a tall solid wall between two platforms severs the jump (A cannot reach C)', () => {
    const wall = { id: 'W', x: 240, y: 100, w: 40, h: 300, sides: null }; // solid, floor-to-ground
    const { surfaces, solids } = build([A, C, wall], 400, [-200, 800]);
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const aTop = topVertsOf(graph, 'A')[0];
    const cTop = topVertsOf(graph, 'C')[0];
    expect(planRoute(graph, aTop.id, cTop.id, LAUNCH_AGILE)).toBeNull();
  });

  it('without the wall, the same two platforms connect by a jump', () => {
    const { surfaces, solids } = build([A, C], 400, [-200, 800]);
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const aTop = topVertsOf(graph, 'A')[0];
    const cTop = topVertsOf(graph, 'C')[0];
    const route = planRoute(graph, aTop.id, cTop.id, LAUNCH_AGILE);
    expect(route).not.toBeNull();
    expect(route.some((s) => s.type === 'jump')).toBe(true);
  });
});

describe('no orphan vertices: occlusion is applied to sampling, not just edges', () => {
  const incidence = (graph) => {
    const deg = new Map(graph.vertices.map((v) => [v.id, (graph.adj.get(v.id) || []).length]));
    for (const [, edges] of graph.adj) for (const e of edges) deg.set(e.to, (deg.get(e.to) || 0) + 1);
    return deg;
  };

  it('a wall-less box resting on the ground leaves no dead vertex beneath it', () => {
    // A top-only box sits ON the ground: the ground span under it is not
    // walkable. Before the fix, regular sampling still dropped vertices there
    // with no incident edges, stranding any byster whose nearest vertex was one.
    const { surfaces, solids } = build(
      [{ id: 'box', x: 300, y: 260, w: 200, h: 40, sides: ['top'] }],
      300,
      [-100, 900],
    );
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const deg = incidence(graph);
    const orphans = graph.vertices.filter((v) => deg.get(v.id) === 0);
    expect(orphans).toHaveLength(0);
    // And specifically: no ground vertex sits strictly under the box footprint.
    const groundUnderBox = graph.vertices.filter(
      (v) => graph.surfaces[v.surface].meta?.ground && v.x > 305 && v.x < 495,
    );
    expect(groundUnderBox).toHaveLength(0);
  });

  it('a surface ENDPOINT buried inside a foreign box leaves no orphan (step-6 prune)', () => {
    // A floating ledge (p) whose right end tucks under a wider box (big) resting
    // on the ground. p's right endpoint sits INSIDE big's footprint; the step-1
    // guard keeps endpoints, so only the final prune removes the buried one.
    const { surfaces, solids } = build(
      [
        { id: 'p', x: 100, y: 250, w: 200, h: 10, sides: ['top'] },
        { id: 'big', x: 250, y: 210, w: 350, h: 190, sides: ['top'] },
      ],
      400,
      [-100, 900],
    );
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const deg = incidence(graph);
    expect(graph.vertices.filter((v) => deg.get(v.id) === 0)).toHaveLength(0);
    // ids stay compact (index === id) after the prune, or planRoute/adj break.
    graph.vertices.forEach((v, i) => expect(v.id).toBe(i));
  });

  it('vertices under a FLOATING box are kept (you can walk beneath it)', () => {
    // The box floats well above the ground, so the ground under it is walkable
    // and must keep its vertices (occlusion must not over-reach).
    const { surfaces, solids } = build(
      [{ id: 'float', x: 300, y: 120, w: 200, h: 40, sides: ['top'] }],
      300,
      [-100, 900],
    );
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const groundUnderFloat = graph.vertices.filter(
      (v) => graph.surfaces[v.surface].meta?.ground && v.x > 320 && v.x < 480,
    );
    expect(groundUnderFloat.length).toBeGreaterThan(0);
  });
});

describe('launch power gates jumps per character (same graph, different reach)', () => {
  it('a gap that needs agile launch is unreachable for the heavy hero', () => {
    // Two floating platforms, level, 220px apart. Min-speed for a 220px level
    // gap is sqrt(220 * g) ~= 726, above base (640) and below agile (900).
    const A = { id: 'A', x: 0, y: 200, w: 120, h: 40, sides: ['top'] };
    const B = { id: 'B', x: 340, y: 200, w: 120, h: 40, sides: ['top'] };
    const { surfaces, solids } = build([A, B], null, [0, 0]); // no ground: only the gap connects them
    const graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const aTop = graph.vertices.filter((v) => graph.surfaces[v.surface].el === 'A');
    const bTop = graph.vertices.filter((v) => graph.surfaces[v.surface].el === 'B');

    // The jump edge exists in the compiled superset, with a speed only agile allows.
    const jumps = [];
    for (const v of aTop) for (const e of graph.adj.get(v.id) || []) if (e.type === 'jump') jumps.push(e);
    const crossing = jumps.find((e) => bTop.some((b) => b.id === e.to));
    expect(crossing).toBeTruthy();
    expect(edgeAllowed(crossing, LAUNCH)).toBe(false); // heavy hero cannot
    expect(edgeAllowed(crossing, LAUNCH_AGILE)).toBe(true); // nimble imp can

    // And it shows up in routing.
    const start = aTop[0].id;
    const goal = bTop[0].id;
    expect(planRoute(graph, start, goal, LAUNCH)).toBeNull();
    expect(planRoute(graph, start, goal, LAUNCH_AGILE)).not.toBeNull();
  });
});
