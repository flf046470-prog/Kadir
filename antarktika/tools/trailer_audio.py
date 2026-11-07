"""Original trailer soundtrack, synthesised with NumPy (no samples, no third-party music).

    python3 tools/trailer_audio.py out.wav <seconds> [cue=seconds ...]

Layers: blizzard wind (filtered noise with gusts), sub drone with slow beating,
HELIKON shimmer chords (detuned sines, entering at cue 'helikon'), low hits on
each cut listed in 'hits', a rising swell into 'game' (the real-to-game cut),
a pulse during gameplay, and a final boom + tail at 'title'.
"""
import sys
import wave

import numpy as np

SR = 44100


def env(n, a, r):
    e = np.ones(n)
    a, r = int(a * SR), int(r * SR)
    if a: e[:a] = np.linspace(0, 1, a)
    if r: e[-r:] *= np.linspace(1, 0, r)
    return e


def lowpass(x, cutoff):
    # one-pole low-pass, vectorised via cumulative filtering in blocks
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(0, len(x), 4096):
        blk = x[i:i + 4096]
        out = np.empty_like(blk)
        for j, v in enumerate(blk):
            acc = (1 - a) * v + a * acc
            out[j] = acc
        y[i:i + 4096] = out
    return y


def main():
    out, dur = sys.argv[1], float(sys.argv[2])
    cues = {k: float(v) for k, v in (a.split('=') for a in sys.argv[3:] if '=' in a and not a.startswith('hits'))}
    hits = [float(h) for a in sys.argv[3:] if a.startswith('hits=') for h in a[5:].split(',') if h]
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(2091)
    mix = np.zeros((n, 2))
    # wind: two decorrelated noise beds, gusting
    gust = 0.55 + 0.45 * np.sin(t * 0.37) * np.sin(t * 0.11 + 1.3)
    for ch in range(2):
        w = lowpass(rng.standard_normal(n) * 0.5, 520 + 160 * ch)
        hiss = lowpass(rng.standard_normal(n) * 0.12, 3200)
        mix[:, ch] += (w * 0.55 + hiss * 0.25) * gust
    # sub drone A1/E2 with slow beating
    drone = 0.16 * np.sin(2 * np.pi * 55 * t) + 0.09 * np.sin(2 * np.pi * 55.35 * t) + 0.07 * np.sin(2 * np.pi * 82.4 * t)
    drone *= np.clip(t / 4, 0, 1)
    mix += drone[:, None]
    # HELIKON shimmer
    h0 = cues.get('helikon', dur * 0.25)
    sh = np.zeros(n)
    for f in (440, 554.4, 659.3, 880, 1318.5):
        sh += np.sin(2 * np.pi * f * t + np.sin(t * 3.1) * 0.6) * (0.5 + 0.5 * np.sin(t * (0.9 + f / 2000)))
    sh *= 0.025 * np.clip((t - h0) / 3, 0, 1)
    mix[:, 0] += sh
    mix[:, 1] += np.roll(sh, 400)
    # hits on cuts
    for hpos in hits:
        i = int(hpos * SR)
        m = min(n - i, int(2.2 * SR))
        if m <= 0: continue
        tt = np.arange(m) / SR
        boom = np.sin(2 * np.pi * (48 * np.exp(-tt * 2.2) + 32) * tt) * np.exp(-tt * 2.6) * 0.55
        crack = rng.standard_normal(m) * np.exp(-tt * 18) * 0.25
        mix[i:i + m] += (boom + crack)[:, None]
    # swell into the real-to-game cut, then a gameplay pulse
    g = cues.get('game', dur * 0.45)
    sw = np.clip(1 - np.abs(t - g) / 3.0, 0, 1) ** 2 * (t < g)
    mix += (rng.standard_normal(n) * 0.25 * sw)[:, None]
    pulse_on = (t > g) & (t < cues.get('title', dur - 4))
    beat = (np.sin(2 * np.pi * 1.6 * t) > 0.92).astype(float)
    kick = lowpass(beat, 90) * 6
    mix += (np.sin(2 * np.pi * 50 * t) * kick * 0.35 * pulse_on)[:, None]
    arp = np.sin(2 * np.pi * np.array([220, 261.6, 329.6, 392])[(t * 3.2).astype(int) % 4] * t) * 0.05 * pulse_on
    mix[:, 0] += arp
    mix[:, 1] += np.roll(arp, 600)
    # title boom + tail
    ti = cues.get('title', dur - 4)
    i = int(ti * SR)
    m = n - i
    if m > 0:
        tt = np.arange(m) / SR
        boom = np.sin(2 * np.pi * (42 * np.exp(-tt * 1.4) + 28) * tt) * np.exp(-tt * 1.2) * 0.8
        mix[i:] += boom[:, None]
    mix *= env(n, 1.5, 2.5)[:, None]
    mix /= max(1e-6, np.abs(mix).max()) / 0.89
    data = (mix * 32767).astype('<i2')
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print('wrote', out, dur, 's')


if __name__ == '__main__':
    main()
