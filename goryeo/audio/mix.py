#!/usr/bin/env python3
"""UI sound design + final mix.

Reads the music bed and the cue list the page exports (audio/cues.json — every
click, drag, keystroke and morph, in seconds on the measured beat grid).
Each UI sound is synthesised, its peak is *measured* (max of a 1 ms RMS
envelope), and it is placed so that peak lands exactly on its cue. Sounds that
cross the loop point wrap around, so the file loops seamlessly.

usage: python3 mix.py bed.wav cues.json soundtrack.wav
"""
import sys
import json
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

SR = 48000
rng = np.random.default_rng(7)


def ts(sec):
    return np.arange(int(sec * SR)) / SR


def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, btype=kind, fs=SR, output='sos'), x)


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def tone(f, sec, decay, attack=0.0008):
    t = ts(sec)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / decay) * np.minimum(1, t / attack)


def chirp(f0, f1, sec, decay):
    t = ts(sec)
    f = f0 * (f1 / f0) ** (t / sec)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay) * np.minimum(1, t / 0.0008)


def pad_to(*xs):
    n = max(len(x) for x in xs)
    return [np.pad(x, (0, n - len(x))) for x in xs]


def mixdown(*parts):
    xs = pad_to(*[p[0] for p in parts])
    return sum(x * g for x, (_, g) in zip(xs, parts))


def fm_bell(f, sec=0.9, ratio=3.0, index=1.4, decay=0.35):
    t = ts(sec)
    return np.sin(2 * np.pi * f * t + index * np.exp(-t / 0.06) * np.sin(2 * np.pi * f * ratio * t)) * np.exp(-t / decay) * np.minimum(1, t / 0.001)


def delayed(x, sec):
    return np.concatenate([np.zeros(int(sec * SR)), x])


# ---------------------------------------------------------------- sounds ---
def click(pitch=1.0, body=1.0):
    n = filt(noise(0.03), 'high', 3500) * np.exp(-ts(0.03) / 0.0025)
    return mixdown((tone(2300 * pitch, 0.03, 0.005), 0.5), (n, 0.45), (tone(190 * pitch, 0.06, 0.016), 0.55 * body))


def key(seed=0, heavy=False):
    r = np.random.default_rng(100 + seed)
    p = 1 + r.uniform(-0.06, 0.06)
    n = filt(r.standard_normal(int(0.04 * SR)), 'band', [1800 * p, 7000]) * np.exp(-ts(0.04) / 0.004)
    parts = [(n, 0.6), (tone(1150 * p, 0.04, 0.006), 0.35), (tone(260 * p, 0.06, 0.012), 0.35)]
    if heavy:
        parts.append((tone(140, 0.12, 0.03), 0.7))
    return mixdown(*parts)


def whoosh(f0=700, f1=2600, sec=0.26, peak=0.07):
    t = ts(sec)
    n = noise(sec)
    out = np.zeros_like(n)
    for i in range(6):                                    # stepped band sweep, crossfaded
        p = i / 5
        f = f0 * (f1 / f0) ** p
        w = np.exp(-((t / sec - p) / 0.22) ** 2)
        out += filt(n, 'band', [f * 0.7, f * 1.4]) * w
    env = np.where(t < peak, (t / peak) ** 2, np.exp(-(t - peak) / (sec * 0.35)))
    return out * env * 0.8


def success():
    a = fm_bell(1318.5, 0.9, 2.0, 1.0, 0.3)            # E6
    b = delayed(fm_bell(1975.5, 0.9, 2.0, 0.9, 0.35), 0.012)   # B6, strummed 12 ms behind
    return mixdown((a, 0.5), (b, 0.4))


def power():
    t = ts(0.9)
    hum = sum(np.sin(2 * np.pi * 60 * h * t) / h ** 0.8 for h in (1, 2, 3, 4, 5, 7))   # Korean mains: 60 Hz
    hum *= np.minimum(1, t / 0.03) * np.exp(-t / 0.35)
    thunk = mixdown((tone(95, 0.25, 0.06), 1.0), (tone(180, 0.1, 0.02), 0.6))
    return mixdown((click(0.85), 0.8), (thunk, 0.8), (filt(hum, 'low', 900), 0.28))


def tick(pitch=1.0):
    return tone(3400 * pitch, 0.02, 0.0028) * 0.7 + filt(noise(0.02), 'high', 6000) * np.exp(-ts(0.02) / 0.0015) * 0.25


def complete():
    return mixdown((tick(1.1), 0.9), (fm_bell(1568, 0.8, 2.0, 0.8, 0.3), 0.35))


def thud():
    return mixdown((tone(120, 0.15, 0.035), 0.9), (click(0.7, 0.4), 0.4))


def stretch():
    sec = 0.55
    t = ts(sec)
    f = 260 * (2.1 ** (t / sec))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    x = filt(x, 'band', [200, 1400]) * (t / sec) ** 2.2
    return x * 0.35


def snap():
    return mixdown((chirp(1500, 280, 0.06, 0.018), 0.55), (click(0.9, 0.6), 0.5))


def switch():
    a = click(1.15, 0.5)
    b = delayed(mixdown((filt(noise(0.05), 'band', [700, 4000]) * np.exp(-ts(0.05) / 0.006), 0.6),
                        (tone(85, 0.15, 0.04), 0.9)), 0.011)
    return mixdown((a, 0.8), (b, 0.8))


def tab():
    return click(1.25, 0.35) * 0.7


def draw():
    sec = 0.42
    t = ts(sec)
    n = noise(sec)
    out = np.zeros_like(n)
    for i in range(5):
        p = i / 4
        f = 500 * (6 ** p)
        out += filt(n, 'band', [f * 0.8, f * 1.25]) * np.exp(-((t / sec - p) / 0.25) ** 2)
    out *= (t / sec) ** 2 * 0.35
    return mixdown((out, 1.0), (delayed(tone(980, 0.08, 0.02), sec - 0.004), 0.55))


def toast():
    a = fm_bell(1046.5, 1.1, 2.0, 1.1, 0.4)            # C6
    b = delayed(fm_bell(1568.0, 1.1, 2.0, 1.0, 0.45), 0.014)   # G6, strummed
    return mixdown((a, 0.45), (b, 0.4))


def morph():
    return whoosh(650, 2400, 0.24, 0.05) * 0.55


def shrink():
    return whoosh(2600, 650, 0.24, 0.05) * 0.5


def grab():
    return click(0.8, 0.3) * 0.6


def release():
    return click(1.05, 0.3) * 0.55


def filter_():
    return whoosh(1200, 3800, 0.18, 0.04) * 0.4


SOUNDS = {
    'click': click, 'morph': morph, 'shrink': shrink, 'success': success, 'power': power, 'grab': grab,
    'tick': tick, 'complete': complete, 'release': release, 'thud': thud, 'stretch': stretch, 'snap': snap,
    'switch': switch, 'tab': tab, 'draw': draw, 'key': key, 'type': key, 'filter': filter_,
    'enter': lambda: key(9, heavy=True), 'toast': toast,
}
LEVEL = {   # dB, relative
    'click': -9, 'morph': -17, 'shrink': -17, 'success': -13, 'power': -8, 'grab': -14, 'tick': -16,
    'complete': -12, 'release': -15, 'thud': -11, 'stretch': -15, 'snap': -12, 'switch': -8, 'tab': -12,
    'draw': -15, 'key': -12, 'type': -13, 'filter': -18, 'enter': -10, 'toast': -11,
}


def peak_index(x):
    """Measured peak: max of a 1 ms RMS envelope."""
    w = int(0.001 * SR)
    rms = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode='same'))
    return int(np.argmax(rms))


def main(bed_path, cues_path, out):
    sr, bed = wavfile.read(bed_path)
    assert sr == SR
    bed = bed.astype(np.float64)
    N = len(bed)
    cues = json.load(open(cues_path))['cues']
    sfx = np.zeros((N, 2))
    n_type = 0
    report = []
    for c in cues:
        kind = c['type']
        if kind == 'type':
            x = key(n_type); n_type += 1
        else:
            x = SOUNDS[kind]()
        pk = peak_index(x)
        g = 10 ** (LEVEL[kind] / 20) * c.get('g', 1)
        start = int(round(c['t'] * SR)) - pk
        pan = np.clip(np.sin(c['t'] * 2.3) * 0.18, -0.2, 0.2)       # a little width, deterministic
        lr = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * 1.414
        idx = (start + np.arange(len(x))) % N                       # wrap across the loop point
        np.add.at(sfx, idx, (x * g)[:, None] * lr[None, :])
        report.append((c['t'], kind, pk / SR * 1000))
    # duck the bed a touch under the UI so every click reads
    env = np.sqrt(np.convolve((sfx ** 2).sum(axis=1), np.ones(int(0.02 * SR)) / int(0.02 * SR), mode='same'))
    duck = 1 - 0.25 * np.clip(env / (env.max() + 1e-9) * 3, 0, 1)
    mix = bed * duck[:, None] + sfx
    mix = np.tanh(mix * 1.15) / 1.15
    gain = min(10 ** (-1 / 20) / np.max(np.abs(mix)),           # −1 dBFS peak …
               10 ** (-13 / 20) / np.sqrt((mix ** 2).mean()))   # … or −13 dBFS RMS, whichever is lower
    mix *= gain
    rms = 20 * np.log10(np.sqrt((mix ** 2).mean()))
    wavfile.write(out, SR, mix.astype(np.float32))
    print(f'{len(cues)} UI sounds placed by measured peak · RMS {rms:.1f} dBFS → {out}')
    seen = {}
    for t, k, p in report:
        seen.setdefault(k, p)
    print('  measured peak offset per sound (ms): ' + ', '.join(f'{k} {p:.1f}' for k, p in seen.items()))


if __name__ == '__main__':
    main(*(sys.argv[1:4] if len(sys.argv) > 3 else ('bed.wav', 'cues.json', 'soundtrack.wav')))
