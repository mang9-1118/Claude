// Viewfinder HUD: brackets, section labels, beat ruler and timecode.
// Drawn after motion blur in 'difference' mode so it inverts against
// whatever is underneath (light on dark scenes, dark on light ones).
import { W, H, BEAT, BEATS, FPS, Ease, tween, ramp, clamp, setFont, FONT, timecode } from './core.js';

const SECTIONS = [
  { at: 0, label: 'REEL 2026  —  COUNTDOWN' },
  { at: 4, label: '01  —  KINETIC TYPE' },
  { at: 8, label: '02  —  SHAPE & RHYTHM' },
  { at: 12, label: '03  —  PARTICLE SYSTEMS' },
  { at: 16, label: '04  —  PROCEDURAL 3D' },
  { at: 20, label: '05  —  SHADERS & FLUIDS' },
  { at: 24, label: '06  —  DATA & INTERFACE' },
];

const M = 46;        // frame inset
const ARM = 34;      // bracket arm length
const HUD_OUT = 28;  // beat at which the HUD leaves (the ident)

function typeOn(str, p) {
  const n = Math.floor(str.length * clamp(p));
  return str.slice(0, n);
}

export function drawHUD(ctx, t, frame) {
  const bt = t / BEAT;
  if (bt >= HUD_OUT) return;
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';

  // Corner brackets draw out from each corner.
  const arm = ARM * tween(bt, 0.0, 0.45, Ease.outExpo);
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  if (arm > 0.5) {
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[M, M, 1, 1], [W - M, M, -1, 1], [M, H - M, 1, -1], [W - M, H - M, -1, -1]]) {
      ctx.moveTo(x, y + sy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * arm, y);
    }
    ctx.stroke();
  }

  const txt = tween(bt, 0.1, 0.9);
  setFont(ctx, 15, 500, FONT.mono);
  ctx.letterSpacing = '2px';
  ctx.textBaseline = 'middle';

  // Top row.
  const topY = M + 4;
  ctx.textAlign = 'left';
  ctx.fillText(typeOn('CLAUDE  /  MOTION DESIGNER', txt), M + ARM + 18, topY);
  ctx.textAlign = 'right';
  ctx.fillText(typeOn('SHOWREEL  2026', txt), W - M - ARM - 18, topY);

  // Metronome: bar number + 4 beat squares + tempo.
  const bar = Math.floor(bt / 4) + 1;
  const beatInBar = Math.floor(bt) % 4;
  const mx = W / 2;
  ctx.globalAlpha = clamp(txt * 1.5);
  ctx.textAlign = 'right';
  ctx.fillText(`BAR ${String(bar).padStart(2, '0')}`, mx - 52, topY);
  ctx.textAlign = 'left';
  ctx.fillText('128 BPM', mx + 52, topY);
  for (let i = 0; i < 4; i++) {
    const x = mx - 33 + i * 18;
    if (i === beatInBar) {
      const pulse = 1 + 0.35 * Math.exp(-(bt % 1) * 9);
      const s = 10 * pulse;
      ctx.fillRect(x + 5 - s / 2, topY - s / 2, s, s);
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, topY - 4, 8, 8);
    }
  }
  ctx.globalAlpha = 1;

  // Bottom-left: section label, rolls vertically on change.
  const botY = H - M - 4;
  let idx = 0;
  for (let i = 0; i < SECTIONS.length; i++) if (bt >= SECTIONS[i].at) idx = i;
  const cur = SECTIONS[idx];
  const roll = idx > 0 ? tween(bt, cur.at, cur.at + 0.35, Ease.outExpo) : 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(M + ARM + 10, botY - 14, 520, 28);
  ctx.clip();
  ctx.textAlign = 'left';
  const lx = M + ARM + 18;
  if (idx > 0 && roll < 1) ctx.fillText(SECTIONS[idx - 1].label, lx, botY - 26 * roll);
  ctx.fillText(idx === 0 ? typeOn(cur.label, txt) : cur.label, lx, botY + 26 * (1 - roll));
  ctx.restore();

  // Bottom-right: timecode.
  ctx.textAlign = 'right';
  ctx.fillText(typeOn('TC ' + timecode(frame), txt), W - M - ARM - 18, botY);

  // Bottom-centre: beat ruler (32 beats) with playhead.
  const rx0 = 640, rx1 = 1280;
  const reveal = tween(bt, 0.15, 0.9, Ease.outExpo);
  const step = (rx1 - rx0) / BEATS;
  for (let i = 0; i <= BEATS; i++) {
    const x = rx0 + i * step;
    if (x > rx0 + (rx1 - rx0) * reveal) break;
    const major = i % 4 === 0;
    const h = major ? 12 : 6;
    ctx.globalAlpha = i <= bt ? 1 : 0.35;
    ctx.fillRect(Math.round(x) - (major ? 1 : 0.5), botY + 6 - h, major ? 2 : 1, h);
  }
  ctx.globalAlpha = 1;
  const px = rx0 + (rx1 - rx0) * clamp(t / (BEATS * BEAT));
  if (reveal > 0.99) {
    ctx.fillRect(px - 1, botY - 12, 2, 20);
    ctx.beginPath();
    ctx.moveTo(px - 5, botY - 18);
    ctx.lineTo(px + 5, botY - 18);
    ctx.lineTo(px, botY - 12);
    ctx.fill();
  }
  ctx.restore();
}
