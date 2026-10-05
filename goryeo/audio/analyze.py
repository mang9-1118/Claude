#!/usr/bin/env python3
"""Measure the beat grid of the music bed with numpy.

  onset envelope : log-magnitude spectral flux (STFT, 5 ms hop)
  tempo          : autocorrelation of the envelope, 70–180 BPM, parabolic refine
  phase          : comb the envelope on 8th notes, then pick the 8th that carries the kick
  downbeat       : the beat phase (mod 4) where harmony changes most

Writes beats.json, which render.mjs hands to the page so every UI event sits
on a measured beat, starting on a downbeat.

usage: python3 analyze.py bed.wav beats.json
"""
import sys
import json
import numpy as np
from scipy.io import wavfile

src = sys.argv[1] if len(sys.argv) > 1 else 'bed.wav'
dst = sys.argv[2] if len(sys.argv) > 2 else 'beats.json'
sr, x = wavfile.read(src)
x = x.astype(np.float64)
if x.ndim == 2:
    x = x.mean(axis=1)
dur = len(x) / sr

# The bed is a loop: pad circularly so the first onset has a past.
HOP, NFFT = 240, 2048
xp = np.concatenate([x[-NFFT:], x, x[:NFFT]])
win = np.hanning(NFFT)
frames = np.lib.stride_tricks.sliding_window_view(xp, NFFT)[::HOP] * win
mag = np.abs(np.fft.rfft(frames, axis=1))
logm = np.log1p(1000 * mag)
flux = np.maximum(0, np.diff(logm, axis=0)).sum(axis=1)
flux = np.concatenate([[0], flux])
fr_t = (np.arange(len(flux)) * HOP + NFFT / 2) / sr - NFFT / sr   # frame centre, original timeline
env = flux - np.convolve(flux, np.ones(41) / 41, mode='same')
env = np.maximum(env, 0)

# tempo
fps = sr / HOP
ac = np.correlate(env, env, mode='full')[len(env) - 1:]
lags = np.arange(len(ac))
bpm_of = lambda lag: 60 * fps / lag
lo, hi = int(60 * fps / 180), int(60 * fps / 70)
L = lo + int(np.argmax(ac[lo:hi]))
a, b, c = ac[L - 1], ac[L], ac[L + 1]
L_ref = L + 0.5 * (a - c) / (a - 2 * b + c)
bpm = bpm_of(L_ref)

# phase, in two steps:
#  1. comb the (lightly smoothed) broadband envelope at the beat period
#  2. of the four 16th positions it could be, the beat is the one carrying the kick's low end
def comb(e, period, n):
    sc = []
    for ph in range(n):
        idx = np.arange(ph, len(e) - 1, period)
        i0 = idx.astype(int)
        fr = idx - i0
        sc.append(np.sum(e[i0] * (1 - fr) + e[i0 + 1] * fr))
    sc = np.array(sc)
    k = int(np.argmax(sc))
    a, b, c = sc[(k - 1) % n], sc[k], sc[(k + 1) % n]
    return k + 0.5 * (a - c) / (a - 2 * b + c)

P = L_ref
g = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2)
env_s = np.convolve(env, g / g.sum(), mode='same')
ph = comb(env_s, P, int(P))
freqs_all = np.fft.rfftfreq(NFFT, 1 / sr)
low_energy = (mag[:, freqs_all < 100] ** 2).sum(axis=1)
def low_at(ph):                                   # how much the low end *rises* across this position
    idx = np.arange(ph + P, len(low_energy) - 20, P).astype(int)
    return float(np.mean([low_energy[i + 2:i + 14].mean() - low_energy[i - 12:i - 2].mean() for i in idx]))
cands = [(ph + k * P / 4) % P for k in range(4)]
ph_ref = max(cands, key=low_at)
beat_period = P / fps
first = np.interp(ph_ref, np.arange(len(fr_t)), fr_t)
# refine to the millisecond with a short-window flux (5 ms window, 1 ms hop) around each beat
N2, H2 = 256, 48
x2 = np.concatenate([x[-N2:], x, x[:N2]])
m2 = np.log1p(1000 * np.abs(np.fft.rfft(np.lib.stride_tricks.sliding_window_view(x2, N2)[::H2] * np.hanning(N2), axis=1)))
f2 = np.concatenate([[0], np.maximum(0, np.diff(m2, axis=0)).sum(axis=1)])
t2 = (np.arange(len(f2)) * H2 + N2 / 2) / sr - N2 / sr
first = first % beat_period
devs = []
for b in np.arange(first, dur, beat_period):
    w = (t2 > b - 0.03) & (t2 < b + 0.03)
    if w.any():
        devs.append(t2[w][np.argmax(f2[w])] - b)
first = (first + float(np.median(devs))) % beat_period
beats = np.arange(first, dur, beat_period)

# downbeat: harmonic change (chroma) between the two beats before and after each beat
freqs = np.fft.rfftfreq(NFFT, 1 / sr)
band = (freqs > 120) & (freqs < 340)                  # pad / piano voicings; bass and bells excluded
pc = np.round(12 * np.log2(np.maximum(freqs[band], 1) / 440)) % 12
chroma = np.zeros((len(mag), 12))
for i in range(12):
    chroma[:, i] = mag[:, band][:, pc == i].sum(axis=1)
chroma /= np.maximum(chroma.sum(axis=1, keepdims=True), 1e-9)
novel = np.zeros(4)
for i, bt in enumerate(beats):
    f = int(np.searchsorted(fr_t, bt))
    w = int(1.9 * beat_period * fps)           # two beats each side: only a bar line separates two chords
    if f - w < 0 or f + w >= len(chroma):
        continue
    novel[i % 4] += np.abs(chroma[f:f + w].mean(0) - chroma[f - w:f].mean(0)).sum()
# second cue: the bass spectrum (38–135 Hz, 6 Hz resolution) changes root at every bar line
NF3, H3 = 8192, 600
x3 = np.concatenate([x[-NF3:], x, x[:NF3]])
mag3 = np.abs(np.fft.rfft(np.lib.stride_tricks.sliding_window_view(x3, NF3)[::H3] * np.hanning(NF3), axis=1))
f3 = np.fft.rfftfreq(NF3, 1 / sr)
spec = mag3[:, (f3 > 38) & (f3 < 135)]
spec /= np.maximum(spec.sum(axis=1, keepdims=True), 1e-9)
t3 = (np.arange(len(spec)) * H3 + NF3 / 2) / sr - NF3 / sr
novel_bass = np.zeros(4)
for i, bt in enumerate(beats):
    a = (t3 > bt - 1.9 * beat_period) & (t3 < bt - 0.1 * beat_period)
    b = (t3 > bt + 0.1 * beat_period) & (t3 < bt + 1.9 * beat_period)
    if a.any() and b.any():
        novel_bass[i % 4] += np.abs(spec[b].mean(0) - spec[a].mean(0)).sum()
novel = novel / novel.mean() + novel_bass / novel_bass.mean()
down = int(np.argmax(novel))
offset = beats[down] % (4 * beat_period)
if offset > 2 * beat_period:                       # nearest downbeat to t=0, may sit a hair before it
    offset -= 4 * beat_period
# the loop is a whole number of bars; snap the period to it
bars = round(dur / (4 * beat_period))
loop_beat = dur / (bars * 4)

out = {
    'source': src, 'duration': dur, 'bpm_measured': round(bpm, 3), 'bpm': round(60 / loop_beat, 3),
    'beat_period': loop_beat, 'offset': round(float(offset), 5), 'bars': bars,
    'loop_seconds': dur, 'downbeat_phase': down, 'downbeat_novelty_by_phase': [round(v, 3) for v in novel],
    'beats': [round(float(offset + i * loop_beat), 5) for i in range(bars * 4)],
}
json.dump(out, open(dst, 'w'), indent=1)
print(f"first beat {first * 1000:+.1f} ms · tempo {bpm:.2f} BPM (loop grid {60 / loop_beat:.2f}) · first downbeat {offset * 1000:+.1f} ms · "
      f"novelty by phase {np.round(novel, 2)} → {dst}")
