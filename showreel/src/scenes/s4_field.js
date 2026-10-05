// 04 — Procedural 3D. A cloner field of extruded bars (MoGraph-style), rendered
// with a hand-rolled perspective camera + painter's algorithm. The dot is now a
// sphere: the camera tracks it down, every bounce sends a damped ripple through
// the field, and the last bounce launches it at the lens.
import {
  W, H, CX, CY, C, TAU, BEAT, Ease, tween, ramp, clamp, lerp, rgb, mixHex, smoothstep, noise, decay,
} from '../core.js';
import { END_R } from './s3_particles.js';

const N = 11;              // grid half-extent (23 x 23 bars)
const A = 0.41;            // bar half width
const BASE_H = 0.22;
const R_S = 0.62;          // sphere radius
const FOV = (30 * Math.PI) / 180;
const F = H / 2 / Math.tan(FOV / 2);
const LIGHT = norm([-0.45, 0.85, 0.32]);
const BG_TOP = '#3B57FF', BG_BOT = '#1E33CF';
const GROUND = '#1A2499';

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Impacts: beat, grid position, amplitude.
const IMPACTS = [
  { bt: 17.0, x: -3, z: 2, amp: 1.55 },
  { bt: 18.0, x: 3, z: -1, amp: 1.75 },
  { bt: 19.0, x: 0, z: 1, amp: 2.1 },
];
const START = [0, 6.2, 0];
export const LENS_HIT = 19.75;  // the sphere fills the frame; liquid scene takes over

// Each impact: a dent under the ball + a shockwave ring (with a trailing
// trough) expanding through the field.
function ripple(x, z, t) {
  let h = 0;
  const c = 7.2, w = 0.85;
  for (const im of IMPACTS) {
    const tau = t - im.bt * BEAT;
    if (tau <= 0) continue;
    const r = Math.hypot(x - im.x, z - im.z);
    const g1 = Math.exp(-((r - c * tau) ** 2) / (2 * w * w));
    const g2 = Math.exp(-((r - c * (tau - 0.16)) ** 2) / (2 * w * w));
    const on = 1 - Math.exp(-tau * 30);
    const ring = im.amp * Math.exp(-tau * 1.15) * (g1 - 0.55 * g2) * on;
    const dent = -0.75 * im.amp * Math.exp(-(r * r) / 2) * Math.exp(-tau * 7) * on;
    h += ring + dent;
  }
  return h;
}

export function barHeight(x, z, bt, t) {
  const r = Math.hypot(x, z);
  const build = Ease.outBack(ramp(bt, 16.0 + r * 0.035, 16.45 + r * 0.035), 2.2);
  // effector stack: a travelling diagonal sine + slow noise
  const idle = 0.34 * (0.5 + 0.5 * Math.sin(0.5 * (x + z) - 3.4 * t)) +
    0.22 * (noise.n3(x * 0.16, z * 0.16, t * 0.35) * 0.5 + 0.5);
  return Math.max(0.03, (BASE_H + idle) * build + ripple(x, z, t) * build);
}

// ---- camera ---------------------------------------------------------------
function camera(bt, t) {
  const down = Ease.inOutCubic(ramp(bt, 16.0, 16.95));
  const target = [
    lerp(START[0], 0.3, down),
    lerp(START[1], 0.5, down) + 0.5 * tween(bt, 17.0, 18.5, Ease.inOutSine),
    lerp(START[2], 0.4, down),
  ];
  // impact shake
  let sx = 0, sy = 0;
  for (const im of IMPACTS) {
    const k = decay(bt, im.bt, 7) * 0.05 * im.amp;
    const tau = bt - im.bt;
    sx += k * Math.sin(tau * 61);
    sy += k * Math.cos(tau * 47);
  }
  target[0] += sx; target[1] += sy;
  const dist = lerp(28, 16.8, Ease.inOutCubic(ramp(bt, 16.0, 17.1))) - 1.8 * tween(bt, 17.1, 20.0, Ease.inOutQuad);
  const az = 0.62 + 0.62 * tween(bt, 16.0, 20.0, Ease.inOutSine);
  const el = lerp(0.42, 0.74, down);
  const pos = [
    target[0] + dist * Math.cos(el) * Math.sin(az),
    target[1] + dist * Math.sin(el),
    target[2] + dist * Math.cos(el) * Math.cos(az),
  ];
  const fwd = norm(sub(target, pos));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { pos, fwd, right, up };
}

function project(cam, p) {
  const d = sub(p, cam.pos);
  const z = dot(d, cam.fwd);
  return [CX + (F * dot(d, cam.right)) / z, CY - (F * dot(d, cam.up)) / z, z];
}

// ---- sphere ---------------------------------------------------------------
function landY(im) {
  // bar top just before the impact
  const b = im.bt - 0.001;
  return barHeight(im.x, im.z, b, b * BEAT) + R_S;
}

export function sphereState(bt) {
  const keys = [{ bt: 16.0, x: START[0], y: START[1], z: START[2], h: 0.6 }];
  for (const im of IMPACTS) keys.push({ bt: im.bt, x: im.x, y: landY(im), z: im.z, h: 1.7 });
  // squash during contact
  for (const im of IMPACTS) {
    const tau = bt - im.bt;
    if (tau >= 0 && tau < 0.1) {
      const e = Math.sin(Math.PI * (tau / 0.1));
      const k = keys.find((q) => q.bt === im.bt);
      return { x: k.x, y: k.y - R_S * 0.3 * e, z: k.z, sq: 1 - 0.32 * e };
    }
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    const t0 = a.bt + (i === 0 ? 0 : 0.1);
    if (bt >= a.bt && bt < b.bt) {
      const u = clamp((bt - t0) / (b.bt - t0));
      const hh = a.h + Math.max(0, b.y - a.y);
      return {
        x: lerp(a.x, b.x, u),
        y: lerp(a.y, b.y, u) + 4 * hh * u * (1 - u),
        z: lerp(a.z, b.z, u),
        sq: 1,
      };
    }
  }
  // final launch towards the lens
  const last = keys[keys.length - 1];
  // hyperbolic growth on screen: the ball hits the lens at LENS_HIT
  const u = clamp((bt - (last.bt + 0.1)) / (LENS_HIT - last.bt - 0.1));
  const cam = camera(bt, bt * BEAT);
  const toCam = sub(cam.pos, [last.x, last.y, last.z]);
  const e = Ease.inQuad(u) * 0.955;
  return {
    x: last.x + toCam[0] * e,
    y: last.y + toCam[1] * e + 0.5 * Math.sin(Math.PI * u),
    z: last.z + toCam[2] * e,
    sq: 1,
  };
}

export function sphereScreen(bt) {
  const cam = camera(bt, bt * BEAT);
  const s = sphereState(bt);
  const [x, y, z] = project(cam, [s.x, s.y, s.z]);
  return { x, y, r: (F * R_S) / z };
}

// ---- drawing ----------------------------------------------------------------
const FACE = [
  { n: [0, 1, 0], v: (x, z, h) => [[x - A, h, z - A], [x + A, h, z - A], [x + A, h, z + A], [x - A, h, z + A]] },
  { n: [1, 0, 0], v: (x, z, h) => [[x + A, 0, z - A], [x + A, 0, z + A], [x + A, h, z + A], [x + A, h, z - A]] },
  { n: [-1, 0, 0], v: (x, z, h) => [[x - A, 0, z + A], [x - A, 0, z - A], [x - A, h, z - A], [x - A, h, z + A]] },
  { n: [0, 0, 1], v: (x, z, h) => [[x + A, 0, z + A], [x - A, 0, z + A], [x - A, h, z + A], [x + A, h, z + A]] },
  { n: [0, 0, -1], v: (x, z, h) => [[x - A, 0, z - A], [x + A, 0, z - A], [x + A, h, z - A], [x - A, h, z - A]] },
];

// Coloured shading: unlit faces fall into deep cobalt rather than grey.
const SHADOW_COL = rgb('#1C2FC4');
const FOG_COL = rgb('#2F4BF6');
function shade(base, n, fog, shadow) {
  const d = Math.max(0, dot(n, LIGHT));
  const k = clamp((0.22 + 0.86 * d) * (1 - shadow));
  const c = rgb(base);
  const r = lerp(lerp(SHADOW_COL[0], c[0], k), FOG_COL[0], fog);
  const g = lerp(lerp(SHADOW_COL[1], c[1], k), FOG_COL[1], fog);
  const b = lerp(lerp(SHADOW_COL[2], c[2], k), FOG_COL[2], fog);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function drawSphere(ctx, cam, s, bt) {
  const [x, y, z] = project(cam, [s.x, s.y, s.z]);
  if (z < 0.5) return;
  const r = (F * R_S) / z;
  ctx.save();
  ctx.translate(x, y + r * (1 - s.sq));
  ctx.scale(1 / Math.sqrt(s.sq), s.sq);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.05, 0, 0, r);
  g.addColorStop(0, '#FFD2B8');
  g.addColorStop(0.18, '#FF8A55');
  g.addColorStop(0.55, C.ember);
  g.addColorStop(1, '#A8320C');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  // cool bounce light from the blue environment
  const rim = ctx.createRadialGradient(r * 0.25, r * 0.55, r * 0.1, r * 0.1, r * 0.3, r * 1.05);
  rim.addColorStop(0, 'rgba(120,140,255,0)');
  rim.addColorStop(0.8, 'rgba(120,140,255,0)');
  rim.addColorStop(1, 'rgba(150,170,255,0.45)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawShadow(ctx, cam, s, gh) {
  const above = Math.max(0, s.y - R_S - gh);
  const [x, y, z] = project(cam, [s.x, gh + 0.02, s.z]);
  if (z < 0.5) return;
  const rx = (F * R_S * (1.1 + 0.35 * above)) / z;
  const ry = rx * 0.55;
  const a = 0.45 / (1 + 0.8 * above);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(12,20,110,${a})`);
  g.addColorStop(1, 'rgba(12,20,110,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export default {
  from: 16.0,
  to: LENS_HIT,
  draw(ctx, bt, t) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, BG_TOP);
    bg.addColorStop(1, BG_BOT);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const cam = camera(bt, t);
    const s = sphereState(bt);

    // ground plane under the bars
    const gq = [[-N - 0.6, 0, -N - 0.6], [N + 0.6, 0, -N - 0.6], [N + 0.6, 0, N + 0.6], [-N - 0.6, 0, N + 0.6]]
      .map((p) => project(cam, p));
    ctx.fillStyle = GROUND;
    ctx.beginPath();
    gq.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.fill();

    // boxes, back to front
    const items = [];
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        const h = barHeight(i, j, bt, t);
        const d = Math.hypot(i - cam.pos[0], h / 2 - cam.pos[1], j - cam.pos[2]);
        items.push({ i, j, h, d });
      }
    }
    const sd = Math.hypot(s.x - cam.pos[0], s.y - cam.pos[1], s.z - cam.pos[2]);
    items.push({ sphere: true, d: sd - R_S * 0.5 });
    const gx = Math.round(s.x), gz = Math.round(s.z);
    const gh = barHeight(gx, gz, bt, t);
    items.push({ shadow: true, gh, d: Math.hypot(s.x - cam.pos[0], gh - cam.pos[1], s.z - cam.pos[2]) - 0.45 });
    items.sort((a, b) => b.d - a.d);

    const sphereH = s.y - R_S;
    for (const it of items) {
      if (it.sphere) { drawSphere(ctx, cam, s, bt); continue; }
      if (it.shadow) { drawShadow(ctx, cam, s, it.gh); continue; }
      const { i, j, h, d } = it;
      const fog = smoothstep(16, 34, d) * 0.92;
      // height-mapped top colour: paper → acid on the crests
      const crest = smoothstep(0.75, 1.55, h);
      const top = mixHex('#F4F2FF', C.acid, crest);
      const side = mixHex('#E4E6FF', C.acid, crest * 0.6);
      // soft contact shadow from the sphere
      const sdx = i - s.x, sdz = j - s.z;
      const above = Math.max(0, sphereH - h);
      const sig = 0.9 + 0.35 * above;
      const shadow = 0.18 * Math.exp(-(sdx * sdx + sdz * sdz) / (2 * sig * sig)) / (1 + 0.5 * above);
      for (let fi = 0; fi < FACE.length; fi++) {
        const fc = FACE[fi];
        const cx = i + fc.n[0] * A, cz = j + fc.n[2] * A, cy = fi === 0 ? h : h / 2;
        const toCam = [cam.pos[0] - cx, cam.pos[1] - cy, cam.pos[2] - cz];
        if (dot(fc.n, toCam) <= 0) continue;
        const pts = fc.v(i, j, h).map((p) => project(cam, p));
        if (pts.some((p) => p[2] < 0.2)) continue;
        ctx.fillStyle = shade(fi === 0 ? top : side, fc.n, fog, fi === 0 ? shadow : shadow * 0.4);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < 4; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
        ctx.fill();
        // hairline edge on top faces for crispness
        if (fi === 0 && fog < 0.6) {
          ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - fog)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // the dot arrives as a flat disc and inflates into the sphere
    const flat = 1 - ramp(bt, 16.0, 16.12);
    if (flat > 0) {
      ctx.fillStyle = C.ember;
      ctx.globalAlpha = flat;
      const sc = sphereScreen(bt);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, lerp(sc.r, END_R, flat), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },
};
