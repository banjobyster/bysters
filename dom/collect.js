// collect: read the marked-up DOM into the geometry the core plans over.
//
// This is a DOM-layer module (it may touch `document`); it hands the pure core
// plain data through an injected Space, never live elements-as-coordinates.
//
// M0 scope: it parses `data-walk` into oriented walkable SURFACES with correct
// outward normals (the orientation-aware representation the path engine grows
// into, proven by acceptance test PE-1), and it produces the document-space
// rects the current top-edge terrain compiler consumes so `mount()` runs today.
// The graph compiler over non-top surfaces (walls/ceilings) lands in M-path;
// the surface model is built orientation-aware from day one so that is not a
// rewrite later.

const SIDES = new Set(['top', 'bottom', 'left', 'right']);

// Parse an element's `data-walk` into the list of walkable sides.
//   data-walk="top left right" -> ['top','left','right']
//   data-walk="top"            -> ['top']
//   data-walk (empty)          -> ['top']   (shorthand)
//   attribute absent           -> ['top']   (default; same as today)
// Unknown tokens are dropped; an all-garbage value falls back to ['top'].
export function walkableSides(el) {
  const raw = el && el.dataset ? el.dataset.walk : undefined;
  if (raw == null) return ['top'];
  const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return ['top'];
  const sides = [];
  for (const t of tokens) if (SIDES.has(t) && !sides.includes(t)) sides.push(t);
  return sides.length ? sides : ['top'];
}

// One oriented walkable line for a side of an axis-aligned rect. The normal is
// the outward face direction: gravity pulls a byster onto the surface along
// -normal, the tangent (unit b - a) is "along", and length is the span. The
// core stays gravity-agnostic by working in this surface-local frame, so the
// same walk code drives a floor, a wall (tangent vertical), or an underside.
//   Surface = { el, side, a:{x,y}, b:{x,y}, normal, tangent, length, meta }
export function surfaceForSide(rect, side, el = null, meta = null) {
  const { x, y, w, h } = rect;
  let a;
  let b;
  let normal;
  switch (side) {
    case 'top':
      a = { x, y };
      b = { x: x + w, y };
      normal = { x: 0, y: -1 };
      break;
    case 'bottom':
      a = { x, y: y + h };
      b = { x: x + w, y: y + h };
      normal = { x: 0, y: 1 };
      break;
    case 'left':
      a = { x, y };
      b = { x, y: y + h };
      normal = { x: -1, y: 0 };
      break;
    case 'right':
      a = { x: x + w, y };
      b = { x: x + w, y: y + h };
      normal = { x: 1, y: 0 };
      break;
    default:
      return null;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const tangent = { x: dx / length, y: dy / length };
  return { el, side, a, b, normal, tangent, length, meta };
}

// All walkable surfaces a rect declares. rect is in world coordinates.
export function surfacesForRect(rect, sides, el = null, meta = null) {
  return sides
    .map((side) => surfaceForSide(rect, side, el, meta))
    .filter(Boolean);
}

// Query the DOM for walkable elements and emit their surfaces (world coords via
// the injected Space). Pure geometry out; the caller compiles a graph from it.
export function collectSurfaces(space, source = '[data-walk]', doc = document) {
  const snap = space.read();
  const out = [];
  for (const el of doc.querySelectorAll(source)) {
    const rect = snap.rectOf(el);
    if (!rect || rect.w < 8) continue;
    for (const s of surfacesForRect(rect, walkableSides(el), el, { tag: el.dataset.walk || 'top' })) {
      out.push(s);
    }
  }
  return out;
}

// The world the general surface graph is compiled from: every declared walkable
// surface (with its outward normal), plus the solid boxes used for occlusion,
// plus the synthesized ground surface at the viewport bottom. World coordinates
// via the injected Space; no window reads. This is what feeds compileSurfaceGraph.
export function collectWorld(space, { source = '[data-walk]', ground = true, doc = document } = {}) {
  const snap = space.read();
  const surfaces = [];
  const solids = [];
  for (const elx of doc.querySelectorAll(source)) {
    const r = snap.rectOf(elx);
    if (!r || r.w < 8) continue;
    solids.push({ x: r.x, y: r.y, w: r.w, h: r.h, el: elx });
    for (const s of surfacesForRect(r, walkableSides(elx), elx, { tag: elx.dataset.walk || 'top' })) {
      surfaces.push(s);
    }
  }
  if (ground) {
    const gy = snap.scrollY + snap.viewportH;
    surfaces.push(
      surfaceForSide({ x: snap.scrollX - 200, y: gy, w: snap.viewportW + 400, h: 0 }, 'top', null, {
        tag: 'ground',
        ground: true,
      }),
    );
  }
  return { surfaces, solids };
}

// Parse a `data-transitions` string into guard pairs.
//   "neutral>failed failed>fixed" -> [['neutral','failed'], ['failed','fixed']]
// Omitted / empty means no guards (any declared state to any other).
export function parseTransitions(raw) {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => pair.split('>').map((s) => s.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1]);
}

// Read `[data-fixture]` elements into value-neutral Fixture definitions (world
// coords via the injected Space). The markup (TDD Section 9.1):
//   <div data-fixture="rack" data-states="neutral failed fixed" data-state="neutral"
//        data-transitions="neutral>failed failed>fixed" data-byster-behavior="...">
// `data-fixture` is the consumer TYPE (a label, not a meaning); the identifier is
// `data-fixture-id`, else the element id, else a generated one. The caller feeds
// these defs to makeFixture + createFixtureStore. Position is the element centre,
// where a byster wires in. This module stays DOM-only: no state machine here.
export function collectFixtures(space, { source = '[data-fixture]', doc = document } = {}) {
  const snap = space.read();
  const out = [];
  let auto = 0;
  for (const el of doc.querySelectorAll(source)) {
    const rect = snap.rectOf(el);
    if (!rect) continue;
    const states = (el.dataset.states || '').trim().split(/\s+/).filter(Boolean);
    if (!states.length) continue; // a fixture needs a declared state set
    const type = el.dataset.fixture || 'fixture';
    out.push({
      id: el.dataset.fixtureId || el.id || `${type}-${auto++}`,
      type,
      states,
      state: el.dataset.state && states.includes(el.dataset.state) ? el.dataset.state : states[0],
      guards: parseTransitions(el.dataset.transitions),
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      w: rect.w,
      h: rect.h,
      el,
      bysterBehavior: el.dataset.bysterBehavior || null,
    });
  }
  return out;
}

