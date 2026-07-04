// Authored maneuvers. The planner guarantees a valid route; these carry all
// the charm. Stumbles are always scripted recovery moves that end back on
// the planned route, never emergent physics failures.

import {
  clamp,
  lerp,
  qbez,
  qbezControlForPeak,
  easeOutCubic,
  easeInOutQuad,
  easeOutBack,
  randRange,
  rot2d,
} from '../math.js';

const TUCK = [
  { x: 9, y: 5 },
  { x: 5, y: 6 },
  { x: -5, y: 6 },
  { x: -9, y: 5 },
];

function setFoot(R, i, x, y) {
  const f = R.gait.feet[i];
  f.override = true;
  f.swing = null;
  f.x = x;
  f.y = y;
}

function tuck(R, rot, spread = 0) {
  const S = R.P.scale;
  for (let i = 0; i < 4; i++) {
    const o = rot2d(TUCK[i].x * R.facing * (1 + spread) * S, (TUCK[i].y + spread * 6) * S, rot);
    setFoot(R, i, R.x + o.x, R.bodyY + o.y);
  }
}

function reachForLanding(R, u0, u, landX, surfY, seg, dir) {
  const S = R.P.scale;
  const grip = clamp((u - u0) / (1 - u0), 0, 1);
  for (let i = 0; i < 4; i++) {
    const rest = clamp(landX + R.P.footRestX[i] * dir, seg.x1, seg.x2);
    const o = rot2d(TUCK[i].x * dir * S, TUCK[i].y * S, R.rot);
    setFoot(R, i, lerp(R.x + o.x, rest, grip), lerp(R.bodyY + o.y, surfY, grip * grip));
  }
}

// Hop between two edge nodes. opts.missed turns it into an undershoot that
// becomes a ledge grab and pull-up. opts.quick is the startle dodge variant.
export function makeHop(R, from, to, opts = {}) {
  const P = R.P;
  const S = P.scale;
  const dir = Math.sign(to.x - from.x) || R.facing;
  const seg = R.graph.segments[to.seg];
  const landX = clamp(to.x + dir * 9 * S, seg.x1 + 3, seg.x2 - 3);
  const missed = !!opts.missed;
  const hang = { x: to.x - dir * 5 * S, y: to.y + 15 * S };
  const start = { x: R.x, y: R.bodyY };
  const target = missed ? hang : { x: landX, y: to.y - P.standH };
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const flightDur = opts.quick ? 0.2 : clamp(0.26 + d * 0.001, 0.26, 0.42);
  const peakY = Math.min(start.y, missed ? to.y - 6 * S : target.y) - clamp(d * 0.28, 12 * S, 40 * S);
  const cpY = qbezControlForPeak(start.y, target.y, peakY);
  const cpX = (start.x + target.x) / 2;
  let phase = opts.quick ? 'flight' : 'crouch';
  let t = 0;

  return {
    type: 'hop',
    update(dt) {
      t += dt;
      if (!opts.keepFacing) R.facing = dir;
      if (phase === 'crouch') {
        const u = clamp(t / 0.09, 0, 1);
        R.bodyY = start.y + 4 * S * Math.sin(u * Math.PI);
        if (u >= 1) {
          phase = 'flight';
          t = 0;
        }
        return false;
      }
      if (phase === 'flight') {
        const u = clamp(t / flightDur, 0, 1);
        R.x = qbez(start.x, cpX, target.x, u);
        R.bodyY = qbez(start.y, cpY, target.y, u);
        R.rot = dir * (-0.05 + 0.13 * u); // barely leans; the monitor stays upright
        if (u < 0.65) tuck(R, R.rot, missed ? 0.25 : 0);
        else if (!missed) reachForLanding(R, 0.65, u, landX, to.y, seg, dir);
        else tuck(R, R.rot, 0.35);
        if (u >= 1) {
          if (missed) {
            phase = 'grab';
            t = 0;
            R.face.set('glitch', 0.35);
          } else {
            R.finishManeuver(to.seg, landX, (200 + d * 0.6) * S);
            return true;
          }
        }
        return false;
      }
      if (phase === 'grab') {
        const decay = Math.exp(-t * 1.8);
        const sway = Math.sin(t * 9) * decay;
        R.x = hang.x + sway * 1.5 * S;
        R.bodyY = hang.y;
        R.rot = dir * (0.35 + sway * 0.16);
        setFoot(R, 0, to.x + dir * 1.5 * S, to.y + 0.5 * S);
        setFoot(R, 1, to.x - dir * 1.5 * S, to.y + 1.5 * S);
        setFoot(R, 2, R.x - dir * 3 * S + sway * 6 * S, R.bodyY + 9 * S);
        setFoot(R, 3, R.x - dir * 6 * S + sway * 8 * S, R.bodyY + 11 * S);
        if (t > 0.55) {
          phase = 'pullup';
          t = 0;
          R.face.set('idle');
        }
        return false;
      }
      // pullup
      const u = clamp(t / 0.42, 0, 1);
      const e = easeInOutQuad(u);
      const end = { x: landX, y: to.y - P.standH };
      R.x = qbez(hang.x, to.x - dir * 2 * S, end.x, e);
      R.bodyY = qbez(hang.y, to.y - P.standH - 6 * S, end.y, e);
      R.rot = dir * 0.35 * (1 - e);
      setFoot(R, 0, to.x + dir * (1.5 + e * 9) * S, to.y);
      setFoot(R, 1, to.x + dir * e * 5 * S, to.y);
      const wallX = to.x - dir * S;
      const rung = u < 0.35 ? 0 : u < 0.7 ? 1 : 2;
      if (u > 0.8) setFoot(R, 2, to.x - dir * 2 * S, to.y);
      else setFoot(R, 2, wallX, to.y + (10 - rung * 4) * S);
      if (u > 0.9) setFoot(R, 3, to.x - dir * 5 * S, to.y);
      else setFoot(R, 3, wallX, to.y + (14 - rung * 4) * S);
      if (u >= 1) {
        R.finishManeuver(to.seg, landX, 140 * S);
        return true;
      }
      return false;
    },
  };
}

// Walk off an edge and fall. opts.tumble adds a scripted roll plus shake-off.
export function makeDrop(R, from, to, opts = {}) {
  const P = R.P;
  const S = P.scale;
  const dir = Math.sign(to.x - from.x) || R.facing;
  const seg = R.graph.segments[to.seg];
  const landX = clamp(to.x, seg.x1 + 3, seg.x2 - 3);
  const g = 2400 * S;
  const vy0 = 30 * S;
  const dy = Math.max(to.y - from.y, 10 * S);
  const fallDur = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * g * dy)) / g;
  const tumble = !!opts.tumble;
  const startY = from.y - P.standH;
  let phase = 'step';
  let t = 0;

  return {
    type: 'drop',
    update(dt) {
      t += dt;
      R.facing = dir;
      if (phase === 'step') {
        const u = clamp(t / 0.1, 0, 1);
        R.x = lerp(from.x, from.x + dir * 5 * S, u);
        R.rot = dir * 0.05 * u;
        if (u >= 1) {
          phase = 'fall';
          t = 0;
        }
        return false;
      }
      if (phase === 'fall') {
        const u = clamp(t / fallDur, 0, 1);
        R.x = lerp(from.x + dir * 5 * S, landX, easeOutCubic(u) * 0.85 + u * 0.15);
        R.bodyY = startY + vy0 * t + 0.5 * g * t * t;
        R.rot = dir * clamp(0.05 + t * 0.35, 0, 0.13);
        if (u < 0.55) tuck(R, R.rot);
        else reachForLanding(R, 0.55, u, landX, to.y, seg, dir);
        if (u >= 1) {
          if (tumble) {
            phase = 'roll';
            t = 0;
            R.face.set('glitch', 0.6);
          } else {
            R.finishManeuver(to.seg, landX, 240 * S + dy * 0.9);
            return true;
          }
        }
        return false;
      }
      if (phase === 'roll') {
        const u = clamp(t / 0.38, 0, 1);
        R.x = landX + dir * 24 * S * easeOutCubic(u);
        R.bodyY = to.y - P.standH * 0.55 - Math.sin(u * Math.PI) * 3 * S;
        R.rot = dir * Math.PI * 2 * easeOutCubic(u);
        tuck(R, R.rot);
        if (u >= 1) {
          phase = 'shake';
          t = 0;
        }
        return false;
      }
      // shake it off
      const u = clamp(t / 0.45, 0, 1);
      R.rot = dir * 0.1 * Math.sin(t * 24) * Math.exp(-t * 6);
      R.headWiggle = 0.18 * Math.sin(t * 30) * Math.exp(-t * 5);
      R.bodyY = to.y - P.standH * lerp(0.6, 1, easeOutBack(u));
      for (let i = 0; i < 4; i++) setFoot(R, i, R.x + P.footRestX[i] * dir, to.y);
      if (u >= 1) {
        R.headWiggle = 0;
        R.finishManeuver(to.seg, R.x, 60 * S);
        return true;
      }
      return false;
    },
  };
}

// A friendly wave: settle back on three legs and swing the front-near leg
// up beside the head. Used by the contact-section job.
export function makeWave(R) {
  const P = R.P;
  const S = P.scale;
  const dir = R.facing;
  const seg = R.graph.segments[R.seg];
  const baseY = seg.y - P.standH;
  const dur = 1.6;
  let t = 0;

  return {
    type: 'wave',
    update(dt) {
      t += dt;
      const u = clamp(t / dur, 0, 1);
      const settle = u < 0.14 ? u / 0.14 : u > 0.84 ? (1 - u) / 0.16 : 1;
      R.rot = -dir * 0.08 * settle;
      R.bodyY = baseY + 2.5 * S * settle;
      for (const i of [1, 2, 3]) {
        setFoot(R, i, R.x + P.footRestX[i] * dir * 0.8, seg.y);
      }
      const wave = Math.sin(t * 9) * settle;
      const hx = R.x + dir * (15 + wave * 5) * S;
      const hy = R.bodyY - (P.headH * 0.5 + 7 * S) * settle - wave * 3 * S;
      setFoot(R, 0, hx, settle > 0.05 ? hy : seg.y);
      R.headWiggle = wave * 0.05;
      if (u >= 1) {
        R.headWiggle = 0;
        R.finishManeuver(R.seg, R.x, 50 * S);
        return true;
      }
      return false;
    },
  };
}

// A quick tamper: hunch over the spot in front, jab the front-near leg at it
// in a fast fiddling motion, head twitching. Stays on the current segment and
// ends back standing. Used by the villain when it messes with a station; it
// is an in-place authored move, not a traversal stumble.
export function makeTamper(R, dur = 0.8) {
  const P = R.P;
  const S = P.scale;
  const dir = R.facing;
  const seg = R.graph.segments[R.seg];
  const baseY = seg.y - P.standH;
  let t = 0;

  return {
    type: 'tamper',
    update(dt) {
      t += dt;
      const u = clamp(t / dur, 0, 1);
      const settle = u < 0.12 ? u / 0.12 : u > 0.85 ? (1 - u) / 0.15 : 1;
      R.rot = dir * 0.07 * settle; // hunch and lean in
      R.bodyY = baseY + 3 * S * settle;
      R.headWiggle = Math.sin(t * 34) * 0.06 * settle;
      for (const i of [1, 2, 3]) setFoot(R, i, R.x + P.footRestX[i] * dir * 0.9, seg.y);
      // front-near leg jabs at the panel
      const jab = (Math.sin(t * 22) * 0.5 + 0.5) * settle;
      setFoot(R, 0, R.x + dir * (11 + jab * 7) * S, R.bodyY + (2 - jab * 5) * S);
      if (u >= 1) {
        R.headWiggle = 0;
        R.finishManeuver(R.seg, R.x, 40 * S);
        return true;
      }
      return false;
    },
  };
}

// Corner climb: rear up against the wall, scramble up it, mantle over.
export function makeClimb(R, from, to) {
  const P = R.P;
  const S = P.scale;
  const dir = Math.sign(to.x - from.x) || R.facing;
  const seg = R.graph.segments[to.seg];
  const wallX = to.x - dir * 2 * S;
  const landX = clamp(to.x + dir * 10 * S, seg.x1 + 3, seg.x2 - 3);
  const startY = from.y - P.standH;
  const hoistStart = { x: wallX - dir * 9 * S, y: from.y - P.standH * 0.7 };
  const hoistEnd = { x: wallX - dir * 9 * S, y: to.y + 8 * S };
  const hoistDur = clamp((from.y - to.y) * 0.005, 0.3, 0.55);
  // back feet grab first: they lag furthest below and stretch the worst
  const grabOrder = [2, 0, 3, 1];
  const grabStep = Math.min(0.09, hoistDur / 5);
  let phase = 'rear';
  let t = 0;
  let grabIx = 0;
  let grabTimer = 0;

  return {
    type: 'climb',
    update(dt) {
      t += dt;
      R.facing = dir;
      if (phase === 'rear') {
        const u = clamp(t / 0.15, 0, 1);
        R.x = lerp(from.x, hoistStart.x, u);
        R.bodyY = lerp(startY, hoistStart.y, u);
        R.rot = -dir * 0.1 * u;
        setFoot(R, 0, wallX, from.y - 20 * S * u);
        setFoot(R, 1, wallX, from.y - 13 * S * u);
        if (u >= 1) {
          phase = 'hoist';
          t = 0;
          grabTimer = 0;
          // take ownership of all feet so they trail as the body rises
          for (let i = 0; i < 4; i++) setFoot(R, i, R.gait.feet[i].x, R.gait.feet[i].y);
        }
        return false;
      }
      if (phase === 'hoist') {
        const u = clamp(t / hoistDur, 0, 1);
        R.x = lerp(hoistStart.x, hoistEnd.x, u) + Math.sin(t * 28) * 0.6 * S;
        R.bodyY = lerp(hoistStart.y, hoistEnd.y, easeInOutQuad(u));
        R.rot = -dir * lerp(0.1, 0.16, clamp(u * 2, 0, 1)); // upright scramble, not a wall-crawl
        grabTimer -= dt;
        if (grabTimer <= 0) {
          grabTimer = grabStep;
          const i = grabOrder[grabIx % 4];
          grabIx++;
          setFoot(
            R,
            i,
            wallX + randRange(-1.5, 1.5),
            R.bodyY - (6 + (i % 2) * 7) * S + randRange(-3, 3),
          );
        }
        if (u >= 1) {
          phase = 'mantle';
          t = 0;
        }
        return false;
      }
      // mantle over the corner
      const u = clamp(t / 0.3, 0, 1);
      const e = easeInOutQuad(u);
      const end = { x: landX, y: to.y - P.standH };
      R.x = qbez(hoistEnd.x, to.x, end.x, e);
      R.bodyY = qbez(hoistEnd.y, to.y - P.standH - 9 * S, end.y, e);
      R.rot = -dir * 0.16 * (1 - easeOutBack(u));
      if (u > 0.15) setFoot(R, 0, to.x + dir * 8 * S, to.y);
      if (u > 0.3) setFoot(R, 1, to.x + dir * 4 * S, to.y);
      if (u > 0.6) setFoot(R, 2, to.x - dir * S, to.y);
      if (u > 0.75) setFoot(R, 3, to.x - dir * 4 * S, to.y);
      if (u >= 1) {
        R.finishManeuver(to.seg, landX, 160 * S);
        return true;
      }
      return false;
    },
  };
}
