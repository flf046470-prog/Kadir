import { describe, expect, it } from 'vitest';

import type { Collider } from '../physics/types.js';
import type { Vec3 } from '../math/vec3.js';
import { Rand } from '../math/rand.js';
import { LevelBuilder } from './builder.js';
import { buildLevel, listLevels } from './registry.js';
import { buildOutbackWorld } from './outback.js';
import { zoneAt } from './zone.js';
import './index.js';

/**
 * Rules every map has to obey, checked against every map that exists.
 *
 * Written after building the third one, because both of the real bugs in it were things the
 * existing tests had no opinion about — and both were found by *driving* the map rather than by
 * reading it, which is exactly the kind of thing that should not need finding twice.
 */

/** Is `point` inside this collider? Exact for boxes, including yawed ones. */
function inside(collider: Collider, point: Vec3): boolean {
  if (collider.kind === 'sphere') {
    return (
      Math.hypot(point.x - collider.center.x, point.y - collider.center.y, point.z - collider.center.z) < collider.radius
    );
  }
  if (collider.kind === 'cylinder') {
    return (
      Math.hypot(point.x - collider.center.x, point.z - collider.center.z) < collider.radius &&
      Math.abs(point.y - collider.center.y) < collider.halfHeight
    );
  }
  // Box: rotate the point into the collider's frame, then compare against the half extents.
  const dx = point.x - collider.center.x;
  const dz = point.z - collider.center.z;
  const cos = Math.cos(-collider.yaw);
  const sin = Math.sin(-collider.yaw);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return (
    Math.abs(lx) < collider.half.x && Math.abs(point.y - collider.center.y) < collider.half.y && Math.abs(lz) < collider.half.z
  );
}

describe('every map', () => {
  it('offers a spawn for each role a mode will ask for', () => {
    /**
     * Outback Station shipped its first build with exactly one spawn — the lobby — while the other
     * two maps had twelve and thirteen. Nothing failed: every mode simply fell back to that single
     * point, so a round of King of the Hill put six players inside each other and read
     * "Contested by 6" from the bell to the final whistle. A missing spawn is silent, which is why
     * it needs a test rather than a play-through.
     */
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      const tags = new Set(level.spawns.map((s) => s.tag));
      for (const tag of ['lobby', 'start', 'runner', 'chaser'] as const) {
        expect(tags.has(tag), `${entry.id} has no '${tag}' spawn`).toBe(true);
      }
    }
  });

  it('never starts a player inside the scenery', () => {
    // A spawn buried in a wall is a player who cannot move, and it is invisible until someone
    // rolls that spawn point in a live match.
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      for (const spawn of level.spawns) {
        // Checked at chest height as well as at the feet: standing in a knee-high rock is fine and
        // normal, standing in a wall is not.
        for (const lift of [0.9, 1.5]) {
          const point = { x: spawn.position.x, y: spawn.position.y + lift, z: spawn.position.z };
          const hit = level.colliders.find((c) => inside(c, point));
          expect(hit, `${entry.id}: ${spawn.tag ?? 'untagged'} spawn at ${JSON.stringify(spawn.position)} is inside collider ${hit?.id}`).toBeUndefined();
        }
      }
    }
  });

  it('gives every mode portal ground to stand on', () => {
    // The doors are placed on a ring by maths, not by hand, so a map whose lobby sits near an edge
    // can put one of them over nothing.
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      for (const portal of level.portals) {
        const below = level.colliders.some(
          (c) =>
            inside(c, { x: portal.position.x, y: portal.position.y - 1.2, z: portal.position.z }) ||
            inside(c, { x: portal.position.x, y: portal.position.y - 2.2, z: portal.position.z }),
        );
        expect(below, `${entry.id}: the ${portal.modeId} door has no floor under it`).toBe(true);
      }
    }
  });
});

describe('Outback Station', () => {
  it('leaves the gorge open to the sky', () => {
    /**
     * The flat's floor was a square centred on the origin, which reached seven metres past the
     * gorge's eastern lip — so the canyon had a lid, and the only enclosed part of the map was
     * enclosed from above by the map itself. Nothing complained: the colliders were all valid and
     * the level built fine.
     *
     * Sampled up the full height of the cut rather than at one point, because a lid two metres
     * above the creek and a lid at ground level are the same bug at different depths.
     */
    const level = buildOutbackWorld();
    for (const z of [-30, -15, 0, 15, 30]) {
      for (let y = -12; y <= 2; y += 2) {
        const point = { x: -74, y, z };
        const hit = level.colliders.find((c) => inside(c, point));
        expect(hit, `roofed at z=${z}, y=${y} by collider ${hit?.id}`).toBeUndefined();
      }
    }
  });

  it('puts a floor under the whole creek bed', () => {
    // The other half of the same mistake: a gorge with no bottom is a hole, not a room.
    const level = buildOutbackWorld();
    for (const z of [-40, -20, 0, 20, 40]) {
      const supported = level.colliders.some((c) => inside(c, { x: -74, y: -16, z }));
      expect(supported, `no creek bed at z=${z}`).toBe(true);
    }
  });

  it('costs no more than the maps it ships beside', () => {
    /**
     * The budget is a Quest drawing every other player in the room at 72 Hz, and a map is the one
     * thing in the frame whose cost is decided entirely at authoring time. Held against the
     * heaviest existing map rather than a number picked from the air, so the bar moves only when
     * somebody deliberately moves it.
     */
    const outback = buildOutbackWorld();
    const others = listLevels()
      .filter((e) => e.id !== 'outback-station')
      .map((e) => buildLevel(e.id));
    const worstColliders = Math.max(...others.map((l) => l.colliders.length));
    const worstProps = Math.max(...others.map((l) => l.props.length));
    expect(outback.colliders.length).toBeLessThanOrEqual(worstColliders);
    expect(outback.props.length).toBeLessThanOrEqual(worstProps);
  });

  it('builds byte-identically from the same seed', () => {
    // The whole reason a map is a seed and not a download: the server and every client have to
    // agree on the world without exchanging any of it.
    expect(JSON.stringify(buildOutbackWorld())).toBe(JSON.stringify(buildOutbackWorld()));
  });
});

/**
 * The leash, pinned from both sides.
 *
 * `playRadius` is the only field that decides how far apart six players end up, because the bot
 * turns back toward the centre past `playRadius * 0.75` and nothing else reads it. All three maps
 * shipped at 150, putting that turn at 112 m and six players on a 700 m circle: on
 * `outback-station` that measured as 48 % of the round spent on the empty apron, a median 43 m to
 * the nearest other player, and 14 % of a *tag game* spent within 15 m of anybody. At 90 the same
 * map reads 3 % apron, 16.9 m, and 47 %.
 *
 * Both bounds matter and they pull opposite ways, which is why this is not a one-sided assertion.
 * Smaller is not safer: below 70 every map collapses into its largest zone — glacier goes to
 * `shelf 100 %, crevasse 0 %, seracs 0 %` — so the density numbers improve by deleting the map.
 * A test that only had a ceiling would wave that through.
 */
describe('how far a map spreads its players', () => {
  it('reaches more than one of the places it built', () => {
    /**
     * The floor on the leash, and the reason it is not a number.
     *
     * This was `playRadius >= 75`, copied off the maps as they stood — which made it impossible to
     * rescale one without the test calling the smaller map broken, and it would have said nothing
     * at all about a map authored at a different size in the first place. What actually matters is
     * that the leash reaches somewhere other than the middle: below that, every map collapses into
     * its largest zone (glacier read `shelf 100 %, crevasse 0 %, seracs 0 %`) and every density
     * figure improves by deleting the map.
     *
     * The ceiling needs no assertion of its own — the ambience test samples the whole leash disc,
     * so a leash that grows past the zones fails there.
     */
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      const leash = level.playRadius * 0.75;
      const reachable = level.zones.filter((z) => Math.hypot(z.center.x, z.center.z) - z.radius < leash);
      expect(
        reachable.map((z) => z.name),
        `${entry.id}: the leash only reaches one place, so the map is that place`,
      ).not.toHaveLength(1);
    }
  });

  it('has an ambience everywhere a player can be', () => {
    /**
     * Outside every zone, `updateZone` calls `setAmbience(null)` and the bed stops — the world
     * goes silent. Every map's primary zone ended at 60–66 m while the leash puts players at
     * 67.5 m, so there was a ring right where they spend their time with no ambience in it at
     * all: measured at 29 % of an Outback round and 20 % of a glacier one.
     *
     * Sampled across the disc the bots actually stay inside, and at height, because `zoneAt`
     * measures in three dimensions — a player on a tree platform is further from a zone's centre
     * than the map from above would suggest.
     */
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      const leash = level.playRadius * 0.75;
      for (let ring = 0; ring <= 8; ring++) {
        const radius = (leash * ring) / 8;
        for (let step = 0; step < 16; step++) {
          const angle = (step / 16) * Math.PI * 2;
          for (const y of [0, 12, 24]) {
            const at = { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
            expect(
              zoneAt(level, at),
              `${entry.id}: silence at (${at.x.toFixed(0)}, ${y}, ${at.z.toFixed(0)}), ${radius.toFixed(0)} m out`,
            ).toBeDefined();
          }
        }
      }
    }
  });

  it('reaches every zone it authored', () => {
    /**
     * The check that makes the lower bound mean something: a zone the leash cannot reach is a zone
     * nobody will ever see. Measured against the turn-back radius rather than `playRadius` itself,
     * because that is the circle bots actually stay inside.
     */
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      const leash = level.playRadius * 0.75;
      for (const zone of level.zones) {
        const distance = Math.hypot(zone.center.x, zone.center.z);
        // Reachable if any part of the zone falls inside the leash.
        expect(
          distance - zone.radius,
          `${entry.id}: the ${zone.name} zone sits ${distance.toFixed(0)} m out, past the ${leash.toFixed(0)} m leash`,
        ).toBeLessThan(leash);
      }
    }
  });
});


/**
 * A ramp has to arrive at the height it was asked for.
 *
 * `LevelBuilder.ramp()` used to add its minimum step thickness *upward*, about a centre of
 * `y / 2`, so any step whose top fell below 0.6 m rose above the height the ramp asked for. A
 * negative `y` lost the `Math.max` outright: the half-height pinned to 0.3 while the centre
 * stayed at `y / 2`, so the descent came out halved. Measured on the glacier's crevasse ramp,
 * which asks for -8: it bottomed out at **-3.70**, leaving a 4.3 m drop at the end of the only
 * way down. Crevasse occupancy was 9 %; it is 15 % now that the ramp is walkable.
 *
 * The jungle's two ramps had been authored against that bug — they said -8 over floors at -4,
 * and -8 halved is exactly what made them land right. They ask for -4 now.
 *
 * Tested on the builder rather than by scanning built levels: post-hoc, a ramp step is not
 * distinguishable from any other narrow box, and a heuristic that guesses wrong reports a map's
 * unrelated geometry as a broken ramp. This asks the one question that has a right answer.
 */
describe('LevelBuilder.ramp', () => {
  function tops(y0: number, y1: number): { top: number; bottom: number }[] {
    const b = new LevelBuilder(new Rand(1));
    const before = b.colliders.length;
    b.ramp(0, 0, 4, 12, y0, y1, 0, 'jungle');
    return b.colliders
      .slice(before)
      .filter((c): c is Extract<Collider, { kind: 'box' }> => c.kind === 'box')
      .map((c) => ({ top: c.center.y + c.half.y, bottom: c.center.y - c.half.y }))
      .sort((a, b2) => a.top - b2.top);
  }

  const MIN_STEP_THICKNESS = 0.6;

  it.each([
    ['uphill from the ground', 0, 6],
    ['downhill to the ground', 6, 0],
    ['downhill between two heights', 10, 6],
    ['downhill below the ground', 0, -8],
    ['a shallow climb, every step under the minimum thickness', 0, 1],
  ])('puts every step top exactly where asked: %s', (_label, y0, y1) => {
    const steps = tops(y0, y1);
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    // The interpolation samples step centres, so tops land strictly inside the range.
    expect(Math.min(...steps.map((s) => s.top))).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(Math.max(...steps.map((s) => s.top))).toBeLessThanOrEqual(hi + 1e-9);
    // The deepest and highest steps reach within one step of each end, so the ramp spans its run.
    const rise = (hi - lo) / steps.length;
    expect(Math.min(...steps.map((s) => s.top))).toBeLessThanOrEqual(lo + rise + 1e-9);
    expect(Math.max(...steps.map((s) => s.top))).toBeGreaterThanOrEqual(hi - rise - 1e-9);
  });

  it('never makes a step thinner than the solver can stop', () => {
    // A box with no thickness is a plane a capsule tunnels through at speed.
    for (const [y0, y1] of [[0, 1], [0, -8], [6, 0], [10, 6]] as const) {
      for (const s of tops(y0, y1)) {
        expect(s.top - s.bottom).toBeGreaterThanOrEqual(MIN_STEP_THICKNESS - 1e-9);
      }
    }
  });

  it('gives a step its thickness downward, which is what the bug got backwards', () => {
    // Mutation guard: `max(0.3, y/2)` about a centre of `y/2` pushed a low step's top up instead.
    const shallow = tops(0, 1);
    const highest = shallow[shallow.length - 1];
    expect(highest?.top).toBeLessThanOrEqual(1 + 1e-9);
    expect(shallow[0]?.bottom).toBeLessThan(0);
  });
});
