// Space seam tests (TDD Section 5). FixedSpace is the deterministic provider
// the acceptance spec leans on ("given a FixedSpace, the sim is deterministic").
// DocumentSpace reads window and is covered by the integration sandbox, not here.

import { describe, it, expect } from 'vitest';
import { FixedSpace } from './space.js';

describe('FixedSpace: a deterministic, DOM-free coordinate provider', () => {
  it('read() returns the configured snapshot with identity doc<->world mapping', () => {
    const space = new FixedSpace({ scrollX: 5, scrollY: 40, viewportW: 1000, viewportH: 700, dpr: 2 });
    const snap = space.read();
    expect(snap).toMatchObject({ scrollX: 5, scrollY: 40, viewportW: 1000, viewportH: 700, dpr: 2 });
    expect(snap.docToWorld(3, 7)).toEqual({ x: 3, y: 7 });
    expect(snap.worldToDoc(3, 7)).toEqual({ x: 3, y: 7 });
  });

  it('setScroll scripts scrolling; the next snapshot reflects it', () => {
    const space = new FixedSpace();
    expect(space.read().scrollY).toBe(0);
    space.setScroll(0, 250);
    expect(space.read().scrollY).toBe(250);
  });

  it('rectOf resolves registered rects in world coordinates, null otherwise', () => {
    const el = { id: 'a' };
    const space = new FixedSpace({ rects: new Map([[el, { x: 10, y: 20, w: 100, h: 40 }]]) });
    expect(space.read().rectOf(el)).toEqual({ x: 10, y: 20, w: 100, h: 40 });
    expect(space.read().rectOf({ id: 'missing' })).toBeNull();
  });
});
