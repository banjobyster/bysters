// Pure math helpers shared by the robot systems. No Pixi imports here.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInCubic = (t) => t * t * t;
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOutBack = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

// Quadratic bezier, used for jump arcs and mantle paths.
export const qbez = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;

// Control point so the bezier apex (t = 0.5) lands on `peak`.
export const qbezControlForPeak = (a, b, peak) => (4 * peak - a - b) / 2;

// Semi-implicit spring integration. Returns [value, velocity].
export function spring(current, vel, target, dt, stiffness, damping) {
  const accel = stiffness * (target - current) - damping * vel;
  const v = vel + accel * dt;
  return [current + v * dt, v];
}

export const rot2d = (x, y, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - y * s, y: x * s + y * c };
};

export const randRange = (a, b) => a + Math.random() * (b - a);
export const choose = (arr) => arr[(Math.random() * arr.length) | 0];

export function weightedChoose(pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = Math.random() * total;
  for (const [item, w] of pairs) {
    r -= w;
    if (r <= 0) return item;
  }
  return pairs[pairs.length - 1][0];
}
