#!/usr/bin/env node
// Offline renderer for index.html.
//
//   node render.mjs --cues                 # dump the UI sound cue list → audio/cues.json
//   node render.mjs --stills               # one frame per beat → out/stills + contact sheet
//   node render.mjs --times 1.2,6.05       # stills at given seconds
//   node render.mjs --loopcheck            # compare t=0 with t=T (must be identical)
//   node render.mjs                        # full render → ../goryeo.mp4
//
// Every frame is 4 subframes (shutter 270°) blended by ffmpeg tmix, at 60 fps.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FPS = 60, SUB = 4, SHUTTER = 0.75;
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const OUT = path.join(ROOT, 'out');
const WORKERS = Number(opt('workers', 4));

// ---- static server ----------------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?render`;

const timing = (() => {
  const f = path.join(ROOT, 'audio', 'beats.json');
  if (!fs.existsSync(f)) return {};
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { offset: j.offset, T: j.loop_seconds };
})();

const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1440 }, deviceScaleFactor: 1 });
  await page.goto(URL_);
  await page.evaluate(() => window.ready);
  const meta = await page.evaluate((o) => { window.init(o); return window.META(); }, timing);
  return { page, meta };
}
const shot = (page) => page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1440, height: 1440 } });
const seek = (page, t) => page.evaluate((x) => window.seek(x), t);

function run(cmd, args, stdin) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [stdin ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}`))));
    if (stdin) stdin(p.stdin);
  });
}

try {
  if (opt('cues')) {
    const { page, meta } = await openPage();
    const cues = await page.evaluate(() => window.CUES);
    fs.writeFileSync(path.join(ROOT, 'audio', 'cues.json'), JSON.stringify({ ...meta, cues }, null, 1));
    console.log(`cues: ${cues.length} → audio/cues.json`, meta);
  } else if (opt('stills') || opt('times') || opt('loopcheck')) {
    const { page, meta } = await openPage();
    const dir = path.join(OUT, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    let list;
    if (opt('loopcheck')) list = [['loop_0', 0], ['loop_T', meta.T], ['loop_m', -1 / FPS], ['loop_Tm', meta.T - 1 / FPS]];
    else if (opt('times')) list = String(opt('times')).split(',').map((x) => [`t_${(+x).toFixed(3)}`, +x]);
    else {
      const phase = Number(opt('phase', 0.85));          // where inside each beat to look
      list = Array.from({ length: meta.BEATS }, (_, b) => [`b_${String(b).padStart(2, '0')}`, meta.OFFSET + (b + phase) * meta.BEAT]);
    }
    for (const [name, t] of list) { await seek(page, t); fs.writeFileSync(path.join(dir, `${name}.png`), await shot(page)); }
    if (opt('loopcheck')) console.log('loop stills written');
    else if (!opt('times')) {
      await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-pattern_type', 'glob', '-i', path.join(dir, 'b_*.png'),
        '-vf', 'scale=360:360,tile=7x4:padding=8:margin=8:color=0xD8D4CD', '-frames:v', '1', path.join(OUT, 'contact.png')]);
      console.log('contact sheet → out/contact.png');
    }
  } else {
    // ---- full render: workers render contiguous chunks into their own encoder ----
    const { page: probe, meta } = await openPage();
    await probe.close();
    const frames = Math.round(meta.T * FPS);
    const from = Number(opt('from', 0)), to = Number(opt('to', frames));
    const segDir = path.join(OUT, 'seg');
    fs.rmSync(segDir, { recursive: true, force: true });
    fs.mkdirSync(segDir, { recursive: true });
    const n = to - from, per = Math.ceil(n / WORKERS);
    const t0 = Date.now();
    let done = 0;
    const jobs = Array.from({ length: WORKERS }, (_, w) => [from + w * per, Math.min(to, from + (w + 1) * per)]).filter(([a, b]) => b > a);
    await Promise.all(jobs.map(async ([a, b], w) => {
      const { page } = await openPage();
      const seg = path.join(segDir, `seg_${String(w).padStart(2, '0')}.mp4`);
      await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-',
        '-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB),scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
        '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '13', '-tune', 'animation',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-x264-params', `keyint=${FPS}:min-keyint=${FPS}`, seg], async (stdin) => {
        for (let f = a; f < b; f++) {
          for (let j = 0; j < SUB; j++) {
            const t = (f + ((j - (SUB - 1) / 2) / SUB) * SHUTTER) / FPS;
            await seek(page, t);
            const buf = await shot(page);
            if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
          }
          done++;
          if (done % 30 === 0) {
            const el = (Date.now() - t0) / 1000;
            process.stdout.write(`\r${done}/${n} frames · ${el.toFixed(0)}s · eta ${((el / done) * (n - done)).toFixed(0)}s   `);
          }
        }
        stdin.end();
      });
      await page.close();
    }));
    console.log(`\nrendered ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const list = path.join(segDir, 'list.txt');
    fs.writeFileSync(list, jobs.map((_, w) => `file 'seg_${String(w).padStart(2, '0')}.mp4'`).join('\n'));
    const audio = path.join(ROOT, 'audio', 'soundtrack.wav');
    const target = path.resolve(ROOT, opt('mp4', '../goryeo.mp4'));
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
    if (fs.existsSync(audio) && !opt('silent')) args.push('-i', audio, '-c:a', 'aac', '-b:a', '256k', '-shortest');
    args.push('-c:v', 'copy', '-movflags', '+faststart', target);
    await run('ffmpeg', args);
    console.log(`→ ${path.relative(process.cwd(), target)}`);
  }
} finally {
  await browser.close();
  server.close();
}
