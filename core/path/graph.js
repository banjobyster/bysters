// The surface nav graph and its planner. Two edge types, no hardcoded
// transition kinds:
//
//   walk  - move along a surface, or turn a shared corner onto an adjacent one.
//           Under gecko-adhesion every declared surface is walkable at any
//           angle, so a walk edge is always traversable (climbing a wall is
//           just a walk whose surface points sideways).
//   jump  - a ballistic arc the compiler already validated (in range, lands on
//           the target's outward side, unoccluded). Gated per character by
//           launch power only.
//
// Everything here is pure: no DOM, no window, no Pixi. The graph creator
// (compile.js) fills this in; the motor (later) replays the steps planRoute
// returns. Drop / hop / climb do not appear anywhere: they collapsed into these
// two primitives plus gravity.

import { dist } from '../math.js';

// Launch-power presets, the general replacement for the four old NAV caps
// (hopMaxX/Y, climbMax, dropMax). Per-character nimbleness is now one number:
// how hard it can launch. gravity is global (used at compile and replay).
export const LAUNCH = { maxLaunch: 640, gravity: 2400 }; // heavy hero: the base contract
export const LAUNCH_AGILE = { maxLaunch: 900, gravity: 2400 }; // nimble imp: the compile ceiling

// Can a character with these caps traverse this edge? Walk is always allowed
// (adhesion); a jump needs enough launch power for its arc.
export function edgeAllowed(edge, caps) {
  if (edge.type === 'jump') return edge.launch.speed <= caps.maxLaunch;
  return true;
}

export function createGraph() {
  return { surfaces: [], vertices: [], adj: new Map() };
}

export function addVertex(graph, surface, x, y, t) {
  const id = graph.vertices.length;
  const v = { id, surface, x, y, t };
  graph.vertices.push(v);
  graph.adj.set(id, []);
  return v;
}

export function addEdge(graph, from, to, type, cost, launch = null) {
  graph.adj.get(from).push({ to, type, cost, launch });
}

export function verticesOfSurface(graph, surfaceId) {
  return graph.vertices.filter((v) => v.surface === surfaceId);
}

// The set of vertex ids reachable from any of startIds using only edges this
// character's caps allow. This is the generalized reachability report: a page
// author sees dead zones (surfaces no vertex of which is in this set) instead of
// a stuck creature.
export function reachableVertexIds(graph, startIds, caps) {
  const seen = new Set(startIds);
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift();
    for (const e of graph.adj.get(id) || []) {
      if (seen.has(e.to) || !edgeAllowed(e, caps)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return seen;
}

// Shortest-path COST from startId to every vertex reachable under these caps
// (Dijkstra over edge costs; jumps gated by launch power). Unreachable vertices
// are simply absent (treat as infinite). This is how a behavior asks "how far
// would a character with these caps have to travel to reach each spot", so flight
// can prefer a perch the pursuer cannot follow onto instead of only running away
// in a straight line.
export function routeCosts(graph, startId, caps) {
  const costs = new Map([[startId, 0]]);
  const open = [{ id: startId, d: 0 }];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.d > (costs.get(cur.id) ?? Infinity)) continue; // stale heap entry
    for (const e of graph.adj.get(cur.id) || []) {
      if (!edgeAllowed(e, caps)) continue;
      const nd = cur.d + e.cost;
      if (nd < (costs.get(e.to) ?? Infinity)) {
        costs.set(e.to, nd);
        open.push({ id: e.to, d: nd });
      }
    }
  }
  return costs;
}

export function nearestVertex(graph, x, y, surfaceId = null) {
  let best = null;
  for (const v of graph.vertices) {
    if (surfaceId != null && v.surface !== surfaceId) continue;
    const d = dist(x, y, v.x, v.y);
    if (!best || d < best.d) best = { v, d };
  }
  return best ? best.v : null;
}

// A* over the surface graph. start/goal are vertex ids. caps gates jump edges
// (walk is always allowed). Returns an ordered list of steps:
//   { type:'walk', from:{x,y,surface}, to:{x,y,surface} }
//   { type:'jump', from:{x,y,surface}, to:{x,y,surface}, launch:{vx,vy,t,g,speed} }
// or null when unreachable. A nimble character reaches goals a heavy one cannot,
// from the same graph, purely via which jump edges its caps allow.
export function planRoute(graph, startId, goalId, caps) {
  const byId = (id) => graph.vertices[id];
  const goal = byId(goalId);
  const h = (v) => dist(v.x, v.y, goal.x, goal.y);

  const open = [{ id: startId, f: h(byId(startId)) }];
  const g = new Map([[startId, 0]]);
  const cameFrom = new Map(); // id -> { prev, edge }
  const closed = new Set();

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.id === goalId) break;
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);
    for (const e of graph.adj.get(cur.id) || []) {
      if (closed.has(e.to)) continue;
      if (!edgeAllowed(e, caps)) continue;
      const ng = g.get(cur.id) + e.cost;
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng);
        cameFrom.set(e.to, { prev: cur.id, edge: e });
        open.push({ id: e.to, f: ng + h(byId(e.to)) });
      }
    }
  }

  if (!g.has(goalId)) return null;

  const chain = [];
  let cur = goalId;
  while (cur !== startId) {
    const link = cameFrom.get(cur);
    if (!link) return null;
    chain.push({ node: byId(cur), edge: link.edge, prev: byId(link.prev) });
    cur = link.prev;
  }
  chain.reverse();

  return chain.map(({ node, edge, prev }) => {
    const from = { x: prev.x, y: prev.y, surface: prev.surface };
    const to = { x: node.x, y: node.y, surface: node.surface };
    return edge.type === 'jump' ? { type: 'jump', from, to, launch: edge.launch } : { type: 'walk', from, to };
  });
}
