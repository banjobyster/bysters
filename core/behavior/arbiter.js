// Per-channel arbitration (TDD Section 8.2). Every behavior's update() runs each
// frame (so lower-priority ones keep their own state), highest priority first.
// For EACH channel independently, the highest-priority behavior that bid for it
// wins that channel. So flee can own locomotion while curiosity owns gaze and
// reactions owns face, in the same frame.
//
// Hysteresis: the current owner of a channel gets a small priority bump and a
// minimum hold time, so ownership never flip-flops at a boundary. This is the
// "no abrupt changes, consider what it was already doing" guarantee, expressed
// once at the arbitration layer instead of scattered through behaviors.

import { CHANNELS } from './channels.js';

const OWNER_BUMP = 6; // the incumbent's edge, so a 1px threshold cross does not steal
const MIN_HOLD = 0.35; // seconds an owner keeps a channel before it can be lost

export class Arbiter {
  constructor() {
    this.owner = {}; // channel -> behavior id
    this.hold = {}; // channel -> seconds of protected ownership left
  }

  // behaviors: sorted by priority desc. Returns { channel -> intent } for the winners.
  resolve(behaviors, world, self, dt) {
    // Gather bids: channel -> [{ priority, id, intent }]
    const bids = {};
    for (const b of behaviors) {
      const bid = b.update ? b.update(world, self) : null;
      if (!bid) continue;
      for (const ch in bid) {
        if (!bid[ch]) continue;
        (bids[ch] || (bids[ch] = [])).push({ priority: b.priority, id: b.id, intent: bid[ch] });
      }
    }

    const winners = {};
    for (const ch of CHANNELS) {
      this.hold[ch] = Math.max(0, (this.hold[ch] || 0) - dt);
      const list = bids[ch];
      if (!list || !list.length) {
        this.owner[ch] = null;
        continue;
      }
      const incumbent = this.owner[ch];
      // effective priority: the incumbent (if still bidding) gets the bump
      let winner = null;
      let winnerEff = -Infinity;
      for (const cand of list) {
        const eff = cand.priority + (cand.id === incumbent ? OWNER_BUMP : 0);
        if (eff > winnerEff) {
          winnerEff = eff;
          winner = cand;
        }
      }
      // min-hold: an incumbent still bidding cannot be displaced until its hold expires
      const incumbentBid = incumbent ? list.find((c) => c.id === incumbent) : null;
      if (incumbentBid && this.hold[ch] > 0 && winner.id !== incumbent) {
        winner = incumbentBid;
      }
      if (winner.id !== incumbent) {
        this.owner[ch] = winner.id;
        this.hold[ch] = MIN_HOLD;
      }
      winners[ch] = winner.intent;
    }

    // Tags are advertised, not arbitrated (see channels.js): union every bidder's
    // tags, whether or not it won a channel, so a byster can broadcast state the
    // others sense. Gathered in the same bid pass, so no behavior is stepped twice.
    const tags = new Set();
    for (const t of bids.tags || []) for (const n of t.intent.names) tags.add(n);
    winners.tags = tags;

    return winners;
  }
}
