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
 *   Crevasse(x ≈ -70)  narrow ice canyon under the surface: dark, tight, and the only place with
 *                      grip, because the walls are bare rock. Runners go here to stop.
 *   Seracs  (x ≈ +72)  a field of ice towers with bouncy snow drifts between them — the vertical
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

  b.zone('shelf', vec3(0, 0, 0), 72, 'canyon', 0.04);
  // Below the ice and genuinely dark — the same role the jungle's cave plays, and the reason the
  // zone darkness work had to land before a second map could be worth building.
  b.zone('crevasse', vec3(-70, 0, 0), 32, 'cave', 0.7);
  b.zone('seracs', vec3(72, 0, 4), 40, 'canyon', 0.12);

  return b.build({
    id: 'glacier-world',
    name: 'Glacier World',
    version: 1,
    seed,
    killPlaneY: -40,
    // 90 is the largest radius that abandons the empty margin and the smallest that keeps every
    // authored zone in play. See `LevelDef.playRadius`; measured per map, not chosen as a round number.
    playRadius: 90,
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
function buildIceShelf(b: LevelBuilder, rand: Rand): void {
  b.box(vec3(0, -1, 0), vec3(62, 1, 62), 'ice', 0, 'shelf');

  // A low rim, so a player who loses control slides to a stop instead of off the map. Bare rock:
  // the one edge of the rink you can actually grab.
  for (const [dx, dz, sx, sz] of [
    [0, -62, 62, 1.5],
    [0, 62, 62, 1.5],
    [-62, 0, 1.5, 62],
    [62, 0, 1.5, 62],
  ] as const) {
    b.box(vec3(dx, 0.4, dz), vec3(sx, 1.4, sz), 'rock', 0, 'shelf');
  }

  // Pressure ridges: low walls of broken ice that break the sightlines without giving cover.
  for (let i = 0; i < 7; i++) {
    const x = rand.range(-46, 46);
    const z = rand.range(-46, 46);
    if (Math.hypot(x, z) < 12) continue; // keep the spawn clear
    const length = rand.range(5, 13);
    const yaw = rand.range(0, Math.PI);
    b.box(vec3(x, 0.5, z), vec3(length, 1.5, 1.2), 'rock', yaw, 'shelf');
    b.grip(vec3(x, 2, z), vec3(0, 1, 0), 'rock');
  }

  // Boulders frozen into the surface — the push-off points.
  for (let i = 0; i < 14; i++) {
    const x = rand.range(-52, 52);
    const z = rand.range(-52, 52);
    if (Math.hypot(x, z) < 10) continue;
    const radius = rand.range(1.4, 3.2);
    b.sphere(vec3(x, radius * 0.45, z), radius, 'rock', 'shelf');
  }

  b.spawn(vec3(0, 0.4, 0), 0, 'shelf', 'start');
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    b.spawn(vec3(Math.cos(angle) * 18, 0.4, Math.sin(angle) * 18), -angle, 'shelf', i < 2 ? 'chaser' : 'runner');
  }
}

/**
 * The crevasse: a slot under the shelf, reached by a ramp at its mouth.
 *
 * The only place on the map with full grip, which is what makes it worth the risk of going
 * somewhere with one exit.
 */
function buildCrevasse(b: LevelBuilder, rand: Rand): void {
  // Ramp down from the rink's western edge. Rock, not ice: a slippery ramp into a hole is a trap
  // rather than a route, and the player has to be able to come back up it.
  b.ramp(-58, 0, 12, 22, 0, -8, 0, 'crevasse');

  b.box(vec3(-78, -9, 0), vec3(26, 1, 12), 'snow', 0, 'crevasse');

  // Walls and roof. The roof is what makes it dark and what stops the sun reaching in.
  b.box(vec3(-78, -2, -13), vec3(26, 8, 1.5), 'rock', 0, 'crevasse');
  b.box(vec3(-78, -2, 13), vec3(26, 8, 1.5), 'rock', 0, 'crevasse');
  b.box(vec3(-78, 6, 0), vec3(26, 1, 13), 'rock', 0, 'crevasse');
  b.box(vec3(-104, -2, 0), vec3(1.5, 8, 13), 'rock', 0, 'crevasse');

  // Ice columns from floor to roof: the cover that makes a dead end survivable.
  for (let i = 0; i < 9; i++) {
    const x = -70 - i * 3.4 - rand.range(0, 2);
    const z = rand.range(-9, 9);
    b.cylinder(vec3(x, -2.5, z), rand.range(0.5, 1.1), 5.5, 'glazedIce', 'crevasse');
  }

  // Ledges up one wall — the climb back out that is not the ramp.
  for (let i = 0; i < 5; i++) {
    const x = -66 - i * 6;
    b.platform(x, -5 + i * 1.6, -10, 3.5, 2.5, 'crevasse');
    b.grip(vec3(x, -4 + i * 1.6, -10), vec3(0, 0, 1), 'ledge');
  }

  b.spawn(vec3(-78, -8, 0), Math.PI / 2, 'crevasse', 'runner');
}

/**
 * Serac field: ice towers with snow drifts between them.
 *
 * The vertical route. Drifts use the `mushroom` surface — already bouncy in the physics — because
 * a bounce is the only way to gain height on a map with no trees to climb.
 */
function buildSeracField(b: LevelBuilder, rand: Rand): void {
  b.box(vec3(72, -1, 4), vec3(40, 1, 40), 'ice', 0, 'seracs');

  const towers: { x: number; z: number; height: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const x = 40 + rand.range(0, 64);
    const z = rand.range(-32, 40);
    const height = rand.range(5, 16);
    towers.push({ x, z, height });
    b.box(vec3(x, height / 2, z), vec3(rand.range(1.6, 3.4), height / 2, rand.range(1.6, 3.4)), 'glazedIce', rand.range(0, Math.PI), 'seracs');
    // A grip at the top of each: the towers are climbable at the lip only, so the route is a
    // sequence of committed jumps rather than a wall you can shimmy up anywhere.
    b.grip(vec3(x, height, z), vec3(0, 1, 0), 'ledge');
  }

  // Snow drifts wedged between the towers.
  for (let i = 0; i < 10; i++) {
    const a = towers[Math.floor(rand.range(0, towers.length))];
    if (!a) continue;
    b.mushroom(a.x + rand.range(-6, 6), 0.8, a.z + rand.range(-6, 6), rand.range(1.2, 2.2), 'seracs');
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
    const yaw = Math.atan2(to.z - from.z, to.x - from.x);
    b.box(vec3(midX, Math.min(from.height, to.height) - 0.4, midZ), vec3(span / 2, 0.3, 1.3), 'platform', yaw, 'seracs');
  }

  b.spawn(vec3(72, 0.4, 20), -Math.PI / 2, 'seracs', 'runner');
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
    const x = rand.range(-58, 58);
    const z = rand.range(-58, 58);
    if (Math.hypot(x, z) < 9) continue;
    b.rocks(x, z, 2, rand.range(0.4, 0.9), 'shelf');
  }
  for (let i = 0; i < 26; i++) {
    b.rocks(40 + rand.range(0, 60), rand.range(-30, 38), 2, rand.range(0.4, 1), 'seracs');
  }
  // Crystals in the crevasse: the only light down there that is not the player's own.
  for (let i = 0; i < 18; i++) {
    b.prop('crystal', vec3(-70 - rand.range(0, 30), -8 + rand.range(0, 0.4), rand.range(-10, 10)), rand.range(0, Math.PI * 2), rand.range(0.6, 1.4));
  }
}

/** The parkour line: rink, down into the crevasse, out, and up the seracs. */
function buildGlacierRoute(b: LevelBuilder): void {
  b.checkpoint(vec3(0, 1, 0), 4.5);
  b.checkpoint(vec3(-56, 0.5, 0), 5);
  b.checkpoint(vec3(-78, -7.5, 0), 5);
  b.checkpoint(vec3(-66, -3.5, -10), 4.5);
  b.checkpoint(vec3(48, 1, 4), 5);
  b.checkpoint(vec3(86, 12, 6), 6, true);
}

registerLevel({
  id: 'glacier-world',
  name: 'Glacier World',
  description: 'Ice underfoot. You slide past whoever you lunge at, so a chase is won on the turn.',
  build: buildGlacierWorld,
});
