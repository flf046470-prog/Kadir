"""The camera path of the trailer's live-action prologue: Ekin films the Sakarya basement with a camcorder in one hand.

One path, two renders: Blender draws it photorealistically (tools/prologue_blender.py), the game draws the same frames
(tools/trailer.mjs, the 'path' shot), and the edit turns the first into the second (tools/prologue_post.py).

    python3 DerinlikSteam/tools/prologue_path.py <out.json>

Writes {"fps": 30, "frames": [[x, y, z, yaw, pitch, roll], ...], "real": n, "turn": m, "zoom": [z, ...]} in the game's coordinates
(three.js: Y up, yaw 0 looks toward -Z, camera rotation order YXZ). 'real' frames are the photoreal part, 'turn' frames
the change into the game, the rest is game only. 'zoom' is the camcorder's zoom per frame (1 outside the live-action part).
"""
import json
import math
import sys

FPS = 30
REAL, TURN, GAME = 7.0, 1.2, 2.0          # seconds
N = round((REAL + TURN + GAME) * FPS)

# walk: from the stairs corner toward the north door (basement: x -3..3, z 0..8, door at z 8.1)
START, END = (0.55, 0.75), (0.05, 3.7)
# where the lens points (x, y, z) over time (s): the west shelves, the scratching on the wall (held while the camcorder
# zooms in on it), then the door
SCRATCH = (-2.97, 1.45, 6.4)
LOOK = [(0.0, (-2.6, 0.95, 2.9)), (1.9, SCRATCH), (4.0, SCRATCH), (5.2, (-0.4, 1.25, 8.0)), (7.0, (0.05, 1.2, 8.0)), (99, (0.1, 1.2, 8.0))]
# the camcorder's zoom (1 = the game's own field of view): in on the scratch, out again before the door; the live-action
# part only, so the game frames match it
ZOOM = [(0.0, 1.0), (2.0, 1.0), (2.9, 4.0), (3.9, 4.0), (4.7, 1.0), (99, 1.0)]


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def zoom_at(t):
    for (t0, a), (t1, b) in zip(ZOOM, ZOOM[1:]):
        if t <= t1:
            return a + (b - a) * smooth((t - t0) / (t1 - t0))
    return 1.0


def look_at(t):
    for (t0, a), (t1, b) in zip(LOOK, LOOK[1:]):
        if t <= t1:
            k = smooth((t - t0) / (t1 - t0))
            return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))
    return LOOK[-1][1]


def noise(t, seed):
    """Smooth 1D value noise: a hand never holds still, but it does not jitter either."""
    s = 0.0
    for octave, (f, a) in enumerate(((0.35, 1.0), (0.9, 0.45), (2.1, 0.18))):
        x = t * f + seed * 17.31 + octave * 3.7
        i = math.floor(x)
        h = lambda n: (math.sin(n * 127.1 + seed * 311.7) * 43758.5453) % 1.0 * 2 - 1
        u = x - i
        s += a * (h(i) + (h(i + 1) - h(i)) * (u * u * (3 - 2 * u)))
    return s


frames, zoom = [], []
for f in range(N):
    t = f / FPS
    walk = smooth(t / (REAL + TURN + GAME) * 1.05)
    x = START[0] + (END[0] - START[0]) * walk
    z = START[1] + (END[1] - START[1]) * walk
    step = t * 1.75 * 2 * math.pi                      # ~1.75 steps a second, slow and careful
    pace = min(1.0, t / 0.8)
    y = 1.56 + 0.012 * abs(math.sin(step / 2)) * pace + 0.006 * noise(t, 1)
    x += 0.008 * math.sin(step / 2) * pace + 0.01 * noise(t, 2)
    z += 0.01 * noise(t, 3)
    lx, ly, lz = look_at(t)
    dx, dy, dz = lx - x, ly - y, lz - z
    steady = zoom_at(t) ** -0.5                      # zoomed in, the hand holds the camcorder stiller
    yaw = math.atan2(-dx, -dz) + 0.018 * noise(t, 4) * steady
    pitch = math.atan2(dy, math.hypot(dx, dz)) + (0.014 * noise(t, 5) - 0.004 * math.cos(step) * pace) * steady
    roll = 0.012 * noise(t, 6) + 0.006 * math.sin(step / 2) * pace
    if frames:                                       # keep the yaw continuous (no jump of 2π where it passes ±π)
        yaw += round((frames[-1][3] - yaw) / (2 * math.pi)) * 2 * math.pi
    frames.append([round(v, 5) for v in (x, y, z, yaw, pitch, roll)])
    zoom.append(round(zoom_at(t), 4))

json.dump({"fps": FPS, "frames": frames, "real": round(REAL * FPS), "turn": round(TURN * FPS), "zoom": zoom}, open(sys.argv[1], "w"))
print(f"{N} frames: {round(REAL * FPS)} real, {round(TURN * FPS)} turning, {N - round((REAL + TURN) * FPS)} game")
