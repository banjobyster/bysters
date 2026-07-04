// The public runtime: wire the pure core to a live page. mount(config) collects
// terrain + fixtures from the marked-up DOM, compiles the surface graph, spawns
// the declared cast on a Stage, and runs the frame loop through the renderer,
// tracking the cursor and rebuilding on layout change. It is thin orchestration
// over the tested pure core; the only thing it adds is lifecycle + the DOM/Pixi
// edge (this file, with collect/space, is the only place that touches document).
//
// Additive and degradable (TDD Section 10): under prefers-reduced-motion or no
// WebGL nothing is created and the page is untouched - mount() resolves to a
// no-op handle so callers never branch. Interaction visuals (a plug cable, an
// adhesion glow, a debug overlay) are NOT baked in: the consumer draws them in
// the onFrame hook, so how an interaction looks stays the consumer's call.

import { createOverlay } from '../render/pixi/overlay.js';
import { RobotRenderer } from '../render/pixi/robot-renderer.js';
import { DocumentSpace } from './space.js';
import { collectWorld, collectFixtures } from './collect.js';
import { compileSurfaceGraph } from '../core/path/compile.js';
import { LAUNCH, LAUNCH_AGILE, nearestVertex } from '../core/path/graph.js';
import { SurfaceMover } from '../core/surface-mover.js';
import { Byster } from '../core/behavior/byster.js';
import { Stage } from '../core/behavior/stage.js';
import { makeFixture } from '../core/fixtures/fixture.js';
import { createFixtureStore } from '../core/fixtures/store.js';
import { wander } from '../core/behavior/library.js';

const REBUILD_MS = 150;

// Nothing is created if the page opts out of motion or cannot run WebGL.
function shouldDegrade() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) return true;
  } catch {
    return true;
  }
  return false;
}

// The handle shape when degraded: every method is a safe no-op so callers never
// have to check whether bysters actually mounted.
function noopHandle(space) {
  return {
    stage: null,
    store: null,
    graph: null,
    cast: [],
    space: space || null,
    byName: () => null,
    rebuild() {},
    goto() {
      return false;
    },
    on() {
      return () => {};
    },
    step() {},
    unmount() {},
    degraded: true,
  };
}

// mount(config) -> handle. Config (all optional except a byster needs a character):
//   space        injected Space (default DocumentSpace)
//   terrain      selector for walkable elements (default '[data-walk]')
//   fixtures     selector for fixtures, or false to disable (default '[data-fixture]')
//   character    default Character for any byster spec that omits its own
//   ground       synthesize a viewport-bottom ground line (default true; pass false
//                for a tall multi-scene page that supplies its own floors per scene)
//   shadow       draw the ground shadow under every byster (default true)
//   bysters      [{ name, character, caps?, behaviors?, planner?,
//                   spawn? (numeric ground fraction) | spawnAt? (selector/element),
//                   speedScale?, alpha?, tint?, shadow? }]
//   onFrame      (frame) => void, for consumer-drawn extras (cable, glow, overlay)
//   onPointerDown(worldPoint, event, handle) => void
//   debug        expose window.__bysters
export async function mount(config = {}) {
  const space = config.space || (typeof window !== 'undefined' ? new DocumentSpace() : null);
  if (shouldDegrade()) return noopHandle(space);

  const terrainSel = (config.terrain && config.terrain.source) || config.terrain || '[data-walk]';
  const fixturesSel =
    config.fixtures === false ? null : (config.fixtures && config.fixtures.source) || config.fixtures || '[data-fixture]';
  // A viewport-bottom ground line that follows the scroll suits a single-screen
  // overlay; a tall, multi-scene page opts out (`ground: false`) and supplies its
  // own floor per scene, so terrain is scroll-invariant and casts stay put.
  const groundOn = config.ground !== false;
  const specs = config.bysters && config.bysters.length ? config.bysters : [{ name: 'byster', character: config.character }];
  if (specs.some((s) => !s.character)) throw new Error('bysters.mount: every byster needs a `character`.');

  const app = await createOverlay();

  let graph = null;
  let store = null;
  let stage = null;
  let disposed = false;
  let rebuildTimer = 0;
  const listeners = {};
  const emit = (ev, payload) => {
    for (const cb of listeners[ev] || []) cb(payload);
  };

  // One mover + renderer per byster, created once (heavy, stateful). The mind
  // (Byster) and the Stage are cheap and rebuilt on every terrain change.
  const cast = specs.map((spec) => {
    const mover = new SurfaceMover(spec.character, spec.planner ? { planner: spec.planner } : {});
    // Resting defaults for the runtime-modulated body knobs (speed + look). A
    // behavior can override any of these live through the pace/appearance channels;
    // absent a bid the byster falls back to these. Frozen only until a behavior says so.
    if (spec.speedScale != null) mover.speedScale = mover.pace = spec.speedScale; // this byster's resting cruise (its live pace channel overrides it)
    if (spec.alpha != null) mover.baseAlpha = mover.alpha = spec.alpha;
    if (spec.tint != null) mover.baseTint = mover.tint = spec.tint;
    const renderer = new RobotRenderer(app.stage, spec.character, {
      shadow: config.shadow !== false && spec.shadow !== false,
    });
    return { name: spec.name, spec, mover, renderer, byster: null };
  });
  const byName = (name) => cast.find((m) => m.name === name) || null;

  const groundIx = () => graph.surfaces.findIndex((s) => s.meta && s.meta.ground);
  // Spawn on a connected ground vertex nearest `frac` across the walkable range,
  // so placement is robust to viewport width (boxes are fixed px, ground scales).
  const spawnAlong = (gi, frac) => {
    const s = graph.surfaces[gi];
    const gv = graph.vertices
      .filter((v) => v.surface === gi && (graph.adj.get(v.id) || []).length > 0)
      .sort((a, b) => a.x - b.x);
    if (!gv.length) return s.length * frac;
    const targetX = gv[0].x + (gv[gv.length - 1].x - gv[0].x) * frac;
    let best = gv[0];
    for (const v of gv) if (Math.abs(v.x - targetX) < Math.abs(best.x - targetX)) best = v;
    return s.length * best.t;
  };

  const paint = (fx) => {
    if (fx.el) fx.el.dataset.state = fx.state; // mirror store -> data-state for consumer CSS
  };

  const rebuild = () => {
    if (disposed) return;
    const { surfaces, solids } = collectWorld(space, { source: terrainSel, ground: groundOn });
    graph = compileSurfaceGraph(surfaces, solids, LAUNCH_AGILE);
    store = fixturesSel ? createFixtureStore(collectFixtures(space, { source: fixturesSel }).map(makeFixture)) : null;
    if (store) {
      for (const fx of store.all()) paint(fx);
      store.subscribe((fx) => paint(fx));
    }
    stage = new Stage(graph, { store });
    const gi = groundIx();
    cast.forEach((m, i) => {
      const caps = m.spec.caps || LAUNCH;
      // spawnAt seats a byster at a specific element (its scene's floor); the
      // numeric spawn frac is the single-ground legacy path. Either way, a
      // rebuild re-seats it in its own region, never on a shared moving ground.
      if (m.spec.spawnAt != null) {
        const el = typeof m.spec.spawnAt === 'string' ? document.querySelector(m.spec.spawnAt) : m.spec.spawnAt;
        const r = el ? space.read().rectOf(el) : null;
        if (r) m.mover.spawnNear(graph, r.x + r.w / 2, r.y + r.h / 2, caps);
        else {
          // A bad selector would otherwise silently drop the byster at the graph
          // origin (usually another scene); surface it instead of hiding it.
          if (typeof console !== 'undefined') console.warn(`bysters.mount: spawnAt ${JSON.stringify(m.spec.spawnAt)} matched no element for "${m.name}"; placing at graph origin.`);
          if (graph.vertices.length) m.mover.spawnNear(graph, graph.vertices[0].x, graph.vertices[0].y, caps);
        }
      } else if (gi >= 0) {
        const frac = m.spec.spawn != null ? m.spec.spawn : cast.length === 1 ? 0.5 : 0.2 + 0.6 * (i / Math.max(1, cast.length - 1));
        m.mover.spawn(graph, gi, spawnAlong(gi, frac), caps);
      } else if (graph.vertices.length) {
        m.mover.spawnNear(graph, graph.vertices[0].x, graph.vertices[0].y, caps);
      }
      const behaviors = m.spec.behaviors && m.spec.behaviors.length ? m.spec.behaviors : [wander()];
      m.byster = new Byster(m.name, m.mover, behaviors);
      stage.add(m.byster);
    });
    emit('rebuild', { graph, store, stage, cast });
  };

  const queueRebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, REBUILD_MS);
  };

  // Cursor: client coords -> world via the space snapshot.
  let cursor = null;
  const onMove = (e) => {
    const snap = space.read();
    cursor = { x: e.clientX + snap.scrollX, y: e.clientY + snap.scrollY };
  };
  const onDown = (e) => {
    if (!stage || !config.onPointerDown) return;
    const snap = space.read();
    config.onPointerDown({ x: e.clientX + snap.scrollX, y: e.clientY + snap.scrollY }, e, handle);
  };
  const onVisibility = () => {
    if (document.hidden) app.ticker.stop();
    else app.ticker.start();
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', onDown);
  window.addEventListener('resize', queueRebuild);
  // Scroll only moves the synthesized ground; with it off, fixed terrain is
  // scroll-invariant and the per-frame overlay offset already tracks the scroll.
  if (groundOn) window.addEventListener('scroll', queueRebuild, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  const ro = new ResizeObserver(queueRebuild);
  ro.observe(document.body);

  const step = (dt) => {
    if (disposed || !stage) return;
    const snap = space.read();
    app.stage.position.set(-snap.scrollX, -snap.scrollY); // shift the overlay for scrolled pages
    stage.setCursor(cursor);
    stage.step(dt);
    for (const m of cast) m.renderer.draw(m.mover, dt);
    if (config.onFrame) config.onFrame({ app, stage, store, cast, graph, space, dt, cursor });
  };

  rebuild();
  app.ticker.add((t) => step(Math.min(t.deltaMS / 1000, 0.05)));

  const handle = {
    get stage() {
      return stage;
    },
    get store() {
      return store;
    },
    get graph() {
      return graph;
    },
    cast,
    space,
    byName,
    rebuild,
    // Command a named byster to an element's nearest vertex. Takes effect only if
    // that byster composes a commanded() behavior (the click flows through the
    // arbiter like any other intent), so nothing is imperatively forced.
    goto(name, el) {
      const m = byName(name);
      if (!m || !graph) return false;
      const r = space.read().rectOf(el);
      if (!r) return false;
      const v = nearestVertex(graph, r.x + r.w / 2, r.y + r.h / 2);
      if (!v) return false;
      m.byster.command(v.id);
      return true;
    },
    on(ev, cb) {
      (listeners[ev] = listeners[ev] || []).push(cb);
      return () => {
        listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb);
      };
    },
    // Deterministic stepping for occluded tabs (rAF frozen) and demos.
    step(seconds = 1 / 60) {
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) step(1 / 60);
    },
    unmount() {
      if (disposed) return;
      disposed = true;
      clearTimeout(rebuildTimer);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', queueRebuild);
      window.removeEventListener('scroll', queueRebuild);
      document.removeEventListener('visibilitychange', onVisibility);
      app.destroy(true, { children: true, texture: true });
    },
    degraded: false,
  };

  if (config.debug && typeof window !== 'undefined') {
    window.__bysters = { ...handle, graph: () => graph, step: handle.step };
  }
  return handle;
}
