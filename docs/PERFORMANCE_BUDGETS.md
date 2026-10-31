# Performance budgets

Measured numbers the game is held to, and the gaps between platforms. Every table says how it
was measured and where the probe lives. A number here is a measurement of a commit, not a target.

## Movement: PC against VR (roadmap A3)

Measured on 2026-10-24 with the real `stepPlayer` and `Simulation`, headless, at 60 Hz. "VR arms" is a
synthetic arms-first player: two tracked hands alternately gripping the floor and pulling back
(knuckle-walking), or hand over hand on a wall, at the stroke speed named. Real arm strokes run
about 2–4 m/s for a relaxed player and 6–8 m/s for a vigorous one.

### Ground speed

Flat dirt, steady state (mean over 5–35 s; peak in brackets). Probe: `.probe/a3.ts`.

| input | m/s |
| --- | --- |
| PC run (stick or keys, no sprint) | 7.20 (7.20) |
| PC sprint held (stamina runs out and comes back) | 8.25 (9.72) |
| VR assisted stick (0.55 of the stick) | 3.96 (3.96) |
| VR assisted stick + sprint | 4.52 (5.35) |
| VR seated stick (1.0) | 7.20 (7.20) |
| VR arms, 2 m/s strokes | 1.91 (2.00) |
| VR arms, 3 m/s strokes | 2.79 (3.00) |
| VR arms, 4 m/s strokes | 3.62 (4.00) |
| VR arms, 6 m/s strokes | 5.14 (6.00) |
| VR arms, 8 m/s strokes | 6.48 (8.00) |

**The gap:** an arms-first player matches a PC run only at about 9 m/s of sustained arm stroke,
and a held sprint not at all. A relaxed 4 m/s stroke is half a PC run.

### Turning

Same probe. Reversal is the time to stop, then to reach 90 % of steady speed the other way. The
90° turn is the time until the velocity is within 10° of the new heading at 90 % of steady speed.

| input | stop | 90 % back | 90° turn |
| --- | --- | --- | --- |
| PC run | 0.17 s | 0.32 s | 0.42 s |
| PC sprint | 0.22 s | 0.40 s | 0.57 s |
| VR assisted stick | 0.17 s | 0.32 s | 0.23 s |
| VR assisted stick + sprint | 0.22 s | 0.40 s | 0.30 s |
| VR arms (any stroke) | 0.00 s | 0.02 s | 0.02 s |

The arms row is idealised: the synthetic stroke turns the moment it is told to. A real hand has to
finish its stroke and re-plant, so a real reversal costs at least half a stroke cycle, about 0.18 s
for a 0.7 m stroke at 4 m/s. Either way the hand-driven body has no momentum to brake, which is
the one place VR is quicker.

How fast the view can turn:

| input | rate |
| --- | --- |
| PC mouse | as fast as the mouse moves |
| PC gamepad look stick | 143°/s at sensitivity 1, 14–573°/s over the setting's 0.1–4 |
| VR head | the player's own neck |
| VR snap turn | 30° a flick by default (15–90°) |
| VR smooth turn | 120°/s by default (60–240°/s) |

### Climb rate

A sheer 14 m rock wall, climbers starting at its foot. Rate over 5 → 10 m. Probe:
`.probe/a3-climb.ts`.

| input | m/s |
| --- | --- |
| PC / mobile assisted climb (stick up, grab held) | 3.09 |
| VR assisted stick climb (0.55) | 1.70 |
| VR seated stick climb | 3.09 |
| VR arms, 2 m/s strokes | 1.91 |
| VR arms, 3 m/s strokes | 2.80 |
| VR arms, 4 m/s strokes | 3.66 |
| VR arms, 6 m/s strokes | 5.26 |

**The gap runs the other way on a wall:** a 4 m/s stroke out-climbs PC, and a vigorous one climbs
1.7× as fast.

### Chase outcome

Kangaroo Chase, six bots: three drive PC intents and three drive arms-first VR intents built from
the same bot's decisions (`.probe/a3-chase.ts`, class `VrShape`). One chaser in six, so a fair
share of the round spent as the chaser is 16.7 %. 16 seeds × 90 s per row; which three are VR
alternates with the seed.

| map | VR strokes | chaser share PC / VR | VR catches PC | PC catches VR | mean speed PC / VR | stuck PC / VR |
| --- | --- | --- | --- | --- | --- | --- |
| jungle | 4 m/s | 9.5 % / 23.8 % | 3 | 11 | 7.06 / 3.28 | 2.8 % / 9.2 % |
| jungle | 6 m/s | 9.2 % / 24.1 % | 17 | 26 | 7.21 / 4.49 | 2.0 % / 9.5 % |
| jungle | 8 m/s | 10.5 % / 22.8 % | 16 | 22 | 7.25 / 5.22 | 1.8 % / 16.5 % |
| glacier | 4 m/s | 10.4 % / 22.9 % | 6 | 13 | 6.84 / 3.11 | 4.4 % / 13.3 % |
| glacier | 6 m/s | 10.3 % / 23.0 % | 12 | 22 | 6.92 / 4.28 | 3.6 % / 12.9 % |
| glacier | 8 m/s | 8.7 % / 24.7 % | 11 | 20 | 6.75 / 5.16 | 4.4 % / 15.6 % |
| outback | 4 m/s | 8.3 % / 25.1 % | 18 | 24 | 6.73 / 3.38 | 3.4 % / 4.2 % |
| outback | 6 m/s | 7.4 % / 25.9 % | 19 | 26 | 6.91 / 4.61 | 2.6 % / 6.9 % |
| outback | 8 m/s | 13.1 % / 20.3 % | 27 | 31 | 7.06 / 5.72 | 2.9 % / 6.8 % |

All six PC: every player is the chaser 16.7 % of the time, as it should be.

**The gap:** an arms-first player is the chaser 1.2–1.6 times their fair share, and a PC player
0.4–0.8 of it. Most of the VR player's tags are on other VR players (the role passes among the
slow), and a VR chaser catches a PC runner less often than the other way round on every map and
at every stroke speed.

Read the VR column as a lower bound. The synthetic player has no fling, no vault and no hop: the
bot brain was written for PC kinematics and gets over obstacles by hopping, which arms-first does
not have. That is most of its stuck share: on the glacier, VR runners pressed into serac towers,
boulders and the rink's 1.8 m rock rim with one hand on the ice. A real player would climb what it
walks into. On the outback, where little blocks it, the VR stuck share is close to PC's and the
chaser gap is as wide as anywhere.

What to do about the gap is roadmap A20 (the crossplay decision). This table is its input.

### Defects found by measuring this, and fixed

Each is in `CLAUDE.md`, "A VR grab, from the trigger to the river".

| defect | before | after |
| --- | --- | --- |
| Arms-first: a fist closed in the air 1 m from a wall (the "magnet" grab) | held, 0 m fall in 2 s | falls 6.00 m |
| The gadget trigger closed the hand | hand anchored to a wall on 60 of 60 ticks | 0 of 60, the gadget still fires |
| Grab sensitivity reached no hand, only the magnet | the hand closed at 0.55 whatever it said | 0.89 (firm) to 0.17 (a touch) |
| Arms-first in water: no hand could hold it | 0.00 m in 15 s in the jungle river | 22.64 m, out the far bank |
| Gamepad stick, full deflection | 20.8 % of angles more than 1° off, worst 10.3° | exact at every angle |
| Gamepad dead zone | square: 0.18 on an axis, 0.255 on a diagonal | 0.18 in every direction |
| Gamepad slowest walk | 18 % of full speed, from standing in one step | from zero |
| Gamepad look, turns of 30°/s or less | 3.6 % of the stick's live travel | 46 %, same top speed |

The VR chase numbers above were taken after the water fix. Before it, the synthetic VR players on
the jungle spent 45.9 % of the round stuck in the river.
