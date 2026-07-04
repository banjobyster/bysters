// A Fixture: a DOM element (or, in a headless test, a plain rect) with a finite
// set of OPAQUE string states that both humans and bysters transition. The
// framework enforces the state machine (guards) and records who moved what, but
// it never interprets what a state MEANS. All meaning ("failed" is bad, red =
// danger, this rack drives the deploy) lives in the consumer's CSS and behavior
// config. This is the value-neutral substrate (TDD Section 9): the same
// primitive is a broken/fixed rack, a locked/open door, or a picked-up item.

// Build a Fixture. `states` is the finite set of opaque strings; `state` the
// current one (defaults to the first). `guards` are the allowed [from, to]
// moves; omitted means any declared state to any other. x/y (+ w/h) are the
// world position a byster routes to; `el` is the DOM node (null in tests).
export function makeFixture({ id, type = 'fixture', states, state = null, guards = [], x = 0, y = 0, w = 0, h = 0, el = null, bysterBehavior = null }) {
  if (id == null) throw new Error('a fixture needs an id');
  if (!states || !states.length) throw new Error(`fixture "${id}" needs at least one state`);
  const init = state ?? states[0];
  if (!states.includes(init)) throw new Error(`fixture "${id}" initial state "${init}" is not one of its states`);
  return {
    id,
    type,
    states: [...states],
    state: init,
    guards: guards.map(([from, to]) => [from, to]),
    x,
    y,
    w,
    h,
    el,
    bysterBehavior, // per-element behavior override (data-byster-behavior); null = use type default
  };
}

// May this fixture move to `to` right now? The move must target a declared
// state, actually change the current one, and (when guards are declared) be a
// listed [from, to] pair. No guards means any declared state to any other. Pure
// structure: the framework never looks at what the strings mean.
export function canTransition(fx, to) {
  if (!fx.states.includes(to)) return false;
  if (to === fx.state) return false;
  if (!fx.guards.length) return true;
  return fx.guards.some(([from, t]) => from === fx.state && t === to);
}
