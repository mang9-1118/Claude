#!/usr/bin/env python3
"""Procedural soundtrack for the showreel — 128 BPM, F minor, exactly 15 s.

Every sound is synthesised from oscillators and noise, and every cue is placed
on the same 32-beat grid the visuals use, so picture and sound lock together:

  bar 0   countdown blips, ticking clock, riser, reverse swell into the drop
  bar 1   DROP; four-on-the-floor; ball impacts are pitched plucks
  bar 2   grid ripples become cascades of ticks; card flips swish
  bar 3   particle burst, sparkle arps, swirl whoosh, chime as "flow" forms
  bar 4   sphere thuds + sub "whum" for each shockwave ring
  bar 5   the lens hit; groove goes underwater (low-pass), bloops on splits
  bar 6   slot-reel ticks, pings, then a beat-repeat glitch and a gap
  bar 7   final hit, logo chime, Fm9 pad tail

usage: python3 soundtrack.py [out.wav]
"""
import sys
import json
import numpy as np
from scipy.signal import lfilter, fftconvolve
from scipy.ndimage import maximum_filter1d
from scipy.io import wavfile

SR = 48000
BPM = 128
BEAT = 60 / BPM
DUR = 32 * BEAT                      # 15.0 s
N = int(round(DUR * SR))
rng = np.random.default_rng(128)


def bs(b):
    """beat → sample index"""
    return int(round(b * BEAT * SR))


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- filters ---
def biquad(kind, f, q=0.707, gain_db=0.0):
    f = min(max(f, 10.0), SR * 0.45)
    w = 2 * np.pi * f / SR
    cw, sw = np.cos(w), np.sin(w)
    a = sw / (2 * q)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a_ = [1 + a, -2 * cw, 1 - a]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a_ = [1 + a, -2 * cw, 1 - a]
    elif kind == 'bp':
        b = [a, 0, -a]; a_ = [1 + a, -2 * cw, 1 - a]
    elif kind == 'peak':
        A = 10 ** (gain_db / 40)
        b = [1 + a * A, -2 * cw, 1 - a * A]; a_ = [1 + a / A, -2 * cw, 1 - a / A]
    else:
        raise ValueError(kind)
    b = np.array(b) / a_[0]
    a_ = np.array(a_) / a_[0]
    return b, a_


def filt(x, kind, f, q=0.707, gain_db=0.0):
    b, a = biquad(kind, f, q, gain_db)
    if x.ndim == 2:
        return np.stack([lfilter(b, a, x[:, c]) for c in range(x.shape[1])], axis=1)
    return lfilter(b, a, x)


def sweep(x, kind, f0, f1, q=0.707, curve='exp', block=128):
    """Time-varying biquad: cutoff glides f0 → f1 over the length of x."""
    out = np.zeros_like(x)
    n = len(x)
    zi = np.zeros(2)
    for s in range(0, n, block):
        u = s / max(1, n - 1)
        f = f0 * (f1 / f0) ** u if curve == 'exp' else f0 + (f1 - f0) * u
        b, a = biquad(kind, f, q)
        seg = x[s:s + block]
        y, zi = lfilter(b, a, seg, zi=zi)
        out[s:s + block] = y
    return out


def automate_lp(x, cutoff_fn, q=0.8, block=128):
    """Stereo low-pass with cutoff given as a function of absolute sample."""
    out = np.zeros_like(x)
    zis = [np.zeros(2), np.zeros(2)]
    for s in range(0, len(x), block):
        b, a = biquad('lp', cutoff_fn(s), q)
        for c in range(2):
            out[s:s + block, c], zis[c] = lfilter(b, a, x[s:s + block, c], zi=zis[c])
    return out


# ------------------------------------------------------------ oscillators ---
def sine_sweep(f0, f1, sec, curve=0.05):
    """Sine whose frequency glides exponentially from f0 to f1 (time const curve)."""
    t = t_axis(sec)
    if curve is None:
        f = f0 * (f1 / f0) ** (t / sec)
    else:
        f = f1 + (f0 - f1) * np.exp(-t / curve)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def saw(f, sec, detune_cents=0.0, phase=0.0, max_f=SR * 0.45):
    """Band-limited saw via additive synthesis (harmonics below max_f)."""
    t = t_axis(sec)
    f = f * 2 ** (detune_cents / 1200)
    out = np.zeros_like(t)
    k = 1
    while k * f < max_f and k < 60:
        out += np.sin(2 * np.pi * k * f * t + phase * k) / k
        k += 1
    return out * (2 / np.pi)


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def env_ad(sec, a=0.002, d=0.2):
    t = t_axis(sec)
    e = np.exp(-np.maximum(t - a, 0) / d)
    if a > 0:
        e *= np.minimum(1, t / a)
    return e


def fade_edges(x, fi=0.002, fo=0.01):
    n = len(x)
    i, o = int(fi * SR), int(fo * SR)
    if i:
        x[:i] *= np.linspace(0, 1, i)
    if o:
        x[-o:] *= np.linspace(1, 0, o)
    return x


# ------------------------------------------------------------ instruments ---
def kick(vel=1.0, punch=1.0):
    sec = 0.55
    t = t_axis(sec)
    f = 46 + (175 - 46) * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.24) * np.minimum(1, t / 0.0015)
    click = filt(noise(0.006), 'hp', 2500) * env_ad(0.006, 0.0002, 0.0015) * 0.5 * punch
    out = body
    out[:len(click)] += click
    return np.tanh(1.6 * out) / np.tanh(1.6) * vel


def sub_boom(f0=58, f1=30, sec=1.6, vel=1.0):
    t = t_axis(sec)
    f = f1 + (f0 - f1) * np.exp(-t / 0.35)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.75) * np.minimum(1, t / 0.004)
    return np.tanh(1.3 * x) * vel


def clap(vel=1.0):
    sec = 0.32
    x = np.zeros(int(sec * SR))
    for k, off in enumerate([0, 0.009, 0.018, 0.026]):
        s = int(off * SR)
        burst = noise(0.012) * env_ad(0.012, 0.0003, 0.0035)
        x[s:s + len(burst)] += burst * (0.8 if k < 3 else 1.0)
    tail = noise(sec) * env_ad(sec, 0.026, 0.085)
    x += tail * 0.7
    x = filt(filt(x, 'bp', 1500, 0.9), 'hp', 600)
    return x * vel * 0.9


def hat(open_=False, vel=1.0):
    sec = 0.25 if open_ else 0.06
    x = noise(sec)
    # inharmonic sine partials give it a metallic colour (band-limited, no aliasing)
    t = t_axis(sec)
    for f in (3540, 5210, 6830, 8710, 10970):
        x += 0.45 * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
    x = filt(filt(x, 'hp', 6500), 'lp', 13500)
    return x * env_ad(sec, 0.0005, 0.09 if open_ else 0.018) * vel * 0.22


def crash(vel=1.0, sec=2.2):
    x = noise(sec)
    t = t_axis(sec)
    for f in (2950, 4370, 5550, 7230, 9110, 11380):
        x += 0.35 * np.sin(2 * np.pi * f * t * (1 + 0.002 * np.sin(2 * np.pi * 5 * t)) + rng.uniform(0, 6))
    x = filt(filt(x, 'hp', 3200), 'lp', 12000)
    return x * env_ad(sec, 0.001, 0.55) * vel * 0.24


def bass_note(m, sec, vel=1.0):
    f = midi(m)
    x = 0.6 * saw(f, sec) + 0.4 * saw(f, sec, 9)
    x = sweep(x, 'lp', 2400, 260, q=1.1)
    sub = np.sin(2 * np.pi * f / 2 * t_axis(sec)) * 0.6
    e = env_ad(sec, 0.003, sec * 0.55)
    return fade_edges((x * 0.9 + sub) * e * vel, 0.001, 0.012)


def pluck(m, vel=1.0, sec=0.7):
    """Marimba-ish: fundamental + 4th partial + soft 10th, fast decays."""
    f = midi(m)
    t = t_axis(sec)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.28)
         + 0.45 * np.sin(2 * np.pi * 3.99 * f * t) * np.exp(-t / 0.05)
         + 0.12 * np.sin(2 * np.pi * 9.9 * f * t) * np.exp(-t / 0.012))
    x *= np.minimum(1, t / 0.001)
    return x * vel


def bell(m, vel=1.0, sec=1.6):
    """FM bell: modulator at 3.5×, decaying index."""
    f = midi(m)
    t = t_axis(sec)
    idx = 4.0 * np.exp(-t / 0.18)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * 3.5 * f * t))
    return x * np.exp(-t / 0.55) * np.minimum(1, t / 0.002) * vel


def supersaw(notes, sec, cutoff=1800, attack=0.25, release=0.6, voices=5, spread=14):
    out = np.zeros((int(sec * SR), 2))
    for m in notes:
        for v in range(voices):
            det = (v - (voices - 1) / 2) * spread / ((voices - 1) / 2 or 1)
            pan = 0.5 + 0.45 * (v / (voices - 1) - 0.5) * 2 if voices > 1 else 0.5
            s = saw(midi(m), sec, det, phase=rng.uniform(0, 6.28), max_f=cutoff * 3)
            out[:, 0] += s * np.sqrt(1 - pan)
            out[:, 1] += s * np.sqrt(pan)
    out = filt(out, 'lp', cutoff, 0.7)
    t = t_axis(sec)
    e = np.minimum(1, t / attack) * np.minimum(1, (sec - t) / release)
    return out * e[:, None] / (len(notes) * voices) * 2.2


def bloop(f0=260, f1=820, vel=1.0):
    sec = 0.28
    t = t_axis(sec)
    f = f0 * (f1 / f0) ** np.minimum(1, t / 0.07)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ad(sec, 0.002, 0.07)
    x += 0.3 * np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR) * env_ad(sec, 0.001, 0.03)
    return x * vel


def tick(freq=3200, vel=1.0, sec=0.018):
    t = t_axis(sec)
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.004)
    x += filt(noise(sec), 'hp', 5000) * np.exp(-t / 0.0015) * 0.6
    return x * vel


def thud(vel=1.0):
    sec = 0.6
    t = t_axis(sec)
    f = 52 + 70 * np.exp(-t / 0.05)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    x += filt(noise(sec), 'lp', 900) * np.exp(-t / 0.03) * 0.5
    return np.tanh(1.8 * x) * vel


def whoosh(sec, f0, f1, vel=1.0, q=1.6, shape='swell'):
    x = sweep(noise(sec), 'bp', f0, f1, q=q)
    t = np.linspace(0, 1, len(x))
    if shape == 'swell':
        e = np.sin(np.pi * t) ** 1.5
    elif shape == 'rise':
        e = t ** 2.2
    else:
        e = (1 - t) ** 2
    return x * e * vel


def reverse_swell(sec, vel=1.0):
    x = filt(noise(sec), 'hp', 1800)
    t = np.linspace(0, 1, len(x))
    return x * (t ** 3.5) * vel


def splash(vel=1.0):
    sec = 0.9
    x = filt(noise(sec), 'bp', 1200, 0.5) * env_ad(sec, 0.001, 0.12)
    for f in (420, 690, 1130):
        x += 0.25 * np.sin(2 * np.pi * np.cumsum(np.full(int(sec * SR), f) * (1 + 0.4 * t_axis(sec))) / SR) * env_ad(sec, 0.001, 0.08)
    return x * vel


# ------------------------------------------------------------------- mix ---
class Bus:
    def __init__(self):
        self.x = np.zeros((N + SR * 3, 2))

    def add(self, sig, beat, gain=1.0, pan=0.0):
        s = bs(beat) if not isinstance(beat, int) else beat
        if s >= N:
            return
        if sig.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            sig = np.stack([sig * l, sig * r], axis=1) * np.sqrt(2)
        e = min(len(self.x), s + len(sig))
        self.x[s:e] += sig[: e - s] * gain


drums, bass, music, fx, verb_send = Bus(), Bus(), Bus(), Bus(), Bus()

F_MINOR_PENTA = [65, 68, 70, 72, 75]  # F4 Ab4 Bb4 C5 Eb5

# ---- bar 0: countdown -------------------------------------------------------
for i, m in enumerate([84, 84, 89]):           # C6, C6, F6 leader blips
    b = float(i)
    sec = 0.11
    t = t_axis(sec)
    blip = np.sin(2 * np.pi * midi(m) * t) * env_ad(sec, 0.003, 0.05)
    fx.add(blip, b, 0.42)
    fx.add(tick(5200, 0.6), b, 0.35)
    verb_send.add(blip, b, 0.25)
for k in range(16):                             # ticking clock, 16ths, building
    b = k * 0.25
    fx.add(tick(4200 if k % 4 else 2600, 0.25 + 0.5 * k / 16), b, 0.5, pan=(-0.35 if k % 2 else 0.35))
fx.add(whoosh(4 * BEAT, 300, 9000, 0.55, q=2.0, shape='rise'), 0.0)
riser_t = t_axis(4 * BEAT)
fx.add(np.sin(2 * np.pi * np.cumsum(180 * (6.5 ** (riser_t / (4 * BEAT)))) / SR) * (riser_t / (4 * BEAT)) ** 3 * 0.12, 0.0)
drone = np.sin(2 * np.pi * midi(29) * t_axis(4 * BEAT)) * np.minimum(1, t_axis(4 * BEAT) / 1.2) * 0.35
bass.add(drone, 0.0)
fx.add(reverse_swell(BEAT * 0.98, 0.5), 3.0)
fx.add(pluck(81, 0.35, 0.4), 3.48)               # dot pops in

# ---- the drop (beat 4) --------------------------------------------------------
drums.add(sub_boom(60, 30, 1.8, 0.9), 4.0)
drums.add(crash(1.0), 4.0)
music.add(supersaw([53, 56, 60, 65], 1.2 * BEAT, cutoff=3200, attack=0.005, release=0.25), 4.0, 0.55)
verb_send.add(supersaw([53, 56, 60, 65], 1.2 * BEAT, cutoff=3200, attack=0.005, release=0.25), 4.0, 0.3)

# ---- groove: beats 4–27 ---------------------------------------------------------
ROOTS = {1: 41, 2: 37, 3: 44, 4: 39, 5: 41, 6: 37}
PADS = {1: [53, 56, 60, 63], 2: [49, 53, 56, 60], 3: [56, 60, 63, 67], 4: [51, 55, 58, 65], 5: [53, 56, 60, 63], 6: [49, 53, 56, 60]}
kick_beats = []
for b in range(4, 28):
    if b == 27:
        continue                                 # the glitch owns beat 27
    kick_beats.append(b)
    drums.add(kick(1.0 if b % 4 == 0 else 0.92), float(b))
    if b % 2 == 1:
        drums.add(clap(0.9), float(b))
        verb_send.add(clap(0.9), float(b), 0.25)
    # hats: offbeat open-ish + 16ths
    drums.add(hat(open_=(b % 4 == 3), vel=0.9), b + 0.5, pan=0.15)
    for s16 in (0.25, 0.75):
        drums.add(hat(vel=0.35 + 0.15 * rng.random()), b + s16, pan=-0.2)
for bar in range(1, 7):
    root = ROOTS[bar]
    pat = [0, 0, 12, 0] if bar % 2 else [0, 12, 0, 7]
    for k in range(4):
        b = 4 * bar + k + 0.5
        if b >= 27:
            continue
        m = root + pat[k]
        if bar == 6 and k >= 2:
            m = 39 + pat[k]                      # Eb leading into the glitch
        bass.add(bass_note(m, 0.42 * BEAT, 0.8), b)
    pad = supersaw(PADS[bar], 4 * BEAT + 0.3, cutoff=2100, attack=0.08, release=0.3)
    music.add(pad, float(4 * bar), 0.52)
    # low-mid body: the chord an octave down, warm and dark
    body = supersaw([m - 12 for m in PADS[bar][:3]], 4 * BEAT + 0.3, cutoff=700, attack=0.05, release=0.3, voices=3, spread=8)
    music.add(body, float(4 * bar), 0.38)

# ---- bar 1: kinetic type — the bouncing ball ----------------------------------
music.add(sine_sweep(midi(65), midi(77), 0.25, curve=0.06) * env_ad(0.25, 0.002, 0.09) * 0.5, 4.0)
for b, m, v in [(5.0, 80, 0.75), (6.0, 84, 0.8), (7.0, 89, 0.85), (7.27, 84, 0.3), (7.47, 89, 0.15)]:
    music.add(pluck(m, v), b, 0.6)
    verb_send.add(pluck(m, v), b, 0.3)
fx.add(whoosh(0.56 * BEAT, 400, 7000, 0.5, q=1.4, shape='rise'), 7.44)
fx.add(sine_sweep(200, 1400, 0.56 * BEAT, curve=None) * np.linspace(0, 1, int(0.56 * BEAT * SR)) ** 2 * 0.1, 7.44)

# ---- bar 2: grid ripples ----------------------------------------------------------
for B in (8, 9, 10, 11):
    for k in range(10):                           # the ripple, as a cascade of ticks
        pan = -0.8 + 1.6 * k / 9 if B == 9 else rng.uniform(-0.6, 0.6)
        fx.add(tick(2400 + 260 * k, 0.55 * (1 - k / 14)), B + k * 0.055, 0.55, pan)
for k in range(12):                               # card flips at beat 10
    b = 10.0 + k * 0.032 * 2
    fx.add(whoosh(0.05, 2500, 6000, 0.35, q=2.5), b, 1.0, pan=-0.7 + 1.4 * k / 11)
fx.add(reverse_swell(0.55 * BEAT, 0.45), 11.45)

# ---- bar 3: particles -----------------------------------------------------------------
fx.add(filt(noise(1.2), 'hp', 900) * env_ad(1.2, 0.001, 0.25) * 0.55, 12.0)
for k in range(32):                               # sparkle arps on 16ths, thinning out
    b = 12.0 + k * 0.25 * 0.5
    if b > 14.0 or rng.random() < k / 48:
        continue
    m = rng.choice(F_MINOR_PENTA) + 24
    s = bell(m, 0.25 + 0.2 * rng.random(), 0.6)
    music.add(s, b, 0.28, pan=rng.uniform(-0.8, 0.8))
    verb_send.add(s, b, 0.35)
fx.add(whoosh(1.6 * BEAT, 600, 3000, 0.3, q=1.2), 12.4, pan=-0.3)
fx.add(whoosh(1.0 * BEAT, 900, 6000, 0.35, q=1.6, shape='rise'), 14.0)
for m in (77, 80, 84, 89):
    music.add(bell(m, 0.35, 1.6), 15.0, 0.4)
    verb_send.add(bell(m, 0.35, 1.6), 15.0, 0.5)
fx.add(reverse_swell(0.5 * BEAT, 0.6), 15.5)
fx.add(sine_sweep(300, 2400, 0.5 * BEAT, curve=None) * np.linspace(0, 1, int(0.5 * BEAT * SR)) ** 3 * 0.12, 15.5)

# ---- bar 4: 3D field ----------------------------------------------------------------------
fall = sine_sweep(2200, 500, 1.0 * BEAT, curve=None) * np.linspace(0.2, 1, int(BEAT * SR)) * 0.06
fx.add(fall, 16.0)
for b, v in ((17.0, 1.0), (18.0, 1.0), (19.0, 1.1)):
    drums.add(thud(v), b, 0.8)
    fx.add(sine_sweep(140, 45, 0.9, curve=0.3) * env_ad(0.9, 0.01, 0.35) * 0.35, b + 0.05)
fx.add(whoosh(0.75 * BEAT, 300, 5000, 0.7, q=1.2, shape='rise'), 19.0)
fx.add(splash(0.8), 19.75)
drums.add(sub_boom(70, 32, 1.2, 0.6), 19.75)

# ---- bar 5: liquid — underwater groove, bloops --------------------------------------------
for b, f0, f1 in ((21.0, 240, 900), (22.0, 300, 1100), (22.12, 420, 1300), (23.0, 900, 260)):
    fx.add(bloop(f0, f1, 0.55), b, 0.8, pan=rng.uniform(-0.4, 0.4))
    verb_send.add(bloop(f0, f1, 0.55), b, 0.4)
fx.add(reverse_swell(0.5 * BEAT, 0.5), 23.5)

# ---- bar 6: data + glitch ------------------------------------------------------------------
for k in range(4):                                 # slot reels: decelerating ticks
    start = 24.1 + k * 0.12
    tt = 0.0
    step = 0.018
    while tt < 1.25 * BEAT:
        fx.add(tick(3000 + 400 * k, 0.28), start + tt / BEAT, 0.5, pan=-0.6 + 0.4 * k)
        tt += step
        step *= 1.12
for b in (24.0, 25.0, 26.0):
    s = np.sin(2 * np.pi * midi(96) * t_axis(0.12)) * env_ad(0.12, 0.001, 0.04)
    fx.add(s, b, 0.2)
    verb_send.add(s, b, 0.2)

# ---- bar 7: final hit -------------------------------------------------------------------------
drums.add(kick(1.0, 1.4), 28.0)
drums.add(sub_boom(62, 28, 2.4, 1.0), 28.0)
drums.add(crash(1.1, 2.6), 28.0)
final = supersaw([41, 48, 56, 63, 67, 72], 4 * BEAT + 0.2, cutoff=2600, attack=0.004, release=1.4)
music.add(final, 28.0, 0.62)
verb_send.add(final, 28.0, 0.35)
for m, v in ((89, 0.6), (96, 0.35)):               # logo chime as the dot lands
    music.add(bell(m, v, 2.0), 29.0, 0.55)
    music.add(pluck(m, v * 0.8, 1.0), 29.0, 0.5)
    verb_send.add(bell(m, v, 2.0), 29.0, 0.6)
music.add(pluck(84, 0.25), 29.42, 0.4)
for b in (30.0, 31.0):
    music.add(pluck(77, 0.18, 0.6), b, 0.4)
    verb_send.add(pluck(77, 0.18, 0.6), b, 0.4)

# ---------------------------------------------------------------- render ---
# Underwater: drums + bass low-passed while we are inside the liquid.
def cutoff_at(s):
    b = s / SR / BEAT
    if b < 19.75 or b >= 24.0:
        return 18000.0
    if b < 20.0:
        return 18000.0 * (450 / 18000) ** ((b - 19.75) / 0.25)
    if b > 23.6:
        return 450 * (18000 / 450) ** ((b - 23.6) / 0.4)
    return 450.0


drums.x = automate_lp(drums.x, cutoff_at, q=1.1)
bass.x = automate_lp(bass.x, cutoff_at, q=1.0)

# Sidechain: duck bass + music on every kick.
duck = np.ones(len(drums.x))
for b in kick_beats + [28]:
    s = bs(b)
    L = int(0.36 * SR)
    t = np.arange(L) / SR
    curve = 1 - 0.65 * np.exp(-t / 0.11)
    e = min(len(duck), s + L)
    duck[s:e] = np.minimum(duck[s:e], curve[: e - s])
bass.x *= duck[:, None]
music.x *= (0.35 + 0.65 * duck)[:, None]

# Reverb: stereo exponentially-decaying noise IR, darker over time.
ir_len = int(2.4 * SR)
ti = np.arange(ir_len) / SR
ir = rng.standard_normal((ir_len, 2)) * np.exp(-ti / 0.55)[:, None]
ir = 0.6 * filt(ir, 'lp', 5000) + 0.4 * filt(ir, 'lp', 1400)
ir[: int(0.012 * SR)] = 0
ir /= np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))
wet = np.stack([fftconvolve(verb_send.x[:, c], ir[:, c])[: len(verb_send.x)] for c in range(2)], axis=1)
wet = filt(wet, 'hp', 250)

mix = drums.x * 0.95 + bass.x * 0.8 + music.x * 0.9 + fx.x * 0.85 + wet * 0.42
mix = filt(mix, 'hp', 28)
mix = filt(mix, 'peak', 9500, 0.7, -2.5)            # tame the top
mix = filt(mix, 'lp', 15500, 0.6)                   # no white-noise fizz up top
mix = filt(mix, 'peak', 380, 0.8, 1.5)              # a little low-mid warmth

# Glitch (beats 27 → 28): beat-repeat stutter of a 16th from just before,
# shrinking repeats + progressive bitcrush, a crackle layer, then a breath of
# silence before the final hit.
g0, gap, g1 = bs(27.0), bs(27.875), bs(28.0)
src = mix[bs(26.5):bs(26.75)].copy()
pos = g0
for k, l in enumerate([0.25, 0.25, 0.125, 0.125, 0.0625, 0.0625]):
    n = int(l * BEAT * SR)
    seg = src[:n].copy()
    rn = int(0.002 * SR)
    seg[:rn] *= np.linspace(0, 1, rn)[:, None]
    seg[-rn:] *= np.linspace(1, 0, rn)[:, None]
    crush = 2 ** (9 - k * 0.9)
    seg = np.round(seg * crush) / crush
    e = min(gap, pos + n)
    mix[pos:e] = seg[: e - pos] * (0.95 - 0.04 * k)
    pos = e
crk = filt(noise((gap - g0) / SR), 'bp', 3000, 2.0)
crk *= (np.random.default_rng(3).random(len(crk)) > 0.93) * 0.35
mix[g0:g0 + len(crk)] += crk[:, None]
mix[gap:g1] = 0.0

# Master: glue + look-ahead peak limiter.
mix = mix[:N]
peak_env = maximum_filter1d(np.max(np.abs(mix), axis=1), size=int(0.004 * SR))
target = 10 ** (-1.0 / 20)
gain = np.minimum(1.0, target / np.maximum(peak_env, 1e-9))
# smooth: instant attack (via min), ~80 ms release
rel = np.exp(-1 / (0.08 * SR))
g = np.empty_like(gain)
acc = 1.0
for i in range(len(gain)):
    acc = gain[i] if gain[i] < acc else rel * acc + (1 - rel) * gain[i]
    g[i] = acc
mix *= g[:, None]
mix = np.clip(mix, -target, target)

# Loudness-ish normalisation to roughly -14 LUFS (RMS proxy) without exceeding the ceiling.
rms = np.sqrt(np.mean(mix ** 2))
mix *= min(10 ** (-13.5 / 20) / max(rms, 1e-9), target / np.max(np.abs(mix)))
mix[-int(0.25 * SR):] *= np.linspace(1, 0, int(0.25 * SR))[:, None] ** 2

out = sys.argv[1] if len(sys.argv) > 1 else 'soundtrack.wav'
wavfile.write(out, SR, (mix * 32767).astype(np.int16))
print(f'wrote {out}: {len(mix) / SR:.3f}s, peak {20 * np.log10(np.max(np.abs(mix))):.2f} dBFS, '
      f'rms {20 * np.log10(np.sqrt(np.mean(mix ** 2))):.2f} dBFS')
