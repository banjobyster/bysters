// Sarge (the police byster): a wide navy letterbox desk-sergeant CRT with a
// single brass beacon-stalk on the crown. Same family contract as the toddler
// and imp (monitor head + chest + four accordion legs), but shaped OPPOSITE to
// the toddler's tall tower: broad, low, and planted, with lightly chamfered
// corners so it reads as a stocky official set. The cool navy shell carries one
// warm note (a brass phosphor face + beacon) so it reads stern, never grim.
//
// It ships entirely inside the current renderer contract (no engine change):
// the "rotating beacon" read lives in the animated `alert` face (a hot bar that
// sweeps like a searchlight) plus a static frosted dome, and the slump-to-rest
// uses the existing sit/height seam. Per-byster launch caps are set on the
// instance (in the cast), not here.

const COL = {
  bezel: 0x3a4a63, // patrol navy-charcoal shell
  bezelHi: 0x51648a, // cool steel top sheen
  bezelShade: 0x27324a, // deep navy bottom-right shade
  bezelDetail: 0x1a2233, // near-black trim, vents, beacon stalk
  screenFrame: 0x161d2b,
  screen: 0x0a0e18,
  chest: 0x2f3c52, // dark-slate breastplate
  chestHi: 0x455876,
  chestDark: 0x141a24,
  brass: 0xd6a24a, // the warm heart under the stern shell (beacon, buttons)
  brassGlow: 0xffdf9a,
  beaconDome: 0x7a6a4a, // frosted dome over the bulb
  legNear: 0x8b97a8, // cool slate-blue rings
  legNearCore: 0x161b24,
  legFar: 0x5e687a,
  legFarCore: 0x0f131a,
  pix: [0, 0x6c86b0, 0xd6a24a, 0xfff0c8], // off, cool shadow, brass phosphor, hot gold
};

const PARAMS = {
  scale: 1.25, // authority-weight, between the imp (1.05) and the toddler (1.4)
  bodyW: 30, // the broadest chest in the cast: a barrel breastplate
  bodyH: 15,
  headW: 60, // wide letterbox, the opposite of the toddler's tall 70x56
  headH: 40,
  // Wide but kept inside the terrain-safe ~26px stander band so the verified
  // nav still holds (the heft is in head width + tuning, not the footprint).
  hipX: [12, 6, -6, -12],
  hipY: 8,
  footRestX: [15, 8, -8, -15],
  standH: 20, // low and planted
  stepThresholdBase: 11, // firm, clipped, deliberate strides
  walkSpeed: 210, // faster than the toddler (165), never the imp's top end
  wanderSpeed: 120,
  accel: 1300, // commits to a direction, hard to turn
  bodySpring: 175,
  bodyDamp: 22,
  rotSpring: 150,
  rotDamp: 24,
  leanGain: 0.0003,
  leanMax: 0.05,
  headMass: 0.6, // an authoritative head-bob and a forward pitch on hard stops
};

const FACES = {
  // On-duty watch: heavy-lidded stern eyes, gently down-angled brows, a firm
  // level mouth. Watchful, not angry. Eyes track via f.eye.
  idle(f) {
    f.block(3, 2, 3, 1, 1);
    f.block(10, 2, 3, 1, 1);
    f.eye(3, 4, 3, 3, true);
    f.eye(10, 4, 3, 3, true);
    f.block(6, 9, 4, 1, 1);
  },
  // Spotted the culprit: a hot searchlight bar sweeps the top row (the beacon
  // read), eyes snap wide with hot pupils locked on the culprit, mouth barks open.
  alert(f) {
    const sc = Math.round((Math.sin(f.t * 6) * 0.5 + 0.5) * (f.w - 3));
    f.block(sc, 0, 3, 1, 3);
    const gx = Math.round(f.gazeX);
    const gy = Math.round(f.gazeY * 0.8);
    for (const c of [2, 10]) {
      f.block(c, 3, 4, 4, 1);
      f.block(Math.min(Math.max(c + 1 + gx, c), c + 2), Math.min(Math.max(4 + gy, 3), 5), 2, 2, 3);
    }
    const open = Math.sin(f.t * 12) > 0 ? 1 : 0;
    f.block(6, 8, 4, 1 + open, 2);
    f.block(7, 8, 2, 1, 3);
  },
  // This ends now: hard slanted brows to center (steady, no jitter), narrowed
  // hot eyes, a gritted mouth.
  stern(f) {
    f.px(2, 3, 2);
    f.px(3, 3, 2);
    f.px(4, 4, 2);
    f.px(13, 3, 2);
    f.px(12, 3, 2);
    f.px(11, 4, 2);
    f.block(3, 5, 3, 2, 2);
    f.px(4, 5, 3);
    f.block(10, 5, 3, 2, 2);
    f.px(11, 5, 3);
    f.block(5, 9, 6, 1, 2);
  },
  // Out of puff (the rest face): sagging half-lids, a slow panting mouth, an
  // occasional heat-shimmer pixel. Sympathetic, a little comic.
  winded(f) {
    f.block(3, 5, 3, 1, 1);
    f.block(10, 5, 3, 1, 1);
    const pant = Math.sin(f.t * 3) > 0 ? 1 : 0;
    f.block(6, 8, 4, 1 + pant, 1);
    if (((f.t * 2) | 0) % 2) f.px(13, 7, 1);
  },
  // Dozing on the beat: gentle closed down-arc eyes, a tiny mouth. Off-duty soft.
  content(f) {
    f.block(3, 6, 3, 1, 1);
    f.px(3, 5, 1);
    f.px(5, 5, 1);
    f.block(10, 6, 3, 1, 1);
    f.px(10, 5, 1);
    f.px(12, 5, 1);
    f.px(7, 9, 1);
  },
  // Torn brass static (engine sets glitch on a failed plan / startle).
  glitch(f) {
    for (const c of [3, 10]) {
      for (let y = 0; y < 4; y++) {
        const s = ((Math.random() * 5) | 0) - 2;
        f.block(Math.min(Math.max(c + s, 0), f.w - 3), 3 + y, 3, 1, Math.random() < 0.7 ? 2 : 1);
      }
    }
    for (let i = 0; i < 10; i++) f.px((Math.random() * f.w) | 0, (Math.random() * f.h) | 0, ((Math.random() * 3) | 0) + 1);
  },
  // Aliases so behaviors that request generic engine faces read in character.
  angry(f) {
    FACES.stern(f);
  },
  curious(f) {
    FACES.alert(f);
  },
  happy(f) {
    FACES.content(f);
  },
  sleepy(f) {
    FACES.content(f);
  },
};

export const SARGE = {
  name: 'sarge',
  params: PARAMS,
  palette: COL,
  legs: {
    rings: 4,
    near: { core: COL.legNearCore, ring: COL.legNear, width: 5.6 }, // planted boot columns
    far: { core: COL.legFarCore, ring: COL.legFar, width: 5.0 },
  },
  face: {
    w: 16,
    h: 12,
    animated: ['alert', 'stern', 'winded', 'glitch'],
    exprs: FACES,
  },

  // Broad slate breastplate with a brass button row and a glowing brass power dot.
  buildBody(g) {
    const P = PARAMS;
    g.roundRect(-P.bodyW / 2, -P.bodyH / 2, P.bodyW, P.bodyH, 3).fill(COL.chest);
    g.roundRect(-P.bodyW / 2 + 3, -P.bodyH / 2 + 1.4, P.bodyW - 6, 3, 1.5).fill(COL.chestHi);
    g.roundRect(-5.5, -2, 11, 5.5, 1.5).fill(COL.chestDark); // recessed port slot
    for (const bx of [-9, -6.5, -4]) g.circle(bx, 4.2, 1).fill(COL.brass); // button row
    g.circle(9, 0.5, 3).fill({ color: COL.brass, alpha: 0.3 }); // power glow
    g.circle(9, 0.5, 1.5).fill(COL.brass);
  },

  // Wide chamfered letterbox bezel with vents, a lower speaker-grille, a high-set
  // small screen, and a baked crown beacon (stalk + frosted dome + brass bulb).
  buildHead(g) {
    const w = PARAMS.headW;
    const h = PARAMS.headH;
    g.roundRect(-w / 2 + 2, -h / 2 + 2.5, w, h, 4).fill(COL.bezelShade); // offset shade
    g.roundRect(-w / 2, -h / 2, w, h, 4).fill(COL.bezel);
    g.roundRect(-w / 2 + 6, -h / 2 + 2.6, w - 12, 3, 1.5).fill(COL.bezelHi); // top sheen
    g.roundRect(w / 2 - 15, -h / 2 + 5, 11, 1.2, 0.6).fill(COL.bezelDetail); // vents
    g.roundRect(w / 2 - 15, -h / 2 + 7.5, 11, 1.2, 0.6).fill(COL.bezelDetail);

    const sw = 36;
    const sh = 22;
    const sy = -h / 2 + 5; // screen set HIGH -> a tall lower bezel = low-browed read
    g.roundRect(-sw / 2 - 2.5, sy - 2, sw + 5, sh + 4, 4).fill(COL.screenFrame);
    g.roundRect(-sw / 2, sy, sw, sh, 3).fill(COL.screen);

    for (let i = 0; i < 7; i++) g.circle(-13 + i * 4.3, h / 2 - 5, 0.9).fill(COL.bezelDetail); // speaker grille

    // Crown beacon: stalk, glow halo, frosted dome, brass bulb.
    g.roundRect(-1.5, -h / 2 - 10, 3, 11, 1).fill(COL.bezelDetail);
    g.circle(0, -h / 2 - 12, 4.4).fill({ color: COL.brassGlow, alpha: 0.22 });
    g.roundRect(-4, -h / 2 - 15, 8, 5, 3).fill(COL.beaconDome);
    g.circle(0, -h / 2 - 12.5, 2.1).fill(COL.brass);

    return { x: -sw / 2, y: sy, w: sw, h: sh };
  },

  // One subtle diagonal shine across the glass.
  buildHeadGloss(g, box) {
    const { x: gx, y: gy, w: sw, h: sh } = box;
    g.poly([
      { x: gx + sw * 0.55, y: gy },
      { x: gx + sw * 0.72, y: gy },
      { x: gx + sw * 0.34, y: gy + sh },
      { x: gx + sw * 0.17, y: gy + sh },
    ]).fill({ color: 0xffffff, alpha: 0.06 });
  },
};
