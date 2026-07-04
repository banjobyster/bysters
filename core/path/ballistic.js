// Ballistic primitive: one projectile model that unifies every airborne
// transition. A "drop" is a downward-dominated arc, a "hop" has more sideways
// launch, a "leap onto a ledge" is aimed up, and "grabbing an underside" is an
// arc that arrives moving up into a downward-facing surface. Same solver, all
// cases, gravity does the shaping. There is no separate climb/drop/hop code.
//
// Coordinates are document/world space: y grows DOWNWARD, so gravity is a
// positive-y constant. Everything here is pure (no DOM, no window), so it runs
// headless under vitest and is deterministic.

// px/s^2, world-down. Tunable; the motor will replay arcs with the same g so
// the planned path and the animated path agree.
export const DEFAULT_GRAVITY = 2400;

// Minimum-speed launch velocity to travel from `from` to `to` under gravity g.
// For a chosen flight time t: vx = dx/t, vy = dy/t - 0.5*g*t. speed^2(t) is
// unimodal in t > 0 (blows up as t->0 and t->inf), so a golden-section search
// finds the min-speed launch deterministically. Returns { vx, vy, t, speed }.
export function solveLaunch(from, to, g = DEFAULT_GRAVITY, { tMin = 0.02, tMax = 4 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const speed2 = (t) => {
    const vx = dx / t;
    const vy = dy / t - 0.5 * g * t;
    return vx * vx + vy * vy;
  };
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = tMin;
  let b = tMax;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = speed2(c);
  let fd = speed2(d);
  for (let i = 0; i < 90; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = speed2(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = speed2(d);
    }
  }
  const t = (a + b) / 2;
  const vx = dx / t;
  const vy = dy / t - 0.5 * g * t;
  return { vx, vy, t, speed: Math.hypot(vx, vy) };
}

// Position and velocity along an arc launched from `from` with velocity `vel`.
export function positionAt(from, vel, g, t) {
  return { x: from.x + vel.vx * t, y: from.y + vel.vy * t + 0.5 * g * t * t };
}
export function velocityAt(vel, g, t) {
  return { x: vel.vx, y: vel.vy + g * t };
}

// n+1 sample points along the arc over [0, t], for occlusion tests and drawing.
export function arcSamples(from, vel, g, t, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(positionAt(from, vel, g, (t * i) / n));
  return pts;
}

// Does the arc land ON surface B from its walkable (outward) side? The landing
// velocity must move INTO the surface: dot with B's outward normal < 0. This is
// the single rule that lets a jump target a wall, a ledge, or an underside: you
// may only arrive on the side the surface faces.
export function landsFromOutside(vel, g, t, normalB, eps = 1e-3) {
  const vLand = velocityAt(vel, g, t);
  return vLand.x * normalB.x + vLand.y * normalB.y < -eps;
}

export function pointInRect(p, r, eps = 0.5) {
  return p.x > r.x + eps && p.x < r.x + r.w - eps && p.y > r.y + eps && p.y < r.y + r.h - eps;
}

// Does the arc pass through the interior of any solid box before it lands?
// Interior samples only (the endpoints sit on surfaces, not inside boxes).
export function arcOccluded(from, vel, g, t, solids, n = 18) {
  for (let i = 1; i < n; i++) {
    const p = positionAt(from, vel, g, (t * i) / n);
    for (const r of solids) if (pointInRect(p, r)) return true;
  }
  return false;
}
