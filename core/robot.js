// The robot: body state, FSM, sensors, and locomotion. Pure logic; the
// renderer reads the fields this update() produces.

import { Gait } from './kinematics/gait.js';
import { Face } from './face.js';
import { Executor } from './kinematics/executor.js';
import { makeHop } from './kinematics/maneuvers.js';
import { planRoute, nearestPointOnTerrain, NAV } from './path/terrain.js';
import { clamp, lerp, spring, rot2d, randRange, choose } from './math.js';

// The robot is character-agnostic: proportions, motion tuning, and the face
// expression set come from the character definition (src/robot/characters/).
// P.scale multiplies authored motion offsets in gait/maneuvers; the NAV
// terrain constants stay absolute px regardless of it.
export class Robot {
  constructor(character) {
    this.character = character;
    const P = character.params;
    this.P = P;
    this.gait = new Gait(P);
    this.face = new Face(character.face);
    this.executor = new Executor(this);
    this.graph = null;
    this.seg = 0;
    this.x = 0;
    this.vel = 0;
    this.facing = 1;
    this.bodyY = 0;
    this.bodyYV = 0;
    this.rot = 0;
    this.rotV = 0;
    this.headX = 0;
    this.headY = 0;
    this.headRot = 0;
    this.headWiggle = 0;
    // Head inertia: the monitor lags/tips when the body lurches, scaled by the
    // character's P.headMass (heavy hero high, nimble imp near zero).
    this.headSway = 0;
    this.headSwayV = 0;
    this.prevVel = 0;
    // Per-character traversal caps: which nav moves this robot may plan. The
    // heavy hero uses base NAV; a nimble character sets params.nav higher and
    // routes through hops/climbs/drops the hero's planner rejects.
    this.caps = P.nav || NAV;
    this.mode = 'ground'; // 'ground' | 'maneuver'
    this.state = 'wake';
    this.stateT = 0;
    this.moveTarget = null;
    this.arrived = true;
    this.speedCap = P.walkSpeed;
    this.noise = 0.5;
    this.autoWander = true; // the site director turns this off and drives moves itself
    this.sitTarget = null; // heightScale target while sitting (null = stand tall)
    this.forceStumble = false;
    this.idleTimer = randRange(2.5, 6);
    this.sleepTimer = 30;
    this.startleCooldown = 0;
    this.pendingGoal = null;
    this.bobPhase = 0;
    this.heightScale = 1;
    this.gazeOverride = null;
    this.gazeX = 0;
    this.gazeY = 0;
    this.legs = [];
    // natural hip-to-foot length at stand, the renderer's squash/stretch reference
    this.legRest = P.hipX.map((hx, i) => Math.hypot(P.footRestX[i] - hx, P.standH - P.hipY));
  }

  get segment() {
    return this.graph.segments[this.seg];
  }

  get surfaceY() {
    return this.segment.y;
  }

  spawn(graph, segIx, x) {
    this.graph = graph;
    this.seg = segIx;
    this.x = x;
    this.bodyY = this.surfaceY - this.P.standH * 0.45;
    this.gait.reset(x, this.surfaceY, this.facing);
    this.setState('wake');
    this.face.set('off');
  }

  setTerrain(graph) {
    this.graph = graph;
    this.executor.cancel();
    this.pendingGoal = null;
    const near = nearestPointOnTerrain(graph, this.x, this.bodyY);
    this.seg = near.seg;
    this.x = near.x;
    this.mode = 'ground';
    this.gait.reset(this.x, this.surfaceY, this.facing);
    if (this.state === 'wander' || this.state === 'goto' || this.state === 'startled') {
      this.setState('idle');
    }
  }

  // Rebind to a freshly compiled graph while staying on the same platform
  // (the segment at segIx must be the robot's current surface, possibly moved
  // by scroll/reflow). Feet and body shift with it; no gait reset, no snap.
  rebindTerrain(graph, segIx) {
    const oldY = this.graph ? this.surfaceY : null;
    this.graph = graph;
    this.seg = segIx;
    this.executor.cancel();
    this.pendingGoal = null;
    this.mode = 'ground';
    const s = this.segment;
    this.x = clamp(this.x, s.x1 + 2, s.x2 - 2);
    const dy = oldY == null ? 0 : s.y - oldY;
    if (dy) {
      this.bodyY += dy;
      for (const f of this.gait.feet) f.y += dy;
    }
    if (this.state === 'wander' || this.state === 'goto' || this.state === 'startled') {
      this.setState('idle');
    }
  }

  consumeForcedStumble() {
    const f = this.forceStumble;
    this.forceStumble = false;
    return f;
  }

  walkTo(x) {
    const s = this.segment;
    this.moveTarget = clamp(x, s.x1 + 2, s.x2 - 2);
    this.arrived = false;
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  commandGoto(px, py, opts = {}) {
    this.wakeIfSleeping();
    if (!this.graph) return false;
    const goal = nearestPointOnTerrain(this.graph, px, py);
    if (!goal) return false;
    return this._planTo(goal, opts);
  }

  // Route to an exact segment, bypassing nearest-point snapping. The director
  // uses this to target a specific DOM platform (a card's port, the hatch).
  commandGotoSeg(segIx, x, opts = {}) {
    this.wakeIfSleeping();
    if (!this.graph || !this.graph.segments[segIx]) return false;
    return this._planTo({ seg: segIx, x }, opts);
  }

  _planTo(goal, opts) {
    const plan = () => {
      const steps = planRoute(this.graph, { seg: this.seg, x: this.x }, goal, this.caps);
      if (!steps) {
        this.face.set('glitch', 0.4);
        this.setState('idle');
        if (opts.onFail) opts.onFail();
        return;
      }
      this.speedCap = opts.speed ?? this.P.walkSpeed;
      this.executor.setRoute(steps, {
        noiseScale: opts.noise ?? 0.55,
        onDone: () => {
          if (opts.quiet) this.setState('idle');
          else this.onArrive();
          if (opts.onDone) opts.onDone();
        },
      });
      this.setState('goto');
      if (!opts.quiet) this.face.set('curious', 0.8);
    };
    if (this.mode === 'maneuver') this.pendingGoal = plan;
    else {
      this.executor.cancel();
      plan();
    }
    return true;
  }

  onArrive() {
    this.face.set('happy', 1.0);
    this.bodyYV -= 90 * this.P.scale; // excited little bounce
    this.setState('idle');
  }

  poke() {
    this.wakeIfSleeping();
    this.startle(-this.facing);
  }

  // moveDir: direction of the dodge hop along the current segment.
  startle(moveDir) {
    if (this.mode !== 'ground') return;
    this.executor.cancel();
    this.pendingGoal = null;
    this.face.set('glitch', 0.45);
    const s = this.segment;
    const from = { x: this.x, y: s.y, seg: this.seg };
    const to = {
      x: clamp(this.x + moveDir * 36 * this.P.scale, s.x1 + 3, s.x2 - 3),
      y: s.y,
      seg: this.seg,
    };
    this.executor.maneuver = makeHop(this, from, to, { quick: true, keepFacing: true });
    this.mode = 'maneuver';
    this.setState('startled');
  }

  startWander() {
    if (!this.graph || this.mode !== 'ground') return;
    const candidates = this.graph.nodes.filter(
      (n) => n.seg !== this.seg || Math.abs(n.x - this.x) > 60,
    );
    if (!candidates.length) return;
    const target = choose(candidates);
    const steps = planRoute(
      this.graph,
      { seg: this.seg, x: this.x },
      { seg: target.seg, x: target.x + randRange(-30, 30) },
      this.caps,
    );
    if (!steps) return;
    this.speedCap = this.P.wanderSpeed;
    this.executor.setRoute(steps, { noiseScale: 1, onDone: () => this.setState('idle') });
    this.setState('wander');
  }

  wakeIfSleeping() {
    this.sleepTimer = randRange(25, 40);
    if (this.state === 'sleep') {
      this.setState('idle');
      this.face.set('idle');
      this.face.blinkPhase = 0.0001;
    }
  }

  finishManeuver(segIx, x, impulse) {
    this.seg = segIx;
    const s = this.segment;
    this.x = clamp(x, s.x1 + 3, s.x2 - 3);
    this.vel = 0;
    this.moveTarget = null;
    this.arrived = true;
    this.mode = 'ground';
    this.bodyYV += impulse;
    this.rot = Math.atan2(Math.sin(this.rot), Math.cos(this.rot));
    this.rotV = 0;
    this.gait.reset(this.x, s.y, this.facing);
  }

  update(dt, input = {}) {
    dt = Math.min(dt, 0.033);
    this.stateT += dt;
    this.startleCooldown = Math.max(0, this.startleCooldown - dt);
    const P = this.P;
    const cur = input.cursor || null;
    const dCursor = cur ? Math.hypot(cur.x - this.x, cur.y - this.bodyY) : 1e9;

    // Startle: the cursor rushing at the robot.
    if (
      cur &&
      this.startleCooldown <= 0 &&
      this.mode === 'ground' &&
      this.state !== 'sleep' &&
      this.state !== 'wake' &&
      cur.speed > 900 &&
      dCursor < 160
    ) {
      const approaching = (this.x - cur.x) * cur.vx + (this.bodyY - cur.y) * cur.vy > 0;
      if (approaching) {
        this.startleCooldown = 1.6;
        this.facing = Math.sign(cur.x - this.x) || this.facing; // face the threat
        this.startle(Math.sign(this.x - cur.x) || -this.facing); // hop away from it
      }
    }

    // --- FSM ---
    this.heightScale = this.state === 'sleep' ? lerp(this.heightScale, 0.62, dt * 3) : this.heightScale;
    switch (this.state) {
      case 'wake': {
        this.heightScale = lerp(0.45, 1, clamp((this.stateT - 0.3) / 1.1, 0, 1));
        if (this.stateT > 0.35 && this.face.expr === 'off') {
          this.face.set('idle');
          this.face.blinkPhase = 0.0001; // eyes flick on
        }
        if (this.stateT > 0.6 && this.stateT < 1.7) {
          const sw = Math.sin((this.stateT - 0.6) * 5);
          this.gazeOverride = { x: this.x + sw * 220, y: this.bodyY - 40 };
        } else {
          this.gazeOverride = null;
        }
        if (this.stateT > 1.9) this.setState('idle');
        break;
      }
      case 'idle': {
        this.heightScale = lerp(this.heightScale, this.sitTarget ?? 1, dt * 4);
        this.idleTimer -= dt;
        this.sleepTimer -= dt;
        if (cur && (cur.speed > 250 || dCursor < 200)) this.sleepTimer = Math.max(this.sleepTimer, 28);
        if (this.sleepTimer <= 0) {
          this.setState('sleep');
          this.face.set('sleepy');
          break;
        }
        if (cur && Math.abs(cur.x - this.x) > 30 && dCursor < 650 && this.mode === 'ground') {
          this.facing = Math.sign(cur.x - this.x);
        }
        if (cur && dCursor < 110 && cur.speed < 40 && this.face.expr === 'idle') {
          this.face.set('curious', 0.9);
        }
        if (this.idleTimer <= 0) {
          this.idleTimer = randRange(3, 8);
          if (this.autoWander) this.startWander();
        }
        break;
      }
      case 'wander':
      case 'goto':
        this.heightScale = lerp(this.heightScale, 1, dt * 4);
        if (!this.executor.active) this.setState('idle');
        break;
      case 'startled':
        if (this.mode === 'ground' && !this.executor.maneuver) this.setState('idle');
        break;
      case 'sleep':
        if (cur && cur.speed > 400 && dCursor < 260) this.wakeIfSleeping();
        break;
      default:
        break;
    }

    // Deferred goal once the current maneuver lands.
    if (this.pendingGoal && this.mode === 'ground' && !this.executor.maneuver) {
      const plan = this.pendingGoal;
      this.pendingGoal = null;
      this.executor.cancel();
      plan();
    }

    this.executor.update(dt);

    // --- locomotion ---
    if (this.mode === 'ground') {
      if (this.moveTarget != null) {
        const dx = this.moveTarget - this.x;
        if (Math.abs(dx) < 2 && Math.abs(this.vel) < 40) {
          this.x = this.moveTarget;
          this.vel = 0;
          this.moveTarget = null;
          this.arrived = true;
        } else {
          const desired = clamp(dx * 6, -this.speedCap, this.speedCap);
          this.vel += clamp(desired - this.vel, -P.accel * dt, P.accel * dt);
        }
      } else {
        this.vel += clamp(-this.vel, -P.accel * dt, P.accel * dt);
      }
      if (Math.abs(this.vel) > 8 && this.moveTarget != null) {
        this.facing = Math.sign(this.vel) || this.facing;
      }
      const s = this.segment;
      this.x = clamp(this.x + this.vel * dt, s.x1 + 2, s.x2 - 2);

      for (const f of this.gait.feet) f.override = false;
      this.gait.update(dt, this.x, this.vel, s.y, this.facing, s.x1, s.x2);

      // Step weight: each planting foot presses the body down a touch and the
      // spring bounces it back, so strides read as carried weight, not glide.
      if (this.gait.landed) {
        const w = clamp(Math.abs(this.vel) / P.walkSpeed, 0.25, 1);
        this.bodyYV += this.gait.landed * (12 + 24 * w) * P.scale;
      }

      this.bobPhase += dt * (1.4 + Math.abs(this.vel) * 0.055);
      const bobAmp = (0.7 + Math.min(Math.abs(this.vel) * 0.009, 1.6)) * P.scale;
      const targetY =
        this.gait.plantedAvgY(s.y) - P.standH * this.heightScale + Math.sin(this.bobPhase) * bobAmp;
      // Body springs are per-character so a heavy robot settles softer and a
      // nimble one snaps crisper; defaults keep the original signed-off feel.
      [this.bodyY, this.bodyYV] = spring(
        this.bodyY,
        this.bodyYV,
        targetY,
        dt,
        P.bodySpring ?? 190,
        P.bodyDamp ?? 22,
      );

      const frontY = (this.gait.feet[0].y + this.gait.feet[1].y) / 2;
      const backY = (this.gait.feet[2].y + this.gait.feet[3].y) / 2;
      const span = (P.footRestX[0] - P.footRestX[3]) * this.facing;
      // atan of the slope, not atan2: span is negative when facing left and
      // atan2 would snap to ~pi, pinning a hard clockwise lean.
      const stance = Math.atan((frontY - backY) / span) * 0.2;
      const leanMax = P.leanMax ?? 0.045;
      const lean = clamp(this.vel * (P.leanGain ?? 0.00025), -leanMax, leanMax);
      [this.rot, this.rotV] = spring(
        this.rot,
        this.rotV,
        stance + lean,
        dt,
        P.rotSpring ?? 160,
        P.rotDamp ?? 24,
      );
    }

    // --- head inertia (weight) ---
    // The monitor trails the chest when the body lurches off and pitches forward
    // when it stops hard, scaled by P.headMass (heavy hero high, imp near zero).
    // A spring gives the lag-then-settle read; nothing else touches these.
    const accel = this.mode === 'ground' ? (this.vel - this.prevVel) / Math.max(dt, 1e-4) : 0;
    this.prevVel = this.vel;
    const swayTarget = clamp(-accel * 0.00055, -1, 1) * (P.headMass ?? 0);
    [this.headSway, this.headSwayV] = spring(this.headSway, this.headSwayV, swayTarget, dt, 85, 11);

    // --- head and gaze ---
    // The monitor rides above the chest, leaning slightly into the facing.
    const headLocal = rot2d(
      this.facing * 2 * P.scale,
      -(P.bodyH / 2 + P.headH / 2 - 2 * P.scale),
      this.rot,
    );
    this.headX = this.x + headLocal.x + this.headSway * 15 * P.scale;
    this.headY = this.bodyY + headLocal.y;
    const gt =
      this.gazeOverride ||
      (cur ? { x: cur.x, y: cur.y } : { x: this.x + this.facing * 120, y: this.bodyY });
    this.gazeX = clamp((gt.x - this.headX) / 260, -1, 1);
    this.gazeY = clamp((gt.y - this.headY) / 180, -1, 1);
    this.headRot =
      this.rot * 0.6 + this.headWiggle + this.gazeY * 0.03 * this.facing + this.headSway * 0.16;
    this.face.update(dt, this.gazeX, this.gazeY);

    // --- legs: straight capsules from hip to foot, no joints ---
    this.legs.length = 0;
    for (let i = 0; i < 4; i++) {
      const hl = rot2d(P.hipX[i] * this.facing, P.hipY, this.rot);
      const hip = { x: this.x + hl.x, y: this.bodyY + hl.y };
      const f = this.gait.feet[i];
      this.legs.push({
        i,
        hip,
        foot: { x: f.x, y: f.y },
        near: i === 0 || i === 3,
        rest: this.legRest[i],
      });
    }
  }
}
