// A Byster (agent): a SurfaceMover body + a name + a composed bag of behaviors
// + an arbiter. Each frame it senses the world, arbitrates per channel, and
// applies the winning intents to the mover. The mover owns smoothing/routing;
// the byster only translates intents to commands. Composition, no inheritance:
// a byster HAS behaviors; adding or swapping one edits nothing else.

import { clamp } from '../math.js';
import { Arbiter } from './arbiter.js';
import { createActuator, stepActuate } from '../fixtures/actuate.js';

const REPLAN_THROTTLE = 0.2; // seconds; re-plan a moving-target goto at most this often
const ALPHA_EASE = 3; // opacity glides toward its target (fade to glass, dim to doze) instead of snapping

export class Byster {
  constructor(name, mover, behaviors = []) {
    this.name = name;
    this.mover = mover;
    this.behaviors = [...behaviors].sort((a, b) => b.priority - a.priority);
    this.arbiter = new Arbiter();
    this._goal = null; // vertex id last routed to
    this._replan = 0;
    this._gaze = null;
    this._command = null; // an imperative one-shot goal (e.g. a click), highest priority
    this.actuator = createActuator(); // runs the interact-channel handshake
    this.tags = new Set(); // state this byster broadcasts to the others (see channels.js)
    for (const b of this.behaviors) if (b.init) b.init(this);
  }

  // Read-only view other bysters sense. Includes caps so a fleer can reason about
  // where a pursuer can and cannot follow (route-aware flight), tags so a byster
  // can react to another's broadcast state (e.g. ignore one that is caught), and
  // the current face expression so an expression is senseable like any other
  // observable state (a mimic reads it here, not through a side channel).
  view() {
    const m = this.mover;
    return { name: this.name, x: m.x, bodyY: m.bodyY, surface: m.surface, state: m.state, caps: m.caps, tags: this.tags, face: m.face.expr };
  }

  // A commanded destination outranks behaviors until reached (see the `commanded`
  // library behavior). Clears itself on arrival.
  command(vertexId) {
    this._command = vertexId;
  }

  // The read/write-through-intents view a behavior gets as `self`.
  _self(world) {
    const m = this.mover;
    const vertexId = m.graph ? m._nearestOwnVertex() : null;
    return {
      name: this.name,
      x: m.x,
      bodyY: m.bodyY,
      surface: m.surface,
      state: m.state,
      facing: m.facing,
      caps: m.caps,
      vertexId,
      // reachable set computed ONCE per frame and shared across behaviors (perf)
      reachable: vertexId != null ? world.nav.reachableFrom(vertexId, m.caps) : new Set(),
      command: this._command,
    };
  }

  step(world, dt, store = null) {
    this._replan = Math.max(0, this._replan - dt);
    const self = this._self(world);
    const winners = this.arbiter.resolve(this.behaviors, world, self, dt);
    this.tags = winners.tags; // advertise this frame's tags for the others to sense
    this._apply(winners, dt);
    // The interact channel is executed by the actuate handshake, gated on the
    // byster actually winning that channel this frame, so a losing operate
    // behavior never touches the store.
    stepActuate(this.actuator, winners.interact || null, { store, by: this.name, dt });
    this.mover.update(dt, this._gaze ? { gaze: this._gaze } : {});
  }

  _apply(winners, dt = 0) {
    const loco = winners.locomotion;
    if (loco) {
      if (loco.kind === 'goto') this._applyGoto(loco.vertex);
      else if (loco.kind === 'stop') {
        this._goal = null;
        this.mover.halt(); // stop() truly halts the body, not just clears the goal
      }
    }

    // Live body knobs: whatever behavior won the pace/appearance channel this frame
    // drives them, otherwise they fall back to the byster's resting defaults. This
    // is how speed and look stay behavior-controlled instead of frozen at spawn.
    this.mover.pace = winners.pace ? winners.pace.mul : this.mover.speedScale;
    const ap = winners.appearance;
    const targetAlpha = ap && ap.alpha != null ? ap.alpha : this.mover.baseAlpha;
    // Ease opacity toward its target so a fade (to glass while startled, to a dim
    // doze) glides in and out instead of snapping between values.
    this.mover.alpha += (targetAlpha - this.mover.alpha) * Math.min(1, dt * ALPHA_EASE);
    this.mover.tint = ap && ap.tint != null ? ap.tint : this.mover.baseTint;

    const gaze = winners.gaze;
    if (gaze && gaze.kind === 'look' && gaze.point) {
      const m = this.mover;
      this._gaze = {
        x: clamp((gaze.point.x - m.headX) / 260, -1, 1),
        y: clamp((gaze.point.y - m.headY) / 180, -1, 1),
      };
    } else {
      this._gaze = null;
    }

    const face = winners.face;
    if (face && face.kind === 'express') this.mover.face.set(face.name, face.hold || 0);

    // A commanded goal clears once the mover arrives there and idles.
    if (this._command != null && this.mover.state === 'idle' && this._goal === this._command) {
      this._command = null;
    }
  }

  // Route to a vertex, re-planning only when the target changes (throttled) or on
  // arrival, so a moving-target chase does not thrash the planner every frame.
  _applyGoto(vertex) {
    if (vertex == null) return;
    const changed = vertex !== this._goal;
    const idle = this.mover.state === 'idle';
    if ((changed && this._replan <= 0) || (idle && changed)) {
      this.mover.routeTo(vertex);
      this._goal = vertex;
      this._replan = REPLAN_THROTTLE;
    }
  }
}
