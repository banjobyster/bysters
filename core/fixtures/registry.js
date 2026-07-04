// Fixture type registry: how a site says "bysters know what to do with this KIND
// of thing" without wiring every element by hand (TDD Section 9.5). A type may
// register a default agent-behavior id; a single element overrides it with
// data-byster-behavior (mirrored on the fixture as `bysterBehavior`). Adding a
// new type is register-a-default; existing bysters pick it up with zero edits.
//
// The registry only maps identifiers; it holds no meaning and no behavior code.

const defaults = new Map(); // type -> default behavior id

export function registerFixtureType(type, behaviorId) {
  defaults.set(type, behaviorId);
}

// Resolve which behavior id should react to a fixture: a per-element override
// (data-byster-behavior / fx.bysterBehavior) wins, else the type default, else
// null (no default reaction registered for this type).
export function resolveFixtureBehavior(fx) {
  const override = (fx.el && fx.el.dataset ? fx.el.dataset.bysterBehavior : null) ?? fx.bysterBehavior ?? null;
  return override || defaults.get(fx.type) || null;
}

// Test/reset hook: forget all registered type defaults.
export function clearFixtureTypes() {
  defaults.clear();
}
