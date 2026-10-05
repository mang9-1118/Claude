#!/usr/bin/env python3
"""Music bed for 고려전장 — 120 BPM, 7 bars, C major, a seamless 14 s loop.

  | Fmaj7 | G6 | Em7 | Am7 | Dm9 | G7sus4 | Cadd9 → (loops to Fmaj7)

Four-on-the-floor kick, claps on 2 & 4, shuffled hats, an offbeat sub bass,
FM electric-piano stabs, a soft pad and a bell arpeggio. Bar 7 drops the last
kick, swells a reverse cymbal and lands on a crash at the top of the loop.

Every event is rendered three times (loop −1, 0, +1) and only the middle loop
is kept, so reverb and delay tails wrap into the start exactly.

usage: python3 music.py out.wav
"""
import sys
import numpy as np
from scipy.signal import lfilter, butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
BPM = 120
BEAT = 60 / BPM
BARS = 7
T = BARS * 4 * BEAT                 # 14.0 s
N = int(round(T * SR))
rng = np.random.default_rng(1118)

CHORDS = [  # (bass midi, voicing)
    (41, [53, 57, 60, 64]),   # Fmaj7
    (43, [55, 59, 62, 64]),   # G6
    (40, [52, 55, 59, 62]),   # Em7
    (45, [55, 57, 60, 64]),   # Am7
    (38, [53, 57, 60, 64]),   # Dm9 (F A C E over D)
    (43, [53, 55, 60, 62]),   # G7sus4
    (36, [52, 55, 60, 62]),   # Cadd9
]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def ts(sec):
    return np.arange(int(sec * SR)) / SR


def sos(kind, f, order=2):
    return butter(order, f, btype=kind, fs=SR, output='sos')


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)


class Bus:
    """Stereo bus covering three loops; events land in all three."""

    def __init__(self):
        self.x = np.zeros((3 * N + SR * 3, 2))

    def add(self, t, sig, gain=1.0, pan=0.0):
        if sig.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            sig = np.stack([sig * l * 1.414, sig * r * 1.414], axis=1)
        for k in range(3):
            s = int(round((t + k * T) * SR))
            e = min(s + len(sig), len(self.x))
            self.x[s:e] += sig[: e - s] * gain


# ---------------------------------------------------------------- voices ---
def kick():
    t = ts(0.5)
    f = 46 + 120 * np.exp(-t / 0.032)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.26) * np.minimum(1, t / 0.0008)
    click = sosfilt(sos('high', 2500), rng.standard_normal(len(t))) * np.exp(-t / 0.003) * 0.35
    return np.tanh(1.6 * (body + click)) * 0.9


def clap():
    t = ts(0.5)
    n = bp(rng.standard_normal(len(t)), 900, 2600)
    env = np.zeros_like(t)
    for d in (0.0, 0.010, 0.021):
        env += np.where(t >= d, np.exp(-(t - d) / 0.005), 0)
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.11), 0) * 0.7
    return n * env * 0.5


def hat(open_=False):
    t = ts(0.4 if open_ else 0.08)
    n = sosfilt(sos('high', 7500, 4), rng.standard_normal(len(t)))
    return n * np.exp(-t / (0.16 if open_ else 0.022)) * 0.35


def bass(m, dur):
    t = ts(dur + 0.06)
    f = hz(m)
    env = np.minimum(1, t / 0.004) * np.where(t < dur, 1 - 0.3 * (t / dur), np.exp(-(t - dur) / 0.015) * 0.7)
    saw = 2 * ((t * f) % 1) - 1
    tone = np.sin(2 * np.pi * f * t) + 0.18 * sosfilt(sos('low', 380), saw) + 0.12 * np.sin(4 * np.pi * f * t)
    return tone * env * 0.6


def ep(notes, dur, vel=1.0):
    """FM electric piano, slightly detuned left / right."""
    t = ts(dur + 1.2)
    out = np.zeros((len(t), 2))
    for m in notes:
        f = hz(m)
        idx = 1.9 * np.exp(-t / 0.22)
        for ch, det in ((0, -2.5), (1, 2.5)):
            ff = f * 2 ** (det / 1200)
            x = np.sin(2 * np.pi * ff * t + idx * np.sin(2 * np.pi * ff * t))
            x += 0.08 * np.sin(2 * np.pi * ff * 7.02 * t) * np.exp(-t / 0.03)
            env = np.minimum(1, t / 0.003) * np.exp(-t / 0.9) * np.where(t < dur, 1, np.exp(-(t - dur) / 0.08))
            out[:, ch] += x * env
    return out * vel * 0.16


def pad(notes, dur):
    t = ts(dur + 0.6)
    out = np.zeros((len(t), 2))
    for m in notes:
        f = hz(m)
        for ch in (0, 1):
            for det in (-7, 0, 7):
                ff = f * 2 ** ((det + (3 if ch else -3)) / 1200)
                out[:, ch] += 2 * ((t * ff + rng.random()) % 1) - 1
    out = sosfilt(sos('low', 1500, 2), out, axis=0)
    env = np.minimum(1, t / 0.35) * np.where(t < dur, 1, np.exp(-(t - dur) / 0.25))
    return out * env[:, None] * 0.018


def bell(m, vel=1.0):
    t = ts(1.2)
    f = hz(m)
    x = np.sin(2 * np.pi * f * t + 1.2 * np.exp(-t / 0.08) * np.sin(2 * np.pi * f * 3.5 * t))
    return x * np.exp(-t / 0.45) * np.minimum(1, t / 0.002) * vel * 0.12


def crash():
    t = ts(2.2)
    n = sosfilt(sos('high', 3500, 2), rng.standard_normal((len(t), 2)), axis=0)
    return n * (np.exp(-t / 0.9) * np.minimum(1, t / 0.002))[:, None] * 0.09


def reverse_cymbal(dur):
    t = ts(dur)
    n = sosfilt(sos('high', 4000, 2), rng.standard_normal((len(t), 2)), axis=0)
    env = (t / dur) ** 3
    return n * env[:, None] * 0.07


def riser(dur):
    """Noise that climbs through four bands."""
    t = ts(dur)
    n, p = rng.standard_normal(len(t)), t / dur
    bands = [(400, 900), (900, 2000), (2000, 4500), (4500, 10000)]
    out = np.zeros_like(n)
    for i, (lo, hi) in enumerate(bands):
        out += bp(n, lo, hi) * np.exp(-((p - i / (len(bands) - 1)) / 0.3) ** 2)
    return out * p ** 2 * 0.05


def impulse_response(sec=1.6, decay=0.45):
    t = ts(sec)
    ir = rng.standard_normal((len(t), 2)) * np.exp(-t / decay)[:, None]
    ir = sosfilt(sos('low', 6000), ir, axis=0)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]
    return ir / np.sqrt((ir ** 2).sum())


# ---------------------------------------------------------------- arrange ---
def build():
    drums, bassb, keys, pads, bells, fx, verb_send = (Bus() for _ in range(7))
    kicks = []
    for bar, (root, chord) in enumerate(CHORDS):
        b0 = bar * 4 * BEAT
        for beat in range(4):
            gb = bar * 4 + beat
            if gb != 27:                                    # breath before the loop
                drums.add(b0 + beat * BEAT, kick(), 1.0)
                kicks.append(b0 + beat * BEAT)
            if beat in (1, 3):
                drums.add(b0 + beat * BEAT, clap(), 0.75)
                verb_send.add(b0 + beat * BEAT, clap(), 0.35)
            drums.add(b0 + (beat + 0.5) * BEAT, hat(), 0.8, pan=0.2)
            for q in (0.25, 0.75):
                drums.add(b0 + (beat + q + 0.03) * BEAT, hat(), 0.3, pan=-0.25)
        if bar % 2 == 1:
            drums.add(b0 + 3.5 * BEAT, hat(True), 0.55, pan=0.2)
        # offbeat bass + a 16th pickup at the end of each bar
        for q in (0.5, 1.5, 2.5, 3.5):
            bassb.add(b0 + q * BEAT, bass(root, BEAT * 0.38))
        if bar != 6:
            bassb.add(b0 + 3.75 * BEAT, bass(root + 12, BEAT * 0.18), 0.6)
        # e-piano stabs
        for q, d, v in ((0, 0.9, 1.0), (1.5, 0.35, 0.7), (2.75, 0.5, 0.85)):
            st = ep(chord, d * BEAT, v)
            keys.add(b0 + q * BEAT, st)
            verb_send.add(b0 + q * BEAT, st, 0.25)
        pads.add(b0, pad(chord, 4 * BEAT))
        # bell arpeggio, one octave up, 8ths
        tones = [chord[i] + 12 for i in (0, 1, 2, 3, 2, 1, 3, 2)]
        for i, m in enumerate(tones):
            v = 1.0 if i % 2 == 0 else 0.65
            bells.add(b0 + i * 0.5 * BEAT, bell(m, v), pan=(-0.35 if i % 2 else 0.35))
    # loop seam: reverse cymbal + riser into a crash on the downbeat
    fx.add(T - 2 * BEAT, reverse_cymbal(2 * BEAT))
    fx.add(T - 4 * BEAT, riser(4 * BEAT))
    fx.add(0.0, crash())
    verb_send.add(0.0, crash(), 0.5)
    return drums, bassb, keys, pads, bells, fx, verb_send, kicks


def sidechain(n_samples, kicks, depth=0.55, rel=0.13):
    t = np.arange(n_samples) / SR
    g = np.ones(n_samples)
    for k0 in kicks:
        for k in range(3):
            s = k0 + k * T
            i0 = int(s * SR)
            seg = t[i0:i0 + int(0.6 * SR)] - s
            g[i0:i0 + len(seg)] *= 1 - depth * np.exp(-seg / rel) * np.minimum(1, seg / 0.004 + 0.2)
    return g


def delay_pingpong(x, d_sec, fb=0.35, mix=0.3):
    d = int(d_sec * SR)
    y = np.zeros_like(x)
    buf = x.copy()
    gain = mix
    for i in range(1, 6):
        sh = np.zeros_like(x)
        sh[i * d:] = buf[: len(x) - i * d]
        if i % 2:
            sh = sh[:, ::-1]
        y += sh * gain
        gain *= fb
    return x + y


def main(out):
    drums, bassb, keys, pads, bells, fx, verb_send, kicks = build()
    L = len(drums.x)
    sc = sidechain(L, kicks)[:, None]
    bells_x = delay_pingpong(sosfilt(sos('high', 600), bells.x, axis=0), 0.75 * BEAT)
    mix = (drums.x * 0.95
           + bassb.x * 0.8 * sc
           + keys.x * sc
           + pads.x * sc ** 1.5
           + bells_x * 0.9
           + fx.x)
    wet = np.stack([fftconvolve(verb_send.x[:, c] + bells_x[:, c] * 0.4, impulse_response()[:, c])[:L] for c in range(2)], axis=1)
    mix += wet * 0.55
    mix = sosfilt(sos('high', 28), mix, axis=0)
    loop = mix[N:2 * N]                                   # the middle loop: steady state
    loop = np.tanh(loop * 1.4) / 1.4
    loop *= 0.5 / np.max(np.abs(loop))                    # headroom for the UI sounds
    wavfile.write(out, SR, loop.astype(np.float32))
    print(f'bed: {len(loop) / SR:.3f}s  peak {20 * np.log10(np.abs(loop).max()):.1f} dBFS → {out}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'bed.wav')
