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
| VR arms, 2 m/s strokes | 2.00 (2.00) |
| VR arms, 3 m/s strokes | 3.00 (3.00) |
| VR arms, 4 m/s strokes | 3.81 (4.00) |
| VR arms, 6 m/s strokes | 6.00 (6.00) |
| VR arms, 8 m/s strokes | 6.86 (8.00) |

Re-measured 2026-11-16 after a hand that closed mid-sweep stopped being a dead stop (CLAUDE.md, "A
hand that closed mid-sweep stopped the body dead"); before it the arms rows read 1.91 / 2.79 / 3.62
/ 5.14 / 6.48. Galloping (both hands together, a flight between plants, `.probe/vr-core.ts`) at 6
and 8 m/s strokes now runs at 5.73 and 7.64 m/s, from 5.02 and 5.17 (two-hand bonus at 1, see
CLAUDE.md, "Two hands were a spring").

**The gap:** an arms-first player matches a PC run at about 7–8 m/s of sustained arm stroke, and a
held sprint not at all. A relaxed 4 m/s stroke is just over half a PC run.

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
| jungle | 4 m/s | 7.5 % / 25.8 % | 6 | 14 | 7.01 / 3.64 | 2.7 % / 5.9 % |
| jungle | 6 m/s | 11.0 % / 22.3 % | 10 | 19 | 7.09 / 4.98 | 2.3 % / 14.1 % |
| jungle | 8 m/s | 12.7 % / 20.6 % | 28 | 31 | 7.15 / 6.43 | 2.4 % / 8.1 % |
| glacier | 4 m/s | 12.2 % / 21.1 % | 8 | 15 | 6.77 / 3.49 | 5.2 % / 9.3 % |
| glacier | 6 m/s | 9.8 % / 23.5 % | 4 | 13 | 6.93 / 5.18 | 2.0 % / 9.2 % |
| glacier | 8 m/s | 9.9 % / 23.5 % | 16 | 24 | 6.94 / 6.32 | 3.7 % / 9.4 % |
| outback | 4 m/s | 7.6 % / 25.7 % | 20 | 27 | 6.83 / 3.67 | 3.0 % / 3.5 % |
| outback | 6 m/s | 7.2 % / 26.1 % | 41 | 46 | 6.88 / 5.45 | 2.6 % / 5.5 % |
| outback | 8 m/s | 11.1 % / 22.3 % | 53 | 56 | 6.96 / 6.52 | 2.7 % / 3.9 % |

Re-measured 2026-11-16, after the fix to a hand closing mid-sweep. VR mean speed rose on every row
(jungle 8 m/s 5.22 → 6.43) and VR catches PC more often at 8 m/s (outback 27 → 53), but the chaser
share hardly moved (20.3–25.9 % before, 20.6–26.1 % now): the speed lost at every plant was not
what the gap is made of.

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

What to do about the gap is decided below, in "The crossplay decision (A20)".

### The crossplay decision (A20)

**Recommendation: full crossplay in every mode, no VR speed multiplier, and no input-based
queues until there is a ranked mode.** Measured 2026-11-20 with the same probe and a second VR
gait, the gallop (`GAIT=gallop`: both hands planted together, a flight between plants, the way
arm-locomotion players actually cover ground). 16 seeds × 90 s per row; chaser share, fair 16.7 %.

| map | VR gallop | release ×1 PC / VR | ×1.15 PC / VR | ×1.3 PC / VR |
| --- | --- | --- | --- | --- |
| jungle | 6 m/s | 11.0 / 22.3 | 14.5 / 18.8 | 10.9 / 22.4 |
| jungle | 8 m/s | 13.8 / 19.5 | 17.3 / 16.1 | 22.5 / 10.9 |
| glacier | 6 m/s | 10.8 / 22.5 | 11.4 / 22.0 | 16.0 / 17.3 |
| glacier | 8 m/s | 24.0 / 9.3 | 24.7 / 8.7 | 21.4 / 11.9 |
| outback | 6 m/s | 10.1 / 23.2 | 8.2 / 25.2 | 13.1 / 20.2 |
| outback | 8 m/s | 15.6 / 17.7 | 13.2 / 20.1 | 14.6 / 18.7 |

The release multiplier is Gorilla Tag's lever: the speed kept on letting go, times a constant. It
was tried as a probe-only patch to `releasePull` and not shipped. On flat ground it moves a
gallop by exactly its factor (8 m/s strokes: 7.64 → 8.52 → 9.39 m/s mean).

- **A vigorous arms-first player is already at parity.** Galloping at 8 m/s strokes, VR is the
  chaser 9–20 % of the round against PC's 14–24 %, and VR catches PC as often as the other way
  round (jungle 18/22, outback 60/58). The knuckle-walk table above is the worst case, not the
  typical one: one hand always holds, so it never flies.
- **A multiplier pays the wrong player.** At 8 m/s strokes ×1.3, VR averages 8.55–8.75 m/s against
  PC's 7.1–7.4 and is the chaser 11–19 %: the gap turns round. At 6 m/s, where the gap is, ×1.3
  moves VR from 22–23 % to 17–22 %, inside this table's noise. It scales effort, and the players
  who most need help are the ones putting in least.
- **The noise is about ±6 points per row.** Same speed, different multiplier rows move by that
  much with no trend (glacier 6 m/s: 22.5, 22.0, 17.3). Read each cell as a range.
- **What is left is effort, and that is the genre.** A relaxed 4–6 m/s stroke is slower than a PC
  run, as a slow runner is slower than a fast one. The accessibility answer is the assisted stick
  (seated, limited reach), which CLAUDE.md keeps deliberately slower than arms.

**What would overturn it:** stroke speeds from a real headset. If real players' sustained gallop
sits near 4–6 m/s rather than 8, the gap is real for most of them, and the first lever to measure
then is the PC side (sprint stamina), not a VR multiplier that rewards those already fast. That
measurement is hardware-gated (Track B).

Boxing needs nothing: honest PC and VR punches are within 10 % (CLAUDE.md, "Turning was a punch").

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
