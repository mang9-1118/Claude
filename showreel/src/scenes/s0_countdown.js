// 00 — Countdown. A film-leader dial counts 3·2·1 on the beat, then the whole
// machine implodes into the ember dot that will travel through the reel.
import {
  W, H, CX, CY, C, TAU, Ease, tween, ramp, clamp, lerp, rgba, setFont, FONT, decay,
} from '../core.js';

const R = 290;             // sweep radius
const RING = 322;          // outer ring
const TICK_IN = 338, TICK_OUT = 352, TICK_MAJOR = 362;
const BADGE_R = 408;
const BADGE = 'MOTION DESIGN  •  SHOWREEL 2026  •  MADE ENTIRELY IN CODE  •  ';
const NUMS = ['3', '2', '1'];
const WEIGHTS = [260, 560, 900];

// Collapse of the dial during beat 3 (anticipation: swells, then implodes).
export function dialScale(bt) {
  return 1 - Ease.inBack(ramp(bt, 3.0, 3.78), 2.4);
}

// The ember dot (also used by the next scene to hand over the ball).
export const DOT_R = 22;

// One revolution per beat for the count, then a faster wind-up while collapsing.
function sweepAngle(bt) {
  if (bt < 3) {
    const u = bt % 1;
    return -Math.PI / 2 + TAU * (0.08 * u + 0.92 * Ease.inOutCubic(u));
  }
  const u = bt - 3;
  return -Math.PI / 2 + TAU * (u * u * 2.6);
}

export default {
  from: 0,
  to: 4.6,
  draw(ctx, bt) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, W, H);

    // Soft centre glow so the black has depth.
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, 900);
    g.addColorStop(0, 'rgba(40,40,52,0.55)');
    g.addColorStop(1, 'rgba(14,14,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const s = dialScale(bt);
    const twist = Ease.inCubic(ramp(bt, 3.0, 3.78)) * Math.PI * 0.9;

    // Crosshair hairlines — outside the dial, they retract as it collapses.
    const lineIn = tween(bt, 0.0, 0.7, Ease.outExpo);
    const lineOut = Ease.inCubic(ramp(bt, 2.9, 3.6));
    const L = 1100 * lineIn * (1 - lineOut);
    if (L > 1) {
      ctx.strokeStyle = rgba(C.paper, 0.13);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const g0 = BADGE_R + 34;
      ctx.moveTo(CX - g0, CY); ctx.lineTo(CX - g0 - L, CY);
      ctx.moveTo(CX + g0, CY); ctx.lineTo(CX + g0 + L, CY);
      ctx.moveTo(CX, CY - g0); ctx.lineTo(CX, CY - g0 - L);
      ctx.moveTo(CX, CY + g0); ctx.lineTo(CX, CY + g0 + L);
      ctx.stroke();
      // tiny registration marks along the lines
      ctx.fillStyle = rgba(C.paper, 0.35);
      for (let k = 1; k <= 6; k++) {
        const d = g0 + k * 80;
        if (d - g0 > L) break;
        ctx.fillRect(CX + d - 1, CY - 5, 2, 10);
        ctx.fillRect(CX - d - 1, CY - 5, 2, 10);
      }
    }

    if (s > 0.002) {
      ctx.save();
      ctx.translate(CX, CY);
      ctx.rotate(twist);
      ctx.scale(s, s);

      // Leader sweep: alternating tone sectors.
      const a = sweepAngle(bt);
      const k = Math.floor(Math.min(bt, 2.999));
      const toneA = '#121218', toneB = '#1D1D26';
      const drawIn = tween(bt, 0.0, 0.35, Ease.outExpo);
      ctx.beginPath();
      ctx.arc(0, 0, R * drawIn, 0, TAU);
      ctx.fillStyle = k % 2 === 0 ? toneA : toneB;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R * drawIn, -Math.PI / 2, a, false);
      ctx.closePath();
      ctx.fillStyle = k % 2 === 0 ? toneB : toneA;
      ctx.fill();

      // Radar trail behind the hand.
      const trail = 0.9;
      const cg = ctx.createConicGradient(a - trail, 0, 0);
      cg.addColorStop(0, rgba(C.ember, 0));
      cg.addColorStop(trail / TAU, rgba(C.ember, 0.28));
      cg.addColorStop(trail / TAU + 0.0001, rgba(C.ember, 0));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R * drawIn, a - trail, a);
      ctx.closePath();
      ctx.fillStyle = cg;
      ctx.fill();

      // Rings.
      const ringP = tween(bt, 0.05, 0.6, Ease.outExpo);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(C.paper, 0.38);
      ctx.beginPath();
      ctx.arc(0, 0, RING, -Math.PI / 2, -Math.PI / 2 + TAU * ringP);
      ctx.stroke();
      ctx.strokeStyle = rgba(C.paper, 0.16);
      ctx.beginPath();
      ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 - TAU * ringP, true);
      ctx.stroke();

      // Beat ping: a ring that radiates on every count.
      for (let b = 0; b < 3; b++) {
        const p = ramp(bt, b, b + 0.6);
        if (p > 0 && p < 1) {
          ctx.strokeStyle = rgba(C.ember, 0.55 * (1 - p));
          ctx.lineWidth = 3 * (1 - p) + 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, RING + Ease.outExpo(p) * 140, 0, TAU);
          ctx.stroke();
        }
      }

      // 60 ticks; ticks already swept glow.
      const sweptFrac = bt < 3 ? ((a + Math.PI / 2) % TAU + TAU) % TAU / TAU : 1;
      for (let i = 0; i < 60; i++) {
        const tp = tween(bt, 0.12 + i * 0.006, 0.42 + i * 0.006, Ease.outExpo);
        if (tp <= 0) continue;
        const major = i % 5 === 0;
        const ang = -Math.PI / 2 + (i / 60) * TAU;
        const r1 = TICK_IN, r2 = major ? TICK_MAJOR : TICK_OUT;
        const rr = lerp(r1, r2, tp);
        const lit = i / 60 <= sweptFrac;
        ctx.strokeStyle = rgba(C.paper, lit ? (major ? 0.95 : 0.7) : major ? 0.4 : 0.22);
        ctx.lineWidth = major ? 2.5 : 1.25;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
        ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        ctx.stroke();
      }

      // Rotating badge text.
      setFont(ctx, 14, 500, FONT.mono);
      ctx.letterSpacing = '0px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const rot = -Math.PI / 2 + bt * 0.12;
      const chars = BADGE.split('');
      const step = TAU / chars.length;
      for (let i = 0; i < chars.length; i++) {
        const cp = tween(bt, 0.2 + i * 0.008, 0.5 + i * 0.008);
        if (cp <= 0) continue;
        const ang = rot + i * step;
        ctx.save();
        ctx.rotate(ang);
        ctx.translate(BADGE_R, 0);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = rgba(C.paper, 0.55 * cp);
        ctx.fillText(chars[i], 0, 0);
        ctx.restore();
      }

      // Sweep hand.
      if (bt < 3.95) {
        ctx.strokeStyle = C.ember;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * (RING + 8) * drawIn, Math.sin(a) * (RING + 8) * drawIn);
        ctx.stroke();
        ctx.fillStyle = C.ember;
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }

    // Numerals 3 · 2 · 1 — each lands on its beat and inflates in weight.
    if (bt < 3) {
      const k = Math.floor(bt);
      const u = bt - k;
      const wt = lerp(110, WEIGHTS[k], Ease.outExpo(ramp(u, 0, 0.55)));
      const sc = lerp(1.28, 1, Ease.outExpo(ramp(u, 0, 0.42)));
      ctx.save();
      ctx.translate(CX, CY);
      ctx.scale(sc, sc);
      setFont(ctx, 400, wt, FONT.sans);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(NUMS[k]);
      const yOff = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      // echo outline
      const ep = ramp(u, 0, 0.55);
      if (ep < 1) {
        ctx.save();
        const es = 1 + Ease.outExpo(ep) * 0.55;
        ctx.scale(es, es);
        ctx.strokeStyle = rgba(C.paper, 0.4 * (1 - ep));
        ctx.lineWidth = 2 / es;
        ctx.strokeText(NUMS[k], 0, yOff);
        ctx.restore();
      }
      ctx.fillStyle = C.paper;
      ctx.fillText(NUMS[k], 0, yOff);
      ctx.restore();
    }

    // The dot is born from the implosion and coils up (anticipation).
    if (bt >= 3.45 && bt < 4) {
      const p = Ease.outBack(ramp(bt, 3.45, 3.72), 2.2);
      const sq = Ease.inQuad(ramp(bt, 3.72, 4.0));
      const flash = decay(bt, 3.62, 9);
      ctx.save();
      ctx.translate(CX, CY + DOT_R * 0.32 * sq);
      ctx.scale(1 + 0.38 * sq, 1 - 0.32 * sq);
      ctx.fillStyle = C.ember;
      ctx.beginPath();
      ctx.arc(0, 0, DOT_R * p, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (flash > 0.01) {
        const fg = ctx.createRadialGradient(CX, CY, 0, CX, CY, 260);
        fg.addColorStop(0, rgba(C.ember, 0.45 * flash));
        fg.addColorStop(1, rgba(C.ember, 0));
        ctx.fillStyle = fg;
        ctx.fillRect(CX - 260, CY - 260, 520, 520);
      }
    }
  },
};
