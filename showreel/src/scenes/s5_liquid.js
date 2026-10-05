// 05 — Shaders & fluids. The sphere hits the lens; we are inside it. The ember
// melts into liquid glass: SDF metaballs (smooth union) with a dome profile,
// refraction + chromatic dispersion of scrolling type, fresnel, specular and a
// soft drop shadow — one WebGL2 fragment shader, composited into the frame.
import { W, H, CX, CY, C, TAU, BEAT, Ease, Curve, tween, ramp, clamp, lerp, rgba, setFont, FONT, decay } from '../core.js';
import { sphereScreen, LENS_HIT } from './s4_field.js';
import { DOT_START } from './s6_data.js';

const MAX_BLOBS = 10;
const TEX_W = 2600;

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uBlob[${MAX_BLOBS}];
uniform int uCount;
uniform float uEmber;
uniform sampler2D uText;
uniform vec3 uScroll;
uniform float uTexW;
out vec4 outColor;

// Classic metaball field: F = sum r^2/rho^2 (F = 1 on the surface). Sums merge
// smoothly everywhere, and H = sqrt(1 - 1/F) is an exact hemisphere for an
// isolated blob, so the domes need no special casing at their centres.
float field(vec2 p) {
  float F = 0.0;
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= uCount) break;
    vec4 b = uBlob[i];
    vec2 q = p - b.xy;
    float l2 = dot(q, q);
    float a = atan(q.y, q.x);
    float w = b.w * (0.6 * sin(3.0 * a + uTime * 5.1 + b.z * 0.01) + 0.4 * sin(5.0 * a - uTime * 3.7));
    w *= smoothstep(0.2 * b.z, 0.8 * b.z, sqrt(l2));    // no wobble singularity at the centre
    float r = 1.048 * b.z * (1.0 + w);
    F += r * r / (l2 + 0.09 * b.z * b.z);               // softened inverse-square kernel
  }
  return F;
}
float localRadius(vec2 p) {
  float ws = 0.0, rs = 0.0;
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= uCount) break;
    float di = length(p - uBlob[i].xy) - uBlob[i].z;
    float w = exp(-clamp(di, -400.0, 400.0) / 60.0);
    ws += w;
    rs += w * uBlob[i].z;
  }
  return rs / max(ws, 1e-6);
}

const vec3 BG_A = vec3(0.055, 0.025, 0.16);
const vec3 BG_B = vec3(0.13, 0.045, 0.31);
const vec3 TXT = vec3(0.62, 0.50, 1.00);

float textMask(vec2 p) {
  if (p.y < 0.0 || p.y > uRes.y) return 0.0;
  float row = floor(p.y / 360.0);
  float off = row < 0.5 ? uScroll.x : (row < 1.5 ? uScroll.y : uScroll.z);
  return texture(uText, vec2((p.x + off) / uTexW, p.y / uRes.y)).r;
}
vec3 background(vec2 p) {
  vec2 uv = p / uRes;
  vec3 c = mix(BG_A, BG_B, uv.y);
  vec2 q = p - uRes * 0.5;
  c += vec3(0.16, 0.05, 0.26) * exp(-dot(q, q) / (2.0 * 560.0 * 560.0));
  c = mix(c, TXT, textMask(p) * 0.38);
  return c;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float F = field(p);
  vec3 bg = background(p);
  // soft drop shadow + a faint caustic halo around the liquid
  float Fs = field(p - vec2(30.0, 44.0));
  float sh = smoothstep(0.28, 1.05, Fs) * 0.5;
  vec3 outside = bg * (1.0 - sh);
  outside += vec3(0.9, 0.35, 0.6) * smoothstep(0.55, 1.0, F) * (1.0 - step(1.0, F)) * 0.07;
  if (F < 0.8) { outColor = vec4(outside, 1.0); return; }

  float e = 1.0;
  vec2 gF = vec2(field(p + vec2(e, 0.0)) - F, field(p + vec2(0.0, e)) - F) / e;
  float gl = max(length(gF), 1e-6);
  float d = (1.0 - F) / gl;                       // signed distance estimate (px)
  float Hh = sqrt(clamp(1.0 - 1.0 / max(F, 1e-3), 0.0, 1.0));
  float Hc = max(Hh, 0.035);
  vec2 gH = gF / (2.0 * Hc * F * F);              // grad of H
  float S = 0.95 * localRadius(p);
  vec3 n = normalize(vec3(-S * gH, 1.0));

  // refraction with dispersion
  vec2 off = -n.xy * 150.0;
  vec3 refr = vec3(background(p + off * 0.90).r, background(p + off).g, background(p + off * 1.12).b);

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.5, -0.65, 0.6));
  vec3 Hv = normalize(L + V);
  float nh = max(dot(n, Hv), 0.0);
  float spec = pow(nh, 180.0) * 1.7 + pow(nh, 22.0) * 0.14;
  float fres = pow(1.0 - n.z, 2.0);
  vec3 R = reflect(-V, n);
  float env = smoothstep(0.15, 0.95, -R.y) * 0.65 + smoothstep(0.6, 0.98, R.x) * 0.3;

  vec3 tint = vec3(1.0, 0.62, 0.78);
  vec3 glass = refr * mix(vec3(1.0), tint, 0.4) * 1.5 + vec3(0.05, 0.0, 0.04);
  vec3 irid = 0.5 + 0.5 * cos(6.2832 * (fres * 1.3 + uTime * 0.12 + vec3(0.0, 0.33, 0.67)));
  glass += irid * fres * 0.42;
  glass += fres * vec3(1.0, 0.45, 0.85) * 0.3;
  glass += env * fres * vec3(1.0, 0.95, 1.0) * 0.8;
  glass += spec;
  vec3 L2 = normalize(vec3(0.65, 0.7, 0.35));
  glass += pow(max(dot(n, normalize(L2 + V)), 0.0), 50.0) * vec3(0.7, 0.8, 1.0) * 0.35;
  glass *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.22, Hh));

  float lam = max(dot(n, L), 0.0);
  vec3 ember = vec3(1.0, 0.357, 0.122);
  vec3 opaque = ember * (0.5 + 0.6 * lam) + spec * 0.9 + fres * vec3(0.55, 0.25, 0.7) * 0.25;
  vec3 inside = mix(glass, opaque, uEmber);
  float a = smoothstep(1.0, -1.0, d);
  outColor = vec4(mix(outside, inside, a), 1.0);
}`;

let gl, glc, prog, U = {};

function textCanvas() {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, TEX_W, H);
  x.fillStyle = '#fff';
  x.textBaseline = 'middle';
  const rows = ['SHADERS — ', 'FLUIDS — ', 'GLSL — '];
  rows.forEach((unit, r) => {
    setFont(x, 290, 900, FONT.sans, 'expanded');
    const u = x.measureText(unit).width;
    const k = Math.max(1, Math.round(TEX_W / u));
    const sx = TEX_W / (k * u);
    x.save();
    x.translate(0, r * 360 + 180);
    x.scale(sx, 1);
    for (let i = 0; i <= k; i++) x.fillText(unit, i * u, 12);
    x.restore();
  });
  return c;
}

function initGL() {
  glc = document.createElement('canvas');
  glc.width = W;
  glc.height = H;
  gl = glc.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const n of ['uRes', 'uTime', 'uBlob', 'uCount', 'uEmber', 'uText', 'uScroll', 'uTexW'])
    U[n] = gl.getUniformLocation(prog, n);
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(U.uText, 0);
  gl.uniform2f(U.uRes, W, H);
  gl.uniform1f(U.uTexW, TEX_W);
  gl.viewport(0, 0, W, H);
}

// Blob choreography ------------------------------------------------------------
const R_MAIN = 250;
function blobs(bt) {
  const out = [];
  const hit = sphereScreen(LENS_HIT);
  const ip = Ease.outExpo(ramp(bt, LENS_HIT, 20.35));
  const s1 = Curve.swift(ramp(bt, 21.0, 21.55));
  const s2 = Curve.swift(ramp(bt, 22.0, 22.55));
  const mg = Ease.inOutCubic(ramp(bt, 23.0, 23.42));
  const end = Ease.inOutExpo(ramp(bt, 23.45, 23.97));
  const cx = lerp(lerp(hit.x, CX, ip), DOT_START.x, end);
  const cy = lerp(lerp(hit.y, CY, ip), DOT_START.y, end);
  let r = lerp(Math.max(hit.r, 1500), R_MAIN, ip);
  // volume-ish conservation across splits
  const rs = lerp(lerp(r, 0.74 * R_MAIN, s1), 0.54 * R_MAIN, s2);
  const rr = lerp(rs, R_MAIN, mg);
  const rad = lerp(rr, 22, end);
  const spin = 0.55 * (bt - 21) * (bt > 21 ? 1 : 0);
  const jig = 0.035 + 0.09 * (decay(bt, 21.0, 5) + decay(bt, 22.0, 5) + decay(bt, 23.0, 4)) + 0.05 * decay(bt, LENS_HIT, 3);
  const sx = [-1, -1, 1, 1], sy = [-1, 1, -1, 1];
  for (let k = 0; k < 4; k++) {
    const ox = sx[k] * 280 * s1 * (1 - mg);
    const oy = sy[k] * 170 * s2 * (1 - mg);
    const c = Math.cos(spin), s = Math.sin(spin);
    out.push([cx + ox * c - oy * s, cy + ox * s + oy * c, rad, jig * (1 - end)]);
  }
  // satellites orbiting, absorbed back into the merge
  const sat = Ease.outBack(ramp(bt, 20.25, 20.75)) * (1 - Ease.inCubic(ramp(bt, 22.9, 23.35)));
  for (let k = 0; k < 3; k++) {
    if (sat <= 0.001) break;
    const a = bt * 1.9 + (k * TAU) / 3;
    const orb = 600 + 40 * Math.sin(bt * 2.3 + k);
    out.push([CX + Math.cos(a) * orb * (0.6 + 0.4 * sat), CY + Math.sin(a) * orb * 0.64, (22 + 10 * k) * sat, 0.05]);
  }
  return out;
}

export default {
  from: LENS_HIT,
  to: 24.0,
  init() {
    initGL();
  },
  draw(ctx, bt, t) {
    const bl = blobs(bt);
    const arr = new Float32Array(MAX_BLOBS * 4);
    bl.forEach((b, i) => arr.set(b, i * 4));
    gl.uniform4fv(U.uBlob, arr);
    gl.uniform1i(U.uCount, bl.length);
    gl.uniform1f(U.uTime, t);
    const ember = 1 - Ease.inOutQuad(ramp(bt, LENS_HIT + 0.05, 20.25)) + Ease.inOutQuad(ramp(bt, 23.5, 23.85));
    gl.uniform1f(U.uEmber, clamp(ember));
    const sp = t * 260;
    gl.uniform3f(U.uScroll, sp, -sp * 0.8 + 900, sp * 1.25 + 400);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(glc, 0, 0);

    // breakdown caption
    const cp = ramp(bt, 21.2, 21.6), co = 1 - ramp(bt, 23.2, 23.4);
    if (cp > 0 && co > 0) {
      setFont(ctx, 15, 600, FONT.mono);
      ctx.letterSpacing = '3px';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const str = 'SDF METABALLS  ·  REFRACTION  ·  DISPERSION  ·  GLSL';
      ctx.fillStyle = rgba(C.paper, 0.8 * co);
      ctx.fillText(str.slice(0, Math.floor(str.length * cp)), W - 98, H - 112);
    }
  },
};
