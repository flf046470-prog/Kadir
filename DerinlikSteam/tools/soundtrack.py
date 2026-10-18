"""Synthesises the trailer's soundtrack from the cut in timeline.json (written by trailer.mjs).

Everything is generated here from oscillators and noise, with the same motifs the game makes at run time
(DerinlikWeb/game.html, sfx): the gate hum (55 + 82.6 Hz), thumps, the Second Voice's formant whisper, the camcorder's
two-tone chirp and tape static. No samples, so no third-party licences.

Usage: python3 soundtrack.py <timeline.json> <out.wav>
"""
import json
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(1717)


def band(x, lo=None, hi=None, slope=6.0):
    """Zero-phase band-pass in the frequency domain (smooth edges, `slope` dB per octave beyond them, roughly)."""
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    with np.errstate(divide='ignore'):
        if hi:
            g /= np.sqrt(1 + (f / hi) ** (slope / 3))
        if lo:
            g /= np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (slope / 3))
    return np.fft.irfft(np.fft.rfft(x) * g, n)


def env(n, attack, release, hold=None):
    """Linear attack, hold, exponential-ish release, all in seconds."""
    t = np.arange(n) / SR
    e = np.clip(t / max(attack, 1e-4), 0, 1)
    tail = t - (hold if hold is not None else attack)
    return e * np.where(tail > 0, np.exp(-np.maximum(tail, 0) / max(release, 1e-4) * 3), 1)


def put(buf, at, sig, gain=1.0, pan=0.0):
    """Mix a mono signal into the stereo buffer at `at` seconds (equal-power pan, -1 left .. 1 right)."""
    i = int(at * SR)
    if i >= buf.shape[1]:
        return
    sig = sig[:buf.shape[1] - i]
    a = (pan + 1) * np.pi / 4
    buf[0, i:i + len(sig)] += sig * gain * np.cos(a)
    buf[1, i:i + len(sig)] += sig * gain * np.sin(a)


def thump(freq, dur, noise_amt=.6):
    """game.html thump(): a pitch-dropping sine plus low-passed noise under a fast decay."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * (1 + .6 * np.exp(-t / .015))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR)
    s += band(rng.standard_normal(n), hi=700) * noise_amt * .5
    return s * env(n, .006, dur * .5, 0.006)


def boom(dur=4.0):
    """Trailer impact: a sub drop (48 Hz thump), a body hit and a dark noise swell."""
    n = int(dur * SR)
    out = np.zeros(n)
    a = thump(48, dur, .8)
    out[:len(a)] += a
    b = thump(140, .3, .4) * .35
    out[:len(b)] += b
    out += band(rng.standard_normal(n), hi=220) * env(n, .02, dur * .35, .05) * .6
    return out


def static(dur, gain=1.0):
    """Tape static: high-passed noise with a crackle."""
    n = int(dur * SR)
    s = band(rng.standard_normal(n), lo=2500)
    crackle = (rng.random(n) > .9985) * rng.standard_normal(n) * 6
    return (s + band(crackle, lo=1200)) * np.linspace(1, 0, n) ** .7 * gain


def chirp():
    """The camcorder's 'evidence saved' two-tone square chirp (880, 1320 Hz)."""
    out = np.zeros(int(.2 * SR))
    for i, fr in enumerate((880, 1320)):
        n = int(.07 * SR)
        t = np.arange(n) / SR
        sq = np.sign(np.sin(2 * np.pi * fr * t))
        e = np.minimum(1, t / .005) * np.clip(1 - t / .07, 0, 1)
        j = int(i * .09 * SR)
        out[j:j + n] += band(sq, hi=5000) * e
    return out


def whisper(dur=2.2):
    """The Second Voice: noise through three drifting formants (700, 1150, 2400 Hz)."""
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    # drift: filter in short overlapping blocks with the formants moving
    blk = 4096
    win = np.hanning(blk * 2)
    for start in range(0, n, blk):
        seg = noise[start:start + blk * 2]
        if len(seg) < 64:
            break
        k = start / n
        y = np.zeros(len(seg))
        for fr, drift in ((700, .85), (1150, 1.25), (2400, .9)):
            c = fr * (1 + (drift - 1) * k)
            y += band(seg, lo=c / 1.12, hi=c * 1.12, slope=24)
        out[start:start + len(seg)] += y * win[:len(seg)]
    return out * env(n, .3, dur * .4, dur * .55) * 3


def heartbeat():
    """Lub-dub: two low thumps."""
    a = thump(52, .35, .3)
    b = thump(46, .4, .3) * .7
    j = int(.26 * SR)
    out = np.zeros(j + len(b))
    out[:len(a)] += a
    out[j:j + len(b)] += b
    return band(out, hi=180)


def reverb(x, seconds=3.2, wet=.35):
    """Convolution with a decaying stereo noise tail: the brick cellar the game's own reverb imitates."""
    n_ir = int(seconds * SR)
    t = np.arange(n_ir) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n_ir) * np.exp(-t / seconds * 6.9)
        ir = band(ir, lo=180, hi=4500, slope=18)   # the lows stay dry and centred
        ir /= np.sqrt(np.sum(ir ** 2))
        m = len(x[ch]) + n_ir
        size = 1 << (m - 1).bit_length()
        y = np.fft.irfft(np.fft.rfft(x[ch], size) * np.fft.rfft(ir, size), size)[:len(x[ch])]
        out[ch] = x[ch] * (1 - wet) + y * wet * 1.6
    return out


def main(timeline_path, out_path):
    tl = json.load(open(timeline_path))
    total = tl['frames'] / tl['fps']
    n = int(total * SR)
    t = np.arange(n) / SR
    shots = tl['shots']
    end_at = next(s['start'] for s in shots if s['kind'] == 'end')
    # intensity: rises over the cut, peaks on the fast cuts, gone at the end card
    rise = np.clip(t / end_at, 0, 1) ** 1.6
    rise[t >= end_at] = 0

    bed = np.zeros((2, n))
    # 1. drone: the gate hum, its fifth and a slow beating pair, swelling with the cut
    drone = (np.sin(2 * np.pi * 55 * t) + .7 * np.sin(2 * np.pi * 82.6 * t)
             + .35 * np.sin(2 * np.pi * 110.4 * t) * (.5 + .5 * np.sin(2 * np.pi * .13 * t))
             + .25 * np.sin(2 * np.pi * 36.7 * t))
    drone_env = np.clip(t / 3, 0, 1) * (.35 + .65 * rise)
    drone_env[t >= end_at] = 0
    put(bed, 0, drone * drone_env, .16)
    # 2. wind: band-passed noise breathing at .07 Hz (ambienceWind)
    wind = band(rng.standard_normal(n), lo=200, hi=520) * (.6 + .4 * np.sin(2 * np.pi * .07 * t))
    wind_r = band(rng.standard_normal(n), lo=200, hi=520) * (.6 + .4 * np.cos(2 * np.pi * .07 * t))
    w_env = np.clip(t / 2, 0, 1) * (1 - .5 * rise)
    w_env[t >= end_at] = 0
    bed[0] += wind * w_env * .05
    bed[1] += wind_r * w_env * .05
    # 3. a high, thin string-like tone that creeps in (two detuned saws, low-passed)
    saw = lambda f: 2 * ((t * f) % 1) - 1
    strings = band(saw(220) + saw(220.9) + .5 * saw(329.6), lo=150, hi=1400)
    put(bed, 0, strings * rise ** 2.2, .035)

    hits = np.zeros((2, n))
    for i, s in enumerate(shots):
        a = s['start']
        if s['kind'] == 'card':
            # the opening card comes up out of tape hiss; every later card lands on an impact and the camcorder chirp
            put(hits, a, static(.45), .05)
            if i > 0:
                put(hits, a, boom(3.5), .5)
                put(hits, a + .55, chirp(), .05)
        elif s['kind'] == 'pulse':
            put(hits, a, boom(1.2), .55)
            put(hits, a, static(.35), .09)
            put(hits, a + .02, whisper(.9), .12, pan=-.3 + .3 * (i % 3))
        elif s['kind'] == 'cam':
            up = s.get('camAt') or a + .15   # the camcorder comes up: its click-chirp, then the Second Voice
            put(hits, up, chirp(), .045)
            put(hits, up + .25, whisper(2.4), .08, pan=.35)
        elif s['kind'] == 'enemy':
            for k in range(5):
                put(hits, a + .4 + k * .74, thump(72, .3, .5), .32, pan=.45)
            put(hits, a + 1.2, whisper(2.6), .1, pan=.4)
        elif s['kind'] == 'end':
            put(hits, a, boom(6.0), .9)
            put(hits, a, static(.8), .05)
    # 4. heartbeat: from the Kola card on, faster towards the fast cuts
    kola = next(s['start'] for s in shots if s.get('label') == 'KOLA')
    pulse_start = next(s['start'] for s in shots if s['kind'] == 'pulse')
    beat_t = kola
    while beat_t < end_at - .4:
        k = np.clip((beat_t - kola) / max(pulse_start - kola, 1), 0, 1)
        put(hits, beat_t, heartbeat(), .45 + .25 * k)
        beat_t += 1.05 - .45 * k
    # drips in the quiet opening shot (Sakarya cellar)
    first = next(s for s in shots if s['kind'] == 'shot')
    for d in (first['start'] + .9, first['start'] + 2.6):
        if d < first['start'] + first['dur']:
            m = int(.25 * SR)
            tt = np.arange(m) / SR
            f = 650 + 850 * np.exp(-tt / .03)
            put(hits, d, np.sin(2 * np.pi * np.cumsum(f) / SR) * env(m, .003, .08, .003), .06, pan=-.4)

    mix = reverb(bed + hits, wet=.32)
    # end card: let the reverb tail ring, then fade out with the last frames
    tail = np.clip((total - t) / .8, 0, 1)
    mix *= tail
    # gentle bus compression (soft knee) and normalisation to -1 dBFS peak
    peak = np.max(np.abs(mix))
    mix = np.tanh(mix / peak * 1.6) / np.tanh(1.6)
    mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))
    pcm = (mix.T * 32767).astype('<i2')
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    rms = 20 * np.log10(np.sqrt(np.mean(mix ** 2)))
    print(f'wrote {out_path}: {n / SR:.1f} s, {SR} Hz stereo, RMS {rms:.1f} dBFS')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
