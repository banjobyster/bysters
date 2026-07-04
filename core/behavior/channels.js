// Channels and intents. A behavior does not act; it emits declarative INTENTS
// for independently-arbitrated CHANNELS. The motor (the byster's intent adapter)
// executes them and owns the smoothing. Because gaze, face, and locomotion are
// separate channels, three different behaviors can drive them in the same frame,
// which is what makes a byster read as alive instead of modal (TDD Section 8.2).

export const CHANNELS = ['locomotion', 'gaze', 'face', 'interact', 'pace', 'appearance'];

// Intent constructors (pure data; no behavior).
export const goto = (vertex, opts = {}) => ({ kind: 'goto', vertex, ...opts });
export const stop = () => ({ kind: 'stop' });
export const look = (point) => ({ kind: 'look', point });
export const express = (name, hold = 0) => ({ kind: 'express', name, hold });

// pace channel: a live cruise multiplier the motor honors, so speed is something
// behaviors dial at runtime (bolt when scared, drag when tired) instead of a value
// frozen at spawn. Independent of who drives locomotion: a low-priority "tired"
// behavior can slow the body while another behavior steers it. Absent bid = the
// byster's resting default.
export const pace = (mul) => ({ kind: 'pace', mul });

// appearance channel: continuous body presentation the renderer reads each frame
// (opacity now, tint too), so fading a dozing byster or flushing an agitated one is
// a behavior, not a one-shot set at spawn. Absent bid = the byster's resting look.
export const appear = (opts = {}) => ({ kind: 'appear', ...opts });

// interact channel: a request to operate a fixture toward a target state (the
// byster's actuate executor runs the physical handshake), or to let go.
export const actuate = (fixture, to, opts = {}) => ({ kind: 'actuate', fixture, to, dwell: opts.dwell, color: opts.color });
export const release = () => ({ kind: 'release' });

// tags: additive, non-arbitrated state a byster BROADCASTS to the others, sensed
// through world.bysters (view().tags). Unlike a channel (one winner per frame),
// every bidding behavior's tags are unioned, because advertising two states at
// once (e.g. 'caught' and 'busy') is not a conflict. This is the decentralized
// signaling seam (TDD Section 8.4): a byster tags itself and others react from
// their own behavior code, with no central coordinator. `tag` is deliberately
// absent from CHANNELS: it is advertisement, not an actuator. Emit it alongside
// channel intents, e.g. `{ locomotion: stop(), tags: tag('caught') }`.
export const tag = (...names) => ({ kind: 'tag', names });
