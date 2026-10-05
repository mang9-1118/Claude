#!/usr/bin/env node
// Offline renderer: serves the reel page, drives headless Chromium workers that
// render frames deterministically, writes PNGs, then encodes with ffmpeg.
//
//   node render.mjs                       # full render + encode → ../showreel.mp4
//   node render.mjs --beats 4.5,7.2       # stills at beat times (fast preview)
//   node render.mjs --frames 0-120 --samples 1
//   node render.mjs --encode-only         # re-encode existing frames + audio
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FPS = 60, FRAMES = 900, BEAT = 60 / 128;

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const samples = Number(opt('samples', 10));
const shutter = Number(opt('shutter', 0.6));
const workers = Number(opt('workers', Math.max(1, Math.min(4, os.cpus().length))));
const outDir = path.resolve(ROOT, opt('out', 'out'));
const encodeOnly = !!opt('encode-only', false);

function parseList(spec, toFrame) {
  const out = [];
  for (const part of String(spec).split(',')) {
    if (part.includes('-') && !part.startsWith('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let f = toFrame(a); f <= toFrame(b); f++) out.push(f);
    } else out.push(toFrame(Number(part)));
  }
  return out;
}

let frames, stills = false;
if (opt('frames')) frames = parseList(opt('frames'), (x) => Math.round(x));
else if (opt('beats')) { frames = parseList(opt('beats'), (b) => Math.round(b * BEAT * FPS)); stills = true; }
else if (opt('times')) { frames = parseList(opt('times'), (t) => Math.round(t * FPS)); stills = true; }
else frames = Array.from({ length: FRAMES }, (_, i) => i);
frames = frames.filter((f) => f >= 0 && f < FRAMES);
if (opt('frames') && opt('stills')) stills = true;

// ---- ffmpeg -----------------------------------------------------------------
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  } catch {
    return 'ffmpeg';
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function encode() {
  const ff = ffmpegPath();
  const audio = path.join(ROOT, 'audio', 'soundtrack.wav');
  const target = path.resolve(ROOT, opt('mp4', '../showreel.mp4'));
  const args = [
    '-y', '-hide_banner', '-loglevel', 'warning', '-stats',
    '-framerate', String(FPS), '-i', path.join(outDir, 'frames', 'f_%04d.png'),
  ];
  if (fs.existsSync(audio)) args.push('-i', audio);
  args.push(
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(opt('crf', 20)), '-tune', 'animation',
    '-profile:v', 'high', '-level', '4.2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart',
  );
  if (fs.existsSync(audio)) args.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
  args.push(target);
  console.log('encoding →', target);
  await run(ff, args);
}

if (encodeOnly) {
  await encode();
  process.exit(0);
}

// ---- static server ----------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// ---- browser ----------------------------------------------------------------
async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const req = createRequire('/opt/node22/lib/node_modules/');
    return req('playwright').chromium;
  }
}
const chromium = await loadPlaywright();

const dir = path.join(outDir, stills ? 'stills' : 'frames');
fs.mkdirSync(dir, { recursive: true });

const chunks = Array.from({ length: Math.min(workers, frames.length) }, () => []);
frames.forEach((f, i) => chunks[i % chunks.length].push(f));

const t0 = Date.now();
let done = 0;
async function worker(list, id) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[w${id}]`, m.text()); });
  page.on('pageerror', (e) => console.log(`[w${id}] pageerror`, e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.reel && window.reel.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.reel.ready);
  for (const f of list) {
    const png = await page.evaluate(({ f, o }) => { window.reel.renderFrame(f, o); return window.reel.toPNG(); },
      { f, o: { samples, shutter } });
    const name = stills ? `b${(f / FPS / BEAT).toFixed(2)}_f${String(f).padStart(4, '0')}.png` : `f_${String(f).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(png.split(',')[1], 'base64'));
    done++;
    if (done % 10 === 0 || done === frames.length) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r${done}/${frames.length} frames  ${el.toFixed(0)}s  (${(el / done).toFixed(2)} s/frame)   `);
    }
  }
  await browser.close();
}

await Promise.all(chunks.map((c, i) => worker(c, i)));
console.log(`\nrendered ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${dir}`);
server.close();

if (!stills && frames.length === FRAMES && !opt('no-encode')) await encode();
