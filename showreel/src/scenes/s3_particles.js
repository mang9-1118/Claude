// 03 — Particle systems. Each grid dot bursts into a swarm that rides a
// curl-noise flow field, then the swarm writes "flow" and is sucked back into
// a single point: the dot again. Trajectories are simulated once at init on a
// fixed timestep, so any frame can be sampled in any order.
import {
  W, H, CX, CY, C, TAU, BEAT, Ease, tween, ramp, clamp, lerp, rgba, setFont, FONT, hash, mulberry32,
  createNoise, decay,
} from '../core.js';
import { dotsAtEnd } from './s2_grid.js';

const PER_DOT = 240;
const B0 = 12.0, B_END = 15.3;          // simulated window (beats)
const DT = 1 / 240;
const T0 = B0 * BEAT;
const STEPS = Math.ceil(((B_END - B0) * BEAT) / DT);
export const END_R = 40;                 // radius of the reformed dot at the cut
// Additive blending on black wants brighter versions of the darker brand colours.
const BRIGHT = { [C.cobalt]: '#5B76FF', [C.violet]: '#9479FF', [C.ink]: C.paper };

let n = 0;
let pos;          // Float32Array [step][particle][x,y]
let tx, ty;       // text targets
let col;          // colour index per particle
let size;
let palette = [];
let groups = [];  // particle indices grouped by colour

function textTargets(count, rnd) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  setFont(c, 560, 400, FONT.serif, 'normal', 'italic');
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const m = c.measureText('flow');
  const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  const base = CY + (asc - desc) / 2 - 20;
  c.fillStyle = '#fff';
  c.fillText('flow', CX, base);
  const d = c.getImageData(0, 0, W, H).data;
  const px = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (d[(y * W + x) * 4 + 3] > 150) px.push(x, y);
  const outX = new Float32Array(count), outY = new Float32Array(count);
  const k = px.length / 2;
  for (let i = 0; i < count; i++) {
    const j = Math.floor(rnd() * k);
    outX[i] = px[j * 2] + rnd() - 0.5;
    outY[i] = px[j * 2 + 1] + rnd() - 0.5;
  }
  return [outX, outY];
}

function simulate() {
  const dots = dotsAtEnd();
  const rnd = mulberry32(31337);
  const nz = createNoise(4242);
  palette = [...new Set(dots.map((d) => d.color))];
  n = dots.length * PER_DOT;
  pos = new Float32Array((STEPS + 1) * n * 2);
  col = new Uint8Array(n);
  size = new Float32Array(n);
  const vx = new Float32Array(n), vy = new Float32Array(n);
  let p = 0;
  for (const d of dots) {
    for (let k = 0; k < PER_DOT; k++, p++) {
      const a = rnd() * TAU;
      const r = Math.sqrt(rnd()) * 7;
      pos[p * 2] = d.x + Math.cos(a) * r;
      pos[p * 2 + 1] = d.y + Math.sin(a) * r;
      const sp = 140 + 980 * Math.pow(rnd(), 2.2);
      const ba = rnd() * TAU;
      // bias the burst away from the centre so the swarm opens up
      const ox = d.x - CX, oy = d.y - CY, ol = Math.hypot(ox, oy) || 1;
      vx[p] = Math.cos(ba) * sp + (ox / ol) * 160;
      vy[p] = Math.sin(ba) * sp + (oy / ol) * 160;
      col[p] = palette.indexOf(d.color);
      size[p] = 1.7 + rnd() * 1.9;
    }
  }
  const FS = 0.0013, EPS = 0.02, U = 420, K = 2.8;
  for (let s = 1; s <= STEPS; s++) {
    const t = s * DT;
    const prev = (s - 1) * n * 2, cur = s * n * 2;
    const tz = t * 0.5;
    const vort = clamp((t - 0.12) / 0.5);
    for (let i = 0; i < n; i++) {
      const x = pos[prev + i * 2], y = pos[prev + i * 2 + 1];
      const nx = x * FS, ny = y * FS;
      const dpdy = (nz.n3(nx, ny + EPS, tz) - nz.n3(nx, ny - EPS, tz)) / (2 * EPS);
      const dpdx = (nz.n3(nx + EPS, ny, tz) - nz.n3(nx - EPS, ny, tz)) / (2 * EPS);
      // curl noise + a vortex that gathers the swarm towards the centre
      const rx = x - CX, ry = y - CY, rr = Math.hypot(rx, ry);
      const om = (2.6 / (1 + rr / 420)) * vort;
      const fx = dpdy * U - ry * om - rx * 0.42 * vort;
      const fy = -dpdx * U + rx * om - ry * 0.42 * vort;
      vx[i] += (fx - vx[i]) * K * DT;
      vy[i] += (fy - vy[i]) * K * DT;
      pos[cur + i * 2] = x + vx[i] * DT;
      pos[cur + i * 2 + 1] = y + vy[i] * DT;
    }
  }
  [tx, ty] = textTargets(n, rnd);
  groups = palette.map((_, ci) => {
    const idx = [];
    for (let i = 0; i < n; i++) if (col[i] === ci) idx.push(i);
    return idx;
  });
}

function simAt(i, t) {
  const f = clamp((t - T0) / DT, 0, STEPS - 1e-6);
  const s0 = Math.floor(f), fr = f - s0;
  const a = s0 * n * 2 + i * 2, b = a + n * 2;
  return [lerp(pos[a], pos[b], fr), lerp(pos[a + 1], pos[b + 1], fr)];
}

function particleAt(i, bt, t) {
  const h1 = hash(i * 3 + 1), h2 = hash(i * 7 + 5);
  let [x, y] = simAt(i, t);
  // converge on the word
  const s0 = 13.92 + 0.36 * h1;
  const cu = Ease.inOutCubic(ramp(bt, s0, s0 + 0.8));
  if (cu > 0) {
    const wob = 1.2 * Math.sin(bt * 9 + i);
    x = lerp(x, tx[i] + wob * (1 - cu * 0.7), cu);
    y = lerp(y, ty[i] + Math.cos(bt * 8 + i * 1.7) * 1.2 * (1 - cu * 0.7), cu);
  }
  // implode into the dot, spiralling
  const iu = ramp(bt, 15.48 + 0.14 * h2, 15.985);
  if (iu > 0) {
    const e = Ease.inExpo(iu);
    const th = 1.9 * e;
    const dx = x - CX, dy = y - CY;
    const c = Math.cos(th), sn = Math.sin(th);
    x = CX + (dx * c - dy * sn) * (1 - e);
    y = CY + (dx * sn + dy * c) * (1 - e);
  }
  return [x, y];
}

export default {
  from: 12.0,
  to: 16.0,
  init() {
    simulate();
  },
  draw(ctx, bt, t) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, 1100);
    g.addColorStop(0, '#191922');
    g.addColorStop(1, '#0B0B0E');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // light sweep across the formed word
    const sweep = lerp(-300, W + 300, Ease.inOutQuad(ramp(bt, 14.85, 15.45)));

    ctx.globalCompositeOperation = 'lighter';
    // Streak length (beats) follows the swarm's energy: long while flowing,
    // zero once the particles have settled into the word.
    const trail = 0.2 * (1 - Ease.inOutQuad(ramp(bt, 13.7, 14.05))) * ramp(bt, 12.02, 12.25) + 0.06 * ramp(bt, 15.6, 15.85);
    const settle = ramp(bt, 14.6, 15.0);
    const SEG = 5;
    ctx.lineCap = 'round';
    for (let ci = 0; ci < groups.length; ci++) {
      const idx = groups[ci];
      const colr = BRIGHT[palette[ci]] || palette[ci];
      if (trail > 0.002) {
        ctx.strokeStyle = rgba(colr, 0.55);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          const [x, y] = particleAt(i, bt, t);
          if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
          ctx.moveTo(x, y);
          for (let sgm = 1; sgm <= SEG; sgm++) {
            const b2 = bt - (trail * sgm) / SEG;
            const [px, py] = particleAt(i, b2, b2 * BEAT);
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }
      ctx.fillStyle = colr;
      ctx.beginPath();
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const [x, y] = particleAt(i, bt, t);
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
        const s = size[i] * (1 + 0.35 * settle);
        ctx.rect(x - s / 2, y - s / 2, s, s);
      }
      ctx.fill();
    }
    // sweep highlight: brighten particles near the sweep line
    if (bt > 14.85 && bt < 15.45) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const [x, y] = particleAt(i, bt, t);
        const d = Math.abs(x - sweep + (y - CY) * 0.35);
        if (d < 50) {
          const s = 2.4 * (1 - d / 50);
          ctx.rect(x - s / 2, y - s / 2, s, s);
        }
      }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // burst flash at the start
    const fl = decay(bt, 12.0, 14);
    if (fl > 0.01) {
      ctx.fillStyle = rgba(C.paper, 0.07 * fl);
      ctx.fillRect(0, 0, W, H);
    }

    // caption
    const cp = ramp(bt, 14.9, 15.3);
    const co = 1 - ramp(bt, 15.45, 15.6);
    if (cp > 0 && co > 0) {
      setFont(ctx, 15, 600, FONT.mono);
      ctx.letterSpacing = '3px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const str = '10,800 PARTICLES  ·  CURL-NOISE FIELD  ·  SEEDED SIM';
      ctx.fillStyle = rgba(C.paper, 0.75 * co);
      ctx.fillText(str.slice(0, Math.floor(str.length * cp)), CX, CY + 300);
    }

    // the dot re-forms from the implosion
    const dp = ramp(bt, 15.82, 16.0);
    if (dp > 0) {
      const glow = ctx.createRadialGradient(CX, CY, 0, CX, CY, 220);
      glow.addColorStop(0, rgba(C.ember, 0.55 * dp));
      glow.addColorStop(1, rgba(C.ember, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(CX - 220, CY - 220, 440, 440);
      ctx.fillStyle = C.ember;
      ctx.beginPath();
      ctx.arc(CX, CY, END_R * Ease.outBack(dp, 1.6), 0, TAU);
      ctx.fill();
    }
  },
};
