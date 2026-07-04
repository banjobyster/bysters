// The pixel face engine: a low-res buffer the renderer upscales
// nearest-neighbor onto the head screen for an LED-matrix look. Values:
// 0 off, 1 dim, 2 bright, 3 white-hot.
//
// WHAT the face shows comes from the character definition: def.exprs maps
// expression names to draw functions that paint the buffer through the
// helpers below (px, block, eye). Expressions listed in def.animated
// re-render every frame so they can animate off this.t; everything else
// only redraws when gaze, blink, or the expression changes.

import { clamp, randRange } from './math.js';

export class Face {
  constructor(def) {
    this.def = def;
    this.w = def.w;
    this.h = def.h;
    this.animated = new Set(def.animated || []);
    this.buf = new Uint8Array(this.w * this.h);
    this.expr = 'off';
    this.holdT = 0; // time left before reverting to idle (0 = sticky)
    this.blink = 0; // 0 open .. 1 closed
    this.blinkTimer = randRange(2, 5);
    this.blinkPhase = 0; // 0 idle, >0 animating
    this.gazeX = 0; // -1..1
    this.gazeY = 0;
    this.t = 0;
    this.dirty = true;
  }

  set(expr, hold = 0) {
    if (this.expr !== expr) this.dirty = true;
    this.expr = expr;
    this.holdT = hold;
  }

  update(dt, gazeX, gazeY) {
    this.t += dt;
    const gx = clamp(gazeX, -1, 1);
    const gy = clamp(gazeY, -1, 1);
    if (Math.abs(gx - this.gazeX) > 0.02 || Math.abs(gy - this.gazeY) > 0.02) this.dirty = true;
    this.gazeX = gx;
    this.gazeY = gy;

    if (this.holdT > 0) {
      this.holdT -= dt;
      if (this.holdT <= 0) this.set('idle');
    }

    // Blink cycle (only meaningful for open-eye expressions).
    const slow = this.expr === 'sleepy' ? 2.2 : 1;
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt / slow;
      const u = this.blinkPhase / 0.16;
      this.blink = u < 0.5 ? u * 2 : clamp(2 - u * 2, 0, 1);
      if (u >= 1) {
        this.blinkPhase = 0;
        this.blink = 0;
        this.blinkTimer = randRange(2, 5) * slow;
      }
      this.dirty = true;
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) this.blinkPhase = 0.0001;
    }

    if (this.animated.has(this.expr)) this.dirty = true; // animate every frame
    if (this.dirty) this.render();
  }

  px(c, r, v) {
    if (c < 0 || c >= this.w || r < 0 || r >= this.h) return;
    this.buf[r * this.w + c] = v;
  }

  block(c, r, w, h, v) {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) this.px(x, y, v);
  }

  eye(c, r, w, h, withPupil) {
    // Eyelid closes from the top.
    const visible = Math.round(h * (1 - this.blink));
    if (visible <= 0) {
      this.block(c, r + h - 1, w, 1, 1);
      return;
    }
    this.block(c, r + (h - visible), w, visible, 1);
    if (withPupil && visible >= 2) {
      const pc = c + Math.round((w - 2) / 2) + Math.round(this.gazeX);
      const pr = r + (h - visible) + Math.round((visible - 2) / 2) + Math.round(this.gazeY * 0.8);
      this.block(clamp(pc, c, c + w - 2), clamp(pr, r + (h - visible), r + h - 2), 2, 2, 2);
    }
  }

  render() {
    this.buf.fill(0);
    if (this.expr !== 'off') {
      const fn = this.def.exprs[this.expr] || this.def.exprs.idle;
      if (fn) fn(this);
    }
    this.dirty = true; // renderer clears this after drawing
  }
}
