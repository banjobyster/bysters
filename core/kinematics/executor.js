// Executes a planned route step by step. Intelligence lives in the planner;
// this layer adds the authored clumsiness, scaled by the noise level.

import { makeHop, makeDrop, makeClimb } from './maneuvers.js';

export class Executor {
  constructor(robot) {
    this.R = robot;
    this.steps = null;
    this.ix = 0;
    this.maneuver = null;
    this.noiseScale = 1;
    this.onDone = null;
  }

  get active() {
    return !!this.steps || !!this.maneuver;
  }

  setRoute(steps, { noiseScale = 1, onDone = null } = {}) {
    this.ix = 0;
    this.maneuver = null;
    this.noiseScale = noiseScale;
    if (steps && steps.length) {
      this.steps = steps;
      this.onDone = onDone;
    } else {
      this.steps = null;
      this.onDone = null;
      if (onDone) onDone();
    }
  }

  cancel() {
    this.steps = null;
    this.maneuver = null;
    this.onDone = null;
    this.R.moveTarget = null;
    this.R.headWiggle = 0;
  }

  update(dt) {
    const R = this.R;
    if (this.maneuver) {
      if (this.maneuver.update(dt)) {
        this.maneuver = null;
        this.advance();
      }
      return;
    }
    if (!this.steps) return;
    const step = this.steps[this.ix];
    if (!step) {
      this.finish();
      return;
    }

    if (step.type === 'walk') {
      if (!step._issued) {
        R.walkTo(step.toX);
        step._issued = true;
      } else if (R.arrived) {
        this.advance();
      }
      return;
    }

    // Transition step: make sure we are standing at the takeoff point first.
    if (Math.abs(R.x - step.from.x) > 3) {
      if (!step._approach) {
        R.walkTo(step.from.x);
        step._approach = true;
      }
      if (!R.arrived) return;
    }

    // Stumble outcomes (missed hop, tumble) are disabled for now; every
    // transition executes clean until the authored recoveries earn their keep.
    if (step.type === 'hop') {
      this.maneuver = makeHop(R, step.from, step.to, {});
    } else if (step.type === 'climb') {
      this.maneuver = makeClimb(R, step.from, step.to);
    } else {
      this.maneuver = makeDrop(R, step.from, step.to, {});
    }
    R.mode = 'maneuver';
  }

  advance() {
    this.ix++;
    if (!this.steps || this.ix >= this.steps.length) this.finish();
  }

  finish() {
    this.steps = null;
    this.maneuver = null;
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
  }
}
