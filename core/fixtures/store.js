// The Fixture store: the synchronous, observable single source of truth for
// fixture state. Generalized from the site's stationStore (get / set / subscribe,
// no async commit), it adds the two things the value-neutral substrate needs:
//
//   - a GUARDED write (transition), checked against the fixture's state machine,
//     so an illegal move (e.g. re-failing a fixed rack) is simply refused; and
//   - a record of WHO moved WHAT and WHEN (byAgent + a monotonic seq), so a
//     byster and a human funnel through one audited write.
//
// It still never interprets a state string: the only fact it holds is "actor A
// moved fixture F from X to Y at step N". Pure: no DOM, no window.

import { canTransition } from './fixture.js';

export function createFixtureStore(fixtures = []) {
  const byId = new Map();
  const listeners = new Set();
  const log = []; // ordered record of applied transitions: { id, from, to, by, seq }
  let seq = 0;
  for (const fx of fixtures) byId.set(fx.id, fx);

  return {
    register(fx) {
      byId.set(fx.id, fx);
      return fx;
    },
    fixture(id) {
      return byId.get(id) || null;
    },
    all() {
      return [...byId.values()];
    },
    get(id) {
      const fx = byId.get(id);
      return fx ? fx.state : undefined;
    },
    canTransition(id, to) {
      const fx = byId.get(id);
      return fx ? canTransition(fx, to) : false;
    },

    // Guarded write. byAgent is the actor (a byster name, or null for a human /
    // the page UI). Returns true iff the move was allowed and applied. Records
    // who/what/when and notifies subscribers with (fixture, from, to, byAgent).
    transition(id, to, byAgent = null) {
      const fx = byId.get(id);
      if (!fx || !canTransition(fx, to)) return false;
      const from = fx.state;
      fx.state = to;
      log.push({ id, from, to, by: byAgent, seq: seq++ });
      // Snapshot listeners: the cascade seam invites re-entrant consumer code
      // (a subscriber may transition another fixture, which subscribes/unsubs),
      // so iterate a copy to keep notification order stable and complete.
      for (const l of [...listeners]) l(fx, from, to, byAgent);
      return true;
    },

    // Subscribe to every applied transition: cb(fixture, from, to, byAgent).
    // This is the cascade seam - consumer policy (e.g. "a failed stage fails the
    // deploy node") lives in a subscriber, never in the framework (TDD 9.4).
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    log,
  };
}
