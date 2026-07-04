// Path-engine acceptance tests (TDD Section 13.1). The core is pure, so these
// run headless with no DOM and no Pixi.

import { describe, it, expect } from 'vitest';
import { compileTerrain, planRoute, nearestPointOnTerrain, NAV, NAV_AGILE } from './terrain.js';

// A field whose ONLY vertical connection between the low platform and the high
// one is a 120px corner climb: the low platform spans x, the high platform sits
// 120px above it and within its span (so no hop edge is possible, the rects
// overlap in x). The graph is compiled to the permissive ceiling so the edge
// exists; planRoute then gates it per caps.
function climbField() {
  const rects = [
    { x: 0, y: 220, w: 300, h: 40, tag: 'low' },
    { x: 120, y: 100, w: 120, h: 40, tag: 'high' },
  ];
  return { rects, graph: compileTerrain(rects, NAV_AGILE) };
}

describe('PE-3: caps gate transition edges (same graph, different route per robot)', () => {
  it('a 120px climb is excluded by base caps (climbMax 95) and allowed by agile caps (155)', () => {
    const { graph } = climbField();

    // The compiled superset contains the 120px climb edge (req.climb === 120).
    const hasClimb120 = [...graph.adj.values()]
      .flat()
      .some((e) => e.type === 'climb' && e.req && e.req.climb === 120);
    expect(hasClimb120).toBe(true);

    const start = { seg: 0, x: 40 };
    const goal = { seg: 1, x: 180 };

    // Heavy hero (base NAV, climbMax 95): the climb is off-limits and there is
    // no alternative, so no route.
    const baseRoute = planRoute(graph, start, goal, NAV);
    expect(baseRoute).toBeNull();

    // Nimble imp (NAV_AGILE, climbMax 155): the same graph now routes, using a
    // climb step. Same terrain, different reachability per character.
    const agileRoute = planRoute(graph, start, goal, NAV_AGILE);
    expect(agileRoute).not.toBeNull();
    expect(agileRoute.some((s) => s.type === 'climb')).toBe(true);
  });
});

describe('PE-6 (compile): two compiles of the same rects are identical', () => {
  const serialize = (g) => ({
    segments: g.segments.map((s) => ({ id: s.id, x1: s.x1, x2: s.x2, y: s.y, tag: s.rect.tag })),
    nodes: g.nodes.map((n) => ({ id: n.id, seg: n.seg, x: n.x, y: n.y })),
    adj: [...g.adj.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, edges]) => [id, edges.map((e) => ({ to: e.to, type: e.type, cost: e.cost, req: e.req || null }))]),
  });

  it('is deterministic: identical rects compile to a structurally identical graph', () => {
    const rects = [
      { x: 0, y: 300, w: 400, h: 40, tag: 'ground' },
      { x: 60, y: 220, w: 160, h: 40, tag: 'a' },
      { x: 300, y: 180, w: 160, h: 40, tag: 'b' },
    ];
    const g1 = compileTerrain(rects, NAV_AGILE);
    const g2 = compileTerrain(rects, NAV_AGILE);
    expect(serialize(g1)).toEqual(serialize(g2));
  });
});

describe('planRoute / nearestPointOnTerrain sanity', () => {
  it('routes across a small hoppable gap and walks on a single platform', () => {
    const rects = [
      { x: 0, y: 200, w: 200, h: 40, tag: 'a' },
      { x: 260, y: 200, w: 200, h: 40, tag: 'b' }, // 60px gap, level: a hop
    ];
    const graph = compileTerrain(rects, NAV_AGILE);
    const route = planRoute(graph, { seg: 0, x: 20 }, { seg: 1, x: 440 }, NAV);
    expect(route).not.toBeNull();
    expect(route.some((s) => s.type === 'hop')).toBe(true);

    const sameSeg = planRoute(graph, { seg: 0, x: 20 }, { seg: 0, x: 180 }, NAV);
    expect(sameSeg).not.toBeNull();
    expect(sameSeg.every((s) => s.type === 'walk')).toBe(true);
  });

  it('nearestPointOnTerrain snaps a point to the closest surface', () => {
    const rects = [
      { x: 0, y: 200, w: 200, h: 40, tag: 'a' },
      { x: 0, y: 400, w: 200, h: 40, tag: 'b' },
    ];
    const graph = compileTerrain(rects, NAV_AGILE);
    const near = nearestPointOnTerrain(graph, 100, 210);
    expect(near.seg).toBe(0); // closer to the y=200 surface
    expect(near.x).toBe(100);
  });
});
