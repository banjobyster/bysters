// The actuate executor: the interact-channel motor. A behavior only DECIDES to
// operate a fixture - it bids `interact: actuate(fixture, to)` once it has
// arrived - and this runs the physical handshake, the same way the surface
// mover runs a `goto`: wire in (plug), dwell (a work beat), commit the guarded
// state change, release. Keeping the side effect (the store write) HERE, gated
// on the byster actually winning the interact channel this frame, is what lets
// behaviors stay pure: a losing operateFixtures never touches the store.
//
// One invariant runs the whole machine: the executor is either idle, or plugged
// into exactly one (fixture, target) pair and dwelling toward it. A commit
// returns it to idle, so the very next bid - even for the same fixture that just
// became actionable again - is a fresh contact, never a wedge. Pure logic; no
// DOM, no Pixi. It returns the fx intent to surface (plug on wire-in, release on
// unplug) and calls store.transition at the moment of commit.

const DEFAULT_DWELL = 0.6;

export function createActuator() {
  return { phase: 'idle', t: 0, fixtureId: null, to: null, plugged: false };
}

function reset(act) {
  act.phase = 'idle';
  act.t = 0;
  act.fixtureId = null;
  act.to = null;
  act.plugged = false;
}

// Advance one frame. `intent` is the interact intent that WON this frame (or
// null/non-actuate). `store` is the fixture store (the executor's only writer);
// `by` is the acting byster's name (recorded on the transition). Returns an fx
// intent to surface this frame, or null.
export function stepActuate(act, intent, { store = null, by = null, dt = 0 } = {}) {
  // Nothing to operate this frame: unplug (if we were) and return to idle.
  if (!intent || intent.kind !== 'actuate') {
    const releasing = act.plugged;
    reset(act);
    return releasing ? { kind: 'release' } : null;
  }

  const fx = intent.fixture;
  const to = intent.to;

  // Fresh contact whenever we are not already dwelling for exactly this
  // (fixture, target). This single condition collapses three cases into one:
  // a brand-new target, a re-target of the same fixture (re-plug for the new
  // goal), and re-arming after a previous commit. So the commit below is always
  // pinned to the target we actually wired in for.
  if (act.phase !== 'dwell' || act.fixtureId !== fx.id || act.to !== to) {
    act.phase = 'dwell';
    act.t = intent.dwell ?? DEFAULT_DWELL;
    act.fixtureId = fx.id;
    act.to = to;
    act.plugged = true;
    return { kind: 'plug', target: fx, color: intent.color ?? null };
  }

  // Dwelling toward the wired-in target; commit the work beat when it elapses.
  act.t -= dt;
  if (act.t <= 0) {
    if (store) store.transition(act.fixtureId, act.to, by); // commit exactly what we plugged in for
    reset(act); // back to idle: a re-bid is a fresh contact, so nothing wedges
    return { kind: 'release' };
  }
  return null; // holding the cable while the work beat runs
}
