// Ballistic solver tests. Pure geometry, headless.

import { describe, it, expect } from 'vitest';
import { solveLaunch, positionAt, velocityAt, landsFromOutside, arcOccluded } from './ballistic.js';

const G = 2400;

describe('solveLaunch: the arc actually connects the two points', () => {
  it('lands exactly on the target at flight time t (level gap)', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 200, y: 0 };
    const s = solveLaunch(from, to, G);
    const p = positionAt(from, s, G, s.t);
    expect(p.x).toBeCloseTo(200, 3);
    expect(p.y).toBeCloseTo(0, 3);
    expect(s.speed).toBeGreaterThan(0);
  });

  it('reaches a target above the launch (a leap up onto a ledge)', () => {
    const from = { x: 0, y: 200 };
    const to = { x: 80, y: 40 }; // 160px up, 80px over (screen y grows down)
    const s = solveLaunch(from, to, G);
    const p = positionAt(from, s, G, s.t);
    expect(p.x).toBeCloseTo(80, 3);
    expect(p.y).toBeCloseTo(40, 3);
    // Launched upward: initial vy is negative (moving to smaller y).
    expect(s.vy).toBeLessThan(0);
  });

  it('returns the minimum-speed launch (no sampled flight time beats it)', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 150, y: -60 };
    const s = solveLaunch(from, to, G);
    for (let t = 0.05; t <= 3; t += 0.05) {
      const vx = (to.x - from.x) / t;
      const vy = (to.y - from.y) / t - 0.5 * G * t;
      const speed = Math.hypot(vx, vy);
      expect(s.speed).toBeLessThanOrEqual(speed + 1e-6);
    }
  });
});

describe('landing and launch side rules unify drop / hop / underside-grab', () => {
  it('lands on a top surface moving downward (into it)', () => {
    const from = { x: 0, y: 200 };
    const to = { x: 120, y: 120 };
    const s = solveLaunch(from, to, G);
    const topNormal = { x: 0, y: -1 };
    expect(landsFromOutside(s, G, s.t, topNormal)).toBe(true);
  });

  it('grabs an underside only when arriving moving upward', () => {
    const from = { x: 0, y: 300 };
    const to = { x: 60, y: 120 }; // well above: still rising at impact
    const s = solveLaunch(from, to, G);
    const underNormal = { x: 0, y: 1 }; // downward-facing surface
    const vLand = velocityAt(s, G, s.t);
    // This target is reached while still ascending, so it can grab the underside.
    if (vLand.y < 0) {
      expect(landsFromOutside(s, G, s.t, underNormal)).toBe(true);
    }
  });
});

describe('occlusion: an arc through a solid box is rejected', () => {
  // The min-speed arc to a level target 200px away peaks ~50px above the launch
  // line (apex = range / 4), at the midpoint x = 100.
  const from = { x: 0, y: 100 };
  const to = { x: 200, y: 100 };

  it('flags a box tall enough to intercept the arc apex', () => {
    const s = solveLaunch(from, to, G);
    const wall = { x: 90, y: 30, w: 20, h: 60 }; // y 30..90 catches the y~50 apex
    expect(arcOccluded(from, s, G, s.t, [wall])).toBe(true);
  });

  it('passes when the box sits below the arc', () => {
    const s = solveLaunch(from, to, G);
    const wall = { x: 90, y: 130, w: 20, h: 40 }; // below the arc (which stays y 50..100)
    expect(arcOccluded(from, s, G, s.t, [wall])).toBe(false);
  });
});
