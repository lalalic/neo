#!/usr/bin/env python3
"""Generate the original Neo Build Log v1 music bed.

No samples or copyrighted source material are used. The output is a deterministic
96 BPM minimal electronic cue intended to sit under speech.
"""
from __future__ import annotations

import argparse
import math
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44_100
BPM = 96.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
BARS = 24
DURATION = BAR * BARS
SEED = 20260915


def midi(n: float) -> float:
    return 440.0 * (2.0 ** ((n - 69.0) / 12.0))


def add_note(buf: np.ndarray, start: float, duration: float, frequency: float,
             amp: float, decay: float = 3.5, pan: float = 0.0) -> None:
    i0 = max(0, int(start * SAMPLE_RATE))
    i1 = min(len(buf), int((start + duration) * SAMPLE_RATE))
    if i1 <= i0:
        return
    t = np.arange(i1 - i0, dtype=np.float64) / SAMPLE_RATE
    env = np.minimum(1.0, t / 0.015) * np.exp(-decay * t / max(duration, 0.05))
    # Soft additive tone, avoiding bright frequencies that compete with speech.
    tone = (np.sin(2 * np.pi * frequency * t)
            + 0.22 * np.sin(2 * np.pi * frequency * 2 * t)) * env * amp
    left = math.sqrt((1.0 - pan) / 2.0)
    right = math.sqrt((1.0 + pan) / 2.0)
    buf[i0:i1, 0] += tone * left
    buf[i0:i1, 1] += tone * right


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output WAV path")
    args = ap.parse_args()

    n = int(DURATION * SAMPLE_RATE)
    out = np.zeros((n, 2), dtype=np.float64)
    timeline = np.arange(n, dtype=np.float64) / SAMPLE_RATE
    rng = np.random.default_rng(SEED)

    # Two-bar chord loop: Am(add9) -> Fmaj7 -> Cmaj7 -> G6.
    chords = [
        [45, 52, 59, 60, 64],
        [41, 48, 52, 57, 60],
        [48, 55, 59, 64, 67],
        [43, 50, 55, 59, 64],
    ]
    for bar in range(BARS):
        chord = chords[(bar // 2) % len(chords)]
        start = bar * BAR
        # Pad breathes slowly and stays mostly below narration presence range.
        for j, note in enumerate(chord):
            f = midi(note)
            amp = 0.022 if note < 55 else 0.014
            add_note(out, start, BAR + 0.15, f, amp, decay=0.20,
                     pan=(-0.35 + (j % 3) * 0.35))

    # Machine pulse: deliberately sparse in the first two bars and breakdown.
    roots = [45, 41, 48, 43]
    for bar in range(BARS):
        if bar in {0, 1, 16, 17}:
            density = 2
        else:
            density = 4
        root = roots[(bar // 2) % len(roots)]
        for step in range(density):
            beat_pos = step * (4 / density)
            t0 = bar * BAR + beat_pos * BEAT
            note = root + (7 if step % 2 else 0)
            add_note(out, t0, 0.22, midi(note), 0.034, decay=7.0,
                     pan=-0.12 if step % 2 == 0 else 0.12)

    # Soft kick on beats 1 and 3 after the sparse opening.
    for bar in range(2, BARS):
        if bar in {16, 17}:
            continue
        for beat_index in (0, 2):
            start = bar * BAR + beat_index * BEAT
            i0 = int(start * SAMPLE_RATE)
            length = int(0.24 * SAMPLE_RATE)
            t = np.arange(length, dtype=np.float64) / SAMPLE_RATE
            freq = 58.0 - 20.0 * np.minimum(t / 0.12, 1.0)
            phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
            kick = np.sin(phase) * np.exp(-18 * t) * 0.055
            i1 = min(n, i0 + length)
            out[i0:i1, :] += kick[:i1-i0, None]

    # Very light digital tick on offbeats; high-passed noise via first difference.
    noise = rng.normal(0.0, 1.0, int(0.055 * SAMPLE_RATE))
    noise = np.concatenate(([0.0], np.diff(noise)))
    env = np.exp(-55 * np.arange(len(noise)) / SAMPLE_RATE)
    tick = noise * env * 0.0055
    for bar in range(4, BARS):
        if bar in {16, 17}:
            continue
        for beat_index in (0.5, 1.5, 2.5, 3.5):
            i0 = int((bar * BAR + beat_index * BEAT) * SAMPLE_RATE)
            i1 = min(n, i0 + len(tick))
            out[i0:i1, 0] += tick[:i1-i0] * 0.9
            out[i0:i1, 1] += tick[:i1-i0] * 1.1

    # Neo signature motif A -> E -> G. Opening, midpoint discovery, payoff.
    motif = [(69, 0.00), (76, 0.55), (79, 1.15)]
    for bar in (0, 8, 22):
        for note, beat_offset in motif:
            add_note(out, bar * BAR + beat_offset * BEAT, 0.55, midi(note),
                     0.042, decay=4.5, pan=0.18)

    # Gentle stereo air and movement, still low enough not to mask speech.
    air = rng.normal(0.0, 1.0, n)
    air = np.concatenate(([0.0], np.diff(air)))[:n]
    lfo = 0.55 + 0.45 * np.sin(2 * np.pi * 0.035 * timeline)
    out[:, 0] += air * lfo * 0.00065
    out[:, 1] += air * (1.0 - 0.25 * lfo) * 0.00065

    # Slow master fade and conservative peak normalization.
    fade = np.ones(n)
    fade_len = int(1.2 * SAMPLE_RATE)
    fade[:fade_len] = np.linspace(0, 1, fade_len)
    fade[-fade_len:] = np.linspace(1, 0, fade_len)
    out *= fade[:, None]
    peak = float(np.max(np.abs(out))) or 1.0
    out *= (10 ** (-5.0 / 20.0)) / peak

    pcm = np.clip(out * 32767.0, -32768, 32767).astype("<i2")
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
