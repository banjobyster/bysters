import { clamp } from '../math.js';

// Analytic 2-bone IK in 2D. Given hip, foot target and segment lengths,
// returns the knee position. `bend` (+1/-1) picks which side of the
// hip-to-foot line the knee sits on. Stable by construction: the target
// distance is clamped into the reachable annulus, no iteration.
export function solveKnee(hx, hy, fx, fy, l1, l2, bend) {
  let dx = fx - hx;
  let dy = fy - hy;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    dx = 1e-6;
    dy = 0;
    d = 1e-6;
  }
  const cd = clamp(d, Math.abs(l1 - l2) * 1.001, (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + cd * cd) / (2 * cd);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const ux = dx / d;
  const uy = dy / d;
  return {
    x: hx + ux * a - uy * h * bend,
    y: hy + uy * a + ux * h * bend,
  };
}
