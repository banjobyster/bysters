// The graph creator. Turns declared surfaces (+ the solid boxes, for occlusion)
// into the nav graph the planner walks. This is where clearance is decided,
// ONCE per rebuild: a jump edge exists only if its arc is in range, lands on the
// target's outward side, and clears every solid box. The motor never re-checks
// any of this; it trusts the graph.
//
// Pure: no DOM, no window. Feed it the output of collectWorld (or any surface
// set) and it returns a Graph.

import { dist } from '../math.js';
import { createGraph, addVertex, addEdge, LAUNCH_AGILE } from './graph.js';
import { solveLaunch, landsFromOutside, arcOccluded } from './ballistic.js';

const SAMPLE_STEP = 36; // vertex spacing along a surface (px)
const CORNER_EPS = 2.5; // two vertices this close (on different surfaces) share a corner
const JUNCTION_EPS = 2.5; // a surface endpoint this close to another surface's span is a T-junction

function pointAt(surface, t) {
  return {
    x: surface.a.x + (surface.b.x - surface.a.x) * t,
    y: surface.a.y + (surface.b.y - surface.a.y) * t,
  };
}

// Is a point blocked by a solid box's footprint (interior, base included)? Used
// to sever a walk that would pass through a box, e.g. along the ground beneath a
// box that sits on it. The box owning the surface being walked is excluded.
function blocksWalk(px, py, box, eps = 1) {
  return (
    px > box.x + eps &&
    px < box.x + box.w - eps &&
    py > box.y - eps &&
    py < box.y + box.h + eps
  );
}

// If (x,y) lies on the surface segment within eps, return its param t, else null.
function paramOnSurface(surface, x, y, eps = JUNCTION_EPS) {
  const dx = surface.b.x - surface.a.x;
  const dy = surface.b.y - surface.a.y;
  const L2 = dx * dx + dy * dy || 1;
  const t = ((x - surface.a.x) * dx + (y - surface.a.y) * dy) / L2;
  if (t < 0 || t > 1) return null;
  const px = surface.a.x + dx * t;
  const py = surface.a.y + dy * t;
  return Math.hypot(x - px, y - py) <= eps ? t : null;
}

export function compileSurfaceGraph(surfaces, solids = [], caps = LAUNCH_AGILE) {
  const graph = createGraph();
  graph.surfaces = surfaces;
  const g = caps.gravity;
  const maxLaunch = caps.maxLaunch;

  // A per-surface registry so we reuse a vertex at a given param instead of
  // stacking duplicates.
  const perSurface = surfaces.map(() => []); // [{ t, id }]
  const vertexAt = (si, tRaw) => {
    const t = Math.max(0, Math.min(1, tRaw));
    for (const rec of perSurface[si]) if (Math.abs(rec.t - t) < 1e-4) return rec.id;
    const p = pointAt(surfaces[si], t);
    const v = addVertex(graph, si, p.x, p.y, t);
    perSurface[si].push({ t, id: v.id });
    return v.id;
  };

  // 1. Sample each surface into vertices (ends + regular spacing), so launch and
  //    landing points exist beside/beneath boxes, not only at surface corners.
  //    Interior samples occluded by a foreign solid (e.g. the ground beneath a
  //    box that rests on it) are skipped: that span is not walkable, so a vertex
  //    there could only ever be a dead node (no walk edge in step 3, no valid
  //    jump). Occlusion is the same predicate that severs walk edges below,
  //    applied one step earlier. Endpoints are kept here because corners and
  //    T-junctions splice off them, but an endpoint CAN be buried in a foreign
  //    box (a ledge running into a pillar); the final prune (step 6) is what
  //    actually guarantees no orphan survives, so this stays a cheap prevention,
  //    not the guarantee.
  surfaces.forEach((s, si) => {
    const ownEl = s.el;
    const occludedAt = (t) => {
      const p = pointAt(s, t);
      return solids.some((box) => box.el !== ownEl && blocksWalk(p.x, p.y, box));
    };
    vertexAt(si, 0);
    vertexAt(si, 1);
    const n = Math.max(1, Math.round(s.length / SAMPLE_STEP));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (!occludedAt(t)) vertexAt(si, t);
    }
  });

  // 2. T-junctions: a surface endpoint that lands on another surface's span gets
  //    a vertex spliced there (e.g. a box wall's base meeting the ground).
  surfaces.forEach((s, si) => {
    for (let sj = 0; sj < surfaces.length; sj++) {
      if (sj === si) continue;
      for (const end of [surfaces[sj].a, surfaces[sj].b]) {
        const t = paramOnSurface(s, end.x, end.y);
        if (t != null && t > 1e-3 && t < 1 - 1e-3) vertexAt(si, t);
      }
    }
  });

  // 3. Walk edges along each surface (consecutive vertices by param), severed
  //    where the span passes through a foreign solid box (walk-occlusion: you
  //    cannot walk through a box that sits on your surface).
  surfaces.forEach((s, si) => {
    const ownEl = s.el;
    const verts = perSurface[si].map((r) => graph.vertices[r.id]).sort((a, b) => a.t - b.t);
    for (let i = 0; i + 1 < verts.length; i++) {
      const mx = (verts[i].x + verts[i + 1].x) / 2;
      const my = (verts[i].y + verts[i + 1].y) / 2;
      if (solids.some((box) => box.el !== ownEl && blocksWalk(mx, my, box))) continue;
      const c = dist(verts[i].x, verts[i].y, verts[i + 1].x, verts[i + 1].y);
      addEdge(graph, verts[i].id, verts[i + 1].id, 'walk', c);
      addEdge(graph, verts[i + 1].id, verts[i].id, 'walk', c);
    }
  });

  // 4. Corner walk edges: coincident vertices on different surfaces (turn the
  //    corner). This is how climbing works: ground -> wall -> top is one walk
  //    chain across shared corners, no special climb code.
  for (let i = 0; i < graph.vertices.length; i++) {
    const a = graph.vertices[i];
    for (let j = i + 1; j < graph.vertices.length; j++) {
      const b = graph.vertices[j];
      if (a.surface === b.surface) continue;
      if (dist(a.x, a.y, b.x, b.y) <= CORNER_EPS) {
        addEdge(graph, a.id, b.id, 'walk', 4);
        addEdge(graph, b.id, a.id, 'walk', 4);
      }
    }
  }

  // 5. Jump edges. For each launch vertex, keep only the best (min-speed) valid
  //    landing per target surface, so the graph stays legible. Compile to the
  //    permissive ceiling; planRoute filters per character by launch power.
  const maxRange = (maxLaunch * maxLaunch) / g * 1.15 + 40;
  for (const vA of graph.vertices) {
    const bestBySurface = new Map(); // targetSurface -> { vB, sol }
    for (const vB of graph.vertices) {
      if (vB.surface === vA.surface) continue;
      const d = dist(vA.x, vA.y, vB.x, vB.y);
      if (d > maxRange || d < 1) continue;
      const sol = solveLaunch(vA, vB, g);
      if (sol.speed > maxLaunch) continue;
      if (!landsFromOutside(sol, g, sol.t, surfaces[vB.surface].normal)) continue;
      if (arcOccluded(vA, sol, g, sol.t, solids)) continue;
      const cur = bestBySurface.get(vB.surface);
      if (!cur || sol.speed < cur.sol.speed) bestBySurface.set(vB.surface, { vB, sol });
    }
    for (const { vB, sol } of bestBySurface.values()) {
      addEdge(graph, vA.id, vB.id, 'jump', dist(vA.x, vA.y, vB.x, vB.y) * 1.4 + 40, {
        vx: sol.vx,
        vy: sol.vy,
        t: sol.t,
        g,
        speed: sol.speed,
      });
    }
  }

  // 6. Prune orphans: a vertex with no incident edge (in or out) is not a place
  //    a byster can stand or reach, only a trap for nearest-vertex lookups. The
  //    step-1 guard prevents most (interior occluded samples); this catches the
  //    rest generally, e.g. a surface endpoint buried inside a foreign solid.
  //    Safe to compact ids: an orphan has no edges, so no edge references it.
  pruneOrphans(graph);

  return graph;
}

// Drop every vertex with zero incident edges and compact ids so the array index
// stays the id (planRoute/adj rely on that). One rule collapses all orphan
// cases: no vertex without an edge, ever.
function pruneOrphans(graph) {
  const deg = new Map(graph.vertices.map((v) => [v.id, (graph.adj.get(v.id) || []).length]));
  for (const [, edges] of graph.adj) for (const e of edges) deg.set(e.to, (deg.get(e.to) || 0) + 1);
  const survivors = graph.vertices.filter((v) => (deg.get(v.id) || 0) > 0);
  if (survivors.length === graph.vertices.length) return;
  const remap = new Map();
  survivors.forEach((v, i) => remap.set(v.id, i));
  const newAdj = new Map();
  survivors.forEach((v, i) => {
    const edges = (graph.adj.get(v.id) || []).map((e) => ({ ...e, to: remap.get(e.to) }));
    v.id = i;
    newAdj.set(i, edges);
  });
  graph.vertices = survivors;
  graph.adj = newAdj;
}
