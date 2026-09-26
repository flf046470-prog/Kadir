import { Rand, hashString } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { LevelBuilder } from './builder.js';
import { registerLevel } from './registry.js';
import type { LevelDef } from './level.js';
import { LOBBY_MODE_IDS } from './level.js';

export const GLACIER_SEED = hashString('kangaroo-chase/glacier-world/v1');

/**
 * Glacier World — the second map.
 *
 * The jungle is about *climbing*: trees, branches, mushrooms that throw you upward. A second map
 * that was another set of platforms in a different colour would add scenery and no game, so this
 * one is about *not stopping*. Almost every surface is `wetRock`, which the physics already
 * treats as slippery at 0.35 friction — a third of the grip the jungle floor gives — so a chase
 * here is decided by where you commit to a turn rather than by how fast you can run.
 *
 * Three areas, each answering the slipperiness differently:
 *   Shelf   (x ≈ 0)    a wide open rink. Nowhere to hide, and you slide past whoever you lunge at.
 *   Crevasse(x ≈ -42)  narrow ice canyon under the surface: dark, tight, and the only place with
 *                      grip, because the walls are bare rock. Runners go here to stop.
 *   Seracs  (x ≈ +43)  a field of ice towers with bouncy snow drifts between them — the vertical
 *                      route, and the only way to cross the map without touching the rink.
 *
 * Generated from a seed like every level, so the client and the server build byte-identical
 * worlds without shipping any mesh data.
 */
export function buildGlacierWorld(seed = GLACIER_SEED): LevelDef {
  const rand = new Rand(seed);
  const b = new LevelBuilder(rand);

  buildIceShelf(b, rand);
  buildCrevasse(b, rand);
  buildSeracField(b, rand);
  dressGlacier(b, rand);
  buildGlacierRoute(b);

  // The same ring of doors, so the lobby reads identically whichever map you are standing on.
  b.spawn(vec3(0, 0.5, 0), 0, 'shelf', 'lobby');
  b.addModePortals(LOBBY_MODE_IDS, vec3(0, 0.5, 0));

  b.zone('shelf', vec3(0, 0, 0), 50, 'canyon', 0.04);
  // Below the ice and genuinely dark — the same role the jungle's cave plays, and the reason the
  // zone darkness work had to land before a second map could be worth building.
  b.zone('crevasse', vec3(-42, 0, 0), 20, 'cave', 0.7);
  // Out the way you came in: the foot of the ramp, then onto the rink past its top.
  b.exit('crevasse', vec3(-59, -8, 0), vec3(-34, 0, 0));
  b.zone('seracs', vec3(43, 0, 2), 24, 'canyon', 0.12);

  // Last, so it measures every floor that exists: wall off each edge that drops straight to the
  // kill plane with a cliff nobody can jump or climb. See `LevelBuilder.enclose`.
  const killPlaneY = -40;
  b.enclose(killPlaneY, 'cliffIce');

  return b.build({
    id: 'glacier-world',
    name: 'Glacier World',
    // 3: the crevasse ramp reaches the crevasse floor. Its -8 was always right — the floor is at
    // exactly -8 — but `ramp()` bottomed the descent out at -3.7, leaving a 4.3 m drop at the end
    // of a ramp. Measured: crevasse occupancy 9 % -> 15 % once it is walkable.
    // 4: yawed towers collide where they are drawn, and the snow drifts rest on the ice.
    // 5: walled edges; the crevasse ends at the rim instead of under it, with a solid ramp.
    version: 5,
    seed,
    killPlaneY,
    // Scales with the map: 54 puts the turn-back at 40.5 m, which is this rink's far rim, and
    // still clears both outlying zones. See `LevelDef.playRadius`.
    playRadius: 54,
    ambientColor: 0x6d8ba8,
    // A pale, slightly grey sky. A saturated blue over white ice makes the horizon vanish, and
    // players read distance off the horizon when everything underfoot is the same colour.
    skyColor: 0xc7dcea,
    // Denser than the jungle's 0.0075: haze is what stops a white plain reading as a void, and it
    // is the one cue that tells you how far away the far wall is.
    fogDensity: 0.011,
  });
}

/**
 * The open rink.
 *
 * Deliberately close to featureless. A tag game needs one place with no cover, and ice is the
 * honest way to make an empty floor interesting: the scattered boulders are not decoration, they
 * are the only things you can push off to change direction.
 */
/** How wide the way down into the crevasse is; the rink's rim leaves a gap for it. */
const CREVASSE_RAMP_WIDTH = 12;

function buildIceShelf(b: LevelBuilder, rand: Rand): void {
  b.box(vec3(0, -1, 0), vec3(38, 1, 38), 'ice', 0, 'shelf');

  // A low rim, so a player who loses control slides to a stop instead of off the map. Bare rock:
  // the one edge of the rink you can actually grab. Open on the west for the crevasse ramp: the rim
  // used to run straight across its top, so the way down led into the underside of a wall.
  const mouth = CREVASSE_RAMP_WIDTH / 2 + 0.5;
  const westHalf = (38 - mouth) / 2;
  for (const [dx, dz, sx, sz] of [
    [0, -38, 38, 1.5],
    [0, 38, 38, 1.5],
    [-38, -(mouth + westHalf), 1.5, westHalf],
    [-38, mouth + westHalf, 1.5, westHalf],
    [38, 0, 1.5, 38],
  ] as const) {
    b.box(vec3(dx, 0.4, dz), vec3(sx, 1.4, sz), 'rock', 0, 'shelf');
  }

  // Pressure ridges: low walls of broken ice that break the sightlines without giving cover.
  for (let i = 0; i < 7; i++) {
    const x = rand.range(-30, 30);
    const z = rand.range(-30, 30);
    if (Math.hypot(x, z) < 9) continue; // keep the spawn clear
    const length = rand.range(5, 13);
    const yaw = rand.range(0, Math.PI);
    b.box(vec3(x, 0.5, z), vec3(length, 1.5, 1.2), 'rock', yaw, 'shelf');
    b.grip(vec3(x, 2, z), vec3(0, 1, 0), 'rock');
  }

  // Boulders frozen into the surface — the push-off points.
  for (let i = 0; i < 14; i++) {
    const x = rand.range(-33, 33);
    const z = rand.range(-33, 33);
    if (Math.hypot(x, z) < 7) continue;
    const radius = rand.range(1.4, 3.2);
    b.sphere(vec3(x, radius * 0.45, z), radius, 'rock', 'shelf');
  }

  b.spawn(vec3(0, 0.4, 0), 0, 'shelf', 'start');
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    b.spawn(vec3(Math.cos(angle) * 12, 0.4, Math.sin(angle) * 12), -angle, 'shelf', i < 2 ? 'chaser' : 'runner');
  }
}

/**
 * The crevasse: a slot beside the shelf, reached by a ramp at its mouth.
 *
 * The only place on the map with full grip, which is what makes it worth the risk of going
 * somewhere with one exit.
 *
 * It ends at the rink's rim (x = -38) with a wall under the lip. It used to run 7 m further, under
 * the shelf, and stop there over nothing: a dark pocket beneath the rink whose far side dropped to
 * the kill plane, with the ramp tucked under the lip so that only a 1.5 m strip of it had
 * headroom. Measured with a racing bot: once that drop was walled, it pinned itself in the pocket
 * for the last ninety seconds of the race, because the only way it had ever left was by falling.
 */
function buildCrevasse(b: LevelBuilder, rand: Rand): void {
  const RIM = -38;
  const FLOOR = -8;
  // Ramp up to the rink, rising east so it meets the shelf edge head on. Rock, not ice: a slippery
  // ramp into a hole is a trap rather than a route, and the player has to be able to come back up
  // it. It is solid to the floor — see `LevelBuilder.ramp` — so it reads as a slope, not a stair of
  // slabs you can walk under.
  const RAMP_LENGTH = 17;
  b.ramp(RIM - RAMP_LENGTH / 2, 0, CREVASSE_RAMP_WIDTH, RAMP_LENGTH, FLOOR, 0, Math.PI / 2, 'crevasse');

  const west = -63;
  const midX = (west + RIM) / 2;
  const halfX = (RIM - west) / 2;
  b.box(vec3(midX, FLOOR - 1, 0), vec3(halfX, 1, 12), 'snow', 0, 'crevasse');

  // Walls and roof. The roof is what makes it dark and what stops the sun reaching in.
  b.box(vec3(midX, -2, -13), vec3(halfX, 8, 1.5), 'rock', 0, 'crevasse');
  b.box(vec3(midX, -2, 13), vec3(halfX, 8, 1.5), 'rock', 0, 'crevasse');
  b.box(vec3(midX, 6, 0), vec3(halfX, 1, 13), 'rock', 0, 'crevasse');
  b.box(vec3(west, -2, 0), vec3(1.5, 8, 13), 'rock', 0, 'crevasse');
  // Under the lip, floor to the underside of the ice: the crevasse's east face.
  b.box(vec3(RIM + 0.75, -6, 0), vec3(0.75, 4, 14.5), 'rock', 0, 'crevasse');

  // Ice columns from floor to roof: the cover that makes a dead end survivable. Either side of the
  // ramp, never through it, and clear of its sides: a column within a body's width of the ramp
  // closes the walk along it to the foot.
  for (let i = 0; i < 9; i++) {
    const x = -42 - i * 2 - rand.range(0, 1.2);
    const z = (i % 2 === 0 ? 1 : -1) * rand.range(8, 10.4);
    b.cylinder(vec3(x, -2.5, z), rand.range(0.5, 0.9), 5.5, 'glazedIce', 'crevasse');
  }

  // Ledges up one wall — the climb back out that is not the ramp.
  for (let i = 0; i < 5; i++) {
    const x = -40 - i * 3.6;
    b.platform(x, -5 + i * 1.6, -10, 3.5, 2.5, 'crevasse');
    b.grip(vec3(x, -4 + i * 1.6, -10), vec3(0, 0, 1), 'ledge');
  }

  b.spawn(vec3(-58, FLOOR, 7), Math.PI / 2, 'crevasse', 'runner');
}

/**
 * Serac field: ice towers with snow drifts between them.
 *
 * The vertical route. Drifts use the `mushroom` surface — already bouncy in the physics — because
 * a bounce is the only way to gain height on a map with no trees to climb.
 */
/** Where a runner starts in the serac field; the towers are kept off it. */
const SERAC_SPAWN = { x: 43, z: 12 };

function buildSeracField(b: LevelBuilder, rand: Rand): void {
  b.box(vec3(43, -1, 2), vec3(24, 1, 24), 'ice', 0, 'seracs');

  const towers: { x: number; z: number; height: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const x = 24 + rand.range(0, 38);
    const z = rand.range(-19, 24);
    const height = rand.range(5, 16);
    // Every draw happens before the skip, so the sequence is the same whether a tower lands or
    // not and the map still builds byte-identically from its seed.
    const footprint = vec3(rand.range(1.6, 3.4), height / 2, rand.range(1.6, 3.4));
    const yaw = rand.range(0, Math.PI);
    /**
     * Nothing on top of the spawn.
     *
     * The rink has kept its own spawn clear since it was built; this field never needed to,
     * because sixteen towers scattered over 80 m rarely hit one point. Packing the same sixteen
     * into a field 0.6 the size put one straight onto the runner spawn — a player starting the
     * round inside a block of ice. Caught by the cross-level spawn test, which is the second time
     * tightening a map has done this.
     */
    if (Math.hypot(x - SERAC_SPAWN.x, z - SERAC_SPAWN.z) < 5) continue;
    towers.push({ x, z, height });
    b.box(vec3(x, height / 2, z), footprint, 'glazedIce', yaw, 'seracs');
    // A grip at the top of each: the towers are climbable at the lip only, so the route is a
    // sequence of committed jumps rather than a wall you can shimmy up anywhere.
    b.grip(vec3(x, height, z), vec3(0, 1, 0), 'ledge');
  }

  // Snow drifts wedged between the towers.
  for (let i = 0; i < 10; i++) {
    const a = towers[Math.floor(rand.range(0, towers.length))];
    if (!a) continue;
    // On the ice, not 0.8 m above it: a drift that lands against a tower looked wedged, and one
    // that landed in the open hovered — two of the ten, found by listing colliders touching nothing.
    b.mushroom(a.x + rand.range(-6, 6), 0, a.z + rand.range(-6, 6), rand.range(1.2, 2.2), 'seracs');
  }

  // Bridges between the taller towers, so there is a high line across the whole field.
  const tall = towers.filter((t) => t.height > 9).sort((x, y) => x.x - y.x);
  for (let i = 0; i + 1 < tall.length; i++) {
    const from = tall[i];
    const to = tall[i + 1];
    if (!from || !to) continue;
    const midX = (from.x + to.x) / 2;
    const midZ = (from.z + to.z) / 2;
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    if (span > 22) continue; // too far to be a bridge; leave it as a jump
    // Long along local +Z and yawed to face `to`, which is the rotation every box uses — see
    // `BoxCollider.yaw`. This used to be long along X at atan2(dz, dx): right under the mirrored
    // rotation physics once applied, so the bridges *collided* across their towers while being
    // *drawn* pointing somewhere else, and fixing the physics would have broken the high line.
    const yaw = Math.atan2(to.x - from.x, to.z - from.z);
    b.box(vec3(midX, Math.min(from.height, to.height) - 0.4, midZ), vec3(1.3, 0.3, span / 2), 'platform', yaw, 'seracs');
  }

  b.spawn(vec3(SERAC_SPAWN.x, 0.4, SERAC_SPAWN.z), -Math.PI / 2, 'seracs', 'runner');
}

/**
 * Scenery, after every area exists.
 *
 * Deliberately a separate pass for the reason the jungle learned the hard way: a district that
 * dressed itself before its neighbours were built scattered props into walls that did not exist
 * yet, and ten of them ended up inside cave pillars.
 */
function dressGlacier(b: LevelBuilder, rand: Rand): void {
  // The glacier has no trees and no foliage, so the shelf is dressed with rock only — anything
  // green would read as the wrong map.
  for (let i = 0; i < 40; i++) {
    const x = rand.range(-35, 35);
    const z = rand.range(-35, 35);
    if (Math.hypot(x, z) < 6) continue;
    b.rocks(x, z, 2, rand.range(0.4, 0.9), 'shelf');
  }
  for (let i = 0; i < 26; i++) {
    b.rocks(24 + rand.range(0, 36), rand.range(-18, 23), 2, rand.range(0.4, 1), 'seracs');
  }
  // Crystals in the crevasse: the only light down there that is not the player's own. On the floor
  // either side of the ramp, not buried in it.
  for (let i = 0; i < 18; i++) {
    const z = (i % 2 === 0 ? 1 : -1) * rand.range(6.6, 10.8);
    b.prop('crystal', vec3(-42 - rand.range(0, 18), -8 + rand.range(0, 0.4), z), rand.range(0, Math.PI * 2), rand.range(0.6, 1.4));
  }
}

/** The parkour line: rink, down into the crevasse, out, and up the seracs. */
function buildGlacierRoute(b: LevelBuilder): void {
  b.checkpoint(vec3(0, 1, 0), 4.5);
  b.checkpoint(vec3(-34, 0.5, 0), 5);
  b.checkpoint(vec3(-58, -7.5, 0), 5);
  b.checkpoint(vec3(-40, -3.5, -10), 4.5);
  b.checkpoint(vec3(29, 1, 2), 5);
  b.checkpoint(vec3(52, 12, 4), 6, true);
}

registerLevel({
  id: 'glacier-world',
  name: 'Glacier World',
  description: 'Ice underfoot. You slide past whoever you lunge at, so a chase is won on the turn.',
  build: buildGlacierWorld,
});
