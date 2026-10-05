// Frame compositor: draws the world at N sub-frame times, accumulates them
// into a real shutter-based motion blur, then adds grain + the HUD on top.
import { W, H, FPS, BEAT, DURATION, FRAMES, clamp, mulberry32 } from './core.js';
import { drawHUD } from './hud.js';
import countdown from './scenes/s0_countdown.js';
import kinetic from './scenes/s1_kinetic.js';
import grid from './scenes/s2_grid.js';
import particles from './scenes/s3_particles.js';
import field from './scenes/s4_field.js';
import liquid from './scenes/s5_liquid.js';
import data from './scenes/s6_data.js';
import ident from './scenes/s7_ident.js';

export const SCENES = [countdown, kinetic, grid, particles, field, liquid, data, ident];

// Hard cuts (in beats). Shutter samples never straddle these, so cuts stay crisp.
const CUTS = [8, 16, 19.75, 24, 28].map((b) => b * BEAT);

const view = document.getElementById('view');
const vctx = view.getContext('2d', { willReadFrequently: true });
const work = document.createElement('canvas');
work.width = W;
work.height = H;
const wctx = work.getContext('2d', { willReadFrequently: true });

const N = W * H;
const acc0 = new Uint32Array(N); // R + B lanes (16 bit each)
const acc1 = new Uint32Array(N); // G + A lanes
const outImg = vctx.createImageData(W, H);
const out32 = new Uint32Array(outImg.data.buffer);

// Film grain: a tileable field of gaussian-ish noise, offset per frame.
const GS = 1024;
const grainTex = new Float32Array(GS * GS);
{
  const r = mulberry32(99);
  for (let i = 0; i < grainTex.length; i++) grainTex[i] = (r() + r() + r() - 1.5) * 1.15;
}

export function drawWorld(ctx, t) {
  const bt = t / BEAT;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  for (const s of SCENES) {
    if (bt >= s.from && bt < s.to) {
      ctx.save();
      s.draw(ctx, bt, t);
      ctx.restore();
    }
  }
}

function segment(t) {
  let a = 0, b = DURATION;
  for (const c of CUTS) {
    if (c <= t) a = c;
    else { b = c; break; }
  }
  return [a, b];
}

// The fastest moves (wipes, zoom-throughs, implosion, lens hit) need many more
// shutter samples, or the blur breaks into visible echoes.
const HEAVY = [
  [3.98, 4.35, 40],   // drop: circle wipe
  [7.5, 8.0, 32],     // dive into the full stop
  [8.0, 8.45, 40],    // pull out of the grid
  [15.55, 16.0, 24],  // particle implosion
  [19.35, 19.75, 24], // sphere hits the lens
];
function samplesAt(bt, base) {
  if (base <= 1) return base;
  for (const [a, b, n] of HEAVY) if (bt >= a && bt < b) return Math.max(base, n);
  return base;
}

export function renderFrame(frame, opts = {}) {
  const { samples = 8, shutter = 0.6, grain = 3.2 } = opts;
  const t = frame / FPS;
  const bt = t / BEAT;
  const S = Math.max(1, samplesAt(bt, samples));
  const [a, b] = segment(t);

  if (S === 1) {
    drawWorld(wctx, t);
    const d = new Uint32Array(wctx.getImageData(0, 0, W, H).data.buffer);
    acc0.fill(0); acc1.fill(0);
    for (let i = 0; i < N; i++) {
      const v = d[i];
      acc0[i] = v & 0xff00ff;
      acc1[i] = (v >>> 8) & 0xff00ff;
    }
  } else {
    acc0.fill(0); acc1.fill(0);
    for (let k = 0; k < S; k++) {
      let ts = (frame + shutter * ((k + 0.5) / S - 0.5)) / FPS;
      ts = clamp(ts, a, b - 1e-4);
      ts = clamp(ts, 0, DURATION - 1e-4);
      drawWorld(wctx, ts);
      const d = new Uint32Array(wctx.getImageData(0, 0, W, H).data.buffer);
      for (let i = 0; i < N; i++) {
        const v = d[i];
        acc0[i] += v & 0xff00ff;
        acc1[i] += (v >>> 8) & 0xff00ff;
      }
    }
  }

  // Resolve + grain.
  const inv = 1 / S;
  const rnd = mulberry32(frame * 7919 + 13);
  const ox = Math.floor(rnd() * GS), oy = Math.floor(rnd() * GS);
  const amp = grain;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const gRow = ((y + oy) & (GS - 1)) * GS;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      const a0 = acc0[i], a1 = acc1[i];
      const g = amp ? grainTex[gRow + ((x + ox) & (GS - 1))] * amp : 0;
      let r = (a0 & 0xffff) * inv + g;
      let gg = (a1 & 0xffff) * inv + g;
      let bb = (a0 >>> 16) * inv + g;
      r = r < 0 ? 0 : r > 255 ? 255 : (r + 0.5) | 0;
      gg = gg < 0 ? 0 : gg > 255 ? 255 : (gg + 0.5) | 0;
      bb = bb < 0 ? 0 : bb > 255 ? 255 : (bb + 0.5) | 0;
      out32[i] = 0xff000000 | (bb << 16) | (gg << 8) | r;
    }
  }
  vctx.putImageData(outImg, 0, 0);
  drawHUD(vctx, t, frame);
}

export async function init() {
  const faces = [
    new FontFace('Archivo', 'url(fonts/archivo-variable.woff2)', { weight: '100 900', stretch: '62% 125%' }),
    new FontFace('Instrument Serif', 'url(fonts/instrument-serif.woff2)', { weight: '400', style: 'normal' }),
    new FontFace('Instrument Serif', 'url(fonts/instrument-serif-italic.woff2)', { weight: '400', style: 'italic' }),
    new FontFace('JetBrains Mono', 'url(fonts/jetbrains-mono-variable.woff2)', { weight: '100 800' }),
  ];
  await Promise.all(faces.map((f) => f.load()));
  faces.forEach((f) => document.fonts.add(f));
  await document.fonts.ready;
  for (const s of SCENES) if (s.init) await s.init();
}

window.reel = {
  FRAMES, FPS, W, H,
  ready: init().then(() => true),
  renderFrame,
  toPNG: () => view.toDataURL('image/png'),
};
