// 06 — Data & interface. A brutalist acid-green dashboard: odometer counters
// for the reel's own specs, and the dot drawing the energy curve of the edit
// (one point per beat). Then the signal corrupts: RGB split, slice displacement
// and block noise tear the frame apart going into the final cut.
import {
  W, H, CX, CY, C, TAU, BEAT, Ease, Curve, tween, ramp, clamp, lerp, rgba, setFont, FONT, mulberry32, decay,
} from '../core.js';

// Chart geometry --------------------------------------------------------------
const X0 = 168, X1 = 1752, Y_BASE = 918, Y_RANGE = 410;
// "Energy" of the edit per beat (0–1): countdown, drop, and a climbing build.
const DATA = [
  0.08, 0.13, 0.18, 0.25, 0.58, 0.5, 0.62, 0.55, 0.64, 0.6, 0.71, 0.66, 0.52, 0.7, 0.66, 0.78,
  0.68, 0.8, 0.76, 0.88, 0.72, 0.8, 0.85, 0.79, 0.84, 0.9, 0.86, 0.95, 1.0, 0.94, 0.97, 0.93, 0.96,
];
const px = (i) => X0 + ((X1 - X0) * i) / (DATA.length - 1);
const py = (v) => Y_BASE - v * Y_RANGE;
export const DOT_START = { x: px(0), y: py(DATA[0]) };

// Catmull-Rom sampled curve.
const CURVE = [];
(() => {
  const P = DATA.map((v, i) => [px(i), py(v)]);
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let s = 0; s < 16; s++) {
      const t = s / 16, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      CURVE.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  CURVE.push(P[P.length - 1]);
})();

function curveAtX(x) {
  for (let i = 1; i < CURVE.length; i++) {
    if (CURVE[i][0] >= x) {
      const a = CURVE[i - 1], b = CURVE[i];
      const u = (x - a[0]) / (b[0] - a[0] || 1);
      return lerp(a[1], b[1], u);
    }
  }
  return CURVE[CURVE.length - 1][1];
}

// Counters -------------------------------------------------------------------
const STATS = [
  { v: 900, label: 'FRAMES RENDERED' },
  { v: 60, label: 'FRAMES PER SECOND' },
  { v: 128, label: 'BEATS PER MINUTE' },
  { v: 100, suffix: '%', label: 'WRITTEN IN CODE' },
];
const COL_W = (W - 192) / 4;
const NUM_SIZE = 168;

let buf, bctx, chan, cctx;

// Slot-machine reels: every digit spins a few full turns and lands exactly on
// its target, left to right.
function drawOdometer(ctx, x, y, target, bt, start, scramble, rnd) {
  setFont(ctx, NUM_SIZE, 850, FONT.sans, 'condensed');
  const cw = ctx.measureText('0').width;
  const asc = NUM_SIZE * 0.74;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const str = String(target);
  const digits = str.length;
  for (let col = 0; col < digits; col++) {
    const cx = x + col * cw + cw / 2;
    const d = Number(str[col]);
    const u = ramp(bt, start + col * 0.14, start + col * 0.14 + 1.15);
    let pos = (d + 10 * (2 + col)) * Ease.outExpo(u);
    if (scramble) pos = Math.floor(rnd() * 10);
    const d0 = Math.floor(pos), fr = pos - d0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - cw / 2 - 2, y - asc - 8, cw + 4, asc + 16);
    ctx.clip();
    const step = asc + 26;
    ctx.fillText(String(d0 % 10), cx, y - fr * step);
    ctx.fillText(String((d0 + 1) % 10), cx, y + (1 - fr) * step);
    ctx.restore();
  }
  return x + digits * cw;
}

function drawScene(ctx, bt, t, g, rnd) {
  ctx.fillStyle = C.acid;
  ctx.fillRect(0, 0, W, H);
  const ink = C.ink;

  // Grid + stat frame lines draw in.
  const lp = tween(bt, 24.0, 24.55, Ease.outExpo);
  ctx.fillStyle = ink;
  ctx.fillRect(96, 132, (W - 192) * lp, 2);
  ctx.fillRect(W - 96 - (W - 192) * lp, 418, (W - 192) * lp, 1.5);
  for (let k = 1; k < 4; k++) {
    const vp = tween(bt, 24.05 + k * 0.05, 24.5 + k * 0.05, Ease.outExpo);
    ctx.fillRect(96 + COL_W * k, 132, 1.5, 286 * vp);
  }

  // Counters.
  for (let k = 0; k < STATS.length; k++) {
    const s = STATS[k];
    const x = 96 + COL_W * k + 24;
    const appear = Curve.snap(ramp(bt, 24.05 + k * 0.1, 24.5 + k * 0.1));
    if (appear <= 0) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 10, 140, COL_W - 20, 270);
    ctx.clip();
    ctx.translate(0, (1 - appear) * 160);
    ctx.fillStyle = ink;
    setFont(ctx, 14, 600, FONT.mono);
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`0${k + 1}`, x, 156);
    ctx.letterSpacing = '0px';
    const scramble = g > 0.25 && rnd() < g;
    const endX = drawOdometer(ctx, x - 6, 352, s.v, bt, 24.1 + k * 0.12, scramble, rnd);
    if (s.suffix) {
      setFont(ctx, NUM_SIZE * 0.55, 850, FONT.sans, 'condensed');
      ctx.textAlign = 'left';
      ctx.fillText(s.suffix, endX + 4, 352 - NUM_SIZE * 0.3);
    }
    setFont(ctx, 15, 600, FONT.mono);
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lab = s.label.slice(0, Math.floor(s.label.length * ramp(bt, 24.3 + k * 0.1, 24.8 + k * 0.1)));
    ctx.fillText(lab, x, 396);
    ctx.restore();
  }

  // Chart grid.
  const gp = tween(bt, 24.1, 24.8, Ease.outExpo);
  setFont(ctx, 13, 600, FONT.mono);
  ctx.letterSpacing = '1px';
  for (const v of [0.25, 0.5, 0.75, 1.0]) {
    const y = py(v);
    ctx.fillStyle = rgba(ink, 0.22);
    ctx.fillRect(X0, y, (X1 - X0) * gp, 1);
    ctx.fillStyle = rgba(ink, gp);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(v * 100)), X1 + 18, y);
  }
  ctx.fillStyle = ink;
  ctx.fillRect(X0, Y_BASE, (X1 - X0) * gp, 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('ENERGY / BEAT', X0, py(1.0) - 14);
  for (let b = 0; b <= 32; b++) {
    const x = px(b);
    if (x > X0 + (X1 - X0) * gp) break;
    const major = b % 4 === 0;
    ctx.fillRect(x - 0.75, Y_BASE, 1.5, major ? 12 : 6);
    if (major) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`BAR ${String(b / 4 + 1).padStart(2, '0')}`, x, Y_BASE + 18);
    }
  }

  // The line, drawn by the dot.
  const u = Ease.inOutCubic(ramp(bt, 24.05, 26.85));
  const xl = lerp(X0, X1, u);
  const yl = curveAtX(xl);
  const pts = CURVE.filter((p) => p[0] <= xl);
  pts.push([xl, yl]);
  // hatched area
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(X0, Y_BASE);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.lineTo(xl, Y_BASE);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = rgba(ink, 0.45);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = X0 - 500; x < X1 + 20; x += 14) {
    ctx.moveTo(x, Y_BASE);
    ctx.lineTo(x + 420, Y_BASE - 420);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  // beat markers already passed
  for (let b = 0; b < DATA.length; b++) {
    const x = px(b);
    if (x > xl) break;
    ctx.fillStyle = ink;
    ctx.fillRect(x - 4, py(DATA[b]) - 4, 8, 8);
    ctx.fillStyle = C.acid;
    ctx.fillRect(x - 2, py(DATA[b]) - 2, 4, 4);
  }
  // crosshair + tooltip following the dot
  if (bt > 24.1) {
    ctx.strokeStyle = rgba(ink, 0.6);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(xl, yl);
    ctx.lineTo(xl, Y_BASE);
    ctx.moveTo(xl, yl);
    ctx.lineTo(X0, yl);
    ctx.stroke();
    ctx.setLineDash([]);
    const beatNo = Math.round((u * (DATA.length - 1)));
    const val = ((Y_BASE - yl) / Y_RANGE).toFixed(2);
    const label = `B${String(beatNo).padStart(2, '0')}  ·  ${val}`;
    setFont(ctx, 15, 700, FONT.mono);
    ctx.letterSpacing = '1px';
    const tw = ctx.measureText(label).width + 28;
    const bx = Math.min(xl + 26, X1 - tw + 60), by = yl - 74;
    ctx.fillStyle = ink;
    ctx.fillRect(bx, by, tw, 36);
    ctx.beginPath();
    ctx.moveTo(bx + 10, by + 36);
    ctx.lineTo(bx + 26, by + 36);
    ctx.lineTo(xl + 4, yl - 22);
    ctx.fill();
    ctx.fillStyle = C.acid;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 14, by + 19);
  }
  // the dot, with pings on every beat
  for (let b = 24; b < 28; b++) {
    const p = ramp(bt, b, b + 0.7);
    if (p > 0 && p < 1) {
      ctx.strokeStyle = rgba(C.ember, 1 - p);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(xl, yl, 22 + Ease.outExpo(p) * 70, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.fillStyle = C.ember;
  ctx.beginPath();
  ctx.arc(xl, yl, 22 * (1 + 0.18 * decay(bt % 1, 0, 9)), 0, TAU);
  ctx.fill();
}

// Glitch compositor ------------------------------------------------------------
function channel(src, color) {
  cctx.globalCompositeOperation = 'source-over';
  cctx.drawImage(src, 0, 0);
  cctx.globalCompositeOperation = 'multiply';
  cctx.fillStyle = color;
  cctx.fillRect(0, 0, W, H);
  cctx.globalCompositeOperation = 'source-over';
  return chan;
}

export default {
  from: 24.0,
  to: 28.0,
  init() {
    buf = document.createElement('canvas');
    buf.width = W; buf.height = H;
    bctx = buf.getContext('2d');
    chan = document.createElement('canvas');
    chan.width = W; chan.height = H;
    cctx = chan.getContext('2d');
  },
  draw(ctx, bt, t) {
    // glitch intensity: creeps in, then saturates right before the cut
    const g = Math.pow(ramp(bt, 27.0, 27.94), 1.6) + 0.35 * decay(bt, 27.0, 10) + 0.5 * decay(bt, 27.5, 12);
    const q = Math.floor(t * 30);
    const rnd = mulberry32(q * 9973 + 17);
    bctx.save();
    drawScene(bctx, bt, t, g, rnd);
    bctx.restore();
    if (g < 0.02) {
      ctx.drawImage(buf, 0, 0);
      return;
    }
    // RGB split
    const dx = (rnd() - 0.5) * 70 * g + 18 * g;
    const dy = (rnd() - 0.5) * 16 * g;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(channel(buf, '#ff0000'), dx, dy);
    ctx.drawImage(channel(buf, '#00ff00'), 0, 0);
    ctx.drawImage(channel(buf, '#0000ff'), -dx, -dy);
    ctx.globalCompositeOperation = 'source-over';
    // slice displacement
    const slices = Math.floor(3 + 16 * g);
    for (let i = 0; i < slices; i++) {
      const y = Math.floor(rnd() * H);
      const h = Math.floor(4 + rnd() * 90 * g);
      const sx = (rnd() - 0.5) * 420 * g;
      ctx.drawImage(buf, 0, y, W, h, sx, y, W, h);
    }
    // block noise
    const blocks = Math.floor(14 * g);
    const pal = [C.ink, C.ember, C.cobalt, C.paper, C.pink, C.acid];
    for (let i = 0; i < blocks; i++) {
      ctx.fillStyle = pal[Math.floor(rnd() * pal.length)];
      const w = 20 + rnd() * 260 * g, h = 8 + rnd() * 60;
      ctx.fillRect(Math.floor(rnd() * W / 8) * 8, Math.floor(rnd() * H / 8) * 8, w, h);
    }
    // scanlines
    ctx.fillStyle = rgba('#000000', 0.16 * g);
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1.5);
    // invert flashes
    if (rnd() < 0.22 * g) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
  },
};
