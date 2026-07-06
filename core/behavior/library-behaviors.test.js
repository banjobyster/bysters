// The generic, composable behaviors the playground personalities are built from
// (followCursor, avoidCursorGaze, mood, flourish, sleep, and the higher-order
// fatigue / sometimes wrappers). Unit-tested pure against a fake world, then one
// composition test proves four very different personalities are nothing but
// different LISTS of these same generic factories - no per-type code.

import { describe, it, expect, afterEach } from 'vitest';
import {
  followCursor, avoidCursorGaze, mood, flourish, sleep, fatigue, sometimes, perch,
  wander, watchCursor, watchNearest, approach, flee, caughtBy, reactTo, fleeCursor, liveliness, operateFixtures, group,
} from './library.js';
import { goto, stop } from './channels.js';
import { Byster } from './byster.js';
import { Stage } from './stage.js';
import { SurfaceMover } from '../surface-mover.js';
import { surfaceForSide, surfacesForRect } from '../../dom/collect.js';
import { compileSurfaceGraph } from '../path/compile.js';
import { LAUNCH_AGILE, createGraph, addVertex, addEdge, routeCosts } from '../path/graph.js';
import { makeFixture } from '../fixtures/fixture.js';
import { createFixtureStore } from '../fixtures/store.js';

const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});
function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('followCursor: seek the pointer, yield once near it', () => {
  const world = { cursor: { x: 200, y: 0 }, nav: { vertexPoint: (id) => ({ 0: { x: 50, y: 0 }, 1: { x: 180, y: 0 }, 2: { x: 300, y: 0 } }[id]) } };
  it('routes to the reachable vertex nearest the cursor when far', () => {
    const self = { x: 0, bodyY: 0, reachable: new Set([0, 1, 2]) };
    expect(followCursor({ near: 20 }).update(world, self)).toEqual({ locomotion: { kind: 'goto', vertex: 1 } });
  });
  it('yields (null) once within `near` of the cursor', () => {
    const self = { x: 190, bodyY: 0, reachable: new Set([0, 1, 2]) };
    expect(followCursor({ near: 30 }).update(world, self)).toBeNull();
  });
});

describe('avoidCursorGaze: look at the far side from the cursor', () => {
  it('gazes to the mirror point away from the cursor', () => {
    const g = avoidCursorGaze().update({ cursor: { x: 100, y: 40 } }, { x: 0, bodyY: 0 });
    expect(g.gaze.kind).toBe('look');
    expect(g.gaze.point.x).toBeLessThan(0); // opposite the cursor (which is at +x)
  });
});

describe('mood: a low-priority baseline face', () => {
  it('always bids its expression at low priority', () => {
    const m = mood('angry');
    expect(m.priority).toBeLessThan(10);
    expect(m.update().face).toMatchObject({ kind: 'express', name: 'angry' });
  });
});

describe('flourish: flash a face on an interval', () => {
  it('is quiet until the interval, then shows a face for the hold, then quiet again', () => {
    seedRandom(1);
    const f = flourish(['a', 'b'], { every: 1, hold: 0.5 });
    const w = (dt) => f.update({ dt });
    expect(w(0.5)).toBeNull(); // t=0.5 < every
    const flash = w(0.6); // t=1.1 >= every -> flash
    expect(flash.face.kind).toBe('express');
    expect(['a', 'b']).toContain(flash.face.name);
    expect(w(0.3)).not.toBeNull(); // still within hold
    w(0.3); // hold elapses
    expect(w(0.1)).toBeNull(); // quiet again
  });
});

describe('sleep: awake -> doze -> awake duty cycle', () => {
  it('yields while awake, stops with a sleepy face while sleeping, then wakes', () => {
    const s = sleep({ awakeFor: 1, sleepFor: 0.5 });
    const w = (dt) => s.update({ dt });
    expect(w(0.5)).toBeNull(); // awake
    const dozing = w(0.6); // crosses awakeFor -> sleeping
    expect(dozing.locomotion.kind).toBe('stop');
    expect(dozing.face.name).toBe('sleepy');
    expect(w(0.3).locomotion.kind).toBe('stop'); // still sleeping
    expect(w(0.3)).toBeNull(); // sleepFor elapsed -> awake again
  });
});

describe('fatigue: run, tire, rest, resume (wrapping any behavior)', () => {
  const inner = { id: 'runner', priority: 60, channels: ['locomotion'], update: () => ({ locomotion: { kind: 'goto', vertex: 1 } }) };
  it('passes the inner bid until energy drains, then rests, then resumes', () => {
    const f = fatigue(inner, { runFor: 0.5, restFor: 0.5 });
    const w = (dt) => f.update({ dt }, {});
    expect(w(0.3).locomotion.vertex).toBe(1); // running
    const tired = w(0.3); // energy exhausted -> rest
    expect(tired.locomotion.kind).toBe('stop');
    expect(w(0.3).locomotion.kind).toBe('stop'); // still resting
    expect(w(0.3)).toBeNull(); // rest over -> refilled, yields this frame
    expect(w(0.1).locomotion.vertex).toBe(1); // running again
  });

  it('broadcasts its tag while resting when `tag` is set', () => {
    const f = fatigue(inner, { runFor: 0.5, restFor: 0.5, tag: 'winded' });
    const w = (dt) => f.update({ dt }, {});
    expect(w(0.3).tags).toBeUndefined(); // running: no tag
    const tired = w(0.3); // energy spent -> rest
    expect(tired.locomotion.kind).toBe('stop');
    expect(tired.tags).toMatchObject({ kind: 'tag', names: ['winded'] }); // advertises exhaustion
  });
});

describe('reactTo: modulate face/pace/gaze on another byster tag, without steering', () => {
  const self = { x: 0, bodyY: 0 };
  it('bids the enabled channels (not locomotion) while a matching tagged byster is near', () => {
    const byte = { name: 'byte', x: 30, bodyY: 0, tags: new Set(['caught']) };
    const world = { bysters: { nearestMatching: (s, pred) => (pred(byte) ? byte : null) } };
    const bid = reactTo((v) => v.name === 'byte', { tag: 'caught', face: 'happy', pace: 0.55, gaze: true }).update(world, self);
    expect(bid.locomotion).toBeUndefined(); // never steers; wander still drives
    expect(bid.face).toMatchObject({ kind: 'express', name: 'happy' });
    expect(bid.pace).toEqual({ kind: 'pace', mul: 0.55 });
    expect(bid.gaze).toMatchObject({ kind: 'look' });
  });
  it('yields when the target is present but not carrying the tag', () => {
    const byte = { name: 'byte', x: 30, bodyY: 0, tags: new Set() };
    const world = { bysters: { nearestMatching: (s, pred) => (pred(byte) ? byte : null) } };
    expect(reactTo((v) => v.name === 'byte', { tag: 'caught', face: 'happy' }).update(world, self)).toBeNull();
  });
});

describe('sometimes: probabilistic gate around a behavior', () => {
  const inner = { id: 'act', priority: 50, channels: ['interact'], update: () => ({ interact: { kind: 'x' } }) };
  it('passes the inner bid only in windows where the roll is under p', () => {
    const rolls = [0.1, 0.9]; // window 1: active, window 2: inactive
    let i = 0;
    Math.random = () => rolls[i++];
    const s = sometimes(inner, 0.5, { window: 1 });
    expect(s.update({ dt: 1 }, {})).not.toBeNull(); // reroll -> active
    expect(s.update({ dt: 0.5 }, {})).not.toBeNull(); // same window, still active
    expect(s.update({ dt: 1 }, {})).toBeNull(); // new window -> inactive
  });
});

describe('perch: climb a wall to a high ledge and settle (uses vertical terrain)', () => {
  it('routes a byster up onto a walled box top and rests there', () => {
    // A box with walls resting on the ground: its top is reachable by walking
    // up the side (climb is walk). perch should pick that high vertex and go.
    const boxSurfaces = surfacesForRect({ x: 200, y: 260, w: 120, h: 140 }, ['top', 'left', 'right'], 'box');
    const ground = surfaceForSide({ x: -100, y: 400, w: 900, h: 0 }, 'top', null, { ground: true });
    const g = compileSurfaceGraph([...boxSurfaces, ground], [{ x: 200, y: 260, w: 120, h: 140, el: 'box' }], LAUNCH_AGILE);
    const boxTopIx = g.surfaces.findIndex((s) => s.el === 'box' && s.side === 'top');
    const gi = g.surfaces.findIndex((s) => s.meta && s.meta.ground);

    const stage = new Stage(g);
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, gi, 120, LAUNCH_AGILE);
    stage.add(new Byster('climber', mover, [perch({ every: 0, dwell: 2 })]));

    let reachedLedge = false;
    for (let i = 0; i < 1500; i++) {
      stage.step(1 / 60);
      if (mover.surface === boxTopIx) reachedLedge = true;
    }
    expect(reachedLedge).toBe(true); // it climbed off the ground onto the ledge
  });
});

// ---- Composition: four distinct personalities, all just behavior lists ----

const CHAR = {
  name: 'p',
  params: {
    scale: 1, bodyW: 20, bodyH: 16, headW: 40, headH: 32,
    hipX: [8, 4, -4, -8], hipY: 6, footRestX: [10, 5, -5, -10], standH: 20,
    stepThresholdBase: 12, walkSpeed: 200, wanderSpeed: 120, accel: 900,
  },
  palette: { pix: [0, 1, 2, 3] },
  legs: { rings: 4, near: {}, far: {} },
  face: { w: 8, h: 8, animated: [], exprs: { idle: (f) => f.px(1, 1, 1) } },
  buildBody() {},
  buildHead() {
    return { x: 0, y: 0, w: 8, h: 8 };
  },
};

const groundGraph = () =>
  compileSurfaceGraph([surfaceForSide({ x: -100, y: 400, w: 900, h: 0 }, 'top', null, { ground: true })], [], LAUNCH_AGILE);

// The playground cast: pure composition of the generic factories above.
const CAST = [
  { name: 'good', at: 120, mind: () => [followCursor({ face: 'happy' }), operateFixtures({ match: (fx) => fx.state === 'broken', drive: 'fixed' }), wander(), watchCursor(), flourish(['happy']), mood('idle')] },
  { name: 'bad', at: 300, mind: () => [flee((v) => v.name === 'police', { radius: 200 }), sleep({ awakeFor: 4, sleepFor: 2 }), sometimes(operateFixtures({ match: (fx) => fx.state !== 'fixed', drive: 'fixed' }), 0.25), operateFixtures({ match: (fx) => fx.state !== 'broken', drive: 'broken' }), wander(), watchNearest(), mood('idle')] },
  { name: 'police', at: 340, mind: () => [fatigue(approach((v) => v.name === 'bad', { notice: 400, face: 'angry' }), { runFor: 2, restFor: 1.5 }), wander(), watchCursor(), mood('angry')] },
  { name: 'ghost', at: 500, mind: () => [sometimes(operateFixtures({ match: (fx) => fx.state !== 'broken', drive: 'broken' }), 0.05), avoidCursorGaze(), wander(), flourish(['idle']), mood('idle')] },
];

describe('composition: four personalities are just different behavior lists', () => {
  it('produces distinct emergent behavior with no per-type code', () => {
    seedRandom(7);
    const g = groundGraph();
    const store = createFixtureStore([
      makeFixture({ id: 'd0', states: ['fixed', 'broken'], state: 'fixed', x: 200, y: 400 }),
      makeFixture({ id: 'd1', states: ['fixed', 'broken'], state: 'fixed', x: 420, y: 400 }),
    ]);
    const stage = new Stage(g, { store });
    stage.setCursor({ x: 150, y: 380 });
    const cast = {};
    for (const spec of CAST) {
      const mover = new SurfaceMover(CHAR);
      mover.spawn(g, 0, spec.at, LAUNCH_AGILE);
      const b = new Byster(spec.name, mover, spec.mind());
      cast[spec.name] = b;
      stage.add(b);
    }
    const badSleep = cast.bad.behaviors.find((b) => b.id === 'sleep');
    let badSleptEver = false;
    for (let i = 0; i < 2400; i++) {
      stage.step(1 / 60);
      if (badSleep._sleeping) badSleptEver = true;
    }

    const by = (name) => store.log.filter((r) => r.by === name);
    // Structural: each mind is a list of generic library behaviors, no type code.
    expect(cast.police.behaviors.map((b) => b.id)).not.toContain('operate-fixtures');
    expect(cast.good.behaviors.map((b) => b.id)).toEqual(expect.arrayContaining(['follow-cursor', 'operate-fixtures']));
    expect(cast.ghost.behaviors.map((b) => b.id)).toContain('avoid-cursor-gaze');
    // Emergent: police never operates fixtures; bad breaks; good repairs; ghost is rare.
    expect(by('police')).toHaveLength(0);
    expect(by('bad').filter((r) => r.to === 'broken').length).toBeGreaterThanOrEqual(1);
    expect(by('good').filter((r) => r.to === 'fixed').length).toBeGreaterThanOrEqual(1);
    expect(by('ghost').length).toBeLessThan(by('bad').length);
    expect(badSleptEver).toBe(true);
  });
});

// ---- Route-aware flight: flee by the pursuer's path cost, not straight line ----

describe('route-aware flight', () => {
  it('routeCosts is shortest path cost, and omits vertices the caps cannot reach', () => {
    const g = createGraph();
    addVertex(g, 0, 0, 0); // 0 floor-left
    addVertex(g, 0, 100, 0); // 1 floor-right
    addVertex(g, 1, 100, -100); // 2 a ledge above
    addEdge(g, 0, 1, 'walk', 100);
    addEdge(g, 1, 0, 'walk', 100);
    addEdge(g, 1, 2, 'jump', 50, { speed: 800 }); // the only way up needs launch >= 800
    const heavy = routeCosts(g, 0, { maxLaunch: 640 });
    expect(heavy.get(1)).toBe(100);
    expect(heavy.has(2)).toBe(false); // heavy caps cannot make the jump -> ledge unreachable
    const agile = routeCosts(g, 0, { maxLaunch: 900 });
    expect(agile.get(2)).toBe(150); // 100 walk + 50 jump
  });

  it('flee escapes to a spot the pursuer cannot reach, not the far end of the floor', () => {
    const pts = { 0: { x: 100, y: 0 }, 1: { x: 900, y: 0 }, 2: { x: 300, y: -200 } };
    const world = {
      bysters: { nearestMatching: () => ({ name: 'cop', x: 0, bodyY: 0, caps: { maxLaunch: 100 } }) },
      nav: {
        vertexPoint: (id) => pts[id],
        nearestVertex: () => ({ id: 9 }), // pretend threat is at some vertex
        routeCostsFrom: () => new Map([[9, 0], [0, 500], [1, 100]]), // vertex 2 (ledge) absent = pursuer can't reach it
      },
    };
    // straight-line farthest from the threat (at x=0) is the floor-right (1, x=900),
    // but the ledge (2) is unreachable for the pursuer, so route-aware flee takes it.
    const self = { x: 500, bodyY: 0, reachable: new Set([0, 1, 2]), caps: { maxLaunch: 900 } };
    expect(flee(() => true).update(world, self).locomotion.vertex).toBe(2);
  });
});

// ---- caughtBy: freeze + broadcast a tag when a matching byster closes in ----

describe('caughtBy: freeze and broadcast when a matching byster closes in', () => {
  const caught = { bysters: { nearestMatching: () => ({ name: 'cop' }) }, dt: 0.1 };
  const clear = { bysters: { nearestMatching: () => null }, dt: 0.1 };
  const self = {};

  it('does nothing until a matching byster is within radius', () => {
    expect(caughtBy(() => true).update(clear, self)).toBeNull();
  });

  it('freezes, shows the face, and tags itself when caught', () => {
    const bid = caughtBy((v) => v.name === 'cop', { face: 'panic', tag: 'caught' }).update(caught, self);
    expect(bid.locomotion.kind).toBe('stop');
    expect(bid.face).toMatchObject({ kind: 'express', name: 'panic' });
    expect(bid.tags).toMatchObject({ kind: 'tag', names: ['caught'] });
  });

  it('holds the freeze through the stun, then a grace where it is free and un-catchable', () => {
    const c = caughtBy(() => true, { stunFor: 0.25, immuneFor: 0.25 });
    const w = () => c.update(caught, self);
    for (let i = 0; i < 4; i++) expect(w().locomotion.kind).toBe('stop'); // caught, held through the stun
    expect(w()).toBeNull(); // stun over -> free to move
    expect(w()).toBeNull(); // still in the grace: not re-caught though the catcher is right there
    expect(w()).toBeNull();
    expect(w().locomotion.kind).toBe('stop'); // grace elapsed -> caught again
  });
});

// ---- stop() halts the body in place (mover.halt), not just clears the goal ----

describe('stop() halts the body in place', () => {
  it('halt() abandons the current route and returns to idle', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, 0, 100, LAUNCH_AGILE);
    const far = g.vertices[g.vertices.length - 1].id;
    expect(mover.routeTo(far)).toBe(true);
    expect(mover.state).toBe('walk');
    mover.halt();
    expect(mover.state).toBe('idle');
    expect(mover.route).toBeNull();
  });

  it('a stop() intent through a Byster clears the route instead of coasting to a stale goal', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, 0, 100, LAUNCH_AGILE);
    const far = g.vertices[g.vertices.length - 1].id;
    let mode = 'go';
    const drive = { id: 'drive', priority: 50, channels: ['locomotion'], update: () => (mode === 'go' ? { locomotion: goto(far) } : { locomotion: stop() }) };
    const stage = new Stage(g);
    stage.add(new Byster('x', mover, [drive]));
    stage.step(1 / 60);
    expect(mover.state).toBe('walk'); // driving toward the far vertex
    mode = 'stop';
    stage.step(1 / 60);
    expect(mover.route).toBeNull(); // stop() cleared the route
    expect(mover.state).toBe('idle'); // at rest, not coasting onward
  });

  it('halt() while airborne keeps the arc (cannot stop mid-jump), only drops a queued goal', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, 0, 100, LAUNCH_AGILE);
    mover.state = 'air'; // pretend mid-arc
    mover.route = [{ type: 'walk' }];
    mover._pendingGoal = 7;
    mover.halt();
    expect(mover.state).toBe('air'); // still flying: an arc runs to completion
    expect(mover.route).not.toBeNull(); // the route is preserved, not abandoned mid-air
    expect(mover._pendingGoal).toBeNull(); // only the queued destination is dropped
  });
});

describe('Byster.view(): the decentralized-sensing snapshot', () => {
  it('exposes name, position, surface, state, caps identity, and an initially-empty tags Set', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    const caps = { maxLaunch: 700, gravity: 2400 };
    mover.spawn(g, 0, 120, caps);
    const v = new Byster('scout', mover, []).view();
    expect(v).toMatchObject({ name: 'scout', x: mover.x, bodyY: mover.bodyY, surface: mover.surface, state: mover.state });
    expect(v.caps).toBe(caps); // identity, so a fleer can reason with the pursuer real caps
    expect(v.tags).toBeInstanceOf(Set);
    expect(v.tags.size).toBe(0);
  });

  it('exposes the current face expression, tracking the mover live', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, 0, 120, LAUNCH_AGILE);
    const b = new Byster('scout', mover, []);
    expect(b.view().face).toBe('idle'); // spawn sets the resting face
    mover.face.set('happy');
    expect(b.view().face).toBe('happy');
  });
});

describe('approach standoff: stand beside the target, never on it', () => {
  // Sparse vertices: 180 | 300 (the target's own spot) | 420.
  const points = { 1: { x: 300, y: 0 }, 2: { x: 420, y: 0 }, 3: { x: 180, y: 0 } };
  const navWorld = (target) => ({
    bysters: { nearestMatching: () => target },
    nav: { vertexPoint: (id) => points[id] },
  });
  const model = { name: 'model', x: 300, bodyY: 0 };

  it('vetoes the target personal-space vertex and berths a standoff away on its own side', () => {
    const b = approach(() => true, { standoff: 110, notice: Infinity });
    // follower far LEFT: aim is 300 - 110 = 190; the nearest vertex to that aim is
    // the target's own (300), but it is inside the personal space, so the berth
    // falls to 180 on the follower's side
    const bid = b.update(navWorld(model), { x: 0, bodyY: 0, reachable: new Set([1, 2, 3]) });
    expect(bid.locomotion).toEqual({ kind: 'goto', vertex: 3 });
    expect(bid.gaze.point).toEqual({ x: 300, y: 0 }); // eyes on the real target, not the berth
  });

  it('the chosen side freezes once close, so the follower never cuts through its target', () => {
    const b = approach(() => true, { standoff: 110, notice: Infinity });
    b.update(navWorld(model), { x: 600, bodyY: 0, reachable: new Set([1, 2, 3]) }); // far right: side = +1
    // now slightly LEFT of the target but within 2x standoff: the side must stay
    // frozen at +1 (aim 410 -> vertex 420), not re-anchor to -1 (aim 190 -> 180)
    const bid = b.update(navWorld(model), { x: 280, bodyY: 0, reachable: new Set([1, 2, 3]) });
    expect(bid.locomotion).toEqual({ kind: 'goto', vertex: 2 });
  });

  it('losing the target resets the side; without standoff the target vertex is fair game', () => {
    const b = approach(() => true, { standoff: 110, notice: Infinity });
    b.update(navWorld(model), { x: 600, bodyY: 0, reachable: new Set([1, 2, 3]) });
    expect(b.update(navWorld(null), { x: 600, bodyY: 0, reachable: new Set([1, 2, 3]) })).toBeNull();
    expect(b._side).toBeNull(); // fresh episode, fresh side
    const plain = approach(() => true, { notice: Infinity });
    const bid = plain.update(navWorld(model), { x: 0, bodyY: 0, reachable: new Set([1, 2, 3]) });
    expect(bid.locomotion).toEqual({ kind: 'goto', vertex: 1 }); // classic pile-on approach, unchanged
  });

  it('personal-space veto falls back to the full set rather than stranding the follower', () => {
    const b = approach(() => true, { standoff: 110, notice: Infinity });
    // the ONLY reachable vertex is the target's own: standing too close beats stranding
    const bid = b.update(navWorld(model), { x: 0, bodyY: 0, reachable: new Set([1]) });
    expect(bid.locomotion).toEqual({ kind: 'goto', vertex: 1 });
  });

  it('headless end to end: the follower settles beside a standing model, outside its personal space', () => {
    const g = groundGraph();
    const stage = new Stage(g);
    const mModel = new SurfaceMover(CHAR); mModel.spawn(g, 0, 300, LAUNCH_AGILE); // x = 200
    const mTail = new SurfaceMover(CHAR); mTail.spawn(g, 0, 700, LAUNCH_AGILE); // x = 600, right of the model
    stage.add(new Byster('model', mModel, [])); // a statue: no behaviors, never moves
    stage.add(new Byster('tail', mTail, [approach((v) => v.name === 'model', { notice: Infinity, standoff: 110 })]));
    for (let i = 0; i < 900; i++) stage.step(1 / 60); // 15 sim-seconds
    const dx = mTail.x - mModel.x;
    expect(mTail.state).toBe('idle'); // settled, not orbiting
    expect(dx).toBeGreaterThanOrEqual(55); // outside the personal space, on its own side
    expect(dx).toBeLessThanOrEqual(160); // but genuinely beside, not stranded down the page
  });
});

describe('group(): fuse behaviors into one bid, later wins per channel', () => {
  const bidder = (id, priority, channels, bid) => ({ id, priority, channels, update: () => bid });

  it('merges bids with later-wins overlap, unions channels, takes the top priority', () => {
    const walkAndFrown = bidder('walk', 40, ['locomotion', 'face'], { locomotion: goto(7), face: { kind: 'express', name: 'frown' } });
    const smile = bidder('smile', 20, ['face'], { face: { kind: 'express', name: 'smile' } });
    const fused = group(walkAndFrown, smile);
    expect(fused.priority).toBe(40);
    expect(fused.channels.sort()).toEqual(['face', 'locomotion']);
    const bid = fused.update({}, {});
    expect(bid.locomotion).toEqual(goto(7)); // the earlier walker still steers
    expect(bid.face.name).toBe('smile'); // the later face overrides the overlap
  });

  it('stays silent when every member is silent, and skips silent members in the merge', () => {
    const mute = bidder('mute', 10, ['face'], null);
    const talk = bidder('talk', 10, ['face'], { face: { kind: 'express', name: 'hey' } });
    expect(group(mute, mute).update({}, {})).toBeNull();
    expect(group(mute, talk).update({}, {}).face.name).toBe('hey');
    expect(group(talk, mute).update({}, {}).face.name).toBe('hey'); // a silent later member does not erase the earlier bid
  });

  it('forwards init to every member and honors an explicit priority override', () => {
    const seen = [];
    const withInit = (id) => ({ id, priority: 10, channels: [], init: (by) => seen.push([id, by]), update: () => null });
    const fused = group(withInit('a'), withInit('b'), { priority: 99 });
    fused.init('the-byster');
    expect(seen).toEqual([['a', 'the-byster'], ['b', 'the-byster']]);
    expect(fused.priority).toBe(99);
  });

  it('a single gate governs the whole unit (sometimes wraps a group cleanly)', () => {
    seedRandom(7);
    const talk = bidder('talk', 10, ['face'], { face: { kind: 'express', name: 'hey' } });
    const gated = sometimes(group(talk), 0, { window: 1 }); // p = 0: never active
    expect(gated.update({ dt: 2 }, {})).toBeNull();
  });
});

describe('Byster.rebase(): the graph changed underneath, the mind persists', () => {
  it('drops the routed goal and pending command; behaviors and tags stay', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, 0, 120, LAUNCH_AGILE);
    const keepState = { id: 'k', priority: 10, channels: ['locomotion'], _count: 7, update: () => null };
    const b = new Byster('scout', mover, [keepState]);
    b.command(3);
    b.tags.add('busy');
    b.rebase();
    expect(b._command).toBeNull(); // an old-graph vertex id means nothing now
    expect(b._goal).toBeNull();
    expect(b.behaviors[0]._count).toBe(7); // mid-episode behavior state untouched
    expect(b.tags.has('busy')).toBe(true);
  });
});

describe('face sensing: one byster reads another expression through world.bysters', () => {
  it('a mimic behavior copies the model face it senses in the snapshot', () => {
    const g = groundGraph();
    const stage = new Stage(g);
    const mModel = new SurfaceMover(CHAR); mModel.spawn(g, 0, 200, LAUNCH_AGILE);
    const mTwin = new SurfaceMover(CHAR); mTwin.spawn(g, 0, 260, LAUNCH_AGILE);
    // the model holds a face; the twin's only knowledge of it is the sensed view
    stage.add(new Byster('model', mModel, [mood('happy')]));
    const copycat = {
      id: 'copycat', priority: 20, channels: ['face'],
      update: (world) => {
        const v = world.bysters.named('model');
        return v && v.face !== 'off' ? { face: { kind: 'express', name: v.face } } : null;
      },
    };
    stage.add(new Byster('twin', mTwin, [copycat]));
    stage.step(1 / 60); // model expresses; snapshot views are pre-step, so the twin sees it next frame
    stage.step(1 / 60);
    expect(stage.named('twin').mover.face.expr).toBe('happy');
  });
});

describe('tag broadcast: one byster senses another advertised state, end to end', () => {
  it('a caught byster advertises the tag through view().tags for another to read', () => {
    const g = groundGraph();
    const stage = new Stage(g);
    const mA = new SurfaceMover(CHAR); mA.spawn(g, 0, 200, LAUNCH_AGILE);
    const mB = new SurfaceMover(CHAR); mB.spawn(g, 0, 208, LAUNCH_AGILE); // right beside A
    stage.add(new Byster('a', mA, [caughtBy((v) => v.name === 'b', { radius: 60, stunFor: 1, immuneFor: 0.2 })]));
    stage.add(new Byster('b', mB, [wander()]));
    stage.step(1 / 60); // A senses B within radius -> tags itself 'caught'
    expect(stage.named('a').view().tags.has('caught')).toBe(true); // advertised
    const world = stage.step(1 / 60);
    expect(world.bysters.named('a').tags.has('caught')).toBe(true); // and sensed through the world snapshot
  });
});

// ---- Runtime body knobs: speed and look are live channels, not frozen at spawn ----

describe('pace + appearance channels: behaviors drive speed and look at runtime', () => {
  it('fatigue winds pace down as it tires (not just a hard stop)', () => {
    const inner = { id: 'runner', priority: 60, channels: ['locomotion'], update: () => ({ locomotion: { kind: 'goto', vertex: 1 } }) };
    const f = fatigue(inner, { runFor: 1, restFor: 0.5, minPace: 0.4 });
    const fresh = f.update({ dt: 0.001 }, {});
    expect(fresh.pace.kind).toBe('pace');
    expect(fresh.pace.mul).toBeGreaterThan(0.9); // fresh legs run near full pace
    const tired = f.update({ dt: 0.9 }, {}); // most of the energy spent
    expect(tired.pace.mul).toBeLessThan(0.6); // visibly labouring
    expect(tired.pace.mul).toBeGreaterThanOrEqual(0.4); // but never below minPace
  });

  it('fleeCursor bids a fast pace while the pointer is close', () => {
    const world = {
      cursor: { x: 10, y: 0 },
      nav: {
        vertexPoint: (id) => ({ 0: { x: 0, y: 0 }, 1: { x: 500, y: 0 } }[id]),
        nearestVertex: () => ({ id: 0 }),
        routeCostsFrom: () => new Map([[0, 0], [1, 500]]), // vertex 1 is far by route from the pointer
      },
    };
    const self = { x: 0, bodyY: 0, reachable: new Set([0, 1]), caps: { maxLaunch: 900 } };
    const bid = fleeCursor({ radius: 100, speed: 1.7 }).update(world, self);
    expect(bid.pace).toEqual({ kind: 'pace', mul: 1.7 });
    expect(bid.locomotion.vertex).toBe(1); // the reachable spot farthest by route from the pointer
    expect(bid.appearance).toBeUndefined(); // no fade unless alpha is set
    const glassy = fleeCursor({ radius: 100, speed: 1.7, alpha: 0.12 }).update(world, self);
    expect(glassy.appearance).toEqual({ kind: 'appear', alpha: 0.12 }); // turns glassy while bolting
  });

  it('sleep fades via the appearance channel when `dim` is set', () => {
    const dozing = sleep({ awakeFor: 0, sleepFor: 1, dim: 0.3 }).update({ dt: 0.001 });
    expect(dozing.appearance).toEqual({ kind: 'appear', alpha: 0.3 });
  });

  it('a pace bid reaches the mover, and falls back to the resting default when unbid', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, 0, 200, LAUNCH_AGILE);
    mover.speedScale = 0.5; // resting cruise default
    const drive = { id: 'drive', priority: 50, channels: ['pace'], on: true, update() { return this.on ? { pace: { kind: 'pace', mul: 1.4 } } : null; } };
    const stage = new Stage(g);
    stage.add(new Byster('x', mover, [drive]));
    stage.step(1 / 60);
    expect(mover.pace).toBeCloseTo(1.4); // the behavior drove it
    drive.on = false;
    stage.step(1 / 60);
    expect(mover.pace).toBeCloseTo(0.5); // reverted to the resting default
  });

  it('liveliness always bids a pace that stays in range and actually varies', () => {
    seedRandom(3);
    const L = liveliness({ base: 0.7, vary: 0.2, every: 0.3, ease: 60 });
    const vals = [];
    for (let i = 0; i < 600; i++) vals.push(L.update({ dt: 1 / 60 }).pace.mul);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    expect(min).toBeGreaterThanOrEqual(0.15); // clamped floor
    expect(max).toBeLessThanOrEqual(0.9 + 1e-6); // base + vary
    expect(max - min).toBeGreaterThan(0.08); // it wobbles, not constant
  });

  it('an appearance bid eases the mover alpha toward the bid, and back to the resting default when unbid', () => {
    const g = groundGraph();
    const mover = new SurfaceMover(CHAR);
    mover.spawn(g, 0, 200, LAUNCH_AGILE);
    mover.baseAlpha = mover.alpha = 0.9; // resting look default
    const dimmer = { id: 'dim', priority: 50, channels: ['appearance'], on: true, update() { return this.on ? { appearance: { kind: 'appear', alpha: 0.2 } } : null; } };
    const stage = new Stage(g);
    stage.add(new Byster('y', mover, [dimmer]));
    stage.step(1 / 60);
    expect(mover.alpha).toBeLessThan(0.9); // started easing down, not a snap
    expect(mover.alpha).toBeGreaterThan(0.2);
    for (let i = 0; i < 240; i++) stage.step(1 / 60);
    expect(mover.alpha).toBeCloseTo(0.2, 1); // eased to the bid
    dimmer.on = false;
    for (let i = 0; i < 240; i++) stage.step(1 / 60);
    expect(mover.alpha).toBeCloseTo(0.9, 1); // eased back to the resting default
  });
});
