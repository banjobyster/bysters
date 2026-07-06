// The signed-off site character (SPEC 4.1): a Pixar CRT toddler. A big
// beige-gray monitor head with a green pixel face, a small blue chest, and
// four ring-armored accordion legs.
//
// This file is everything that makes THIS robot look like itself; the engine
// under src/robot/engine/ is character-agnostic. A character definition is:
//   name       - id string
//   params     - body proportions and motion tuning (P). P.scale multiplies
//                every authored pixel offset in gait/maneuvers. It never
//                touches the NAV terrain constants, which are absolute px.
//   palette    - colors, including pix: the 4-level face palette
//                [off, dim, main, hot] the renderer can override per accent.
//   legs       - accordion leg style per depth layer: { rings, near, far },
//                each layer { core, ring, width }.
//   face       - { w, h, animated: [expr...], exprs: { name(f) } }. Each
//                expression draws into the low-res buffer through the Face
//                instance helpers (f.px, f.block, f.eye) and can animate off
//                f.t when listed in animated (re-rendered every frame).
//   buildBody(container)            - draw the chest.
//   buildHead(container) -> faceBox - draw the head, return where the face
//                buffer maps in head-local coords ({ x, y, w, h }).
//   buildHeadGloss?(container, faceBox) - drawn over the face (CRT glass).

const COL = {
  bezel: 0xd3d7dc,
  bezelShade: 0xa8aeb7,
  bezelDetail: 0x8f969f,
  screenFrame: 0x394049,
  screen: 0x0b100d,
  blue: 0x5b9fe3,
  blueHi: 0x7ab5ee,
  blueDark: 0x2f5d8f,
  legNear: 0xc6cbd2,
  legNearCore: 0x2a2e33,
  legFar: 0x878e97,
  legFarCore: 0x1d2126,
  orange: 0xf08c3c,
  pix: [0, 0x3f8f55, 0x7de88a, 0xe2ffe4],
};

const PARAMS = {
  scale: 1.4, // multiplier for the authored motion offsets in gait/maneuvers
  bodyW: 26, // chest
  bodyH: 16,
  headW: 70, // the monitor: bigger and top-heavy, so it reads as the larger bot
  headH: 56,
  // Stance geometry (hipX/footRestX/standH) is the terrain-critical part and is
  // deliberately unchanged: the hero stays a ~26px-wide stander so the verified
  // level design (SPEC 4.2c) still holds. The heft comes from head size, slower
  // tuning, softer springs, and head inertia, not a wider footprint.
  hipX: [10, 5.5, -5.5, -10],
  hipY: 7,
  footRestX: [13, 7, -7, -13],
  standH: 22,
  stepThresholdBase: 14, // longer, more deliberate strides
  walkSpeed: 165, // slower than the imp (250+): a heavier walker
  wanderSpeed: 95,
  accel: 720, // ponderous to start and stop
  // Heft: softer body/rot springs settle with more weight; a strong head mass
  // makes the big monitor lag back on starts and pitch forward on hard stops.
  bodySpring: 165,
  bodyDamp: 21,
  rotSpring: 140,
  rotDamp: 23,
  leanGain: 0.00034,
  leanMax: 0.052,
  headMass: 1.15,
};

const FACES = {
  idle(f) {
    f.eye(3, 3, 3, 4, true);
    f.eye(10, 3, 3, 4, true);
    f.block(7, 9, 2, 1, 1); // small resting mouth
  },
  curious(f) {
    // One eye wide, the other squinting, a raised brow pixel row; the
    // squint's pupil slides along the lid to follow the gaze.
    f.eye(2, 2, 4, 5, true);
    f.block(10, 5, 3, 2, 1);
    f.px(Math.min(Math.max(11 + Math.round(f.gazeX), 10), 12), 6, 2);
    f.block(10, 2, 3, 1, 1);
  },
  happy(f) {
    // Chevron eyes and a small smile.
    for (const c of [3, 10]) {
      f.px(c, 5, 2);
      f.px(c + 1, 4, 2);
      f.px(c + 2, 4, 2);
      f.px(c + 3, 5, 2);
    }
    f.px(5, 8, 2);
    f.block(6, 9, 4, 1, 2);
    f.px(10, 8, 2);
  },
  sync(f) {
    // Scanning bar sweeping across while data loads.
    const c = Math.round((Math.sin(f.t * 5) * 0.5 + 0.5) * (f.w - 3));
    f.block(c, 4, 3, 4, 2);
    f.px(c + 1, 5, 3);
  },
  glitch(f) {
    // Torn eyes plus flickering static.
    for (const [c, r] of [
      [3, 3],
      [10, 3],
    ]) {
      for (let y = 0; y < 4; y++) {
        const shift = ((Math.random() * 5) | 0) - 2;
        f.block(Math.min(Math.max(c + shift, 0), f.w - 3), r + y, 3, 1, Math.random() < 0.7 ? 2 : 1);
      }
    }
    for (let i = 0; i < 14; i++) {
      f.px((Math.random() * f.w) | 0, (Math.random() * f.h) | 0, ((Math.random() * 3) | 0) + 1);
    }
  },
  sleepy(f) {
    f.block(3, 5, 3, 2, 1);
    f.block(10, 5, 3, 2, 1);
  },
  eager(f) {
    // The chase face: big saucer eyes with pupils locked on the gaze, an
    // open delighted grin. Shown while sprinting after the cursor.
    f.eye(2, 2, 4, 5, true);
    f.eye(10, 2, 4, 5, true);
    f.block(6, 8, 4, 2, 2);
    f.block(7, 9, 2, 1, 3);
  },
  love(f) {
    // The swoon: bobbing heart eyes and a little open smile, for when the
    // cursor is close enough to sidle right up to.
    const b = Math.sin(f.t * 6) > 0 ? 1 : 0;
    for (const c of [3, 10]) {
      const r = 3 - b;
      f.px(c, r, 3);
      f.px(c + 2, r, 3);
      f.block(c, r + 1, 3, 1, 3);
      f.px(c + 1, r + 2, 3);
    }
    f.px(5, 8, 2);
    f.block(6, 9, 4, 1, 2);
    f.px(10, 8, 2);
  },
  surprise(f) {
    // Caught off guard: huge whites with pinpoint pupils on the gaze, a
    // small o mouth.
    const gx = Math.round(f.gazeX);
    const gy = Math.round(f.gazeY * 0.8);
    for (const c of [2, 10]) {
      f.block(c, 2, 4, 4, 1);
      f.px(Math.min(Math.max(c + 1 + gx, c), c + 3), Math.min(Math.max(3 + gy, 2), 5), 3);
    }
    f.block(7, 8, 2, 2, 2);
  },
  puff(f) {
    // Winded after a chase: flat closed lids, a panting mouth, a sweat drop
    // sliding down the bezel.
    f.block(3, 4, 3, 1, 1);
    f.block(10, 4, 3, 1, 1);
    const pant = Math.sin(f.t * 3.2) > 0 ? 1 : 0;
    f.block(6, 8, 4, 1 + pant, 1);
    const drop = ((f.t * 5) | 0) % 4;
    f.px(14, 1 + drop, 3);
  },
  excited(f) {
    // Bouncing chevron eyes, an open grin, twinkling corner sparkles.
    const b = Math.sin(f.t * 10) > 0 ? 1 : 0;
    for (const c of [3, 10]) {
      f.px(c, 5 - b, 2);
      f.px(c + 1, 4 - b, 3);
      f.px(c + 2, 4 - b, 3);
      f.px(c + 3, 5 - b, 2);
    }
    f.block(6, 8, 4, 2, 2);
    f.block(7, 8, 2, 1, 3);
    const tw = ((f.t * 6) | 0) % 2;
    f.px(1, 2, tw ? 3 : 1);
    f.px(14, 6, tw ? 1 : 3);
    f.px(13, 1, tw ? 2 : 1);
  },
  dizzy(f) {
    // Counter-rotating pupils orbiting dim eye plates, a wobbling mouth.
    const ORBIT = [
      [1, 0],
      [2, 1],
      [1, 2],
      [0, 1],
    ];
    const k = (f.t * 8) | 0;
    for (const [c, off] of [
      [3, 0],
      [10, 2],
    ]) {
      f.block(c, 3, 3, 4, 1);
      const [ox, oy] = ORBIT[(k + off) % 4];
      f.px(c + ox, 3 + oy + 1, 3);
    }
    for (let x = 5; x <= 10; x++) f.px(x, 9 + ((x + k) % 2), 1);
  },
  angry(f) {
    // Brows slanted hard toward the center, narrowed hot eyes, gritted
    // mouth; the brows tremble sideways like it is fuming.
    const j = ((f.t * 14) | 0) % 2;
    for (const [bx, dir] of [
      [2, 1],
      [13, -1],
    ]) {
      f.px(bx + j * dir, 2, 2);
      f.px(bx + dir + j * dir, 2, 2);
      f.px(bx + dir * 2 + j * dir, 3, 2);
      f.px(bx + dir * 3 + j * dir, 3, 2);
    }
    f.block(3, 5, 3, 2, 2);
    f.px(4, 5, 3);
    f.block(10, 5, 3, 2, 2);
    f.px(11, 5, 3);
    for (let x = 5; x <= 10; x++) f.px(x, 9, x % 2 ? 2 : 1);
  },
  suspicious(f) {
    // Flat-lidded eyes, both pupils pinned on the gaze, so the once-over
    // literally follows whatever it is sizing up.
    const sl = Math.round(f.gazeX * 1.6);
    for (const c of [3, 10]) {
      f.block(c, 4, 3, 2, 1);
      f.px(Math.min(Math.max(c + 1 + sl, c), c + 2), 5, 3);
    }
    f.block(6, 9, 3, 1, 1);
  },
  wink(f) {
    // One eye open and tracking, the other a closed happy arc, plus the
    // full smile. Used as a wave flourish.
    f.eye(3, 3, 3, 4, true);
    f.px(9, 4, 1);
    f.block(10, 5, 3, 1, 2);
    f.px(13, 4, 1);
    f.px(5, 8, 2);
    f.block(6, 9, 4, 1, 2);
    f.px(10, 8, 2);
  },
  portrait(f) {
    // A tiny pixel portrait of Sayan: hair, face, bright eyes, a smile,
    // shoulders. Static; shown once while sitting beside the About text.
    f.block(5, 1, 6, 1, 2); // hair top
    f.block(4, 2, 8, 1, 2); // hair
    for (const r of [3, 4, 5]) {
      f.px(4, r, 2); // hair sides
      f.px(11, r, 2);
      f.block(5, r, 6, 1, 1); // face
    }
    f.px(6, 5, 3); // eyes
    f.px(9, 5, 3);
    f.block(5, 6, 6, 1, 1);
    f.block(5, 7, 6, 1, 1);
    f.block(6, 7, 4, 1, 2); // smile
    f.block(6, 8, 4, 1, 1); // chin
    f.block(7, 9, 2, 1, 1); // neck
    f.block(3, 10, 10, 2, 2); // shoulders
  },
};

export const CRT_TODDLER = {
  name: 'crt-toddler',
  params: PARAMS,
  palette: COL,
  legs: {
    rings: 4,
    near: { core: COL.legNearCore, ring: COL.legNear, width: 5.4 },
    far: { core: COL.legFarCore, ring: COL.legFar, width: 4.8 },
  },
  face: {
    w: 16,
    h: 12,
    animated: ['glitch', 'sync', 'dizzy', 'excited', 'angry', 'suspicious', 'love', 'puff'],
    exprs: FACES,
  },

  // Chest: small blue box with a highlight and a port slot.
  buildBody(g) {
    const P = PARAMS;
    g.roundRect(-P.bodyW / 2, -P.bodyH / 2, P.bodyW, P.bodyH, 5).fill(COL.blue);
    g.roundRect(-P.bodyW / 2 + 2.8, -P.bodyH / 2 + 1.4, P.bodyW - 5.6, 4.2, 2).fill(COL.blueHi);
    g.roundRect(-5, -1.5, 10, 5.5, 1.5).fill(COL.blueDark);
  },

  // Monitor: bezel with bottom-right shading, recessed screen, detail bits.
  buildHead(g) {
    const w = PARAMS.headW;
    const h = PARAMS.headH;
    g.roundRect(-w / 2 + 1.7, -h / 2 + 2.5, w, h, 10).fill(COL.bezelShade);
    g.roundRect(-w / 2, -h / 2, w, h, 10).fill(COL.bezel);
    g.roundRect(-w / 2 - 4, -8.5, 6.5, 17, 2).fill(COL.bezelShade); // side unit
    g.roundRect(-w / 2 + 5.5, -h / 2 + 4.2, w - 11, h - 13.5, 7).fill(COL.screenFrame);
    g.roundRect(-w / 2 + 7.5, -h / 2 + 6.2, w - 15, h - 17.5, 5).fill(COL.screen);
    // control strip under the screen
    g.circle(w / 2 - 10, h / 2 - 4.6, 1.8).fill(COL.bezelDetail);
    g.circle(w / 2 - 16, h / 2 - 4.6, 1.8).fill(COL.bezelDetail);
    g.circle(-w / 2 + 10, h / 2 - 4.6, 3).fill({ color: COL.orange, alpha: 0.3 }); // glow
    g.circle(-w / 2 + 10, h / 2 - 4.6, 1.7).fill(COL.orange); // power light
    const sw = w - 15;
    const sh = h - 17.5;
    return { x: -sw / 2, y: -h / 2 + 6.2, w: sw, h: sh };
  },

  // Glossy CRT glass: two diagonal shines over the screen.
  buildHeadGloss(g, box) {
    const { x: gx, y: gy, w: sw, h: sh } = box;
    g.poly([
      { x: gx + sw * 0.52, y: gy },
      { x: gx + sw * 0.72, y: gy },
      { x: gx + sw * 0.34, y: gy + sh },
      { x: gx + sw * 0.14, y: gy + sh },
    ]).fill({ color: 0xffffff, alpha: 0.07 });
    g.poly([
      { x: gx + sw * 0.8, y: gy },
      { x: gx + sw * 0.87, y: gy },
      { x: gx + sw * 0.62, y: gy + sh },
      { x: gx + sw * 0.55, y: gy + sh },
    ]).fill({ color: 0xffffff, alpha: 0.05 });
  },
};
