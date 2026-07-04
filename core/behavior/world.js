// The World: the read-only per-frame snapshot a behavior senses. This is the
// dependency-inversion boundary and the key to DECENTRALIZED interaction: a
// byster reacts to the others purely through `world.bysters`, from its own
// behavior code, so adding a byster edits no other byster (TDD Section 8.4).
//
// Pure: built from plain agent views + the graph. No DOM, no window.

import { nearestVertex, reachableVertexIds, routeCosts } from '../path/graph.js';
import { canTransition } from '../fixtures/fixture.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.bodyY - b.bodyY);

// Read-only fixture queries a behavior senses (never a writer: only the byster's
// actuate executor commits, via the store, on the channel it won). Built from
// the injected store so the same behaviors run headless with a scripted store.
function fixtureQueries(store) {
  if (!store) return null;
  return {
    all: () => store.all(),
    byType: (t) => store.all().filter((fx) => fx.type === t),
    byState: (s) => store.all().filter((fx) => fx.state === s),
    near: (point, r) => store.all().filter((fx) => Math.hypot(fx.x - point.x, fx.y - point.y) <= r),
    canTransition: (fx, to) => canTransition(fx, to),
  };
}

// Nav helpers behaviors use to turn positions into graph targets.
export function makeNav(graph) {
  return {
    vertexPoint: (id) => {
      const v = graph.vertices[id];
      return v ? { x: v.x, y: v.y } : null;
    },
    vertexSurface: (id) => {
      const v = graph.vertices[id];
      return v ? v.surface : null;
    },
    nearestVertex: (point) => nearestVertex(graph, point.x, point.y),
    reachableFrom: (vertexId, caps) => reachableVertexIds(graph, [vertexId], caps),
    // path-cost field from a vertex under some caps: "how far must THIS mover
    // travel to reach each spot" (unreachable spots are absent). Powers route-aware
    // flight (flee to where the pursuer would struggle to follow, e.g. up a wall).
    routeCostsFrom: (vertexId, caps) => routeCosts(graph, vertexId, caps),
  };
}

// Build the snapshot. `agents` expose view() -> { name, x, bodyY, surface, state }.
// `dt` is the frame delta, so time-based behaviors (sleep, fatigue, flourish)
// stay pure functions of the world instead of reaching for a clock.
export function buildWorld({ agents = [], cursor = null, graph, nav = null, store = null, dt = 0 }) {
  const views = agents.map((a) => a.view());
  const others = (self) => views.filter((v) => v.name !== self.name);
  const nearestOf = (list, self) => {
    let best = null;
    for (const v of list) {
      const d = dist(self, v);
      if (!best || d < best.d) best = { v, d };
    }
    return best ? best.v : null;
  };
  const bysters = {
    all: () => views,
    named: (name) => views.find((v) => v.name === name) || null,
    nearest: (self) => nearestOf(others(self), self),
    within: (self, r) => others(self).filter((v) => dist(self, v) <= r),
    // nearest OTHER matching a predicate within radius (the flee/chase primitive)
    nearestMatching: (self, predicate, radius = Infinity) => {
      const cand = others(self).filter((v) => predicate(v) && dist(self, v) <= radius);
      return nearestOf(cand, self);
    },
  };
  return { cursor, dt, graph, nav: nav || makeNav(graph), bysters, fixtures: fixtureQueries(store) };
}
