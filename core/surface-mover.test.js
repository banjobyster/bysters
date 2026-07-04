// Surface-mover tests: one locomotion logic, correct in every frame. Headless.
// Verifies the surface-local transform (body sits outward along the normal, so
// a wall-walker really is off to the side) and a full jump that lands on a
// top-only box.

import { describe, it, expect, afterEach } from 'vitest';
import { SurfaceMover } from './surface-mover.js';
import { surfacesForRect, surfaceForSide } from '../dom/collect.js';
import { compileSurfaceGraph } from './path/compile.js';
import { LAUNCH_AGILE, planRoute } from './path/graph.js';

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
    scale: 1,
    bodyW: 20,
    bodyH: 16,
    headW: 40,
    headH: 32,
    hipX: [8, 4, -4, -8],
    hipY: 6,
    footRestX: [10, 5, -5, -10],
    standH: 20,
    stepThresholdBase: 12,
    walkSpeed: 160,
    wanderSpeed: 90,
    accel: 600,
  },
  palette: { pix: [0, 1, 2, 3] },
  legs: { rings: 4, near: {}, far: {} },
  face: { w: 8, h: 8, animated: [], exprs: { idle: (f) => f.px(1, 1, 1) } },
  buildBody() {},
  buildHead() {
    return { x: 0, y: 0, w: 8, h: 8 };
  },
};

// Ground + a walled box W sitting on it.
function scene() {
  const surfaces = [];
  const solids = [];
  const W = { x: 200, y: 200, w: 100, h: 100 }; // base y=300 sits on the ground
  solids.push({ ...W, el: 'W' });
  for (const s of surfacesForRect(W, ['top', 'left', 'right'], 'W')) surfaces.push(s);
  surfaces.push(surfaceForSide({ x: -200, y: 300, w: 900, h: 0 }, 'top', null, { ground: true }));
  return { surfaces, solids };
}

const surfaceIx = (g, el, side) => g.surfaces.findIndex((s) => s.el === el && s.side === side);
const groundIx = (g) => g.surfaces.findIndex((s) => s.meta && s.meta.ground);

const origRandom = Math.random;
afterEach(() => {
  Math.random = origRandom;
});

describe('surface-local frame: the body sits outward along the surface normal', () => {
  it('on the floor, the body is above the contact point (smaller y), normal points up', () => {
    const { surfaces, solids } = scene();
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const m = new SurfaceMover(CHAR);
    m.spawn(g, groundIx(g), 250, LAUNCH_AGILE);
    m.update(1 / 60, { autoWander: false });
    expect(m.normal.y).toBeCloseTo(-1, 5);
    expect(m.bodyY).toBeLessThan(m.contact.y - 5); // above the floor
  });

  it('on the right wall, the body is off to the right (outward), frame rotated ~90deg', () => {
    const { surfaces, solids } = scene();
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const m = new SurfaceMover(CHAR);
    m.spawn(g, surfaceIx(g, 'W', 'right'), 50, LAUNCH_AGILE);
    m.update(1 / 60, { autoWander: false });
    expect(m.normal.x).toBeCloseTo(1, 5);
    expect(m.x).toBeGreaterThan(m.contact.x + 5); // outward from the wall, to the right
    expect(m.fRot).toBeCloseTo(Math.PI / 2, 2);
  });

  it('on the underside, the body hangs below the surface (larger y), normal points down', () => {
    // A floating box with a walkable bottom.
    const surfaces = [];
    const solids = [{ x: 100, y: 100, w: 120, h: 40, el: 'O' }];
    for (const s of surfacesForRect({ x: 100, y: 100, w: 120, h: 40 }, ['top', 'bottom'], 'O')) surfaces.push(s);
    surfaces.push(surfaceForSide({ x: -200, y: 400, w: 900, h: 0 }, 'top', null, { ground: true }));
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const m = new SurfaceMover(CHAR);
    m.spawn(g, surfaceIx(g, 'O', 'bottom'), 60, LAUNCH_AGILE);
    m.update(1 / 60, { autoWander: false });
    expect(m.normal.y).toBeCloseTo(1, 5);
    expect(m.bodyY).toBeGreaterThan(m.contact.y + 5); // hangs below the underside
  });
});

describe('climb-as-walk: the byster rounds corners up a declared wall onto the top', () => {
  it('reaches W:top from the ground with no jumps, transitioning ground -> wall -> top', () => {
    Math.random = mulberry32(3);
    const { surfaces, solids } = scene();
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const wTop = surfaceIx(g, 'W', 'top');
    const goal = g.vertices.find((v) => v.surface === wTop);

    const m = new SurfaceMover(CHAR);
    m.spawn(g, groundIx(g), g.surfaces[groundIx(g)].length * 0.42, LAUNCH_AGILE);
    expect(m.routeTo(goal.id)).toBe(true);
    expect(m.route.some((s) => s.type === 'jump')).toBe(false); // a pure walk climb

    const seen = new Set();
    let reached = false;
    for (let i = 0; i < 1500; i++) {
      m.update(1 / 60, { autoWander: false });
      seen.add(g.surfaces[m.surface].side);
      if (m.surface === wTop && m.state === 'idle') {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
    expect(seen.has('right') || seen.has('left')).toBe(true); // it went up a wall
  });
});

describe('one ballistic maneuver: the byster jumps onto a top-only box and lands', () => {
  it('reaches a top-only box that is only jump-reachable, passing through the air', () => {
    Math.random = mulberry32(7);
    const surfaces = [];
    const solids = [];
    const T = { x: 220, y: 250, w: 120, h: 50 }; // top-only, base y=300 on ground
    solids.push({ ...T, el: 'T' });
    for (const s of surfacesForRect(T, ['top'], 'T')) surfaces.push(s);
    surfaces.push(surfaceForSide({ x: -200, y: 300, w: 900, h: 0 }, 'top', null, { ground: true }));
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);

    const tTop = surfaceIx(g, 'T', 'top');
    const goal = g.vertices.find((v) => v.surface === tTop);

    const m = new SurfaceMover(CHAR);
    m.spawn(g, groundIx(g), 120, LAUNCH_AGILE);
    expect(m.routeTo(goal.id)).toBe(true);

    let sawAir = false;
    let landed = false;
    for (let i = 0; i < 1500; i++) {
      m.update(1 / 60, { autoWander: false });
      if (m.state === 'air') sawAir = true;
      if (m.surface === tTop && m.state !== 'air') {
        landed = true;
        break;
      }
    }
    expect(sawAir).toBe(true); // it left the ground on a ballistic arc
    expect(landed).toBe(true); // and ended up standing on the top-only box
  });

  it('does not abandon its arc when a new destination is requested mid-jump', () => {
    Math.random = mulberry32(9);
    const surfaces = [];
    const solids = [];
    const T = { x: 220, y: 250, w: 120, h: 50 };
    solids.push({ ...T, el: 'T' });
    for (const s of surfacesForRect(T, ['top'], 'T')) surfaces.push(s);
    surfaces.push(surfaceForSide({ x: -200, y: 300, w: 900, h: 0 }, 'top', null, { ground: true }));
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const m = new SurfaceMover(CHAR);
    m.spawn(g, groundIx(g), 120, LAUNCH_AGILE);
    m.routeTo(g.vertices.find((v) => v.surface === surfaceIx(g, 'T', 'top')).id);

    let air = null;
    for (let i = 0; i < 1500 && !air; i++) {
      m.update(1 / 60, { autoWander: false });
      if (m.state === 'air') air = m.air;
    }
    expect(air).toBeTruthy();

    // Interrupt mid-arc: this must NOT teleport / replan; it queues.
    const groundGoal = g.vertices.find((v) => g.surfaces[v.surface].meta && g.surfaces[v.surface].meta.ground);
    m.routeTo(groundGoal.id);
    expect(m.state).toBe('air'); // still flying
    expect(m.air).toBe(air); // exact same arc, not replaced

    let landed = false;
    for (let i = 0; i < 1500 && !landed; i++) {
      m.update(1 / 60, { autoWander: false });
      if (m.state !== 'air') landed = true;
    }
    expect(landed).toBe(true);
    expect(m._pendingGoal).toBeNull(); // the queued destination was taken on landing
  });
});

describe('per-byster routing: the planner is an injectable seam', () => {
  it('uses the byster\'s own planner instead of the default A*', () => {
    const { surfaces, solids } = scene();
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const goal = g.vertices.find((v) => v.surface === surfaceIx(g, 'W', 'top'));

    let calledWith = null;
    const customPlanner = (graph, startId, goalId, caps) => {
      calledWith = { graph, startId, goalId, caps };
      return planRoute(graph, startId, goalId, caps); // reuse the generic A* underneath
    };
    const m = new SurfaceMover(CHAR, { planner: customPlanner });
    m.spawn(g, groundIx(g), 120, LAUNCH_AGILE);
    expect(m.routeTo(goal.id)).toBe(true);
    expect(calledWith).toBeTruthy();
    expect(calledWith.goalId).toBe(goal.id);
    expect(calledWith.caps).toBe(LAUNCH_AGILE); // its own caps flow through
  });
});

describe('frame handedness is consistent on every face (no left/bottom mirroring)', () => {
  it('tangent is perpendicular to the normal with one handedness, and rot reproduces both', () => {
    const { surfaces, solids } = scene(); // ground + W(top/left/right)
    const g = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    const m = new SurfaceMover(CHAR);
    m.spawn(g, groundIx(g), 100, LAUNCH_AGILE);
    const sides = new Set();
    for (let si = 0; si < g.surfaces.length; si++) {
      const f = m._frameOf(si);
      sides.add(g.surfaces[si].side);
      const dot = f.tangent.x * f.normal.x + f.tangent.y * f.normal.y;
      const crossZ = f.tangent.x * f.normal.y - f.tangent.y * f.normal.x;
      const dispTan = { x: Math.cos(f.rot), y: Math.sin(f.rot) };
      const dispNorm = { x: Math.sin(f.rot), y: -Math.cos(f.rot) };
      expect(Math.abs(dot)).toBeLessThan(1e-9); // tangent perpendicular to normal
      expect(crossZ).toBeCloseTo(-1, 6); // SAME handedness on every face
      expect(dispTan.x).toBeCloseTo(f.tangent.x, 6);
      expect(dispTan.y).toBeCloseTo(f.tangent.y, 6);
      expect(dispNorm.x).toBeCloseTo(f.normal.x, 6);
      expect(dispNorm.y).toBeCloseTo(f.normal.y, 6);
    }
    // W contributes left+right walls, so left/bottom-style faces are exercised.
    expect(sides.has('left') && sides.has('right') && sides.has('top')).toBe(true);
  });
});

describe('fluidity: one continuous glide along a surface, no per-vertex stutter', () => {
  it('holds speed across the ground\'s many waypoints instead of stopping at each', () => {
    Math.random = mulberry32(4);
    const g = compileSurfaceGraph(
      [surfaceForSide({ x: -100, y: 400, w: 1000, h: 0 }, 'top', null, { ground: true })],
      [],
      LAUNCH_AGILE,
    );
    const far = g.vertices.reduce((a, b) => (b.x > a.x ? b : a));
    const m = new SurfaceMover(CHAR);
    m.spawn(g, 0, 60, LAUNCH_AGILE);
    expect(m.routeTo(far.id)).toBe(true);

    const vels = [];
    for (let i = 0; i < 1500; i++) {
      m.update(1 / 60, { autoWander: false });
      vels.push(Math.abs(m.vel));
      if (m.state === 'idle') break;
    }
    // skip the initial ramp-up and the final glide-to-stop; the cruise must never
    // stall (the old per-vertex stop would drop this to ~0 repeatedly).
    const cruise = vels.slice(25, vels.length - 25);
    expect(cruise.length).toBeGreaterThan(30);
    expect(Math.min(...cruise)).toBeGreaterThan(90);
  });
});
