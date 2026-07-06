// Winnow (the ghost byster): a faint tall-narrow portable-TV that never quite
// tuned in. Same family contract (monitor head + chest + four accordion legs),
// but tall and slim (the inverse of Sarge's letterbox), translucent, with one
// bent rabbit-ear antenna and thin slack legs so it reads as HOVERING on
// trailing wisps rather than standing. Its face is soft teal snow; it drifts,
// ignores everyone, and rolls its picture away rather than meeting your eyes.
//
// Fully inside the renderer contract (no engine change): the four legs stay
// (drawn thin and faint like a trailing veil), and the spectral faintness is a
// behavior driving root.alpha (root is a plain Container). A truly legless
// mid-air float would need an engine hook; this concept deliberately does not.

const COL = {
  shell: 0xcfd8d4, // translucent pale cold-ivory with a greenish cast (drawn ~0.5 alpha via root)
  shellHi: 0xe6efe9,
  shellShade: 0x9fb0aa,
  screenFrame: 0x2a3a38,
  screen: 0x0d1614, // the dead channel
  chest: 0x8b9a96, // faint slate, mostly hidden
  antenna: 0x9aa6b8,
  bloom: 0x9fe6da, // outer aura halo
  legNear: 0x7fd6cc, // wispy pale teal
  legNearCore: 0x2b524e,
  legFar: 0x5aa7a0,
  legFarCore: 0x1c3835,
  pix: [0, 0x3f7d75, 0x8fded0, 0xe8fff9], // off, faint teal snow, soft teal phosphor, snow flash
};

const PARAMS = {
  scale: 1.1,
  bodyW: 18, // slight chest, mostly hidden behind the shell (it is a floating head)
  bodyH: 12,
  headW: 40, // tall and narrow, the inverse of Sarge's letterbox
  headH: 48,
  hipX: [8, 4.5, -4.5, -8],
  hipY: 6,
  footRestX: [10, 5.5, -5.5, -10], // narrow imp-class footprint
  standH: 24, // taller than the others so legs stay long and dangling, head hovers clear
  stepThresholdBase: 10,
  walkSpeed: 90, // it does not walk with intent, it drifts
  wanderSpeed: 60,
  accel: 300,
  bodySpring: 110, // soft and loose: nothing snaps, everything eases and lags
  bodyDamp: 16,
  rotSpring: 90,
  rotDamp: 18,
  leanGain: 0.0002,
  leanMax: 0.04,
  headMass: 0.4, // light: sways and lags a half-beat behind itself
};

const FACES = {
  // The default AND resting face: soft crawling teal snow, a lazy roll-bar that
  // never locks, and two faint eye-smudges that pointedly do NOT track the
  // viewer (gaze drifts past). Animated, re-randomized each frame.
  idle(f) {
    const roll = ((f.t * 1.4) | 0) % f.h;
    f.block(0, roll, f.w, 1, 1);
    for (let i = 0; i < 5; i++) f.px((Math.random() * f.w) | 0, (Math.random() * f.h) | 0, 1);
    for (let i = 0; i < 2; i++) f.px((Math.random() * f.w) | 0, (Math.random() * f.h) | 0, 3);
    f.block(4, 5, 2, 2, 1); // eye-smudges, off-center, never toward gaze
    f.block(10, 5, 2, 2, 1);
  },
  // Shy almost-contact: the snow thins, eyes firm up with a hot pupil and a
  // faint de-ghosting echo, a small soft mouth, held in a hush. The pupils
  // ride the gaze, and her gaze behavior (avoidCursorGaze) mirrors the look
  // point away from the cursor, so they still never aim at the viewer. Used
  // for the curious flourish.
  peek(f) {
    // 2x2 pupils punched DARK (value 0 lets the near-black screen through):
    // her eye plates are pale teal, so a hot pupil is light-on-light mush,
    // while a dark hole reads instantly and its drift shows the gaze. The
    // plates are 4x4 so a lit rim always frames the hole.
    const gx = Math.round(f.gazeX * 1.6);
    const pr = Math.min(Math.max(4 + Math.round(f.gazeY * 0.8), 3), 5);
    f.block(2, 3, 4, 4, 2);
    f.block(Math.min(Math.max(3 + gx, 2), 4), pr, 2, 2, 0);
    f.px(6, 5, 1);
    f.block(10, 3, 4, 4, 2);
    f.block(Math.min(Math.max(11 + gx, 10), 12), pr, 2, 2, 0);
    f.px(14, 5, 1);
    f.block(6, 9, 4, 1, 2);
  },
  // Avoids eye contact: the picture ROLLS away, a bright-edged band sliding up,
  // pupils pinned to the far edge the gaze points at (her gaze behavior mirrors
  // away from the cursor, so that edge is always the escape side). Bashful,
  // not distressed. Animated.
  lookaway(f) {
    const band = f.h - 1 - (((f.t * 4) | 0) % f.h);
    f.block(0, band, f.w, 1, 2);
    // 2x2 hot pupils filling the slit's height, pinned to the escape side.
    const g = Math.round(f.gazeX * 2);
    f.block(3, 5, 3, 2, 1);
    f.block(Math.min(Math.max(4 + g, 3), 4), 5, 2, 2, 3);
    f.block(10, 5, 3, 2, 1);
    f.block(Math.min(Math.max(11 + g, 10), 11), 5, 2, 2, 3);
  },
  // A beat off in its own world: a soft test-pattern sliver blooms and fades.
  dream(f) {
    const v = Math.sin(f.t * 1.5) > 0.2 ? 2 : 1;
    f.block(5, 4, 6, 1, 1);
    f.block(5, 5, 6, 1, v);
    f.block(5, 6, 6, 1, 1);
  },
  // Drift-off / rest: everything fades toward off, collapsing to a single bright
  // CRT power-off line. Alpha is sunk by the doze behavior. Animated.
  dim(f) {
    f.block(0, Math.floor(f.h / 2), f.w, 1, 2);
    const on = ((f.t * 2) | 0) % 2;
    if (on) {
      f.px(4, 4, 1);
      f.px(11, 4, 1);
    }
  },
  // Aliases so behaviors requesting generic engine faces stay in character.
  curious(f) {
    FACES.peek(f);
  },
  happy(f) {
    FACES.peek(f);
  },
  sleepy(f) {
    FACES.dim(f);
  },
  glitch(f) {
    FACES.idle(f);
  },
};

export const WINNOW = {
  name: 'winnow',
  params: PARAMS,
  palette: COL,
  legs: {
    rings: 4,
    near: { core: COL.legNearCore, ring: COL.legNear, width: 3.4 }, // thin trailing wisps
    far: { core: COL.legFarCore, ring: COL.legFar, width: 3.0 },
  },
  face: {
    w: 16,
    h: 12,
    animated: ['idle', 'lookaway', 'dim', 'dream', 'peek'],
    exprs: FACES,
  },

  // A slight slate chest mostly lost behind the translucent shell, with a faint
  // bloom so what shows reads as glow, not a hole.
  buildBody(g) {
    const P = PARAMS;
    g.circle(0, 0, P.bodyW * 0.65).fill({ color: COL.bloom, alpha: 0.06 });
    g.roundRect(-P.bodyW / 2, -P.bodyH / 2, P.bodyW, P.bodyH, 4).fill(COL.chest);
    g.roundRect(-P.bodyW / 2 + 2, -P.bodyH / 2 + 1, P.bodyW - 4, 2.4, 1.2).fill(COL.shellHi);
  },

  // A tall rounded portable-TV shell with an aura, a bent rabbit-ear antenna off
  // the top-left, and a deep-set high screen.
  buildHead(g) {
    const w = PARAMS.headW;
    const h = PARAMS.headH;
    g.circle(0, -2, w * 0.72).fill({ color: COL.bloom, alpha: 0.05 }); // aura
    g.circle(0, -2, w * 0.55).fill({ color: COL.bloom, alpha: 0.05 });
    g.moveTo(-w / 2 + 6, -h / 2 + 1).lineTo(-w / 2 - 3, -h / 2 - 16).stroke({ width: 1.6, color: COL.antenna }); // bent whip
    g.circle(-w / 2 - 3, -h / 2 - 17, 2.4).stroke({ width: 1.2, color: COL.antenna }); // loop
    g.roundRect(-w / 2 + 2, -h / 2 + 2.5, w, h, 10).fill(COL.shellShade); // under-shade
    g.roundRect(-w / 2, -h / 2, w, h, 10).fill(COL.shell);
    g.roundRect(-w / 2 + 5, -h / 2 + 3, w - 10, 3, 1.5).fill(COL.shellHi); // top sheen

    const sw = 26;
    const sh = 26;
    const sy = -h / 2 + 8; // deep-set, high
    g.roundRect(-sw / 2 - 2.5, sy - 2.5, sw + 5, sh + 5, 6).fill(COL.screenFrame);
    g.roundRect(-sw / 2, sy, sw, sh, 4).fill(COL.screen);
    return { x: -sw / 2, y: sy, w: sw, h: sh };
  },

  // A faint diagonal shine plus a few horizontal scanline sheens for CRT texture.
  buildHeadGloss(g, box) {
    const { x: gx, y: gy, w: sw, h: sh } = box;
    g.poly([
      { x: gx + sw * 0.5, y: gy },
      { x: gx + sw * 0.66, y: gy },
      { x: gx + sw * 0.3, y: gy + sh },
      { x: gx + sw * 0.14, y: gy + sh },
    ]).fill({ color: 0xffffff, alpha: 0.05 });
    for (let i = 1; i < 4; i++) g.rect(gx, gy + (sh * i) / 4, sw, 0.5).fill({ color: 0xffffff, alpha: 0.03 });
  },
};
