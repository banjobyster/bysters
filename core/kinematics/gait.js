// Step scheduler for the four feet. A foot steps when its planted position
// drifts past a speed-scaled threshold from its rest anchor; diagonal pairs
// alternate; each step is a short parabolic swing.

import { clamp, lerp, easeInOutQuad, randRange } from '../math.js';

const PAIRS = [
  [0, 2], // front-near + back-far
  [1, 3], // front-far + back-near
];

export class Gait {
  constructor(P) {
    this.P = P;
    this.feet = [0, 1, 2, 3].map(() => ({
      x: 0,
      y: 0,
      swing: null, // {fromX, fromY, toX, toY, t, dur, h}
      override: false, // true while a maneuver drives this foot directly
    }));
    this.fidgetTimer = randRange(2, 4);
    this.landed = 0; // swings that planted this frame; the robot reads it for step weight
  }

  reset(bodyX, surfY, facing) {
    for (let i = 0; i < 4; i++) {
      const f = this.feet[i];
      f.x = bodyX + this.P.footRestX[i] * facing + randRange(-3, 3);
      f.y = surfY;
      f.swing = null;
      f.override = false;
    }
  }

  // delay staggers the two feet of a diagonal pair so they never move in
  // robotic lockstep; the swing sits parked until t crosses zero.
  startSwing(i, toX, toY, dur, h, delay = 0) {
    const f = this.feet[i];
    f.swing = { fromX: f.x, fromY: f.y, toX, toY, t: -delay, dur, h };
  }

  // relaxed: feet past the midpoint of their swing no longer block, so at
  // running speed the pairs overlap like a real trot instead of leaving the
  // waiting pair stretched further and further behind the body.
  pairSwinging(pairIx, relaxed = false) {
    return PAIRS[pairIx].some((i) => {
      const s = this.feet[i].swing;
      if (!s) return false;
      return relaxed ? s.t < s.dur * 0.55 : true;
    });
  }

  update(dt, bodyX, vel, surfY, facing, segX1, segX2) {
    const P = this.P;

    this.landed = 0;
    for (const f of this.feet) {
      if (f.override || !f.swing) continue;
      const s = f.swing;
      s.t += dt;
      if (s.t <= 0) continue; // staggered start, parked until its turn
      const u = clamp(s.t / s.dur, 0, 1);
      // Ease the horizontal so the foot decelerates into the plant; skew the
      // arc so it lifts fast and reaches down longer (peak near u = 0.38).
      f.x = lerp(s.fromX, s.toX, easeInOutQuad(u));
      const ua = Math.pow(u, 0.72);
      f.y = lerp(s.fromY, s.toY, u) - s.h * 4 * ua * (1 - ua);
      if (u >= 1) {
        f.x = s.toX;
        f.y = s.toY;
        f.swing = null;
        this.landed++;
      }
    }

    const S = P.scale;
    const speed = Math.abs(vel);
    // Threshold growth and cap kept tight: feet that drift far behind the
    // body stretch the legs thin and read as a splayed, skinny run.
    const threshold = clamp(P.stepThresholdBase + speed * 0.055, 8 * S, 22 * S);
    const swingDur = clamp(0.12 - speed * 0.0003, 0.055, 0.12);
    const swingH = clamp(3 * S + speed * 0.02, 3 * S, 8 * S);
    const stagger = speed > 120 ? 0.02 : 0.04;
    const relaxed = speed > 180;

    for (let p = 0; p < 2; p++) {
      const other = 1 - p;
      if (this.pairSwinging(p) || this.pairSwinging(other, relaxed)) continue;
      const errs = PAIRS[p].map((i) => {
        const anchor = bodyX + P.footRestX[i] * facing;
        return { i, anchor, err: Math.abs(this.feet[i].x - anchor) };
      });
      if (errs.some((e) => e.err > threshold)) {
        let k = 0;
        for (const e of errs) {
          if (e.err > threshold * 0.45) {
            // Hind feet get extra lead so they replant under the body
            // instead of trailing stretched-out behind it.
            const lead = vel * (e.i >= 2 ? 0.17 : 0.12);
            const toX = clamp(e.anchor + lead, segX1 - 2, segX2 + 2);
            this.startSwing(e.i, toX, surfY, swingDur, swingH, k * stagger);
            k++;
          }
        }
        break; // one pair per frame at most
      }
    }

    // Idle fidget: tiny nervous replants while standing still.
    if (speed < 5) {
      this.fidgetTimer -= dt;
      if (this.fidgetTimer <= 0) {
        this.fidgetTimer = randRange(2.5, 5.5);
        const i = (Math.random() * 4) | 0;
        const f = this.feet[i];
        if (!f.swing && !f.override) {
          const anchor = bodyX + P.footRestX[i] * facing;
          const toX = clamp(anchor + randRange(-4, 4), segX1 - 2, segX2 + 2);
          this.startSwing(i, toX, surfY, 0.1, 3 * this.P.scale);
        }
      }
    }
  }

  plantedAvgY(fallbackY) {
    let sum = 0;
    let n = 0;
    for (const f of this.feet) {
      if (!f.swing && !f.override) {
        sum += f.y;
        n++;
      }
    }
    return n ? sum / n : fallbackY;
  }
}
