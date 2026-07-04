// Pixi render edge: draws a robot from the state Robot.update() produced.
// Everything character-specific (colors, body graphics, leg style, face
// dimensions) comes from the character definition; this file owns the
// generic machinery: layering, the ground shadow, the accordion legs, and
// the nearest-neighbor face blit.

import { Container, Graphics } from 'pixi.js';
import { clamp, qbez } from '../../core/math.js';

export class RobotRenderer {
  constructor(parent, character, opts = {}) {
    this.C = character;
    this.P = character.params;
    // A ground shadow only reads on a floor; on walls, undersides and mid-jump
    // it has no real ground to fall on. Consumers of a many-angle world can opt
    // out (`shadow: false`); the flagship floor look keeps it by default.
    this.shadow = opts.shadow !== false;
    this.pix = character.palette.pix; // face palette; may be tinted per accent
    this.paletteHold = 0; // seconds left on a temporary accent tint (0 = sticky)
    this.root = new Container();
    parent.addChild(this.root);

    // Per-leg secondary-motion state, keyed by the leg's index on the robot:
    // ring spread lags the core on stretch, the core bows against fast swings.
    this.legState = [0, 1, 2, 3].map(() => ({ spread: 0, whip: 0, fx: 0, fy: 0, init: false }));

    this.shadowG = new Graphics();
    this.legsFar = new Graphics();
    this.bodyC = new Container();
    this.legsNear = new Graphics();
    this.headC = new Container();

    const chestG = new Graphics();
    character.buildBody(chestG);
    this.bodyC.addChild(chestG);

    const headG = new Graphics();
    const faceBox = character.buildHead(headG);
    this.headC.addChild(headG);

    this.faceG = new Graphics();
    this.faceG.scale.set(faceBox.w / character.face.w, faceBox.h / character.face.h);
    this.faceG.position.set(faceBox.x, faceBox.y);
    this.headC.addChild(this.faceG);

    if (character.buildHeadGloss) {
      const glossG = new Graphics();
      character.buildHeadGloss(glossG, faceBox);
      this.headC.addChild(glossG);
    }

    this.root.addChild(this.shadowG, this.legsFar, this.bodyC, this.legsNear, this.headC);
  }

  // Override the face palette. hold > 0 auto-reverts to the character default
  // after that many seconds (a brief accent echo); hold 0 is sticky until the
  // caller resets it with setFacePalette(null). The caller marks R.face.dirty
  // so the recolor blits; the auto-revert in draw() does the same.
  setFacePalette(pix, hold = 0) {
    this.pix = pix || this.C.palette.pix;
    this.paletteHold = hold;
  }

  destroy() {
    if (this.root.parent) this.root.parent.removeChild(this.root);
    this.root.destroy({ children: true });
  }

  // Accordion legs: a stretchy inner core wrapped in hard rings. The rings
  // never deform; they just ride the core, sitting flush at rest, spreading
  // apart when the leg reaches, and stacking up when it compresses. The core
  // thins as it stretches, which sells the elastic. Two layers of secondary
  // motion: the ring stack (anchored at the boot) lags a beat behind a sudden
  // stretch before spreading, and the core bows against fast sideways swings.
  drawLegs(g, legs, style, dt) {
    const RINGS = this.C.legs.rings;
    const S = this.P.scale;
    const width = style.width;
    for (const l of legs) {
      const st = this.legState[l.i];
      const hx = l.hip.x;
      const hy = l.hip.y;
      let dx = l.foot.x - hx;
      let dy = l.foot.y - 2 - hy;
      let len = Math.hypot(dx, dy) || 0.001;
      const s = len / l.rest;
      // soft cap: past 3.5x rest length extra reach is heavily damped
      if (s > 3.5) {
        const k = (l.rest * (3.5 + (s - 3.5) * 0.25)) / len;
        dx *= k;
        dy *= k;
        len *= k;
      }
      const ux = dx / len;
      const uy = dy / len;

      if (!st.init) {
        st.init = true;
        st.spread = len;
        st.fx = l.foot.x;
        st.fy = l.foot.y;
      }
      // Compression snaps (the stack rides the boot down); stretch spreads
      // with a short lag, so reaches read as the accordion pulling open.
      st.spread += (len - st.spread) * (len < st.spread ? 1 : 1 - Math.exp(-dt * 14));
      if (dt > 0.0001) {
        const lv = ((l.foot.x - st.fx) * -uy + (l.foot.y - st.fy) * ux) / dt;
        st.whip += (clamp(lv * -0.004, -3, 3) * S - st.whip) * (1 - Math.exp(-dt * 12));
      }
      st.fx = l.foot.x;
      st.fy = l.foot.y;

      const cpx = hx + ux * len * 0.5 - uy * st.whip;
      const cpy = hy + uy * len * 0.5 + ux * st.whip;
      const ex = hx + ux * (len - 0.5);
      const ey = hy + uy * (len - 0.5);
      const px = (t) => qbez(hx, cpx, ex, t);
      const py = (t) => qbez(hy, cpy, ey, t);

      // Core thins only gently as it stretches: a steeper curve reads as
      // spindly legs mid-run.
      const coreW = width * 0.68 * clamp(Math.pow(1 / s, 0.3), 0.72, 1);
      g.moveTo(hx + ux, hy + uy)
        .quadraticCurveTo(cpx, cpy, ex, ey)
        .stroke({ width: coreW, color: style.core, cap: 'round' });

      const ringLen = l.rest / RINGS;
      // stretch biases the stack toward the boot: the bare core shows hip-side
      // (capped low, a long bare stretch of core reads too thin)
      const bias = clamp(st.spread / l.rest, 1, 1.25);
      for (let i = 0; i < RINGS; i++) {
        const c = len - Math.pow(1 - (i + 0.5) / RINGS, bias) * st.spread;
        const b = Math.min(c + ringLen / 2, len);
        const ta = clamp((b - ringLen) / len, 0, 1);
        const tb = clamp(b / len, 0, 1);
        // rings taper toward the foot, except the last one: a chunky little boot
        const rw = i === RINGS - 1 ? width : width * (1 - 0.07 * i);
        g.moveTo(px(ta), py(ta))
          .lineTo(px(tb), py(tb))
          .stroke({ width: rw, color: style.ring, cap: 'butt' });
      }
    }
  }

  draw(R, dt) {
    const P = this.P;

    // Live body presentation, read from state each frame so the appearance channel
    // can fade or tint the byster at runtime. null means the neutral default.
    this.root.alpha = R.alpha != null ? R.alpha : 1;
    this.root.tint = R.tint != null ? R.tint : 0xffffff;

    // Expire a temporary accent tint and force the face to re-blit in the
    // character's own palette.
    if (this.paletteHold > 0) {
      this.paletteHold -= dt;
      if (this.paletteHold <= 0) {
        this.pix = this.C.palette.pix;
        R.face.dirty = true;
      }
    }

    this.bodyC.position.set(R.x, R.bodyY);
    this.bodyC.rotation = R.rot;
    this.headC.position.set(R.headX, R.headY);
    this.headC.rotation = R.headRot;

    // Soft ground shadow, fading with altitude. Two sources: a surface-local
    // mover supplies contact + normal (so the shadow lies flat on a wall or an
    // underside), otherwise the classic top-surface path uses graph/segment.
    this.shadowG.clear();
    this.shadowG.position.set(0, 0);
    this.shadowG.rotation = 0;
    if (this.shadow && R.contact && R.normal) {
      const alt = Math.max(Math.hypot(R.x - R.contact.x, R.bodyY - R.contact.y) - P.standH, 0);
      const k = clamp(1 - alt / 170, 0, 1);
      if (k > 0.05) {
        this.shadowG.position.set(R.contact.x, R.contact.y);
        this.shadowG.rotation = Math.atan2(R.normal.x, -R.normal.y);
        this.shadowG
          .ellipse(0, 2, 27 * (0.55 + 0.45 * k), 4.4 * (0.6 + 0.4 * k))
          .fill({ color: 0x000000, alpha: 0.22 * k });
      }
    } else if (this.shadow && R.graph) {
      const surf = R.segment.y;
      const alt = Math.max(surf - R.bodyY - P.standH, 0);
      const k = clamp(1 - alt / 170, 0, 1);
      if (k > 0.05) {
        this.shadowG
          .ellipse(R.x, surf + 2, 27 * (0.55 + 0.45 * k), 4.4 * (0.6 + 0.4 * k))
          .fill({ color: 0x000000, alpha: 0.22 * k });
      }
    }

    this.legsFar.clear();
    this.legsNear.clear();
    this.drawLegs(this.legsFar, R.legs.filter((l) => !l.near), this.C.legs.far, dt);
    this.drawLegs(this.legsNear, R.legs.filter((l) => l.near), this.C.legs.near, dt);

    if (R.face.dirty) {
      this.faceG.clear();
      const buf = R.face.buf;
      const fw = R.face.w;
      const fh = R.face.h;
      for (let r = 0; r < fh; r++) {
        for (let c = 0; c < fw; c++) {
          const v = buf[r * fw + c];
          if (v) this.faceG.rect(c + 0.07, r + 0.07, 0.86, 0.86).fill(this.pix[v]);
        }
      }
      R.face.dirty = false;
    }
  }
}
