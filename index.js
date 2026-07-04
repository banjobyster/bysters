// Bysters: bring a web page to life with small procedurally-animated creatures
// that treat the DOM as physical terrain, sense the cursor and each other, and
// operate value-neutral Fixtures on the page. Public entry point.
//
//   import { mount, behaviors } from 'bysters';
//   const stage = await mount({ bysters: [{ name: 'hero', character, behaviors: [
//     behaviors.followCursor(), behaviors.wander(),
//   ] }] });
//
// A byster is a Character (its look + tuning, supplied by the consumer) plus a
// composed list of small behaviors (its mind). The framework is value-neutral:
// it has no notion of good/bad, fix/fail; all meaning lives in consumer config
// and CSS. See FRAMEWORK_TDD.md.

// The runtime.
export { mount } from './dom/mount-dom.js';

// The built-in behavior library, namespaced: behaviors.wander(), .flee(...), etc.
export * as behaviors from './core/behavior/library.js';

// Coordinate/scroll providers (inject a custom one for iframes/headless tests).
export { DocumentSpace, FixedSpace } from './dom/space.js';

// The composition primitives, for advanced use (custom loops, headless sims).
export { Stage } from './core/behavior/stage.js';
export { Byster } from './core/behavior/byster.js';
export { SurfaceMover } from './core/surface-mover.js';
export { buildWorld } from './core/behavior/world.js';

// Path engine + per-byster launch caps. Jump edges carry their `launch` params
// (vx, vy, t, g), so a consumer can draw the exact arc a byster will fly with
// standard projectile math, no internal helper needed.
export { compileSurfaceGraph } from './core/path/compile.js';
export { planRoute, routeCosts, nearestVertex, reachableVertexIds, edgeAllowed, LAUNCH, LAUNCH_AGILE } from './core/path/graph.js';

// Value-neutral Fixtures: opaque multi-state elements + a guarded store.
export { makeFixture, canTransition } from './core/fixtures/fixture.js';
export { createFixtureStore } from './core/fixtures/store.js';
export { registerFixtureType, resolveFixtureBehavior } from './core/fixtures/registry.js';

// DOM collection (marked-up terrain + fixtures -> pure data via a Space).
export { collectWorld, collectFixtures, surfacesForRect, walkableSides, parseTransitions } from './dom/collect.js';
