#!/usr/bin/env python3
"""Generate original, copyright-unencumbered sonic cues for IT佬加国砰砰砰.
Only synthetic oscillator/noise; no imitation samples, existing songs or voice.
Re-running deterministically recreates the same PCM bytes (48 kHz / mono).
"""
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'brand'
RATE = 48_000
RNG = random.Random(810119)


def mix(samples, t, duration, generator):
    first = int(t * RATE)
    count = int(duration * RATE)
    for i in range(count):
        if first + i >= len(samples):
            break
        samples[first + i] += generator(i / RATE)


def soft_tap(base, tint=0.15):
    def run(t):
        env = min(1, t / 0.006) * math.exp(-t * 26)
        tone = (math.sin(2 * math.pi * base * t) * 0.65 +
                math.sin(2 * math.pi * 2.11 * base * t) * 0.19 +
                math.sin(2 * math.pi * 3.28 * base * t) * 0.10)
        return env * (tone + tint * (RNG.random() * 2 - 1) * math.exp(-t * 90))
    return run


def glint(base, decay=7):
    def run(t):
        return (min(1, t / 0.008) * math.exp(-t * decay) *
                (0.60 * math.sin(2 * math.pi * base * t) +
                 0.22 * math.sin(2 * math.pi * base * 2.01 * t)))
    return run


def flop(t):
    env = min(1, t / 0.01) * math.exp(-t * 8)
    pitch = 330 * t - 250 * t * t + 60 * t * t * t
    return env * (math.sin(2 * math.pi * pitch) + 0.18 * (RNG.random() * 2 - 1) * math.exp(-t * 22))


def write(name, duration, recipe):
    out = [0.0] * round(duration * RATE)
    recipe(out)
    # Keep enough headroom for mixing with the canonical BGM at 0.7.
    peak = max(1e-8, max(abs(x) for x in out))
    gain = 0.22 / peak
    end = len(out)
    pcm = bytearray()
    for i, value in enumerate(out):
        fade = min(1.0, (end - i) / (RATE * 0.03))
        pcm.extend(struct.pack('<h', int(max(-1.0, min(1.0, value * gain * fade)) * 32767)))
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / name), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm)
    print(f'{name}: {duration:.2f}s {len(pcm)} bytes mono 48 kHz')


def taps(s):
    for start, base in [(0, 310), (0.22, 280), (0.45, 380)]:
        mix(s, start, 0.30, soft_tap(base))
    mix(s, 0.46, 0.40, glint(784, 13))


def awkward(s):
    mix(s, 0.02, 0.33, soft_tap(340))
    mix(s, 0.35, 0.46, soft_tap(207))


def discovery(s):
    for start, pitch in [(0.00, 523.25), (0.15, 659.25), (0.30, 783.99)]:
        mix(s, start, 0.68, glint(pitch, 7))


def little_flop(s):
    mix(s, 0.01, 0.60, flop)


if __name__ == '__main__':
    write('brand-three-taps.wav', 0.96, taps)
    write('awkward-pluck.wav', 0.95, awkward)
    write('discovery-chime.wav', 1.10, discovery)
    write('tiny-flop.wav', 0.80, little_flop)
