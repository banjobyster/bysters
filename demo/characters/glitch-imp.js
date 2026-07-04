// The saboteur (Part 3d, redesigned): a mischievous little CRT gremlin, the
// naughty sibling of the hero toddler. Same character contract and the same
// rounded, appealing Pixar read as the hero, just smaller, quicker, and warm
// cherry-red instead of beige. It is cute, not grim: big glowing amber eyes,
// a cheeky grin, rounded shell with little ear nubs.
//
// It reuses the same face buffer helpers (f.px, f.block, f.eye, f.t) on the
// same 16x12 grid the hero uses. Signature faces: scheme (a sly sideways
// look, doubling as idle), grin, cackle (gloating over a broken station),
// panic (caught / fleeing), fumble (a botched tamper). Engine expressions it
// omits fall back to idle in the Face renderer.

const COL = {
  bezel: 0xb84a4a, // warm cherry-red shell
  bezelHi: 0xd76d64, // top highlight sliver
  bezelShade: 0x8c3638, // bottom-right shade
  bezelDetail: 0x6d2a2c,
  screenFrame: 0x2a1416,
  screen: 0x140b0c,
  chest: 0x4c3742, // warm dark plum chest
  chestHi: 0x6d525e,
  chestDark: 0x2c1e26,
  ember: 0xff9a3c, // glowing amber core / power light
  legNear: 0xcaa8aa, // rosy warm-gray rings (bezel material family, not body)
  legNearCore: 0x241618,
  legFar: 0x9c8082,
  legFarCore: 0x160e0f,
  pix: [0, 0xc25e2f, 0xff9a3c, 0xffe3bc], // warm amber face
};

const PARAMS = {
  scale: 1.05, // small, well under the heavy 1.4 hero
  bodyW: 20,
  bodyH: 12,
  headW: 44, // a compact little monitor
  headH: 37,
  hipX: [8, 4.5, -4.5, -8],
  hipY: 6,
  footRestX: [10.5, 5.5, -5.5, -10.5], // a narrow, skittery stance
  standH: 17,
  stepThresholdBase: 8, // quick, frantic little steps
  walkSpeed: 330, // much faster than the hero: hard to catch
  wanderSpeed: 175,
  accel: 2200, // darts and stops on a dime
  // Light and crisp: stiff springs snap into place and the tiny head barely
  // lags, the opposite of the hero's weighty settle.
  bodySpring: 215,
  bodyDamp: 23,
  rotSpring: 185,
  rotDamp: 25,
  leanGain: 0.0004,
  leanMax: 0.06,
  headMass: 0.12,
  // Nimbleness: the imp plans with caps beyond the base NAV contract (up to
  // NAV_AGILE, which the live graph is compiled to), so it leaps wider gaps,
  // scrambles taller walls, and drops farther than the hero's planner allows,
  // taking sneak routes the hero simply cannot follow.
  nav: { hopMaxX: 190, hopMaxY: 125, climbMax: 155, dropMax: 440 },
};

const FACES = {
  // Idle IS a scheme: round eyes glancing to the side, a little smirk.
  idle(f) {
    f.block(3, 3, 4, 4, 1);
    f.block(9, 3, 4, 4, 1);
    f.block(5, 4, 2, 2, 2);
    f.block(11, 4, 2, 2, 2);
    f.px(6, 4, 3);
    f.px(12, 4, 3);
    f.block(6, 9, 4, 1, 2);
    f.px(9, 8, 2); // upturned corner
  },
  // Big cheeky grin: arched brows, happy eyes, open smile with teeth line.
  grin(f) {
    f.block(2, 2, 4, 1, 2);
    f.block(10, 2, 4, 1, 2);
    f.block(3, 4, 3, 2, 2);
    f.px(4, 4, 3);
    f.block(10, 4, 3, 2, 2);
    f.px(11, 4, 3);
    for (let x = 4; x <= 11; x++) f.px(x, 8, 2);
    f.block(5, 9, 6, 1, 3);
    f.px(4, 7, 2);
    f.px(11, 7, 2);
  },
  // Alias so behaviors reading "mischief" keep working.
  mischief(f) {
    FACES.grin(f);
  },
  // Gloating laugh: squeezed ^ ^ eyes, a flapping open mouth, twinkles.
  cackle(f) {
    const open = Math.sin(f.t * 16) > 0 ? 1 : 0;
    for (const c of [3, 10]) {
      f.px(c, 4, 2);
      f.px(c + 1, 3, 3);
      f.px(c + 2, 3, 3);
      f.px(c + 3, 4, 2);
    }
    f.block(5, 6, 6, 2 + open, 2);
    f.block(6, 6, 4, 1, 3);
    const tw = ((f.t * 8) | 0) % 2;
    f.px(1, 2, tw ? 3 : 1);
    f.px(14, 3, tw ? 1 : 3);
  },
  // Caught: huge round eyes with tiny bright pupils, a small o, a jitter.
  panic(f) {
    const j = ((f.t * 18) | 0) % 2;
    f.block(2 + j, 2, 4, 5, 1);
    f.block(3 + j, 3, 2, 2, 3);
    f.block(10 - j, 2, 4, 5, 1);
    f.block(11 - j, 3, 2, 2, 3);
    f.block(7, 9, 2, 1, 2);
  },
  // Botched it: dizzy cross eyes, a wavy oops mouth.
  fumble(f) {
    const k = (f.t * 10) | 0;
    f.block(3, 3, 4, 4, 1);
    f.px(4 + (k % 2), 4, 3);
    f.px(5, 5, 3);
    f.block(9, 3, 4, 4, 1);
    f.px(11 - (k % 2), 4, 3);
    f.px(10, 5, 3);
    for (let x = 5; x <= 10; x++) f.px(x, 9 + ((x + k) % 2), 2);
  },
  // Torn static (engine sets this on a failed plan / startle), warm flavored.
  glitch(f) {
    for (const [c, r] of [
      [3, 3],
      [10, 3],
    ]) {
      for (let y = 0; y < 4; y++) {
        const s = ((Math.random() * 5) | 0) - 2;
        f.block(Math.min(Math.max(c + s, 0), f.w - 3), r + y, 3, 1, Math.random() < 0.7 ? 2 : 1);
      }
    }
    for (let i = 0; i < 12; i++) {
      f.px((Math.random() * f.w) | 0, (Math.random() * f.h) | 0, ((Math.random() * 3) | 0) + 1);
    }
  },
  curious(f) {
    f.eye(3, 3, 4, 5, true);
    f.block(10, 4, 3, 2, 1);
    f.px(11, 3, 2);
    f.block(6, 9, 4, 1, 2);
  },
  happy(f) {
    FACES.grin(f);
  },
  sleepy(f) {
    f.block(3, 5, 4, 1, 1);
    f.block(9, 5, 4, 1, 1);
    f.px(7, 8, 1);
  },
};

export const GLITCH_IMP = {
  name: 'glitch-imp',
  params: PARAMS,
  palette: COL,
  legs: {
    rings: 4,
    near: { core: COL.legNearCore, ring: COL.legNear, width: 5.0 },
    far: { core: COL.legFarCore, ring: COL.legFar, width: 4.4 },
  },
  face: {
    w: 16,
    h: 12,
    animated: ['cackle', 'panic', 'fumble', 'glitch'],
    exprs: FACES,
  },

  // Chest: rounded warm-plum box with a glowing amber core.
  buildBody(g) {
    const P = PARAMS;
    g.roundRect(-P.bodyW / 2, -P.bodyH / 2, P.bodyW, P.bodyH, 5).fill(COL.chest);
    g.roundRect(-P.bodyW / 2 + 2.6, -P.bodyH / 2 + 1.3, P.bodyW - 5.2, 3.6, 2).fill(COL.chestHi);
    g.roundRect(-4.5, -1.6, 9, 5, 1.5).fill(COL.chestDark);
    g.circle(0, 1, 2.4).fill({ color: COL.ember, alpha: 0.3 });
    g.circle(0, 1, 1.4).fill(COL.ember);
  },

  // Monitor: rounded cherry shell with little ear nubs and a warm shine.
  buildHead(g) {
    const w = PARAMS.headW;
    const h = PARAMS.headH;
    g.roundRect(-w / 2 - 3, -6, 6, 12, 3).fill(COL.bezelShade); // left ear
    g.roundRect(w / 2 - 3, -6, 6, 12, 3).fill(COL.bezelShade); // right ear
    g.roundRect(-w / 2 + 1.8, -h / 2 + 2.4, w, h, 10).fill(COL.bezelShade); // body shade
    g.roundRect(-w / 2, -h / 2, w, h, 10).fill(COL.bezel);
    g.roundRect(-w / 2 + 6, -h / 2 + 2.6, w - 12, 3.6, 2).fill(COL.bezelHi); // top sheen
    g.roundRect(-w / 2 + 5.5, -h / 2 + 5.2, w - 11, h - 13.5, 7).fill(COL.screenFrame);
    g.roundRect(-w / 2 + 7.5, -h / 2 + 7.2, w - 15, h - 17.5, 5).fill(COL.screen);
    g.circle(-w / 2 + 10, h / 2 - 4.6, 3).fill({ color: COL.ember, alpha: 0.32 }); // glow
    g.circle(-w / 2 + 10, h / 2 - 4.6, 1.7).fill(COL.ember); // power light
    g.circle(w / 2 - 10, h / 2 - 4.6, 1.6).fill(COL.bezelDetail);
    g.circle(w / 2 - 15, h / 2 - 4.6, 1.6).fill(COL.bezelDetail);
    const sw = w - 15;
    const sh = h - 17.5;
    return { x: -sw / 2, y: -h / 2 + 7.2, w: sw, h: sh };
  },

  // Soft diagonal CRT shine over the screen.
  buildHeadGloss(g, box) {
    const { x: gx, y: gy, w: sw, h: sh } = box;
    g.poly([
      { x: gx + sw * 0.5, y: gy },
      { x: gx + sw * 0.68, y: gy },
      { x: gx + sw * 0.32, y: gy + sh },
      { x: gx + sw * 0.14, y: gy + sh },
    ]).fill({ color: 0xffffff, alpha: 0.06 });
  },
};
