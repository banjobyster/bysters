// The surface-local motor. One locomotion logic for every angle: the byster
// lives in a surface's local frame (along = tangent, out = normal), and the
// exact same gait/body math draws a floor-walker, a wall-walker rotated 90
// degrees, or an underside-walker upside down. Gecko-adhesion: a declared
// surface is walkable, gravity only flavors the motion. Airborne moves are one
// ballistic maneuver, so drop / hop / climb never appear as separate code.
//
// It reuses the existing Gait and Face and produces the same world-space fields
// the RobotRenderer already reads (x, bodyY, rot, head*, legs), so the accordion
// legs and pixel face carry over for free. Pure logic; no DOM, no Pixi.
//
// Execution model: a route is decided once (on a click or a wander pick), then
// followed. It is NOT re-decided every frame. Along one surface the byster
// glides through the graph's waypoints without stopping (they are only there for
// the planner); it eases speed only into the final destination and rounds
// corners carrying its momentum. A jump runs to completion; a new destination
// requested mid-arc is queued and taken on landing.

import { Gait } from './kinematics/gait.js';
import { Face } from './face.js';
import { clamp, spring, rot2d } from './math.js';
import { solveLaunch } from './path/ballistic.js';
import { planRoute, nearestVertex } from './path/graph.js';

const TAU = Math.PI * 2;
// Shortest-arc angle ease, so rounding a corner rotates the short way.
function easeAngle(a, b, k) {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
}

export class SurfaceMover {
  // opts.planner: a per-byster route finder with the signature
  //   (graph, startVertexId, goalVertexId, caps) => route | null
  // Defaults to the generic A* (planRoute). This is the seam that lets each
  // byster carry its own routing logic later (a wary bot weighting away from
  // others, a repair bot taking the strict shortest path), while everything
  // else here stays identical. It must return the same step shape planRoute does.
  constructor(character, opts = {}) {
    this.C = character;
    const P = character.params;
    this.P = P;
    this.planner = opts.planner || planRoute;
    this.gait = new Gait(P);
    this.face = new Face(character.face);
    this.legRest = P.hipX.map((hx, i) => Math.hypot(P.footRestX[i] - hx, P.standH - P.hipY));

    this.graph = null;
    this.caps = null;
    this.surface = 0;
    this.p = 0; // along the frame tangent from the frame anchor (world units)
    this.facing = 1;
    this.vel = 0;
    this.moveTarget = null;
    this.speedCap = P.walkSpeed;
    // Runtime-modulated body knobs. Each has a resting default (set once, e.g. a
    // scene-wide derate or a spectral alpha) and a LIVE value the byster refreshes
    // every frame from the pace/appearance channels, falling back to the default
    // when no behavior bids. So speed and look are behavior-driven, not frozen.
    this.speedScale = 1; // resting cruise default
    this.pace = 1; // live cruise multiplier (byster sets from the pace channel)
    this.baseAlpha = 1; // resting opacity default
    this.alpha = 1; // live opacity (byster sets from the appearance channel; renderer reads)
    this.baseTint = null; // resting tint default (null = untinted)
    this.tint = null; // live tint (renderer reads)

    this.bodyLocalY = -P.standH; // localY 0 on surface, negative = outward
    this.bodyLocalYV = 0;
    this.rotLocal = 0;
    this.rotLocalV = 0;
    this.bob = 0;
    this.fRot = 0; // eased frame rotation (rounds corners, tumbles in air)
    this.headWiggle = 0;
    this.gazeX = 0;
    this.gazeY = 0;

    this.state = 'idle'; // idle | walk | air (idle = no active route)
    this.route = null;
    this.stepIx = 0;
    this.air = null;
    this._carrySpeed = null; // momentum carried around a corner
    this._pendingGoal = null; // a destination requested while airborne

    this.x = 0;
    this.bodyY = 0;
    this.rot = 0;
    this.headX = 0;
    this.headY = 0;
    this.headRot = 0;
    this.legs = [];
    this.contact = { x: 0, y: 0 };
    this.normal = { x: 0, y: -1 };
  }

  // The local frame for a surface. The tangent is chosen with a CONSISTENT
  // handedness relative to the outward normal (tHat = (-n.y, n.x)), so the gait
  // is never mirrored on left/bottom faces where the stored a->b tangent points
  // the other way. The anchor is the endpoint with the smaller projection onto
  // tHat, so `p` always increases along tHat from 0.
  _frameOf(surfaceIx) {
    const s = this.graph.surfaces[surfaceIx];
    const n = s.normal;
    const tangent = { x: -n.y, y: n.x };
    const pa = s.a.x * tangent.x + s.a.y * tangent.y;
    const pb = s.b.x * tangent.x + s.b.y * tangent.y;
    const anchor = pa <= pb ? s.a : s.b;
    return { anchor, tangent, normal: n, length: s.length, rot: Math.atan2(tangent.y, tangent.x) };
  }

  // Project a world point onto a surface, returning its along-coordinate in the
  // frame (0..length), consistent with `p`.
  _alongOf(pt, surfaceIx = this.surface) {
    const f = this._frameOf(surfaceIx);
    const t = (pt.x - f.anchor.x) * f.tangent.x + (pt.y - f.anchor.y) * f.tangent.y;
    return clamp(t, 0, f.length);
  }

  spawn(graph, surfaceIx, along, caps) {
    this.graph = graph;
    this.caps = caps;
    this.surface = surfaceIx;
    const f = this._frameOf(surfaceIx);
    this.p = clamp(along, 2, f.length - 2);
    this.fRot = f.rot;
    this.bodyLocalY = -this.P.standH;
    this.bodyLocalYV = 0;
    this.vel = 0;
    this.moveTarget = null;
    this.route = null;
    this._carrySpeed = null;
    this.state = 'idle';
    this.gait.reset(this.p, 0, this.facing);
    this.face.set('idle');
    this._syncGround(0);
  }

  // Spawn at whatever walkable vertex is nearest a world point, resolving the
  // surface + along for the caller. This is how a byster is placed at a specific
  // spot on the page (its scene's floor) rather than a fraction of the global
  // ground, so a multi-region page can seat each byster in its own cluster.
  spawnNear(graph, x, y, caps) {
    this.graph = graph;
    const v = nearestVertex(graph, x, y);
    const surfaceIx = v ? v.surface : 0;
    const along = this._alongOf({ x, y }, surfaceIx);
    this.spawn(graph, surfaceIx, along, caps);
  }

  // Adopt a recompiled graph IN PLACE: the world's geometry changed (a card grew,
  // a console reflowed, the layout shifted), the byster did not. If its surface
  // survived the recompile (same element, same side) it keeps riding it at the
  // same along-position, wherever that surface now sits, so a byster whose floor
  // moved simply moves with its floor. The route is dropped either way (its steps
  // reference the old graph); the mind replans from here next frame. If the
  // surface is gone, or the byster is mid-arc toward an index that no longer
  // means anything, it settles at the nearest walkable spot to where it was.
  // Placement intent (spawn / spawnAt) is a first-build concern; after that a
  // byster's position is its own.
  rebase(graph, caps) {
    const old = this.graph ? this.graph.surfaces[this.surface] : null;
    const sameSurface = (s) =>
      s.side === old.side &&
      (old.el != null ? s.el === old.el : !!(s.meta && s.meta.ground && old.meta && old.meta.ground));
    const ix = old && this.state !== 'air' ? graph.surfaces.findIndex(sameSurface) : -1;
    if (ix < 0) {
      this.spawnNear(graph, this.x, this.bodyY, caps);
      return;
    }
    this.halt(); // drops the old-graph route and queued goal, keeps position
    this.graph = graph;
    this.caps = caps;
    this.surface = ix;
    this.p = clamp(this.p, 2, this._frameOf(ix).length - 2);
    this._syncGround(0);
  }

  // Plan and follow a route to a goal vertex. Returns false when there is no route
  // from here. While airborne the request is queued and taken on landing (so a jump
  // is never cut short) and returns true meaning "queued, not yet validated": the
  // landing replan is where an unreachable queued goal actually resolves (to idle).
  routeTo(goalVertexId) {
    if (this.state === 'air') {
      this._pendingGoal = goalVertexId;
      return true;
    }
    const start = this._nearestOwnVertex();
    if (start == null) return false;
    const route = this.planner(this.graph, start, goalVertexId, this.caps);
    if (!route || !route.length) return false;
    this.route = route;
    this.stepIx = 0;
    this.moveTarget = null;
    this._carrySpeed = null;
    this.state = 'walk';
    return true;
  }

  _nearestOwnVertex() {
    let best = null;
    for (const v of this.graph.vertices) {
      if (v.surface !== this.surface) continue;
      const d = Math.abs(this._alongOf(v, this.surface) - this.p);
      if (!best || d < best.d) best = { id: v.id, d };
    }
    return best ? best.id : null;
  }

  _endRoute() {
    this.route = null;
    this.moveTarget = null;
    this.stepIx = 0;
    this._carrySpeed = null;
    this.state = 'idle';
  }

  // Come to rest where we are, abandoning the current route. This is what a stop()
  // intent means (sleep, perch, a stun): the body decelerates in place through the
  // idle path rather than coasting to a stale route end. Velocity is kept, so the
  // halt eases in over a few frames instead of snapping. A jump cannot be stopped
  // mid-arc, so airborne we only drop any queued goal and let the arc finish; the
  // next grounded frame's stop() then halts it.
  halt() {
    if (this.state === 'air') {
      this._pendingGoal = null;
      return;
    }
    this._endRoute();
  }

  // Advance the route intent: coalesce the run of walk steps on the current
  // surface into one continuous glide to its far end, round corners without
  // stopping (carrying speed), and launch jumps. Only the final destination
  // decelerates to a stop.
  _advance() {
    let guard = 0;
    while (this.state === 'walk' && this.route && guard++ < 256) {
      if (this.stepIx >= this.route.length) {
        this._endRoute();
        return;
      }
      const step = this.route[this.stepIx];

      if (step.type === 'jump') {
        this._beginJump(step);
        return;
      }

      if (step.to.surface !== this.surface) {
        // corner: switch to the adjoining surface at the shared point, carry
        // speed, and continue; the frame rotation eases so it rounds the corner.
        this._carrySpeed = Math.abs(this.vel);
        this.surface = step.to.surface;
        this.p = clamp(this._alongOf(step.to, this.surface), 2, this._frameOf(this.surface).length - 2);
        this.gait.reset(this.p, 0, this.facing);
        this.stepIx += 1;
        continue;
      }

      // A run of consecutive walk steps on this surface = one fluid glide.
      let j = this.stepIx;
      while (
        j + 1 < this.route.length &&
        this.route[j + 1].type === 'walk' &&
        this.route[j + 1].to.surface === this.surface
      ) {
        j += 1;
      }
      const len = this._frameOf(this.surface).length;
      const target = clamp(this._alongOf(this.route[j].to), 2, len - 2);
      const dx = target - this.p;
      const isFinalRun = j >= this.route.length - 1;

      if (Math.abs(dx) < 6) {
        if (isFinalRun) {
          if (Math.abs(this.vel) < 40) {
            this.p = target;
            this.vel = 0;
            this.moveTarget = null;
            this.stepIx = j + 1;
            this._endRoute();
            return;
          }
          this.moveTarget = target; // glide to a stop
          return;
        }
        this.stepIx = j + 1; // reached the run's end; on to the corner/jump
        continue;
      }

      this.moveTarget = target;
      this.facing = Math.sign(dx) || this.facing;
      if (this._carrySpeed != null) {
        this.vel = this._carrySpeed * this.facing; // redirect momentum along the new tangent
        this._carrySpeed = null;
      }
      return;
    }
  }

  _beginJump(step) {
    const P = this.P;
    const tgt = this.graph.surfaces[step.to.surface];
    const from = { x: this.x, y: this.bodyY };
    const land = { x: step.to.x + tgt.normal.x * P.standH, y: step.to.y + tgt.normal.y * P.standH };
    // Replay the arc under THIS byster's own gravity (a low-gravity byster leaps
    // floatier), falling back to the edge's compile-time gravity. The edge stays a
    // value-neutral reachability assertion, gated by launch speed at compile time;
    // only the animation of the arc is per-byster, so it lands on the same vertex.
    const g = this.caps.gravity ?? step.launch.g;
    const sol = solveLaunch(from, land, g);
    this._carrySpeed = null;
    this.air = {
      from,
      vel: sol,
      g,
      t: sol.t,
      e: 0,
      toSurface: step.to.surface,
      toAlong: this._alongOf(step.to, step.to.surface),
      fromRot: this.fRot,
      toRot: this._frameOf(step.to.surface).rot,
    };
    this.state = 'air';
    this.face.set('curious', 0.4);
    for (const ft of this.gait.feet) ft.override = true;
  }

  update(dt, input = {}) {
    dt = Math.min(dt, 0.033);
    if (input.gaze) {
      this.gazeX = input.gaze.x;
      this.gazeY = input.gaze.y;
    }
    if (this.state === 'air') {
      this._updateAir(dt);
      return;
    }
    if (this.state === 'walk') this._advance();
    if (this.state === 'air') {
      this._updateAir(dt); // _advance launched a jump this frame
      return;
    }
    // idle just decelerates and holds position; deciding where to go is the
    // byster's job (a behavior), not the body's.
    this._locomote(dt);
    this._syncGround(dt);
  }

  _locomote(dt) {
    const P = this.P;
    const f = this._frameOf(this.surface);
    if (this.moveTarget != null) {
      const dx = this.moveTarget - this.p;
      const cap = this.speedCap * this.pace;
      const desired = clamp(dx * 6, -cap, cap);
      this.vel += clamp(desired - this.vel, -P.accel * dt, P.accel * dt);
    } else {
      this.vel += clamp(-this.vel, -P.accel * dt, P.accel * dt);
    }
    if (Math.abs(this.vel) > 8) this.facing = Math.sign(this.vel) || this.facing;
    this.p = clamp(this.p + this.vel * dt, 2, f.length - 2);

    for (const ft of this.gait.feet) ft.override = false;
    this.gait.update(dt, this.p, this.vel, 0, this.facing, 0, f.length);

    if (this.gait.landed) {
      const w = clamp(Math.abs(this.vel) / P.walkSpeed, 0.25, 1);
      this.bodyLocalYV += this.gait.landed * (12 + 24 * w) * P.scale;
    }
    this.bob += dt * (1.4 + Math.abs(this.vel) * 0.055);
    const bobAmp = (0.7 + Math.min(Math.abs(this.vel) * 0.009, 1.6)) * P.scale;
    const targetLocalY = this.gait.plantedAvgY(0) - P.standH + Math.sin(this.bob) * bobAmp;
    [this.bodyLocalY, this.bodyLocalYV] = spring(
      this.bodyLocalY,
      this.bodyLocalYV,
      targetLocalY,
      dt,
      P.bodySpring ?? 190,
      P.bodyDamp ?? 22,
    );

    const frontY = (this.gait.feet[0].y + this.gait.feet[1].y) / 2;
    const backY = (this.gait.feet[2].y + this.gait.feet[3].y) / 2;
    const span = (P.footRestX[0] - P.footRestX[3]) * this.facing;
    const stance = Math.atan((frontY - backY) / span) * 0.2;
    const leanMax = P.leanMax ?? 0.045;
    const lean = clamp(this.vel * (P.leanGain ?? 0.00025), -leanMax, leanMax);
    [this.rotLocal, this.rotLocalV] = spring(
      this.rotLocal,
      this.rotLocalV,
      stance + lean,
      dt,
      P.rotSpring ?? 160,
      P.rotDamp ?? 24,
    );
  }

  _updateAir(dt) {
    const air = this.air;
    air.e += dt;
    const e = Math.min(air.e, air.t);
    this.x = air.from.x + air.vel.vx * e;
    this.bodyY = air.from.y + air.vel.vy * e + 0.5 * air.g * e * e;

    const k = clamp(air.e / air.t, 0, 1);
    this.fRot = easeAngle(air.fromRot, air.toRot, k * k);
    this.rot = this.fRot;
    this.face.update(dt, this.gazeX, this.gazeY);

    const P = this.P;
    const dispTan = { x: Math.cos(this.fRot), y: Math.sin(this.fRot) };
    const dispNorm = { x: Math.sin(this.fRot), y: -Math.cos(this.fRot) };
    const headQ = P.bodyH / 2 + P.headH / 2 - 2 * P.scale;
    this.headX = this.x + dispNorm.x * headQ + dispTan.x * this.facing * 2 * P.scale;
    this.headY = this.bodyY + dispNorm.y * headQ + dispTan.y * this.facing * 2 * P.scale;
    this.headRot = this.fRot + this.headWiggle;
    this.contact = { x: this.x - dispNorm.x * P.standH, y: this.bodyY - dispNorm.y * P.standH };
    this.normal = dispNorm;
    this.legs.length = 0;
    for (let i = 0; i < 4; i++) {
      const hl = rot2d(P.hipX[i] * this.facing, P.hipY, 0);
      const hip = {
        x: this.x + dispTan.x * hl.x - dispNorm.x * hl.y,
        y: this.bodyY + dispTan.y * hl.x - dispNorm.y * hl.y,
      };
      const foot = { x: hip.x + dispNorm.x * 6 * P.scale, y: hip.y + dispNorm.y * 6 * P.scale };
      this.legs.push({ i, hip, foot, near: i === 0 || i === 3, rest: this.legRest[i] });
    }

    if (air.e >= air.t) {
      this.surface = air.toSurface;
      const f = this._frameOf(this.surface);
      this.p = clamp(air.toAlong, 2, f.length - 2);
      this.fRot = air.toRot;
      this.bodyLocalY = -P.standH;
      this.bodyLocalYV = 140; // a small landing settle
      this.rotLocal = 0;
      this.vel = 0;
      this.gait.reset(this.p, 0, this.facing);
      this.air = null;
      this.stepIx += 1;
      // A destination requested mid-arc is honored now; otherwise continue the route.
      if (this._pendingGoal != null) {
        const goal = this._pendingGoal;
        this._pendingGoal = null;
        this.state = 'walk';
        if (!this.routeTo(goal)) this._endRoute(); // no route from the landing spot: rest, don't wedge in 'walk' with a null route
      } else {
        this.state = 'walk';
      }
      this._syncGround(dt);
    }
  }

  _syncGround(dt) {
    const f = this._frameOf(this.surface);
    this.fRot = easeAngle(this.fRot, f.rot, 1 - Math.exp(-dt * 12));
    const dispTan = { x: Math.cos(this.fRot), y: Math.sin(this.fRot) };
    const dispNorm = { x: Math.sin(this.fRot), y: -Math.cos(this.fRot) };
    // contact uses the frame anchor + tangent, continuous across a corner
    const contact = { x: f.anchor.x + this.p * f.tangent.x, y: f.anchor.y + this.p * f.tangent.y };
    this.contact = contact;
    this.normal = f.normal;
    const P = this.P;
    const worldOf = (la, lo) => ({
      x: contact.x + (la - this.p) * dispTan.x - lo * dispNorm.x,
      y: contact.y + (la - this.p) * dispTan.y - lo * dispNorm.y,
    });

    const bw = worldOf(this.p, this.bodyLocalY);
    this.x = bw.x;
    this.bodyY = bw.y;
    this.rot = this.fRot + this.rotLocal;

    const headLocal = rot2d(this.facing * 2 * P.scale, -(P.bodyH / 2 + P.headH / 2 - 2 * P.scale), this.rotLocal);
    const hw = worldOf(this.p + headLocal.x, this.bodyLocalY + headLocal.y);
    this.headX = hw.x;
    this.headY = hw.y;
    this.headRot = this.fRot + this.rotLocal * 0.6 + this.headWiggle + this.gazeY * 0.03 * this.facing;
    this.face.update(dt, this.gazeX, this.gazeY);

    this.legs.length = 0;
    for (let i = 0; i < 4; i++) {
      const hl = rot2d(P.hipX[i] * this.facing, P.hipY, this.rotLocal);
      const hip = worldOf(this.p + hl.x, this.bodyLocalY + hl.y);
      const foot = worldOf(this.gait.feet[i].x, this.gait.feet[i].y);
      this.legs.push({ i, hip, foot, near: i === 0 || i === 3, rest: this.legRest[i] });
    }
  }
}
