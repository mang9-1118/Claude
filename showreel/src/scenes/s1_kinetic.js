// 01 — Kinetic type. "MAKE IT MOVE." The dot becomes a bouncing ball: every
// impact pumps a word from hairline to black (variable font weight), spawns an
// echo stack, and the ball finally lands as the full stop. Then we dive into it.
import {
  W, H, CX, CY, C, TAU, Ease, Curve, tween, ramp, clamp, lerp, rgba, setFont, FONT, decay,
} from '../core.js';
import { DOT_R } from './s0_countdown.js';

const SIZE = 205;
const BASE = 650;               // text baseline
const BALL_R = 34;
const CONTACT = 0.09;           // beats the ball stays on a surface (squash)
const WORDS = [
  { text: 'MAKE', on: 4.0, hit: 5.0, land: 3 },
  { text: 'IT', on: 4.08, hit: 6.0, land: 1 },
  { text: 'MOVE', on: 4.16, hit: 7.0, land: 3 },
];
const GAP = 64;                  // word spacing (at final weight)
const PERIOD_GAP = 18;

let layout = null;               // computed once fonts are ready
let capH = 0;

function measure(ctx) {
  const c = document.createElement('canvas').getContext('2d');
  setFont(c, SIZE, 900, FONT.sans);
  capH = c.measureText('H').actualBoundingBoxAscent;
  const widths = WORDS.map((w) => c.measureText(w.text).width);
  const total = widths.reduce((a, b) => a + b, 0) + GAP * (WORDS.length - 1) + PERIOD_GAP + BALL_R * 2;
  let x = (W - total) / 2;
  layout = WORDS.map((w, i) => {
    const cx = x + widths[i] / 2;
    x += widths[i] + GAP;
    return { cx, w: widths[i] };
  });
  const last = layout[layout.length - 1];
  layout.period = { x: last.cx + last.w / 2 + PERIOD_GAP + BALL_R, y: BASE - BALL_R };
}

// Per-letter weight for word i at beat bt.
function letterWeight(i, j, bt) {
  const w = WORDS[i];
  const d = Math.abs(j - (w.land === 'end' ? w.text.length - 1 : w.land)) * 0.05;
  const p = Ease.outExpo(ramp(bt, w.hit + d, w.hit + d + 0.32));
  // hairline weight breathes slightly before the hit
  const idle = 100 + 30 * (0.5 + 0.5 * Math.sin(bt * 5 + j * 0.9 + i));
  return lerp(idle, 900, p);
}

// Lay out a word with per-letter weights, keeping the word centre fixed.
function wordGlyphs(ctx, i, bt) {
  const w = WORDS[i];
  const chars = w.text.split('');
  const weights = chars.map((_, j) => letterWeight(i, j, bt));
  const adv = chars.map((ch, j) => {
    setFont(ctx, SIZE, weights[j], FONT.sans);
    return ctx.measureText(ch).width;
  });
  const total = adv.reduce((a, b) => a + b, 0);
  // the word grows from its right edge for the last word (towards the full stop)
  const isLast = i === WORDS.length - 1;
  let x = isLast ? layout[i].cx + layout[i].w / 2 - total : layout[i].cx - total / 2;
  return chars.map((ch, j) => {
    const g = { ch, x, w: adv[j], weight: weights[j] };
    x += adv[j];
    return g;
  });
}

// ---- Ball ------------------------------------------------------------------
function keys() {
  const top = BASE - capH - BALL_R;
  return [
    { bt: 4.0, x: CX, y: CY, h: 300 },
    { bt: 5.0, x: 0, y: top, h: 230, word: 0 },
    { bt: 6.0, x: 0, y: top, h: 250, word: 1 },
    { bt: 7.0, x: layout.period.x, y: layout.period.y },
  ];
}

// Horizontal landing x depends on the landing letter's live position.
function landX(ctx, i, bt) {
  const gl = wordGlyphs(ctx, i, bt);
  const g = gl[WORDS[i].land];
  return g.x + g.w / 2;
}

export function ballState(ctx, bt) {
  const K = keys();
  K[1].x = landX(ctx, 0, 5.0);
  K[2].x = landX(ctx, 1, 6.0);
  if (bt < 4.0) return { x: CX, y: CY, sx: 1, sy: 1, rot: 0, r: DOT_R };
  // grow from the S0 dot to the ball size on launch
  const r = lerp(DOT_R, BALL_R, Ease.outBack(ramp(bt, 4.0, 4.35)));
  for (let k = 0; k < K.length - 1; k++) {
    const a = K[k], b = K[k + 1];
    const t0 = a.bt + (k === 0 ? 0 : CONTACT);
    if (bt >= a.bt && bt < t0) {
      // contact: squash anchored at the bottom
      const e = Math.sin(Math.PI * ramp(bt, a.bt, t0));
      const sy = 1 - 0.42 * e, sx = 1 + 0.38 * e;
      return { x: a.x, y: a.y + r * (1 - sy), sx, sy, rot: 0, r };
    }
    if (bt >= t0 && bt < b.bt) {
      const u = (bt - t0) / (b.bt - t0);
      const Hh = a.h + Math.max(0, a.y - b.y) * 0.5;
      const x = lerp(a.x, b.x, u);
      const y = lerp(a.y, b.y, u) - 4 * Hh * u * (1 - u);
      const vx = b.x - a.x;
      const vy = b.y - a.y - 4 * Hh * (1 - 2 * u);
      const sp = Math.hypot(vx, vy) / (b.bt - t0);
      const st = clamp((sp - 500) / 2600, 0, 0.42);
      return { x, y, sx: 1 + st, sy: 1 / (1 + st * 0.8), rot: Math.atan2(vy, vx), r };
    }
  }
  // Final landing as the full stop + follow-through hops.
  const P = layout.period;
  const t = bt - 7.0;
  if (t < CONTACT) {
    const e = Math.sin(Math.PI * ramp(t, 0, CONTACT));
    const sy = 1 - 0.45 * e, sx = 1 + 0.4 * e;
    return { x: P.x, y: P.y + r * (1 - sy), sx, sy, rot: 0, r };
  }
  const hops = [[CONTACT, 0.36, 44], [0.36 + 0.05, 0.6, 12]];
  for (const [h0, h1, hh] of hops) {
    if (t >= h0 && t < h1) {
      const u = (t - h0) / (h1 - h0);
      return { x: P.x, y: P.y - 4 * hh * u * (1 - u), sx: 1, sy: 1, rot: 0, r };
    }
  }
  const settle = decay(t, 0.36, 30) * 0.18 + decay(t, 0.6, 30) * 0.08;
  return { x: P.x, y: P.y + r * settle, sx: 1 + settle, sy: 1 - settle, rot: 0, r };
}

function drawBall(ctx, s) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rot);
  ctx.scale(s.sx, s.sy);
  ctx.rotate(-s.rot * 0); // keep scale in velocity frame
  ctx.fillStyle = C.ember;
  ctx.beginPath();
  ctx.arc(0, 0, s.r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// After-Effects-style motion path: dotted arc + keyframe diamonds + handles.
function drawPath(ctx, bt) {
  const K = keys();
  K[1].x = landX(ctx, 0, 5.0);
  K[2].x = landX(ctx, 1, 6.0);
  for (let k = 0; k < K.length - 1; k++) {
    const a = K[k], b = K[k + 1];
    const show = tween(bt, a.bt - 0.55, a.bt - 0.1, Ease.outCubic);
    const hide = tween(bt, b.bt + 0.1, b.bt + 0.6);
    const alpha = show * (1 - hide);
    if (alpha <= 0.01) continue;
    const Hh = (a.h ?? 0) + Math.max(0, a.y - b.y) * 0.5;
    const pts = 64;
    ctx.fillStyle = rgba(C.ink, 0.38 * alpha);
    for (let i = 0; i <= pts; i++) {
      const u = i / pts;
      if (u > show) break;
      const x = lerp(a.x, b.x, u);
      const y = lerp(a.y, b.y, u) - 4 * Hh * u * (1 - u);
      ctx.beginPath();
      ctx.arc(x, y, i % 8 === 0 ? 3 : 1.6, 0, TAU);
      ctx.fill();
    }
    // keyframes + bezier handles
    ctx.strokeStyle = rgba(C.ink, 0.5 * alpha);
    ctx.lineWidth = 1.25;
    for (const p of [a, b]) {
      ctx.save();
      ctx.translate(p.x, p.y + BALL_R);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = rgba(C.ink, 0.85 * alpha);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(p.x - 46, p.y + BALL_R);
      ctx.lineTo(p.x + 46, p.y + BALL_R);
      ctx.stroke();
      for (const sx of [-46, 46]) {
        ctx.beginPath();
        ctx.arc(p.x + sx, p.y + BALL_R, 3.2, 0, TAU);
        ctx.stroke();
      }
    }
  }
}

const NOTES = [
  { at: 4.05, out: 4.85, text: 'ANTICIPATION', key: 0 },
  { at: 5.0, out: 5.85, text: 'SQUASH & STRETCH', key: 1 },
  { at: 6.0, out: 6.85, text: 'ARCS + TIMING', key: 2 },
  { at: 7.0, out: 7.5, text: 'FOLLOW-THROUGH', key: 3 },
];

function drawNotes(ctx, bt) {
  const K = keys();
  K[1].x = landX(ctx, 0, 5.0);
  K[2].x = landX(ctx, 1, 6.0);
  setFont(ctx, 15, 600, FONT.mono);
  ctx.letterSpacing = '2px';
  ctx.textBaseline = 'middle';
  for (const n of NOTES) {
    const p = ramp(bt, n.at, n.at + 0.3);
    const o = 1 - ramp(bt, n.out - 0.15, n.out);
    if (p <= 0 || o <= 0) continue;
    const k = K[n.key];
    const x0 = k.x, y0 = k.y - BALL_R - 14;
    const x1 = x0 + 70, y1 = y0 - 90;
    const lp = Ease.outExpo(p);
    ctx.strokeStyle = rgba(C.ink, 0.7 * o);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(lerp(x0, x1, lp), lerp(y0, y1, lp));
    if (lp > 0.98) ctx.lineTo(x1 + 18, y1);
    ctx.stroke();
    ctx.fillStyle = rgba(C.ink, o);
    ctx.textAlign = 'left';
    const str = n.text.slice(0, Math.floor(n.text.length * clamp(p * 1.4)));
    ctx.fillText(str, x1 + 26, y1);
  }
}

function drawGuides(ctx, bt) {
  const p = tween(bt, 4.0, 4.6, Ease.outExpo);
  // faint layout grid
  ctx.fillStyle = rgba(C.ink, 0.045);
  for (let x = 60; x < W; x += 60) {
    const h = H * tween(bt, 4.0 + (Math.abs(x - CX) / W) * 0.4, 4.6 + (Math.abs(x - CX) / W) * 0.4, Ease.outExpo);
    ctx.fillRect(x, CY - h / 2, 1, h);
  }
  for (let y = 60; y < H; y += 60) {
    const w = W * tween(bt, 4.0 + (Math.abs(y - CY) / H) * 0.4, 4.6 + (Math.abs(y - CY) / H) * 0.4, Ease.outExpo);
    ctx.fillRect(CX - w / 2, y, w, 1);
  }
  // type guides: baseline, cap height (with labels)
  const gw = W * p;
  ctx.fillStyle = rgba(C.cobalt, 0.55);
  ctx.fillRect(CX - gw / 2, BASE, gw, 1.5);
  ctx.fillRect(CX - gw / 2, BASE - capH, gw, 1);
  ctx.fillStyle = rgba(C.cobalt, 0.85 * p);
  setFont(ctx, 13, 600, FONT.mono);
  ctx.letterSpacing = '1px';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`CAP HEIGHT  ${Math.round(capH)}`, 96, BASE - capH - 6);
  ctx.textBaseline = 'top';
  ctx.fillText('BASELINE  0', 96, BASE + 10);
  ctx.textAlign = 'right';
  ctx.fillText('ARCHIVO VARIABLE  /  WGHT 100 → 900', W - 96, BASE + 10);
}

export default {
  from: 4.0,
  to: 8.0,
  init() {
    measure();
  },
  draw(ctx, bt) {
    const ball = ballState(ctx, bt);

    // Dive into the full stop (zoom-through to the next scene).
    const zu = ramp(bt, 7.45, 8.0);
    const P = layout.period;
    if (zu > 0) {
      const s = Math.exp(Math.log(80) * Ease.inQuart(zu));
      const qx = lerp(P.x, CX, Ease.inOutCubic(zu));
      const qy = lerp(P.y, CY, Ease.inOutCubic(zu));
      ctx.translate(qx, qy);
      ctx.scale(s, s);
      ctx.translate(-P.x, -P.y);
    }

    // Circle wipe from the dot (the drop).
    const wp = ramp(bt, 4.0, 4.5);
    const wr = lerp(DOT_R, 1250, Ease.outExpo(wp));
    ctx.save();
    if (wp < 1) {
      ctx.beginPath();
      ctx.arc(CX, CY, wr, 0, TAU);
      ctx.clip();
    }
    ctx.fillStyle = C.paper;
    ctx.fillRect(-W, -H, W * 3, H * 3);
    drawGuides(ctx, bt);

    // Words.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '0px';
    for (let i = 0; i < WORDS.length; i++) {
      const w = WORDS[i];
      const glyphs = wordGlyphs(ctx, i, bt);
      const hitT = bt - w.hit;

      // Echo stack below the word, sprung out by the impact.
      if (hitT > 0 && hitT < 1.2) {
        const spring = Math.exp(-hitT * 4.2) * Math.sin(Math.min(hitT * 9, Math.PI / 2 + hitT * 2));
        for (let e = 1; e <= 4; e++) {
          const off = spring * e * 120;
          if (off < 2) continue;
          ctx.strokeStyle = rgba(e % 2 ? C.ink : C.ember, 0.75 - e * 0.12);
          ctx.lineWidth = 1.6;
          for (let j = 0; j < glyphs.length; j++) {
            const g = glyphs[j];
            setFont(ctx, SIZE, g.weight, FONT.sans);
            ctx.strokeText(g.ch, g.x, BASE + off);
          }
        }
      }

      for (let j = 0; j < glyphs.length; j++) {
        const g = glyphs[j];
        // staggered rise from the baseline mask
        const rp = Curve.snap(ramp(bt, w.on + j * 0.045, w.on + j * 0.045 + 0.42));
        if (rp <= 0) continue;
        const dy = (1 - rp) * (capH + 40);
        // impact jiggle wave travelling across the letters
        const d = Math.abs(j - w.land) * 0.06;
        const jt = bt - (w.hit + d);
        let sy = 1;
        if (jt > 0) sy = 1 - 0.2 * Math.exp(-jt * 9) * Math.cos(jt * 26) * (j === w.land ? 1.3 : 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.x - 40, BASE - capH - 220, g.w + 80, capH + 220 + 2);
        ctx.clip();
        ctx.translate(g.x, BASE + dy);
        ctx.scale(1 / Math.sqrt(sy), sy);
        setFont(ctx, SIZE, g.weight, FONT.sans);
        ctx.fillStyle = C.ink;
        ctx.fillText(g.ch, 0, 0);
        ctx.restore();
      }
    }

    drawPath(ctx, bt);
    drawNotes(ctx, bt);
    ctx.restore();

    // Shockwave ring of the drop.
    if (wp > 0 && wp < 1) {
      ctx.strokeStyle = rgba(C.ember, 1 - wp);
      ctx.lineWidth = 18 * (1 - wp) + 1;
      ctx.beginPath();
      ctx.arc(CX, CY, wr * 1.06 + 10, 0, TAU);
      ctx.stroke();
    }

    drawBall(ctx, ball);
  },
};
