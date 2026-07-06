// Collect acceptance tests (TDD Section 13.1, PE-1). Surface production and
// normals are pure geometry; collectSurfaces is exercised with a FixedSpace and
// a fake document, so no real DOM is needed.

import { describe, it, expect } from 'vitest';
import { walkableSides, surfaceForSide, surfacesForRect, collectSurfaces, collectFixtures, collectWorld, parseTransitions, worldSignature } from './collect.js';
import { FixedSpace } from './space.js';

const elWith = (walk) => (walk === undefined ? { dataset: {} } : { dataset: { walk } });

describe('PE-1: data-walk parses into the declared walkable sides', () => {
  it('"top left right" -> three sides, "top" -> one, absent/empty -> top', () => {
    expect(walkableSides(elWith('top left right'))).toEqual(['top', 'left', 'right']);
    expect(walkableSides(elWith('top'))).toEqual(['top']);
    expect(walkableSides(elWith(''))).toEqual(['top']); // shorthand <div data-walk>
    expect(walkableSides(elWith(undefined))).toEqual(['top']); // attribute absent (default)
  });

  it('drops unknown tokens and de-dupes, falling back to top if nothing valid', () => {
    expect(walkableSides(elWith('left LEFT bogus right'))).toEqual(['left', 'right']);
    expect(walkableSides(elWith('nonsense garbage'))).toEqual(['top']);
  });
});

describe('PE-1: surfaces carry the correct outward normal per side', () => {
  const rect = { x: 10, y: 20, w: 100, h: 50 };

  it('top/bottom/left/right normals point outward along the face', () => {
    expect(surfaceForSide(rect, 'top').normal).toEqual({ x: 0, y: -1 });
    expect(surfaceForSide(rect, 'bottom').normal).toEqual({ x: 0, y: 1 });
    expect(surfaceForSide(rect, 'left').normal).toEqual({ x: -1, y: 0 });
    expect(surfaceForSide(rect, 'right').normal).toEqual({ x: 1, y: 0 });
  });

  it('top surface spans the top edge; endpoints are correct', () => {
    const top = surfaceForSide(rect, 'top');
    expect(top.a).toEqual({ x: 10, y: 20 });
    expect(top.b).toEqual({ x: 110, y: 20 });
  });

  it('a rect declaring three sides yields three surfaces with distinct normals', () => {
    const surfaces = surfacesForRect(rect, ['top', 'left', 'right']);
    expect(surfaces).toHaveLength(3);
    expect(surfaces.map((s) => s.side)).toEqual(['top', 'left', 'right']);
  });
});

describe('PE-1: collectSurfaces reads the DOM through a Space (headless)', () => {
  it('emits one surface for a default element and three for a multi-side one', () => {
    const a = elWith(undefined); // defaults to top
    const b = elWith('top left right');
    const space = new FixedSpace({
      rects: new Map([
        [a, { x: 0, y: 100, w: 200, h: 40 }],
        [b, { x: 300, y: 100, w: 150, h: 60 }],
      ]),
    });
    const doc = { querySelectorAll: () => [a, b] };

    const surfaces = collectSurfaces(space, '[data-walk]', doc);
    expect(surfaces).toHaveLength(4); // 1 (a: top) + 3 (b: top/left/right)
    expect(surfaces.filter((s) => s.el === a)).toHaveLength(1);
    expect(surfaces.filter((s) => s.el === b).map((s) => s.side)).toEqual(['top', 'left', 'right']);
  });

  it('skips slivers narrower than 8px', () => {
    const tiny = elWith('top');
    const space = new FixedSpace({ rects: new Map([[tiny, { x: 0, y: 0, w: 4, h: 40 }]]) });
    const doc = { querySelectorAll: () => [tiny] };
    expect(collectSurfaces(space, '[data-walk]', doc)).toHaveLength(0);
  });
});

describe('data-fixture parses into value-neutral Fixture definitions', () => {
  it('parseTransitions turns "a>b c>d" into guard pairs and tolerates junk', () => {
    expect(parseTransitions('neutral>failed failed>fixed')).toEqual([['neutral', 'failed'], ['failed', 'fixed']]);
    expect(parseTransitions('')).toEqual([]);
    expect(parseTransitions(undefined)).toEqual([]);
    expect(parseTransitions('bogus a>b')).toEqual([['a', 'b']]); // drops the malformed token
  });

  it('reads type, id, states, initial state, guards, centre position and overrides', () => {
    const rack = { dataset: { fixture: 'rack', states: 'neutral failed fixed', state: 'failed', transitions: 'failed>fixed', bysterBehavior: 'special' } };
    const bay = { id: 'bay-el', dataset: { fixture: 'bay', states: 'open shut' } }; // no explicit state/id
    const space = new FixedSpace({
      rects: new Map([
        [rack, { x: 100, y: 200, w: 40, h: 20 }],
        [bay, { x: 0, y: 0, w: 30, h: 30 }],
      ]),
    });
    const doc = { querySelectorAll: () => [rack, bay] };
    const fixtures = collectFixtures(space, { doc });

    expect(fixtures[0]).toMatchObject({
      type: 'rack', states: ['neutral', 'failed', 'fixed'], state: 'failed',
      guards: [['failed', 'fixed']], x: 120, y: 210, bysterBehavior: 'special',
    });
    expect(fixtures[0].id).toBe('rack-0'); // generated (no id/data-fixture-id)
    expect(fixtures[1]).toMatchObject({ id: 'bay-el', type: 'bay', state: 'open' }); // falls back to element id + first state
  });
});

describe('worldSignature: rebuilds key off what changed, not which event fired', () => {
  // A tiny page: one walkable box and one fixture, collected through a FixedSpace.
  const makePage = (rectA = { x: 0, y: 100, w: 200, h: 40 }, fxState = 'open') => {
    const walk = { dataset: { walk: 'top left' } };
    const fx = { dataset: { fixture: 'bay', fixtureId: 'bay-1', states: 'open shut', state: fxState } };
    const space = new FixedSpace({
      rects: new Map([
        [walk, rectA],
        [fx, { x: 300, y: 100, w: 30, h: 30 }],
      ]),
    });
    const doc = { querySelectorAll: (sel) => (sel === '[data-fixture]' ? [fx] : [walk]) };
    const world = collectWorld(space, { ground: false, doc });
    const fixtures = collectFixtures(space, { doc });
    return { walk, fx, space, doc, world, fixtures };
  };

  it('an identical re-collection has an identical signature (skip the rebuild)', () => {
    const p = makePage();
    const again = collectWorld(p.space, { ground: false, doc: p.doc });
    expect(worldSignature(again, collectFixtures(p.space, { doc: p.doc }))).toBe(worldSignature(p.world, p.fixtures));
  });

  it('sub-pixel jitter rounds away; a real move changes the signature', () => {
    const p1 = makePage({ x: 0, y: 100, w: 200, h: 40 });
    const doc1 = { querySelectorAll: (sel) => (sel === '[data-fixture]' ? [p1.fx] : [p1.walk]) };
    // same elements, same rounded pixels: same world
    const jitterSpace = new FixedSpace({
      rects: new Map([
        [p1.walk, { x: 0.3, y: 100.2, w: 199.9, h: 40 }],
        [p1.fx, { x: 300.4, y: 99.8, w: 30.1, h: 30 }],
      ]),
    });
    expect(worldSignature(collectWorld(jitterSpace, { ground: false, doc: doc1 }), collectFixtures(jitterSpace, { doc: doc1 }))).toBe(
      worldSignature(p1.world, p1.fixtures),
    );
    // a real move (>= 1px) is a different world
    const moved = new FixedSpace({
      rects: new Map([
        [p1.walk, { x: 0, y: 130, w: 200, h: 40 }],
        [p1.fx, { x: 300, y: 100, w: 30, h: 30 }],
      ]),
    });
    expect(worldSignature(collectWorld(moved, { ground: false, doc: doc1 }), collectFixtures(moved, { doc: doc1 }))).not.toBe(
      worldSignature(p1.world, p1.fixtures),
    );
  });

  it('a fixture STATE flip does not change the signature (state is live data, not layout)', () => {
    const open = makePage(undefined, 'open');
    // flip the state on the SAME elements, re-collect
    open.fx.dataset.state = 'shut';
    const flipped = collectFixtures(open.space, { doc: open.doc });
    expect(worldSignature(open.world, flipped)).toBe(worldSignature(open.world, open.fixtures));
  });

  it('new elements on identical pixels ARE a new world (fixtures hold live els)', () => {
    const a = makePage();
    const b = makePage(); // same geometry, brand-new element objects
    expect(worldSignature(b.world, b.fixtures)).not.toBe(worldSignature(a.world, a.fixtures));
  });

  it('the synthesized ground follows the viewport, so its signature tracks scroll', () => {
    const walk = { dataset: {} };
    const space = new FixedSpace({ rects: new Map([[walk, { x: 0, y: 100, w: 200, h: 40 }]]) });
    const doc = { querySelectorAll: () => [walk] };
    const before = worldSignature(collectWorld(space, { ground: true, doc }), []);
    space.setScroll(0, 250);
    const after = worldSignature(collectWorld(space, { ground: true, doc }), []);
    expect(after).not.toBe(before);
  });
});
