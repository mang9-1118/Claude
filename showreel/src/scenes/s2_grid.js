// 02 — Shape & rhythm. We zoom out of the full stop to find it is one tile in a
// Bauhaus grid. Every beat sends a different choreography through the tiles
// (radial ripple, sweep, card-flip, ripple), then the grid condenses to dots.
import { W, H, CX, CY, C, TAU, Ease, Curve, tween, ramp, clamp, lerp, mulberry32, rgba } from '../core.js';

const S = 240;
const HS = S / 2;
const COLS = 5, ROWS = 3; // i ∈ [-COLS, COLS], j ∈ [-ROWS, ROWS]
const ZOOM0 = 22;
const HERO_R = 0.42 * S;

const PAIRS = [
  [C.cobalt, C.paper, 3], [C.paper, C.cobalt, 3], [C.ember, C.ink, 3], [C.ink, C.ember, 2],
  [C.acid, C.ink, 2], [C.paper, C.ember, 3], [C.pink, C.ink, 1], [C.ink, C.paper, 2],
  [C.cobalt, C.acid, 1], [C.paper, C.ink, 2], [C.ink, C.acid, 1], [C.violet, C.paper, 1],
  [C.ember, C.paper, 1], [C.mint, C.ink, 1],
];
const TYPES = ['quarter', 'half', 'circle', 'ring', 'diamond', 'tri', 'stripes', 'plus', 'dots', 'arch', 'leaf', 'square'];
const VIVID = new Set([C.ember, C.cobalt, C.acid, C.pink, C.violet, C.mint]);

let tiles = [];

function build() {
  const rnd = mulberry32(2026);
  const pick = () => {
    const total = PAIRS.reduce((a, p) => a + p[2], 0);
    let r = rnd() * total;
    for (const p of PAIRS) if ((r -= p[2]) < 0) return p;
    return PAIRS[0];
  };
  const grid = {};
  tiles = [];
  for (let j = -ROWS; j <= ROWS; j++) {
    for (let i = -COLS; i <= COLS; i++) {
      let pair, tries = 0;
      do {
        pair = pick();
        tries++;
      } while (tries < 30 && ((grid[`${i - 1},${j}`] && grid[`${i - 1},${j}`][0] === pair[0]) ||
        (grid[`${i},${j - 1}`] && grid[`${i},${j - 1}`][0] === pair[0])));
      let type = TYPES[Math.floor(rnd() * TYPES.length)];
      let [bg, fg] = pair;
      if (i === 0 && j === 0) { bg = C.ink; fg = C.ember; type = 'circle'; }
      grid[`${i},${j}`] = [bg, fg];
      const dot = VIVID.has(bg) ? bg : VIVID.has(fg) ? fg : rnd() < 0.5 ? C.paper : C.ember;
      tiles.push({
        i, j, bg, fg, type, dot,
        rot0: Math.floor(rnd() * 4) * (Math.PI / 2),
        dist: Math.hypot(i, j),
        hero: i === 0 && j === 0,
      });
    }
  }
}

// Camera: zoom out of the hero circle, settle, then drift in slowly.
export function camera(bt) {
  const z = ramp(bt, 8.0, 8.85);
  const s = Math.exp(Math.log(ZOOM0) * (1 - Ease.outExpo(z))) * (1 + 0.035 * tween(bt, 8.85, 12, Ease.inOutQuad));
  const rot = -0.28 * (1 - Ease.outExpo(ramp(bt, 8.0, 9.0)));
  return { s, rot };
}

// Beat choreography: which beat, its wave delay for tile t, and the action kind.
const WAVES = [
  { at: 8.0, kind: 'act', delay: (t) => t.dist * 0.055 },
  { at: 9.0, kind: 'act', delay: (t) => (t.i + COLS) * 0.045 },
  { at: 10.0, kind: 'flip', delay: (t) => (t.i + COLS + t.j + ROWS) * 0.032 },
  { at: 11.0, kind: 'act', delay: (t) => t.dist * 0.035 },
];
const COLLAPSE = [11.42, 11.95];
const maxDist = Math.hypot(COLS, ROWS);

function collapseP(t, bt) {
  const d = (maxDist - t.dist) / maxDist; // outer tiles first
  return Ease.inOutCubic(ramp(bt, COLLAPSE[0] + d * 0.16, COLLAPSE[0] + d * 0.16 + 0.36));
}

export function dotsAtEnd() {
  const { s, rot } = camera(12.0);
  return tiles
    .filter((t) => Math.abs(t.i) <= 4 && Math.abs(t.j) <= 2)
    .map((t) => {
      const x = t.i * S, y = t.j * S;
      const c = Math.cos(rot), sn = Math.sin(rot);
      return { x: CX + s * (x * c - y * sn), y: CY + s * (x * sn + y * c), color: t.dot, hero: t.hero };
    });
}

function shape(ctx, type, fg, p, rotAdd) {
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  switch (type) {
    case 'quarter':
      ctx.rotate(rotAdd);
      ctx.beginPath();
      ctx.moveTo(-HS, -HS);
      ctx.arc(-HS, -HS, S, 0, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'half':
      ctx.rotate(rotAdd * 2);
      ctx.beginPath();
      ctx.arc(0, HS, HS, Math.PI, TAU);
      ctx.fill();
      break;
    case 'circle': {
      // circle ⇄ rounded square morph on each action
      const m = Math.sin(Math.PI * p);
      const r = 0.4 * S * (1 - 0.18 * m);
      ctx.rotate(rotAdd * 0.5);
      ctx.beginPath();
      ctx.roundRect(-r, -r, 2 * r, 2 * r, r * (1 - 0.75 * m));
      ctx.fill();
      break;
    }
    case 'ring': {
      const m = Math.sin(Math.PI * p);
      ctx.lineWidth = 0.13 * S * (1 + 1.1 * m);
      ctx.beginPath();
      ctx.arc(0, 0, 0.3 * S * (1 - 0.25 * m), 0, TAU);
      ctx.stroke();
      break;
    }
    case 'diamond':
      ctx.rotate(Math.PI / 4 + rotAdd);
      ctx.fillRect(-0.27 * S, -0.27 * S, 0.54 * S, 0.54 * S);
      break;
    case 'tri':
      ctx.rotate(rotAdd * 2);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k * TAU) / 3;
        ctx.lineTo(Math.cos(a) * 0.38 * S, Math.sin(a) * 0.38 * S + 0.06 * S);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'stripes': {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-HS, -HS, S, S);
      ctx.clip();
      ctx.rotate(rotAdd);
      const off = (p % 1) * (S / 4);
      for (let k = -3; k < 4; k++) ctx.fillRect(-S, k * (S / 4) + off - S / 16, 2 * S, S / 8);
      ctx.restore();
      break;
    }
    case 'plus':
      ctx.rotate(rotAdd * 0.5);
      ctx.fillRect(-0.31 * S, -0.08 * S, 0.62 * S, 0.16 * S);
      ctx.fillRect(-0.08 * S, -0.31 * S, 0.16 * S, 0.62 * S);
      break;
    case 'dots': {
      ctx.rotate(rotAdd);
      const m = 1 + 0.6 * Math.sin(Math.PI * p);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          ctx.beginPath();
          ctx.arc(a * 0.26 * S, b * 0.26 * S, 0.055 * S * m, 0, TAU);
          ctx.fill();
        }
      break;
    }
    case 'arch':
      ctx.rotate(rotAdd);
      ctx.beginPath();
      ctx.arc(-HS, -HS, S * 0.92, 0, Math.PI / 2);
      ctx.arc(-HS, -HS, S * 0.46, Math.PI / 2, 0, true);
      ctx.closePath();
      ctx.fill();
      break;
    case 'leaf':
      ctx.rotate(rotAdd);
      ctx.beginPath();
      ctx.arc(-HS, HS, S, -Math.PI / 2, 0);
      ctx.arc(HS, -HS, S, Math.PI / 2, Math.PI);
      ctx.closePath();
      ctx.fill();
      break;
    case 'square': {
      const m = Math.sin(Math.PI * p);
      ctx.rotate(rotAdd * 0.5);
      const r = 0.22 * S * (1 + 0.3 * m);
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
      break;
    }
  }
}

export default {
  from: 8.0,
  to: 12.0,
  init() {
    build();
  },
  draw(ctx, bt) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, W, H);
    const { s, rot } = camera(bt);
    ctx.translate(CX, CY);
    ctx.rotate(rot);
    ctx.scale(s, s);

    for (const t of tiles) {
      // accumulate the beat actions for this tile
      let acts = 0, actP = 0, flipped = false, flipScale = 1;
      for (const w of WAVES) {
        const d = w.delay(t);
        const p = Curve.snap(ramp(bt, w.at + d, w.at + d + 0.42));
        if (w.kind === 'act') {
          acts += p;
          if (p > 0 && p < 1) actP = p;
        } else if (!t.hero) {
          const fp = Ease.inOutCubic(ramp(bt, w.at + d, w.at + d + 0.36));
          flipScale = Math.abs(Math.cos(Math.PI * fp));
          flipped = fp > 0.5;
        }
      }
      const bg = flipped ? t.fg : t.bg;
      const fg = flipped ? t.bg : t.fg;

      const cp = t.hero ? 0 : collapseP(t, bt);
      const cpHero = t.hero ? collapseP(t, bt) : 0;
      ctx.save();
      ctx.translate(t.i * S, t.j * S);

      if (cp > 0) {
        // condense tile → dot
        const size = lerp(S + 0.8, 18, cp);
        const col = cp < 0.5 ? bg : t.dot;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, lerp(0, size / 2, Ease.inQuad(cp)));
        ctx.fill();
        if (cp < 0.6) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(-size / 2, -size / 2, size, size);
          ctx.clip();
          const k = size / S;
          ctx.scale(k, k);
          ctx.rotate(t.rot0);
          shape(ctx, t.type, fg, actP, acts * (Math.PI / 2));
          ctx.restore();
        }
        ctx.restore();
        continue;
      }

      ctx.scale(flipScale, 1);
      ctx.fillStyle = bg;
      ctx.fillRect(-HS - 0.4, -HS - 0.4, S + 0.8, S + 0.8);
      ctx.save();
      ctx.beginPath();
      ctx.rect(-HS, -HS, S, S);
      ctx.clip();
      if (t.hero) {
        // the protagonist: an ember disc that breathes on each beat
        const pulse = 1 - 0.12 * Math.sin(Math.PI * actP);
        const r = lerp(HERO_R * pulse, 9, Ease.inOutCubic(cpHero));
        ctx.fillStyle = C.ember;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
      } else {
        ctx.rotate(t.rot0);
        shape(ctx, t.type, fg, actP, acts * (Math.PI / 2));
      }
      ctx.restore();
      // flip shading
      if (flipScale < 0.999) {
        ctx.fillStyle = rgba('#000000', 0.35 * (1 - flipScale));
        ctx.fillRect(-HS, -HS, S, S);
      }
      ctx.restore();
    }

    // hero background collapses too (it is ink, so just let the disc shrink)
  },
};
