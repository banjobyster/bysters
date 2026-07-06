// Built-in, site-agnostic behaviors. Each is a factory returning a fresh
// stateful object; never share an instance between bysters. They are pure: given
// the world and their own self, they return per-channel intents. All the
// "theater" (who is a hero, what a fault means) stays in consumer config, never
// here (TDD Section 8.5).

import { goto, stop, look, express, actuate, pace, appear, tag } from './channels.js';

// Farthest / nearest reachable vertex helpers (routing targets are graph
// vertices; behaviors pick which one, the mover plans the path).
function pickReachable(self, world, score) {
  let best = null;
  for (const id of self.reachable) {
    const p = world.nav.vertexPoint(id);
    if (!p) continue;
    const s = score(p, id);
    if (best == null || s > best.s) best = { id, s };
  }
  return best ? best.id : null;
}

// Score a spot by how HARD it is for `threat` to get to (its own route cost),
// with anywhere the threat cannot reach ranked safest of all; among equally-safe
// spots, prefer the one nearest `self` so the fleer darts to the closest refuge
// rather than sprinting across the whole level. Falls back to straight-line
// distance if there is no threat vertex to route from.
function safestFrom(world, self, threatPoint, threatCaps) {
  const tv = world.nav.nearestVertex(threatPoint);
  const costs = tv ? world.nav.routeCostsFrom(tv.id, threatCaps) : null;
  const UNREACHABLE = 1e9;
  return (p, id) => {
    if (!costs) return Math.hypot(p.x - threatPoint.x, p.y - threatPoint.y);
    if (!costs.has(id)) return UNREACHABLE - Math.hypot(p.x - self.x, p.y - self.bodyY); // safe: nearest wins
    return costs.get(id); // reachable by the threat: the longer its trek, the better
  };
}

// An imperative command (a click) beats everything until it arrives.
export function commanded({ priority = 100 } = {}) {
  return {
    id: 'commanded',
    priority,
    channels: ['locomotion'],
    update(world, self) {
      return self.command != null ? { locomotion: goto(self.command) } : null;
    },
  };
}

// Amble to a random reachable spot, prefer leaving the current surface, hold the
// target until arrival, then pick a new one.
export function wander({ priority = 10 } = {}) {
  return {
    id: 'wander',
    priority,
    channels: ['locomotion'],
    _target: null,
    update(world, self) {
      const needNew =
        this._target == null || self.state === 'idle' || !self.reachable.has(this._target);
      if (needNew) {
        const far = [...self.reachable].filter((id) => world.nav.vertexSurface(id) !== self.surface);
        const pool = far.length ? far : [...self.reachable];
        if (pool.length) this._target = pool[Math.floor(Math.random() * pool.length)];
      }
      return this._target != null ? { locomotion: goto(this._target) } : null;
    },
  };
}

// Gaze at the cursor whenever it is present.
export function watchCursor({ priority = 30 } = {}) {
  return {
    id: 'watch-cursor',
    priority,
    channels: ['gaze'],
    update(world) {
      return world.cursor ? { gaze: look(world.cursor) } : null;
    },
  };
}

// Gaze at the nearest other byster.
export function watchNearest({ priority = 20 } = {}) {
  return {
    id: 'watch-nearest',
    priority,
    channels: ['gaze'],
    update(world, self) {
      const o = world.bysters.nearest(self);
      return o ? { gaze: look({ x: o.x, y: o.bodyY }) } : null;
    },
  };
}

// Move toward the nearest byster matching `predicate` (within `notice`), watch
// it, and show `face`. This is chase / approach / follow, parameterized.
//
// `standoff` (px) turns the chase into an escort: instead of piling onto the
// target, seek a berth `standoff` px to its SIDE and never pick a vertex inside
// its personal space (within standoff/2 of it), so a follower stands beside its
// target rather than on top of it. Which side is chosen by where the follower
// already is, live while it is far (no crossing risk out there) and frozen once
// it is within 2x standoff, so the follower never cuts through its target to
// reach a berth on the other flank. The personal-space veto falls back to the
// full reachable set if it would empty it: standing too close beats stranding.
export function approach(predicate, { priority = 60, notice = 340, face = 'curious', standoff = 0 } = {}) {
  return {
    id: 'approach',
    priority,
    channels: ['locomotion', 'gaze', 'face'],
    _side: null,
    update(world, self) {
      const target = world.bysters.nearestMatching(self, predicate, notice);
      if (!target) {
        this._side = null;
        return null;
      }
      let aim = { x: target.x, y: target.bodyY };
      let seeker = self;
      if (standoff > 0) {
        const away = Math.hypot(self.x - target.x, self.bodyY - target.bodyY) > standoff * 2;
        if (away || this._side == null) this._side = Math.sign(self.x - target.x) || 1;
        aim = { x: target.x + this._side * standoff, y: target.bodyY };
        const keep = new Set();
        for (const id of self.reachable) {
          const p = world.nav.vertexPoint(id);
          if (!p || Math.hypot(p.x - target.x, p.y - target.bodyY) > standoff / 2) keep.add(id);
        }
        if (keep.size) seeker = { ...self, reachable: keep };
      } else {
        this._side = null;
      }
      const goal = pickReachable(seeker, world, (p) => -Math.hypot(p.x - aim.x, p.y - aim.y));
      if (goal == null) return null;
      return { locomotion: goto(goal), gaze: look({ x: target.x, y: target.bodyY }), face: express(face, 0.5) };
    },
  };
}

// Bolt to the reachable spot farthest from the nearest byster matching
// `predicate` (within `radius`), with a `face`. This is flee / avoid.
export function flee(predicate, { priority = 90, radius = 220, face = 'glitch' } = {}) {
  return {
    id: 'flee',
    priority,
    channels: ['locomotion', 'face'],
    update(world, self) {
      const threat = world.bysters.nearestMatching(self, predicate, radius);
      if (!threat) return null;
      // Route-aware: escape to where the threat would toil hardest to follow (up a
      // wall it cannot climb, not just the far end of the floor).
      const goal = pickReachable(self, world, safestFrom(world, self, { x: threat.x, y: threat.bodyY }, threat.caps || self.caps));
      if (goal == null) return null;
      return { locomotion: goto(goal), face: express(face, 0.3) };
    },
  };
}

// Get caught: when a byster matching `predicate` closes within `radius`, freeze
// where you are for `stunFor` seconds and broadcast `tag` so the catcher can sense
// the catch and disengage instead of pinning you forever (decentralized, no
// coordinator: see channels.js). A short `immuneFor` grace after recovering stops
// an instant re-catch, so the freed byster gets a beat to bolt. High priority by
// default, so being caught overrides fleeing. Value-neutral: "caught" is only a
// tag string; who catches whom, and what it means, is the consumer's config. The
// pursuer opts out of pinning a caught byster by excluding the tag from its own
// approach predicate, e.g. `approach(v => v.name === 'x' && !v.tags.has('caught'))`.
// Priority defaults high (above flee's 90 + the arbiter's incumbent bump of 6), so
// being caught cleanly overrides an in-progress flee on every channel, face
// included: a stun is a hard interrupt, not a boundary flip-flop.
export function caughtBy(
  predicate,
  { radius = 46, stunFor = 2.4, immuneFor = 1.2, priority = 97, face = 'stunned', tag: label = 'caught' } = {},
) {
  const frozen = () => ({ locomotion: stop(), face: express(face, 0), tags: tag(label) });
  return {
    id: 'caught-by',
    priority,
    channels: ['locomotion', 'face'],
    _stun: 0, // seconds of freeze left
    _immune: 0, // seconds of post-recovery grace left
    update(world, self) {
      const dt = world.dt || 0;
      if (this._stun > 0) {
        this._stun -= dt;
        if (this._stun <= 0) this._immune = immuneFor;
        return frozen();
      }
      if (this._immune > 0) {
        this._immune -= dt;
        return null; // recovered: free to move, and briefly un-catchable
      }
      if (!world.bysters.nearestMatching(self, predicate, radius)) return null;
      this._stun = stunFor;
      return frozen();
    },
  };
}

// React to another byster's advertised state WITHOUT commandeering movement: while
// a byster matching `predicate` is broadcasting `tag` within `radius`, colour how
// this one behaves (an optional `face`, `pace` multiplier, and glance at the target)
// while some OTHER behavior still decides where it goes. This is the "modulate, do
// not steer" reaction, the mirror of caughtBy from the catcher's side: e.g. saunter
// slowly and pleased near a quarry you just caught, letting wander carry you around
// so nobody jams up standing still. Bids only the channels you enable, so it layers
// cleanly. Value-neutral: `tag` is an opaque string; the reaction is consumer config.
export function reactTo(predicate, { tag: label = null, radius = 140, priority = 55, face = null, pace: paceMul = null, gaze = false } = {}) {
  const channels = [];
  if (face) channels.push('face');
  if (paceMul != null) channels.push('pace');
  if (gaze) channels.push('gaze');
  return {
    id: 'react-to',
    priority,
    channels,
    update(world, self) {
      const target = world.bysters.nearestMatching(
        self,
        (v) => predicate(v) && (label == null || (v.tags && v.tags.has(label))),
        radius,
      );
      if (!target) return null;
      const bid = {};
      if (face) bid.face = express(face, 0);
      if (paceMul != null) bid.pace = pace(paceMul);
      if (gaze) bid.gaze = look({ x: target.x, y: target.bodyY });
      return channels.length ? bid : null;
    },
  };
}

// Value-neutral fixture operator (TDD Section 9.3): route to the nearest
// reachable fixture where `match(fx)` and it can legally move to `drive`, then
// actuate it toward `drive`. This ONE behavior is the whole rivalry: run it with
// `{ match: fx => fx.state !== 'failed', drive: 'failed' }` and it reads as a
// saboteur; run it mirrored (`match: fx => fx.state === 'failed', drive: 'fixed'`)
// and it reads as a repairer. Nothing here knows which is "good". It bids
// locomotion to approach and, once arrived, the interact intent; the byster's
// actuate executor runs plug -> dwell -> guarded commit -> release.
export function operateFixtures({ match = () => true, drive, dwell = 0.6, priority = 50, face = 'sync' } = {}) {
  return {
    id: 'operate-fixtures',
    priority,
    channels: ['locomotion', 'interact', 'face'],
    update(world, self) {
      if (!world.fixtures || drive == null) return null;
      const cands = world.fixtures.all().filter((fx) => match(fx) && world.fixtures.canTransition(fx, drive));
      let best = null;
      for (const fx of cands) {
        const goal = pickReachable(self, world, (p) => -Math.hypot(p.x - fx.x, p.y - fx.y));
        if (goal == null) continue;
        const p = world.nav.vertexPoint(goal);
        const d = Math.hypot(p.x - fx.x, p.y - fx.y);
        if (!best || d < best.d) best = { fx, goal, d };
      }
      if (!best) return null;
      // Arrived only when idle AT the goal vertex. Using the vertex identity (not
      // an x-proximity fallback) keeps this surface-correct: a byster idling on a
      // platform that merely shares the fixture's x is on a different vertex, so
      // it does not actuate from the wrong surface.
      const arrived = self.state === 'idle' && self.vertexId === best.goal;
      if (!arrived) return { locomotion: goto(best.goal) };
      return { locomotion: goto(best.goal), interact: actuate(best.fx, drive, { dwell }), face: express(face, 0.5) };
    },
  };
}

// Approach the cursor and hang around it. Locomotion toward the reachable spot
// nearest the cursor; yields once within `near` so it does not jitter on top of
// it. followCursor / approach are the same idea (seek a moving target); this one
// seeks the pointer instead of another byster.
export function followCursor({ priority = 40, near = 90, face = null } = {}) {
  return {
    id: 'follow-cursor',
    priority,
    channels: face ? ['locomotion', 'face'] : ['locomotion'],
    update(world, self) {
      const c = world.cursor;
      if (!c) return null;
      if (Math.hypot(c.x - self.x, c.y - self.bodyY) < near) return null; // close enough
      const goal = pickReachable(self, world, (p) => -Math.hypot(p.x - c.x, p.y - c.y));
      if (goal == null) return null;
      return face ? { locomotion: goto(goal), face: express(face, 0.4) } : { locomotion: goto(goal) };
    },
  };
}

// The mirror of followCursor: when the pointer comes within `radius`, bolt to the
// reachable spot FARTHEST from it. This is "scared of the cursor" (hover near a
// shy byster and it flees), the pointer analogue of flee(predicate).
// `alpha`, if set, fades the byster toward that opacity through the appearance
// channel while it is bolting, so being startled reads as it turning glassy /
// spectral for as long as the threat is near (the mover eases opacity, so the fade
// glides in and out rather than snapping).
export function fleeCursor({ priority = 85, radius = 170, face = 'glitch', speed = 1, alpha = null } = {}) {
  const channels = alpha != null ? ['locomotion', 'face', 'pace', 'appearance'] : ['locomotion', 'face', 'pace'];
  return {
    id: 'flee-cursor',
    priority,
    channels,
    update(world, self) {
      const c = world.cursor;
      if (!c) return null;
      if (Math.hypot(c.x - self.x, c.y - self.bodyY) > radius) return null; // pointer not close, ignore
      // Route-aware away from the pointer's spot, so it flees along the terrain
      // (out of the box, up and over) rather than straight-line into a corner.
      const goal = pickReachable(self, world, safestFrom(world, self, { x: c.x, y: c.y }, self.caps));
      if (goal == null) return null;
      const bid = { locomotion: goto(goal), face: express(face, 0.3), pace: pace(speed) }; // bolt, not amble
      if (alpha != null) bid.appearance = appear({ alpha }); // turn glassy while startled
      return bid;
    },
  };
}

// Ambient pace variation: a low-priority, always-on wobble so a byster's cruising
// never looks robotic. Pace eases toward fresh random targets within `vary` of
// `base`, re-rolled on a per-instance rhythm (`every`), so each byster carries its
// own energy: give one a big `vary` + short `every` for a twitchy, darting feel, a
// small `vary` + long `every` for a steady plod. Any deliberate pace (flee, fatigue)
// simply outranks it. `base` is usually the byster's cruise (e.g. a scene derate).
export function liveliness({ base = 1, vary = 0.2, every = 2.5, ease = 2, priority = 8 } = {}) {
  return {
    id: 'liveliness',
    priority,
    channels: ['pace'],
    _t: 0,
    _next: every * Math.random(), // stagger the first change so bots desync
    _cur: base,
    _target: base,
    update(world) {
      const dt = world.dt || 0;
      this._t += dt;
      if (this._t >= this._next) {
        this._t = 0;
        this._next = every * (0.5 + Math.random());
        this._target = Math.max(0.15, base + (Math.random() * 2 - 1) * vary);
      }
      this._cur += (this._target - this._cur) * Math.min(1, dt * ease); // ease, never jump
      return { pace: pace(this._cur) };
    },
  };
}

// Look AWAY from the cursor: gaze at the mirror point on the far side of the
// head, so the byster reads as avoiding eye contact. Only bids gaze.
export function avoidCursorGaze({ priority = 22 } = {}) {
  return {
    id: 'avoid-cursor-gaze',
    priority,
    channels: ['gaze'],
    update(world, self) {
      const c = world.cursor;
      if (!c) return null;
      return { gaze: look({ x: self.x - (c.x - self.x), y: self.bodyY - (c.y - self.bodyY) }) };
    },
  };
}

// A baseline mood: bid one face every frame at low priority, so it shows
// whenever no stronger behavior is expressing something. This is how "angry most
// of the time" or "happy by default" is stated, without touching anyone else.
export function mood(expr, { priority = 5 } = {}) {
  return {
    id: `mood-${expr}`,
    priority,
    channels: ['face'],
    update() {
      return { face: express(expr, 0) };
    },
  };
}

// Every `every` seconds, flash a face from `exprs` for `hold` seconds: the
// occasional sing / cute-animation flourish. Time comes from world.dt so it
// stays a pure function of the world.
export function flourish(exprs, { every = 4, hold = 1.2, priority = 25 } = {}) {
  const list = Array.isArray(exprs) ? exprs : [exprs];
  return {
    id: 'flourish',
    priority,
    channels: ['face'],
    _t: 0,
    _showing: 0,
    _expr: null,
    update(world) {
      const dt = world.dt || 0;
      if (this._showing > 0) {
        this._showing -= dt;
        return { face: express(this._expr, 0) };
      }
      this._t += dt;
      if (this._t >= every) {
        this._t = 0;
        this._showing = hold;
        this._expr = list[Math.floor(Math.random() * list.length)];
        return { face: express(this._expr, 0) };
      }
      return null;
    },
  };
}

// A doze duty cycle: awake for `awakeFor` (yielding, so other behaviors drive),
// then stop where it is and show `face` for `sleepFor`, at high priority so the
// nap actually overrides roaming/mischief. Repeats.
export function sleep({ awakeFor = 6, sleepFor = 3, priority = 70, face = 'sleepy', dim = null } = {}) {
  // While asleep, hold still and show `face`; if `dim` is set, also fade to that
  // opacity through the appearance channel, so dozing off actually dims the byster.
  const dozing = () =>
    dim != null
      ? { locomotion: stop(), face: express(face, 0), appearance: appear({ alpha: dim }) }
      : { locomotion: stop(), face: express(face, 0) };
  return {
    id: 'sleep',
    priority,
    channels: dim != null ? ['locomotion', 'face', 'appearance'] : ['locomotion', 'face'],
    _t: 0,
    _sleeping: false,
    update(world) {
      const dt = world.dt || 0;
      this._t += dt;
      if (this._sleeping) {
        if (this._t >= sleepFor) {
          this._sleeping = false;
          this._t = 0;
          return null;
        }
        return dozing();
      }
      if (this._t >= awakeFor) {
        this._sleeping = true;
        this._t = 0;
        return dozing();
      }
      return null; // awake: let the rest of the mind drive
    },
  };
}

// Higher-order: wrap a behavior so it tires out. While the inner behavior drives
// locomotion, energy drains; when it runs out, stop and show `face` for
// `restFor`, then refill and carry on. Turns any pursuer into one that must
// catch its breath, with no change to the pursuer itself.
// `tag`, if set, is broadcast while resting, so other bysters can sense that this
// one is spent (e.g. a quarry that stops fleeing a winded pursuer, or resumes its
// mischief). This is the same decentralized-signaling seam caughtBy uses.
export function fatigue(inner, { runFor = 4, restFor = 2.5, face = 'sleepy', minPace = 0.5, tag: label = null } = {}) {
  const winded = () =>
    label ? { locomotion: stop(), face: express(face, 0), tags: tag(label) } : { locomotion: stop(), face: express(face, 0) };
  return {
    id: `fatigue(${inner.id})`,
    priority: inner.priority,
    channels: [...new Set([...(inner.channels || []), 'locomotion', 'face', 'pace'])],
    _energy: runFor,
    _resting: false,
    _restT: 0,
    init(byster) {
      if (inner.init) inner.init(byster);
    },
    update(world, self) {
      const dt = world.dt || 0;
      if (this._resting) {
        this._restT -= dt;
        if (this._restT <= 0) {
          this._resting = false;
          this._energy = runFor;
          return null;
        }
        return winded();
      }
      const bid = inner.update ? inner.update(world, self) : null;
      if (bid && bid.locomotion) {
        this._energy -= dt;
        if (this._energy <= 0) {
          this._resting = true;
          this._restT = restFor;
          return winded();
        }
        // Wind down as energy drains: full pace when fresh, minPace when spent, so
        // the pursuer visibly labours before it has to stop and catch its breath.
        const t = Math.max(0, Math.min(1, this._energy / runFor));
        return { ...bid, pace: pace(minPace + (1 - minPace) * t) };
      }
      return bid;
    },
  };
}

// Higher-order: gate a behavior on a coin flip. Every `window` seconds it re-rolls
// whether the inner behavior is active this window (probability `p`). Turns
// "always sabotage" into "sometimes", or grafts a rare accidental action onto an
// otherwise oblivious byster, without editing the inner behavior.
export function sometimes(inner, p = 0.3, { window = 2 } = {}) {
  return {
    id: `sometimes(${inner.id})`,
    priority: inner.priority,
    channels: inner.channels,
    _t: window,
    _active: false,
    init(byster) {
      if (inner.init) inner.init(byster);
    },
    update(world, self) {
      this._t += world.dt || 0;
      if (this._t >= window) {
        this._t = 0;
        this._active = Math.random() < p;
      }
      return this._active && inner.update ? inner.update(world, self) : null;
    },
  };
}

// Higher-order: fuse several behaviors into ONE, so a single gate (a
// sometimes(), a fatigue(), a custom condition) governs them as a unit and
// their bids merge instead of competing in the arbiter. Each frame every inner
// behavior is updated in order and the bids are shallow-merged, LATER WINS per
// channel: group(trek, copy) walks like trek but wears copy's face wherever
// copy has an opinion. Silence is preserved: if no inner bids, the group bids
// null. The group's priority is the highest of its members (override with
// opts.priority); its channels are the union. This replaces the hand-rolled
// `{ ...a.update(), ...b.update() }` merge every composite otherwise reinvents.
export function group(...args) {
  const last = args[args.length - 1];
  const opts = last && typeof last.update !== 'function' ? args.pop() : {};
  const inner = args;
  return {
    id: `group(${inner.map((b) => b.id).join('+')})`,
    priority: opts.priority != null ? opts.priority : Math.max(...inner.map((b) => b.priority)),
    channels: [...new Set(inner.flatMap((b) => b.channels || []))],
    init(byster) {
      for (const b of inner) if (b.init) b.init(byster);
    },
    update(world, self) {
      let bid = null;
      for (const b of inner) {
        const r = b.update ? b.update(world, self) : null;
        if (r) bid = { ...(bid || {}), ...r };
      }
      return bid;
    },
  };
}

// Every `every` seconds, climb to a high, hard-to-reach spot and settle there
// for `dwell` seconds, then come back down. This is what makes a byster actually
// USE the vertical terrain (walk up a wall, leap to a ledge) and gives it a
// readable idle beat perched up high, instead of only ever grinding the ground.
// `pick(point, self)` scores candidate perches (default: the highest, smallest
// y). Priority is deliberately mid so an urgent behavior (flee, chase) preempts
// the outing, but it outranks plain wandering so the climb reliably happens.
export function perch({ every = 12, dwell = 5, priority = 35, face = 'idle', pick = null } = {}) {
  const score = pick || ((p) => -p.y);
  return {
    id: 'perch',
    priority,
    channels: ['locomotion', 'face'],
    _t: 0,
    _phase: 'wait', // wait -> climb -> rest
    _target: null,
    update(world, self) {
      this._t += world.dt || 0;
      if (this._phase === 'wait') {
        if (this._t < every) return null;
        let best = null;
        for (const id of self.reachable) {
          const p = world.nav.vertexPoint(id);
          if (!p) continue;
          const s = score(p, self);
          if (best == null || s > best.s) best = { id, s };
        }
        if (best == null) {
          this._t = 0;
          return null;
        }
        this._target = best.id;
        this._phase = 'climb';
        this._t = 0;
        return { locomotion: goto(this._target) };
      }
      if (this._phase === 'climb') {
        if (!self.reachable.has(this._target)) {
          this._phase = 'wait'; // the perch fell out of reach (rebuild); try again later
          this._t = 0;
          return null;
        }
        if (self.state === 'idle' && self.vertexId === this._target) {
          this._phase = 'rest';
          this._t = 0;
        }
        return { locomotion: goto(this._target), face: express(face, 0) };
      }
      // rest: settled on the perch
      if (this._t >= dwell) {
        this._phase = 'wait';
        this._t = 0;
        this._target = null;
        return null;
      }
      return { locomotion: stop(), face: express(face, 0) };
    },
  };
}
