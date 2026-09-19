import { describe, expect, it } from 'vitest';

import type { Collider } from '../physics/types.js';
import type { Vec3 } from '../math/vec3.js';
import { buildLevel, listLevels } from './registry.js';
import { buildOutbackWorld } from './outback.js';
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
  it('keeps the leash inside the authored content, and outside a single zone', () => {
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      expect(level.playRadius, `${entry.id} lets bots orbit past the built world`).toBeLessThanOrEqual(110);
      expect(level.playRadius, `${entry.id} pens everyone into one zone`).toBeGreaterThanOrEqual(75);
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
