// Sim reproducibility (TDD Section 13.1, PE-6). The Robot motor is pure logic:
// given the same terrain, the same inputs, and the same RNG stream it produces
// the same trajectory. The core does not yet take an injected RNG (it calls the
// global Math.random via math.js), so determinism here is established by seeding
// Math.random; a first-class injectable RNG is a candidate for a later
// milestone (see the M0 hand-back note).

import { describe, it, expect, afterEach } from 'vitest';
import { Robot } from './robot.js';
import { compileTerrain, NAV_AGILE } from './path/terrain.js';

// A tiny seedable PRNG so the sim is reproducible without touching core code.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Enough of a character to drive the motor headless; the face falls back to
// idle for any expression it does not define (Face.render).
const TEST_CHARACTER = {
  name: 'test',
  params: {
    scale: 1,
    bodyW: 20,
    bodyH: 16,
    headW: 40,
    headH: 32,
    hipX: [8, 4, -4, -8],
    hipY: 6,
    footRestX: [10, 5, -5, -10],
    standH: 20,
    stepThresholdBase: 12,
    walkSpeed: 160,
    wanderSpeed: 90,
    accel: 600,
  },
  palette: { pix: [0, 0x3f8f55, 0x7de88a, 0xe2ffe4] },
  legs: { rings: 4, near: {}, far: {} },
  face: { w: 8, h: 8, animated: [], exprs: { idle: (f) => f.px(1, 1, 1) } },
  buildBody() {},
  buildHead() {
    return { x: 0, y: 0, w: 8, h: 8 };
  },
};

const FIELD = [
  { x: 0, y: 320, w: 500, h: 40, tag: 'ground' },
  { x: 60, y: 240, w: 180, h: 40, tag: 'a' },
  { x: 300, y: 200, w: 160, h: 40, tag: 'b' },
];

const origRandom = Math.random;
afterEach(() => {
  Math.random = origRandom;
});

// Run the sim for `steps` fixed ticks under a seeded RNG, sampling the motor
// state every 30 frames. autoWander stays on so the RNG-driven wander fires.
function runSim(seed, steps = 900) {
  Math.random = mulberry32(seed);
  const graph = compileTerrain(FIELD, NAV_AGILE);
  const r = new Robot(TEST_CHARACTER);
  r.spawn(graph, 0, 100);
  const samples = [];
  for (let i = 0; i < steps; i++) {
    r.update(1 / 60, {});
    if (i % 30 === 0) {
      samples.push({
        x: r.x,
        bodyY: r.bodyY,
        rot: r.rot,
        facing: r.facing,
        state: r.state,
        seg: r.seg,
        vel: r.vel,
      });
    }
  }
  Math.random = origRandom;
  return samples;
}

describe('PE-6: a seeded sim is reproducible', () => {
  it('two runs with the same seed produce an identical trajectory', () => {
    expect(runSim(1337)).toEqual(runSim(1337));
  });

  it('the sim is non-trivial (the byster actually moves and changes state)', () => {
    const trace = runSim(1337);
    const xs = trace.map((s) => s.x);
    const states = new Set(trace.map((s) => s.state));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1); // it wandered
    expect(states.size).toBeGreaterThan(1); // it left the initial state
  });

  it('different seeds diverge (the RNG stream is what drives it)', () => {
    expect(runSim(1)).not.toEqual(runSim(2));
  });
});
