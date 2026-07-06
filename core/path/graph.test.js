// planRoute cost shaping (opts.shapeCost): reprice edges without reimplementing
// the search. The contract under test: shaping is inflation-only (sub-1 and NaN
// clamp to 1, so the euclidean heuristic stays admissible and shaped routes are
// optimal under the shaped metric), Infinity is an outright ban, and shaping
// never touches which edges exist (reachability is a caps question, not a
// pricing question).

import { describe, it, expect } from 'vitest';
import { createGraph, addVertex, addEdge, planRoute, LAUNCH } from './graph.js';

// A diamond: S and G on top surfaces, A on a wall, B on a top detour.
//     S --100-- A --100-- G        (direct, through the wall vertex A)
//     S --128-- B --128-- G        (longer detour along tops)
const diamond = () => {
  const g = createGraph();
  g.surfaces.push({ side: 'top' }, { side: 'left' }, { side: 'top' }, { side: 'top' });
  const S = addVertex(g, 0, 0, 0, 0);
  const A = addVertex(g, 1, 100, 0, 0);
  const B = addVertex(g, 2, 100, 80, 0);
  const G = addVertex(g, 3, 200, 0, 0);
  const both = (a, b) => {
    const d = Math.hypot(g.vertices[a].x - g.vertices[b].x, g.vertices[a].y - g.vertices[b].y);
    addEdge(g, a, b, 'walk', d);
    addEdge(g, b, a, 'walk', d);
  };
  both(S.id, A.id);
  both(A.id, G.id);
  both(S.id, B.id);
  both(B.id, G.id);
  return { g, S: S.id, A: A.id, B: B.id, G: G.id };
};

const visits = (route, x, y) => route.some((s) => (s.to.x === x && s.to.y === y) || (s.from.x === x && s.from.y === y));

describe('planRoute opts.shapeCost: reprice the metric, keep the search', () => {
  it('unshaped, the direct route through the wall vertex wins (it is shorter)', () => {
    const { g, S, G } = diamond();
    const route = planRoute(g, S, G, LAUNCH);
    expect(visits(route, 100, 0)).toBe(true); // through A
    expect(visits(route, 100, 80)).toBe(false);
  });

  it('a finite tax on edges landing off-top reroutes onto the detour (bias, not ban)', () => {
    const { g, S, G } = diamond();
    const wallTax = (e, graph) => {
      const s = graph.surfaces[graph.vertices[e.to].surface];
      return s && s.side !== 'top' ? 3 : 1;
    };
    const route = planRoute(g, S, G, LAUNCH, { shapeCost: wallTax });
    expect(visits(route, 100, 80)).toBe(true); // detour through B
    expect(visits(route, 100, 0)).toBe(false); // wall vertex avoided, not banned
  });

  it('inflation-only: an attempted discount (or NaN) clamps to 1 and cannot buy a longer route', () => {
    const { g, S, B, G } = diamond();
    // try to make the detour nearly free: a sub-1 multiplier must read as 1
    const discount = (e, graph) => (graph.vertices[e.to].id === B || graph.vertices[e.to].id === G ? 0.01 : 1);
    const route = planRoute(g, S, G, LAUNCH, { shapeCost: discount });
    expect(visits(route, 100, 0)).toBe(true); // still the true shortest path
    const chaotic = planRoute(g, S, G, LAUNCH, { shapeCost: () => NaN });
    expect(visits(chaotic, 100, 0)).toBe(true); // NaN reads as 1, not as poison
  });

  it('Infinity bans an edge outright; with an alternative the plan detours, without one it honestly fails', () => {
    const { g, S, A, G } = diamond();
    const banWall = (e, graph) => (graph.vertices[e.to].id === A ? Infinity : 1);
    const detour = planRoute(g, S, G, LAUNCH, { shapeCost: banWall });
    expect(visits(detour, 100, 80)).toBe(true);
    const banEverything = () => Infinity;
    expect(planRoute(g, S, G, LAUNCH, { shapeCost: banEverything })).toBeNull();
  });

  it('the shaped route is optimal under the shaped metric (admissible heuristic held)', () => {
    const { g, S, G } = diamond();
    const tax = (e, graph) => {
      const s = graph.surfaces[graph.vertices[e.to].surface];
      return s && s.side !== 'top' ? 3 : 1;
    };
    const route = planRoute(g, S, G, LAUNCH, { shapeCost: tax });
    const len = (r) => r.reduce((sum, s) => sum + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), 0);
    // shaped costs: direct = 100*3 + 100 = 400, detour = 2 * sqrt(100^2 + 80^2) ~= 256
    expect(len(route)).toBeCloseTo(2 * Math.hypot(100, 80), 5);
  });
});
