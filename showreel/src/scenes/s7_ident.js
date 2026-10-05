// 07 — Ident. Hard cut to ink. The name rises in a hairline weight, the dot
// drops in as the full stop, and its impact pumps the wordmark to black —
// the same move as the opening type, closing the loop.
import {
  W, H, CX, CY, C, TAU, Ease, Curve, tween, ramp, clamp, lerp, rgba, setFont, FONT, decay,
} from '../core.js';

const NAME = 'CLAUDE';
const SIZE = 232;
const BASE = 590;
const DOT_R = 30;
const GAP = 22;
const LAND = 29.0;

let layout = null;

function measure() {
  const c = document.createElement('canvas').getContext('2d');
  setFont(c, SIZE, 900, FONT.sans, 'expanded');
  const w = c.measureText(NAME).width;
  const capH = c.measureText('H').actualBoundingBoxAscent;
  const total = w + GAP + DOT_R * 2;
  const x0 = CX - total / 2;
  layout = { x0, w, capH, dotX: x0 + w + GAP + DOT_R, dotY: BASE - DOT_R };
}

function weightOf(j, bt) {
  const d = (NAME.length - 1 - j) * 0.055;
  return lerp(100, 900, Ease.outExpo(ramp(bt, LAND + d, LAND + d + 0.36)));
}

function dotState(bt) {
  const { dotX, dotY } = layout;
  if (bt < 28.42) return null;
  if (bt < LAND) {
    const u = ramp(bt, 28.42, LAND);
    const y = lerp(-120, dotY, Ease.inQuad(u));
    const st = 1 + 0.35 * Ease.inQuad(u);
    return { x: dotX, y, sx: 1 / Math.sqrt(st), sy: st };
  }
  const t = bt - LAND;
  if (t < 0.1) {
    const e = Math.sin(Math.PI * (t / 0.1));
    const sy = 1 - 0.45 * e;
    return { x: dotX, y: dotY + DOT_R * (1 - sy), sx: 1 + 0.42 * e, sy };
  }
  if (t < 0.42) {
    const u = (t - 0.1) / 0.32;
    return { x: dotX, y: dotY - 46 * 4 * u * (1 - u), sx: 1, sy: 1 };
  }
  // settle, then breathe on the remaining beats
  const pulse = 0.14 * (decay(bt, 30, 7) + decay(bt, 31, 7)) + 0.12 * decay(bt, LAND + 0.42, 22);
  return { x: dotX, y: dotY + DOT_R * pulse * 0.5, sx: 1 + pulse, sy: 1 - pulse * 0.5 };
}

export default {
  from: 28.0,
  to: 32.01,
  init() {
    measure();
  },
  draw(ctx, bt) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, 1000);
    g.addColorStop(0, '#1B1B24');
    g.addColorStop(1, '#0A0A0D');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // slow push-in on the hold
    const s = 1 + 0.035 * tween(bt, 28.6, 32, Ease.inOutSine);
    ctx.translate(CX, CY);
    ctx.scale(s, s);
    ctx.translate(-CX, -CY);

    const { x0, capH, dotX } = layout;

    // faint baseline guide (callback to the type scene)
    const gl = tween(bt, 28.05, 28.7, Ease.outExpo) * (1 - tween(bt, 29.4, 30.0));
    if (gl > 0) {
      ctx.fillStyle = rgba(C.cobalt, 0.75 * gl);
      const gw = W * Ease.outExpo(ramp(bt, 28.05, 28.7));
      ctx.fillRect(CX - gw / 2, BASE + 1, gw, 1.5);
      ctx.fillRect(CX - gw / 2, BASE - capH, gw, 1);
    }

    // glow under the dot
    const ds = dotState(bt);
    if (ds) {
      const ga = 0.32 * ramp(bt, 28.9, 29.3);
      if (ga > 0) {
        const rg = ctx.createRadialGradient(dotX, BASE - DOT_R, 0, dotX, BASE - DOT_R, 340);
        rg.addColorStop(0, rgba(C.ember, ga));
        rg.addColorStop(1, rgba(C.ember, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(dotX - 340, BASE - DOT_R - 340, 680, 680);
      }
    }

    // the name
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '0px';
    const ws = NAME.split('').map((_, j) => weightOf(j, bt));
    const adv = NAME.split('').map((ch, j) => {
      setFont(ctx, SIZE, ws[j], FONT.sans, 'expanded');
      return ctx.measureText(ch).width;
    });
    let x = x0;
    for (let j = 0; j < NAME.length; j++) {
      const rp = Curve.snap(ramp(bt, 28.02 + j * 0.05, 28.02 + j * 0.05 + 0.5));
      const d = (NAME.length - 1 - j) * 0.055;
      const jt = bt - (LAND + d);
      const sy = jt > 0 ? 1 - 0.14 * Math.exp(-jt * 8) * Math.cos(jt * 24) : 1;
      if (rp > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 30, BASE - capH - 160, adv[j] + 60, capH + 162);
        ctx.clip();
        ctx.translate(x, BASE + (1 - rp) * (capH + 50));
        ctx.scale(1, sy);
        setFont(ctx, SIZE, ws[j], FONT.sans, 'expanded');
        ctx.fillStyle = C.paper;
        ctx.fillText(NAME[j], 0, 0);
        ctx.restore();
      }
      x += adv[j];
    }

    // the dot — the full stop
    if (ds) {
      ctx.save();
      ctx.translate(ds.x, ds.y);
      ctx.scale(ds.sx, ds.sy);
      ctx.fillStyle = C.ember;
      ctx.beginPath();
      ctx.arc(0, 0, DOT_R, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // hairline divider
    const dp = Ease.outExpo(ramp(bt, 29.1, 29.75));
    if (dp > 0) {
      ctx.fillStyle = rgba(C.paper, 0.35);
      ctx.fillRect(CX - 300 * dp, BASE + 58, 600 * dp, 1);
    }

    // subtitle
    const sp = ramp(bt, 29.12, 29.8);
    if (sp > 0) {
      const e = Ease.outExpo(sp);
      setFont(ctx, 86, 400, FONT.serif, 'normal', 'italic');
      ctx.letterSpacing = `${lerp(26, 1, e)}px`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = rgba(C.paper, 0.9 * clamp(sp * 2));
      ctx.fillText('Motion Designer', CX, BASE + 160 + (1 - e) * 26);
    }

    // mono credits line, typed on with a block cursor
    const tp = ramp(bt, 29.55, 30.5);
    if (tp > 0) {
      const str = 'SHOWREEL 2026   ·   15 SECONDS   ·   900 FRAMES   ·   128 BPM   ·   RENDERED ENTIRELY IN CODE';
      setFont(ctx, 15, 600, FONT.mono);
      ctx.letterSpacing = '3px';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const full = ctx.measureText(str).width;
      const shown = str.slice(0, Math.floor(str.length * tp));
      const lx = CX - full / 2;
      const y = H - 150;
      ctx.fillStyle = rgba(C.paper, 0.6);
      ctx.fillText(shown, lx, y);
      const cw = ctx.measureText(shown).width;
      const blink = tp < 1 || Math.floor(bt * 4) % 2 === 0;
      if (blink) {
        ctx.fillStyle = C.ember;
        ctx.fillRect(lx + cw + 4, y - 9, 10, 18);
      }
    }

    // cut-in flash
    const fl = decay(bt, 28.0, 16);
    if (fl > 0.01) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = rgba(C.paper, 0.85 * fl);
      ctx.fillRect(0, 0, W, H);
    }
  },
};
