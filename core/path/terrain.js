// Terrain compiler: turns axis-aligned rects (from DOM bounding boxes) into
// walkable top-edge segments, links them into a nav graph with typed
// transitions (walk, hop, climb, drop), and plans routes with A*.

import { clamp, dist } from '../math.js';

// Base traversal limits (SPEC 4.2c). These are the BINDING absolute-px contract
// the level design and scripts/check-terrain.mjs verify against, and the caps a
// normal (heavy) robot plans with. They never scale with any character.
export const NAV = {
  hopMaxX: 120,
  hopMaxY: 80,
  climbMax: 95,
  dropMax: 320,
  edgeInset: 2, // walkable segment is inset from the rect corners
};

// The most permissive limits any character may use. The live overlay graph is
// compiled to these (a superset of NAV), and every transition edge is tagged
// with the metric that gates it so planRoute can filter per character. A nimble
// character (the imp) plans with caps up to these; the heavy hero plans with
// NAV, so it only ever uses the base subset and its verified connectivity is
// unchanged. The compiler's default stays NAV, so the terrain check and the
// sandbox keep measuring the base contract.
export const NAV_AGILE = {
  hopMaxX: 190,
  hopMaxY: 125,
  climbMax: 155,
  dropMax: 440,
  edgeInset: 2,
};

// Can a character with these caps traverse this edge? Walk edges (no req) are
// always allowed; transition edges carry the geometry that gates them.
export function edgeAllowed(edge, caps) {
  const r = edge.req;
  if (!r) return true;
  if (r.climb != null && r.climb > caps.climbMax) return false;
  if (r.drop != null && r.drop > caps.dropMax) return false;
  if (r.hopX != null && (r.hopX > caps.hopMaxX || r.hopY > caps.hopMaxY)) return false;
  return true;
}

function nearestBelow(rects, x, yAbove, exceptRect) {
  // The first surface strictly below yAbove that spans x. Used so drops
  // never pass through an intervening box.
  let best = null;
  for (const r of rects) {
    if (r === exceptRect) continue;
    if (r.y <= yAbove + 1) continue;
    if (x < r.x || x > r.x + r.w) continue;
    if (!best || r.y < best.y) best = r;
  }
  return best;
}

// limits: the max moves the compiled graph should contain. Defaults to NAV (the
// base contract) so the terrain check and sandbox measure base connectivity;
// the live overlay compiles with NAV_AGILE and lets planRoute filter per robot.
export function compileTerrain(rects, limits = NAV) {
  const segments = rects.map((r, i) => ({
    id: i,
    x1: r.x + NAV.edgeInset,
    x2: r.x + r.w - NAV.edgeInset,
    y: r.y,
    rect: r,
  }));

  const nodes = [];
  const adj = new Map(); // nodeId -> [{to, type, cost, req}]

  // req (optional): the geometry that gates this transition, so planRoute can
  // allow it only for a character whose caps cover it (see edgeAllowed).
  const addEdge = (a, b, type, cost, req) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, type, cost, req });
  };

  const addNode = (seg, x) => {
    const cx = clamp(x, seg.x1, seg.x2);
    for (const n of nodes) {
      if (n.seg === seg.id && Math.abs(n.x - cx) < 4) return n;
    }
    const n = { id: nodes.length, seg: seg.id, x: cx, y: seg.y };
    nodes.push(n);
    return n;
  };

  // Endpoint nodes for every segment.
  for (const s of segments) {
    addNode(s, s.x1);
    addNode(s, s.x2);
  }

  // Climb transitions: from a lower segment, up the side wall of a box,
  // onto its top segment. Both corners of every box are candidates.
  for (const upper of segments) {
    for (const lower of segments) {
      if (lower === upper) continue;
      const dy = lower.y - upper.y;
      if (dy <= 0 || dy > limits.climbMax) continue;
      const sides = [
        { cornerX: upper.x1, approachX: upper.rect.x - 10 },
        { cornerX: upper.x2, approachX: upper.rect.x + upper.rect.w + 10 },
      ];
      for (const side of sides) {
        if (side.approachX < lower.x1 || side.approachX > lower.x2) continue;
        // Ghost rects (the facade's synthesized viewport-bottom ground) are
        // walkable lines, not solid boxes: they must not sever climbs that
        // cross them, or the cable ladder gets cut at the fold and a robot
        // below the viewport can never climb back in.
        const blocker = nearestBelow(
          rects.filter((r) => r !== upper.rect && !r.ghost),
          side.approachX,
          upper.y,
          lower.rect,
        );
        if (blocker && blocker.y < lower.y) continue;
        const nLow = addNode(lower, side.approachX);
        const nHigh = addNode(upper, side.cornerX);
        addEdge(nLow.id, nHigh.id, 'climb', dy * 2 + 40, { climb: dy });
        addEdge(nHigh.id, nLow.id, 'drop', dy * 0.6 + 12, { drop: dy });
      }
    }
  }

  // Hop transitions between facing edges of two boxes.
  for (const a of segments) {
    for (const b of segments) {
      if (a === b) continue;
      const gapX = b.rect.x - (a.rect.x + a.rect.w);
      if (gapX <= 6 || gapX > limits.hopMaxX) continue;
      const hopY = Math.abs(a.y - b.y);
      if (hopY > limits.hopMaxY) continue;
      const nA = addNode(a, a.x2);
      const nB = addNode(b, b.x1);
      const d = dist(nA.x, nA.y, nB.x, nB.y);
      const upPenalty = (target, from) => (target.y < from.y ? (from.y - target.y) * 0.8 : 0);
      const req = { hopX: gapX, hopY };
      addEdge(nA.id, nB.id, 'hop', d * 1.4 + 25 + upPenalty(nB, nA), req);
      addEdge(nB.id, nA.id, 'hop', d * 1.4 + 25 + upPenalty(nA, nB), req);
    }
  }

  // Long drops off either corner down to the nearest surface below.
  for (const upper of segments) {
    const corners = [
      { x: upper.x1, offX: upper.rect.x - 12 },
      { x: upper.x2, offX: upper.rect.x + upper.rect.w + 12 },
    ];
    for (const c of corners) {
      const below = nearestBelow(rects, c.offX, upper.y, upper.rect);
      if (!below) continue;
      const dy = below.y - upper.y;
      if (dy > limits.dropMax) continue;
      const lowerSeg = segments.find((s) => s.rect === below);
      if (c.offX < lowerSeg.x1 || c.offX > lowerSeg.x2) continue;
      const nHigh = addNode(upper, c.x);
      const nLow = addNode(lowerSeg, c.offX);
      addEdge(nHigh.id, nLow.id, 'drop', dy * 0.5 + 15, { drop: dy });
    }
  }

  // Walk edges between consecutive nodes on each segment.
  for (const s of segments) {
    const segNodes = nodes.filter((n) => n.seg === s.id).sort((a, b) => a.x - b.x);
    for (let i = 0; i + 1 < segNodes.length; i++) {
      const a = segNodes[i];
      const b = segNodes[i + 1];
      const cost = b.x - a.x;
      addEdge(a.id, b.id, 'walk', cost);
      addEdge(b.id, a.id, 'walk', cost);
    }
  }

  return { segments, nodes, adj };
}

export function nearestPointOnTerrain(graph, px, py) {
  let best = null;
  for (const s of graph.segments) {
    const x = clamp(px, s.x1, s.x2);
    const d = dist(px, py, x, s.y);
    if (!best || d < best.d) best = { seg: s.id, x, y: s.y, d };
  }
  return best;
}

// A* over the nav graph. start/goal: {seg, x}. Returns a list of steps:
//   {type:'walk', seg, toX, y}
//   {type:'hop'|'climb'|'drop', from:{x,y,seg}, to:{x,y,seg}}
// or null when unreachable. caps gates which transition edges are usable, so a
// nimble character routes through moves a heavy one cannot (defaults to the
// base NAV contract).
export function planRoute(graph, start, goal, caps = NAV) {
  const { segments, nodes, adj } = graph;
  const startSeg = segments[start.seg];
  const goalSeg = segments[goal.seg];
  if (!startSeg || !goalSeg) return null;

  const temps = [];
  const extra = new Map(); // overlay adjacency, symmetric
  const addExtra = (a, b, cost) => {
    if (!extra.has(a)) extra.set(a, []);
    if (!extra.has(b)) extra.set(b, []);
    extra.get(a).push({ to: b, type: 'walk', cost });
    extra.get(b).push({ to: a, type: 'walk', cost });
  };

  const insertTemp = (seg, x) => {
    const cx = clamp(x, seg.x1, seg.x2);
    const existing = nodes.find((n) => n.seg === seg.id && Math.abs(n.x - cx) < 3);
    if (existing) return existing;
    const n = { id: nodes.length + temps.length + 1000, seg: seg.id, x: cx, y: seg.y };
    temps.push(n);
    const segNodes = nodes.filter((p) => p.seg === seg.id).sort((a, b) => a.x - b.x);
    let left = null;
    let right = null;
    for (const p of segNodes) {
      if (p.x <= cx) left = p;
      if (p.x >= cx && !right) right = p;
    }
    if (left) addExtra(n.id, left.id, cx - left.x);
    if (right && right !== left) addExtra(n.id, right.id, right.x - cx);
    return n;
  };

  const nStart = insertTemp(startSeg, start.x);
  const nGoal = insertTemp(goalSeg, goal.x);
  if (nStart.seg === nGoal.seg) {
    addExtra(nStart.id, nGoal.id, Math.abs(nStart.x - nGoal.x));
  }

  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);
  for (const n of temps) byId.set(n.id, n);

  const neighbors = (id) => [...(adj.get(id) || []), ...(extra.get(id) || [])];
  const h = (n) => dist(n.x, n.y, nGoal.x, nGoal.y);

  const open = [{ id: nStart.id, f: h(nStart) }];
  const g = new Map([[nStart.id, 0]]);
  const cameFrom = new Map(); // id -> {prev, type}
  const closed = new Set();

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.id === nGoal.id) break;
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);
    for (const e of neighbors(cur.id)) {
      if (closed.has(e.to)) continue;
      if (!edgeAllowed(e, caps)) continue;
      const ng = g.get(cur.id) + e.cost;
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng);
        cameFrom.set(e.to, { prev: cur.id, type: e.type });
        open.push({ id: e.to, f: ng + h(byId.get(e.to)) });
      }
    }
  }

  if (!g.has(nGoal.id)) return null;

  // Reconstruct node chain, then compress into steps.
  const chain = [];
  let cur = nGoal.id;
  while (cur !== nStart.id) {
    const link = cameFrom.get(cur);
    if (!link) return null;
    chain.push({ node: byId.get(cur), type: link.type });
    cur = link.prev;
  }
  chain.reverse();

  const steps = [];
  let prevNode = nStart;
  for (const { node, type } of chain) {
    if (type === 'walk') {
      const last = steps[steps.length - 1];
      if (last && last.type === 'walk' && last.seg === node.seg) {
        last.toX = node.x;
      } else {
        steps.push({ type: 'walk', seg: node.seg, toX: node.x, y: node.y });
      }
    } else {
      steps.push({
        type,
        from: { x: prevNode.x, y: prevNode.y, seg: prevNode.seg },
        to: { x: node.x, y: node.y, seg: node.seg },
      });
    }
    prevNode = node;
  }
  return steps;
}
