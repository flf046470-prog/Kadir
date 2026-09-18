import { Rand, hashString } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { LevelBuilder } from './builder.js';
import { registerLevel } from './registry.js';
import type { LevelDef } from './level.js';
import { LOBBY_MODE_IDS } from './level.js';

export const OUTBACK_SEED = hashString('kangaroo-chase/outback-station/v1');

/**
 * Outback Station — the third map, and the one the animal actually comes from.
 *
 * Each map is built around a different thing going wrong for you. The jungle is about *climbing*:
 * everything worth having is above you. The glacier is about *not stopping*: the floor will not
 * let you turn. This one is about **being seen**.
 *
 * The flat is deliberately, uncomfortably open. On the other two maps you break line of sight by
 * accident — a trunk, a serac, a corner. Here you can watch your chaser commit from eighty metres
 * away, and they can watch you, so the round becomes a series of decisions about *where to be
 * when they arrive* rather than a reaction test. Everything else on the map exists to price that:
 *
 *   Gum Flat  (x ≈ 0)    open red dirt under scattered gums. Nowhere to hide at ground level; the
 *                        trees are the only cover and they are also the only way up.
 *   The Gorge (x ≈ -74)  a creek cut fifteen metres into the rock. The one place on the map with
 *                        no sightline at all — and you pay for it in the creek, whose water is the
 *                        slowest surface here, and in the climb back out.
 *   Station   (x ≈ +76)  an abandoned sheep station: shed, tank, windmill, fences. Man-made right
 *                        angles and corrugated iron, which is the only slippery surface on the map
 *                        and sits on the roof you most want to run along.
 *
 *   The Track            a dirt road linking the gorge to the station across the south of the
 *                        flat. Straight, fast, and completely exposed — the honest shortcut.
 *
 * Generated from a seed like every level, so the client and the server build byte-identical worlds
 * without shipping a single byte of mesh.
 */
export function buildOutbackWorld(seed = OUTBACK_SEED): LevelDef {
  const rand = new Rand(seed);
  const b = new LevelBuilder(rand);

  buildApron(b, rand);
  buildGumFlat(b, rand);
  buildGorge(b, rand);
  buildStation(b, rand);
  buildTrack(b, rand);
  buildOutbackRoute(b);

  // The same ring of doors, so the lobby reads identically whichever map you are standing on.
  b.spawn(vec3(0, 0.5, 0), 0, 'flat', 'lobby');
  b.addModePortals(LOBBY_MODE_IDS, vec3(0, 0.5, 0));
  buildSpawns(b);

  b.zone('flat', vec3(0, 0, 0), 66, 'jungle', 0);
  b.zone('gorge', vec3(-74, -8, 0), 34, 'canyon', 0.25);
  // Genuinely dark, and the only such pocket here. On a map whose whole subject is sightlines, one
  // room you cannot be seen in is worth more than it would be anywhere else.
  b.zone('cave', vec3(-88, -7, 22), 16, 'cave', 0.72);
  b.zone('station', vec3(76, 0, 0), 38, 'village', 0.06);

  return b.build({
    id: 'outback-station',
    name: 'Outback Station',
    version: 1,
    seed,
    killPlaneY: -40,
    playRadius: 150,
    // Warm bounce off red earth. The ground is the biggest light source on a map with no canopy,
    // and a neutral ambient here made the gums read as grey rather than sun-bleached.
    ambientColor: 0x9c8567,
    // Pale and hot rather than a deep blue: an Australian midday sky loses most of its saturation,
    // and a saturated one over ochre ground reads as a cartoon rather than as glare.
    skyColor: 0xa9c6e2,
    /**
     * Thinner haze than either other map, on purpose.
     *
     * Fog is how the jungle hides its draw distance and how the glacier stops a white plain reading
     * as a void. Here the long view *is* the mechanic, so the fog only has to suggest dust and heat
     * — enough that the far cliffs sit behind the near ones, and no more.
     */
    fogDensity: 0.0052,
  });
}

/**
 * The plain, carrying on past the edge of the map.
 *
 * Empty ground out to the fog, on every side except the one the gorge cuts. It holds nothing and
 * it is not meant to: it exists so that the edge of the playable area is a place rather than a
 * drop, which is worth more here than on either other map. This one is *about* the long view, and
 * a world that visibly stops eighty metres away is a diorama.
 *
 * It also retires the argument the boundary walls were having with the art direction. With ground
 * under you out there, the ridge and the station fence only have to say "the game is behind you",
 * so they can be knee- and chest-height instead of four metres of grey.
 */
function buildApron(b: LevelBuilder, rand: Rand): void {
  // A frame, not a slab: the middle is left to the flat, the station and the gorge, which sit at
  // three different heights and would otherwise be fighting one enormous box for the same space.
  b.box(vec3(4, -1, 108), vec3(146, 1, 42), 'redEarth', 0, 'flat');
  b.box(vec3(4, -1, -108), vec3(146, 1, 42), 'redEarth', 0, 'flat');
  b.box(vec3(132, -1, 0), vec3(18, 1, 66), 'redEarth', 0, 'flat');
  b.box(vec3(-120, -1, 0), vec3(30, 1, 66), 'redEarth', 0, 'flat');
  // The two corners either side of the gorge's ends, which none of the above reaches.
  b.box(vec3(-74, -1, 55), vec3(16, 1, 11), 'redEarth', 0, 'flat');
  b.box(vec3(-74, -1, -55), vec3(16, 1, 11), 'redEarth', 0, 'flat');

  // A thin scatter of scrub, thinning further out. Visual only, and sparse: the apron has to read
  // as distance, and distance with detail in it reads as somewhere worth walking to.
  for (let i = 0; i < 70; i++) {
    const angle = rand.range(0, Math.PI * 2);
    const dist = rand.range(74, 142);
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;
    // Nothing inside the gorge's footprint, where there is no apron to stand on.
    if (x > -92 && x < -56 && Math.abs(z) < 46) continue;
    b.prop('bush', vec3(x, 0, z), rand.range(0, Math.PI * 2), rand.range(0.5, 1.1), rand.bool(0.5) ? 0 : 1);
  }
}

/**
 * The open flat.
 *
 * Almost no cover below head height, which is the point. The gums are spaced so that no two are
 * close enough to string together at a run: committing to one is committing to being at that tree
 * for a while, which is the decision this map is built to force.
 */
function buildGumFlat(b: LevelBuilder, rand: Rand): void {
  /**
   * The floor stops short of the gorge on the west.
   *
   * The first version was a square centred on the origin, which put seven metres of flat *on top
   * of* the gorge's eastern end — the canyon had a lid. Offsetting the centre east instead of
   * widening it keeps the lobby where it is and leaves the cliff face as the boundary it was
   * always meant to be.
   */
  b.box(vec3(4, -1, 0), vec3(62, 1, 66), 'redEarth', 0, 'flat');

  /**
   * The rim of the basin.
   *
   * `playRadius` is a hint to the bot steering and nothing else — measured, nothing in the physics
   * or the simulation reads it — so without this a player who simply keeps running leaves the
   * floor and falls to the kill plane. Driving six bots for two minutes did exactly that on every
   * mode before this existed.
   *
   * Built as a low ridge rather than the glacier's wall: this map is about the long view, and a
   * four-metre barrier at the horizon would take away the thing it is for. At 2.2 m and climbable
   * it stops a run, and standing on it is the best vantage point on the flat — which is the right
   * reward for someone who went looking at the edge of the world.
   *
   * The two gaps are deliberate and are the map's connections: west into the gorge (a cliff, not a
   * door — you commit) and east into the station yard.
   */
  const ridge = (cx: number, cz: number, hx: number, hz: number) =>
    b.box(vec3(cx, 0.5, cz), vec3(hx, 1.1, hz), 'redRock', 0, 'flat');
  ridge(4, 66, 62, 1.6);
  ridge(4, -66, 62, 1.6);
  // East: open where the station yard continues (|z| < 38), ridged beyond it.
  ridge(66, 52, 1.6, 14);
  ridge(66, -52, 1.6, 14);
  // West: open where the gorge is cut (|z| < 44) — that edge is a cliff, and falling in is a
  // legitimate, fast, and expensive way to enter it.
  ridge(-58, 55, 1.6, 11);
  ridge(-58, -55, 1.6, 11);

  // River red gums. Tall, bare for the first third, then branches — so the climb is committing and
  // the payoff is a real vantage point over the whole flat.
  const LOBBY_CLEAR = 15;
  for (let i = 0; i < 20; i++) {
    const angle = rand.range(0, Math.PI * 2);
    const dist = rand.range(LOBBY_CLEAR + 4, 54);
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;
    // Skip anything that would land on the road; the track is only a shortcut if it is clear.
    if (Math.abs(z + 34) < 7) continue;
    b.tree(x, z, rand.range(11, 19), 'flat', 1);
  }

  // Termite mounds. Waist-high, hard, and scattered — the only thing on the flat you can put
  // between yourself and someone at ground level, and too small to hide behind for long.
  for (let i = 0; i < 14; i++) {
    const angle = rand.range(0, Math.PI * 2);
    const dist = rand.range(LOBBY_CLEAR + 2, 54);
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;
    if (Math.abs(z + 34) < 6) continue;
    const height = rand.range(1.3, 2.4);
    b.cylinder(vec3(x, height * 0.5, z), rand.range(0.5, 0.9), height * 0.5, 'dirt', 'flat');
    b.prop('stalagmite', vec3(x, 0, z), rand.range(0, Math.PI * 2), height * 0.6, 1);
  }

  // Two granite outcrops. The only ground-level cover worth the name, and deliberately placed out
  // towards the rim so that using them means leaving the middle.
  /**
   * Kept clear of the ring the runner spawns sit on (radius 52), one inside it and one outside.
   *
   * `rocks` scatters its boulders with the level's RNG out to about 1.6× the cluster scale, so an
   * outcrop whose radius from the lobby is near 52 will eventually put a boulder on top of a spawn
   * point — which is what happened the moment the apron was added ahead of this call and shifted
   * the random stream by a few draws. The spawn-inside-scenery test caught it immediately, and it
   * is the reason that test exists.
   */
  b.rocks(-20, 22, 7, 3.2, 'flat');
  b.rocks(44, -46, 6, 3.6, 'flat');
  // A fallen gum: a low run-up that gets you high enough to reach the first branch of its neighbour.
  b.box(vec3(20, 1.1, 24), vec3(7, 1.1, 1.1), 'wood', 0.7, 'flat');
  b.prop('log', vec3(20, 0.2, 24), 0.7, 2.2, 0);

  // Scrub. Visual only — the flat needs to read as bush rather than as a car park, and a collider
  // here would give exactly the ankle-height cover the map is designed not to have.
  for (let i = 0; i < 46; i++) {
    const angle = rand.range(0, Math.PI * 2);
    const dist = rand.range(LOBBY_CLEAR, 56);
    b.prop(
      rand.bool(0.3) ? 'flower' : 'bush',
      vec3(Math.sin(angle) * dist, 0, Math.cos(angle) * dist),
      rand.range(0, Math.PI * 2),
      rand.range(0.6, 1.5),
      rand.bool(0.5) ? 0 : 1,
    );
  }
}

/**
 * The gorge: a creek bed cut into the rock, and the only place here you cannot be seen.
 *
 * Fifteen metres down, walls on both sides, and a strip of water along the bottom. The water is
 * the price — it is the slowest surface on the map — so the gorge buys you invisibility and costs
 * you the ability to outrun anyone who followed you in.
 */
function buildGorge(b: LevelBuilder, rand: Rand): void {
  const FLOOR_Y = -15;

  // The bed itself, running north-south so it cuts across anyone crossing the map east-west.
  b.box(vec3(-74, FLOOR_Y - 1, 0), vec3(15, 1, 44), 'redRock', 0, 'gorge');
  // The creek. A shallow channel down the middle rather than the whole floor: there is a dry route
  // through, it is just the one everybody can predict.
  b.box(vec3(-74, FLOOR_Y - 0.6, 0), vec3(4.5, 0.6, 44), 'water', 0, 'gorge');

  // Walls. Sheer on the east side (the side you arrive from, so entering is a commitment) and
  // stepped on the west, which is the way out. The east face is split to leave the scree notch.
  b.box(vec3(-58, FLOOR_Y / 2, 25), vec3(1.5, 8, 19), 'redRock', 0, 'gorge');
  b.box(vec3(-58, FLOOR_Y / 2, -25), vec3(1.5, 8, 19), 'redRock', 0, 'gorge');
  for (let step = 0; step < 5; step++) {
    const y = FLOOR_Y + 2.6 + step * 2.9;
    b.box(vec3(-90 + step * 2.1, y, rand.range(-16, 16)), vec3(2.6, 0.5, 5.5), 'redRock', 0, 'gorge');
    b.grip(vec3(-90 + step * 2.1, y + 0.5, 0), vec3(0, 1, 0), 'ledge');
  }
  b.box(vec3(-92, FLOOR_Y / 2, 0), vec3(1.5, 8, 44), 'redRock', 0, 'gorge');
  // End caps. The side walls were there from the start and these were not, so the gorge was a
  // corridor open at both ends into fifteen metres of nothing.
  b.box(vec3(-74, FLOOR_Y / 2, 44), vec3(15, 8, 1.5), 'redRock', 0, 'gorge');
  b.box(vec3(-74, FLOOR_Y / 2, -44), vec3(15, 8, 1.5), 'redRock', 0, 'gorge');

  /**
   * The way in from the flat: a scree slope through the notch in the east face.
   *
   * Stepped by hand rather than with `b.ramp`, which cannot do this. That helper centres each step
   * at `y / 2` with a half-height of `max(0.3, y / 2)` — arithmetic that assumes a ramp rising from
   * ground level, and which for a descent to −14 m produces thin slabs buried inside the floor.
   * Measured: the first version of this entrance was completely inside the ground.
   *
   * Fast down, awkward up. The stepped west wall is the way out, and it is at the far side.
   */
  const SCREE_STEPS = 11;
  for (let i = 0; i < SCREE_STEPS; i++) {
    const t = (i + 0.5) / SCREE_STEPS;
    const x = -57 - t * 9;
    const y = -0.8 + (FLOOR_Y + 1.2 + 0.8) * t;
    b.box(vec3(x, y, 0), vec3(0.75, 0.7, 5.5), 'redRock', 0, 'gorge');
  }

  // The cave, under an overhang at the north end. Deep enough to be properly dark.
  b.box(vec3(-88, FLOOR_Y + 7, 22), vec3(9, 1, 10), 'redRock', 0, 'cave');
  b.box(vec3(-97, FLOOR_Y + 3, 22), vec3(1, 4, 10), 'redRock', 0, 'cave');
  b.box(vec3(-88, FLOOR_Y - 1, 32), vec3(9, 1, 1.5), 'redRock', 0, 'cave');
  for (let i = 0; i < 7; i++) {
    const x = -95 + rand.range(0, 13);
    const z = 15 + rand.range(0, 14);
    b.prop('stalagmite', vec3(x, FLOOR_Y, z), rand.range(0, Math.PI * 2), rand.range(0.7, 1.6), 0);
  }

  // Boulders in the bed: the only footing that is neither wet nor exposed, and the bounce route
  // for anyone who would rather cross the gorge than go down into it.
  b.rocks(-68, -18, 5, 2.4, 'gorge');
  b.rocks(-80, 12, 6, 2.8, 'gorge');
  for (let i = 0; i < 9; i++) {
    b.prop('rock', vec3(-74 + rand.range(-13, 13), FLOOR_Y, rand.range(-40, 40)), rand.range(0, Math.PI * 2), rand.range(0.8, 1.9), 1);
  }
}

/**
 * The abandoned station.
 *
 * The only right angles on the map, and the only slippery surface: the shed roof is corrugated
 * iron, which is both the fastest way across the yard and the one place a hard turn will not hold.
 * Everything here is climbable, so the station is where a chase goes vertical — the jungle's game
 * played on a building instead of a tree.
 */
function buildStation(b: LevelBuilder, rand: Rand): void {
  // Yard: packed dirt, a little smaller than the flat so the buildings dominate it.
  b.box(vec3(76, -1, 0), vec3(38, 1, 38), 'dirt', 0, 'station');

  /**
   * The yard's edge, on the three sides that do not meet the flat.
   *
   * This started as a solid sheet-iron wall 4.4 m tall, and a screenshot from inside the yard
   * settled it: it read as a featureless grey slab across the entire horizon, which is a worse
   * thing to look at than anything it was preventing. Measured against the two shipped maps, this
   * one already leaked six times less than the jungle and twelve times less than the glacier, and
   * a player who goes over the edge is caught and respawned — so the containment was never the
   * scarce resource here. The view was.
   *
   * So: a stock fence at chest height, the same one that crosses the yard, plus the apron of plain
   * beyond it. You can hop it. There is just nothing out there.
   */
  for (const [cx, cz, hx, hz] of [
    [114, 0, 0.5, 38],
    [90, 38, 24, 0.5],
    [90, -38, 24, 0.5],
  ] as const) {
    b.box(vec3(cx, 0.75, cz), vec3(hx, 0.75, hz), 'corrugatedIron', 0, 'station');
    const along = hx > hz ? hx : hz;
    const posts = Math.round(along / 4);
    for (let i = 0; i <= posts; i++) {
      const t = (i / posts - 0.5) * 2 * along;
      b.cylinder(vec3(cx + (hx > hz ? t : 0), 0.85, cz + (hx > hz ? 0 : t)), 0.16, 0.85, 'wood', 'station');
    }
  }

  // The shearing shed. Open-sided — posts rather than walls, so a chase can run straight through
  // it at ground level and the roof above is a genuinely separate route rather than a ceiling.
  const SHED_Y = 6.4;
  for (const [px, pz] of [
    [62, -10], [62, 10], [78, -10], [78, 10], [70, -10], [70, 10],
  ] as const) {
    b.cylinder(vec3(px, SHED_Y / 2, pz), 0.42, SHED_Y / 2, 'wood', 'station');
  }
  // Floor: raised, as a shearing shed is, so stepping up onto it costs a hop.
  b.box(vec3(70, 0.6, 0), vec3(9.5, 0.6, 11.5), 'wood', 0, 'station');
  // The roof. Two pitched sheets of iron meeting at a ridge.
  b.box(vec3(66, SHED_Y + 0.9, 0), vec3(5.5, 0.35, 12), 'corrugatedIron', 0, 'station');
  b.box(vec3(75, SHED_Y + 0.9, 0), vec3(5.5, 0.35, 12), 'corrugatedIron', 0, 'station');
  b.grip(vec3(70.5, SHED_Y + 1.25, 0), vec3(0, 1, 0), 'ledge');
  b.prop('banner', vec3(70, SHED_Y + 1.6, 0), 0, 1.4, 0);

  // Water tank: a cylinder tall enough to be the yard's high ground, with a ladder of ledges.
  b.cylinder(vec3(92, 4, -14), 4.5, 4, 'corrugatedIron', 'station');
  for (let rung = 0; rung < 5; rung++) {
    const y = 1.4 + rung * 1.6;
    b.box(vec3(87.2, y, -14), vec3(0.5, 0.18, 1.2), 'wood', 0, 'station');
    b.grip(vec3(87.2, y + 0.18, -14), vec3(0, 1, 0), 'ledge');
  }

  // Windmill: the tallest thing on the map, and the only way to see into the gorge from outside it.
  const MILL_X = 90;
  const MILL_Z = 16;
  for (let leg = 0; leg < 4; leg++) {
    const dx = leg < 2 ? -1.6 : 1.6;
    const dz = leg % 2 === 0 ? -1.6 : 1.6;
    b.cylinder(vec3(MILL_X + dx, 7, MILL_Z + dz), 0.22, 7, 'wood', 'station');
  }
  for (let deck = 0; deck < 3; deck++) {
    b.platform(MILL_X, 4.5 + deck * 4.5, MILL_Z, 4.4, 4.4, 'station');
  }
  b.prop('torch', vec3(MILL_X, 14, MILL_Z), 0, 1.6, 0);

  // Fence lines. Waist-high: you vault them, you do not stop at them, and they shape where a
  // sprint across the yard can actually go.
  for (const [x0, z0, len, yaw] of [
    [76, 30, 30, 0],
    [76, -30, 30, 0],
    [52, 0, 24, Math.PI / 2],
  ] as const) {
    const posts = Math.round(len / 3);
    for (let i = 0; i <= posts; i++) {
      const t = (i / posts - 0.5) * len;
      const px = x0 + Math.cos(yaw) * t;
      const pz = z0 + Math.sin(yaw) * t;
      b.cylinder(vec3(px, 0.6, pz), 0.14, 0.6, 'wood', 'station');
    }
    b.box(vec3(x0, 1.05, z0), vec3(Math.cos(yaw) * len * 0.5 + 0.1, 0.08, Math.sin(yaw) * len * 0.5 + 0.1), 'wood', 0, 'station');
  }

  // Scatter: a dead ute-sized crate, troughs, and dry scrub against the fence.
  b.box(vec3(60, 0.9, -24), vec3(2.6, 0.9, 1.4), 'corrugatedIron', 0.4, 'station');
  for (let i = 0; i < 16; i++) {
    b.prop(
      rand.bool(0.4) ? 'log' : 'bush',
      vec3(76 + rand.range(-34, 34), 0, rand.range(-34, 34)),
      rand.range(0, Math.PI * 2),
      rand.range(0.6, 1.3),
      0,
    );
  }
}

/**
 * The track: a dirt road across the south of the flat, gorge to station.
 *
 * Every other route between the two ends of the map costs you something — the climb out of the
 * gorge, the fences and the height of the station, the trees on the flat. This one costs nothing
 * and hides nothing, which is the whole trade. It is raised slightly so it reads as a road from
 * anywhere on the flat, and so that standing on it is visibly standing in the open.
 */
function buildTrack(b: LevelBuilder, rand: Rand): void {
  b.box(vec3(0, -0.85, -34), vec3(58, 1, 4), 'redEarth', 0, 'flat');

  // Wheel ruts, as props: they say "road" at a glance from the top of a gum, which is where the
  // decision to use it or avoid it actually gets made.
  for (let i = 0; i < 22; i++) {
    const x = rand.range(-56, 56);
    b.prop('rock', vec3(x, 0.15, -34 + rand.range(-3.4, 3.4)), rand.range(0, Math.PI * 2), rand.range(0.25, 0.5), 1);
  }
  // A culvert under the road: one duck-height crossing, so the track can be left without going
  // the long way round it.
  b.box(vec3(-24, 1.2, -38.4), vec3(3, 1.2, 0.6), 'wood', 0, 'flat');
  b.box(vec3(-24, 1.2, -29.6), vec3(3, 1.2, 0.6), 'wood', 0, 'flat');
}

/**
 * Where each role starts a round.
 *
 * The first version of this map shipped with one spawn — the lobby — which the other two maps have
 * twelve and thirteen of. Every mode fell back to that single point, so six bots spent a whole
 * round of King of the Hill standing inside each other and the headline read "Contested by 6" from
 * the bell to the end. Caught by driving the map rather than by reading it.
 *
 * Runners are spread across all three areas, so a round does not open with everyone in one place
 * on a map whose subject is seeing people. Chasers start together in the middle of the flat, in
 * the open, facing out: the most exposed spot on the map, which is the right handicap for the side
 * that has the advantage.
 */
function buildSpawns(b: LevelBuilder): void {
  // Parkour and any mode that wants one neutral line.
  b.spawn(vec3(-40, 0.4, 0), Math.PI / 2, 'flat', 'start');

  // Chasers: the middle, looking outward.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    b.spawn(vec3(Math.sin(angle) * 22, 0.4, Math.cos(angle) * 22), angle, 'flat', 'chaser');
  }

  // Runners on the flat, out near the gums.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + 0.4;
    b.spawn(vec3(Math.sin(angle) * 52, 0.4, Math.cos(angle) * 52), angle + Math.PI, 'flat', 'runner');
  }
  // Runners down in the gorge and up at the station, so both ends of the map open occupied.
  b.spawn(vec3(-70, -13.6, -26), 0, 'gorge', 'runner');
  b.spawn(vec3(-78, -13.6, 24), Math.PI, 'gorge', 'runner');
  b.spawn(vec3(70, 1.6, 0), -Math.PI / 2, 'station', 'runner');
  b.spawn(vec3(90, 0.4, 24), Math.PI, 'station', 'runner');
}

/**
 * The parkour route.
 *
 * Laid out to use each area for what it is: down into the gorge, along the creek, up the stepped
 * wall, across the flat on the ground, then up the station — so a racer has to change technique
 * three times rather than repeat one.
 */
function buildOutbackRoute(b: LevelBuilder): void {
  b.checkpoint(vec3(-46, 1, 0), 4.5);
  b.checkpoint(vec3(-74, -14, -14), 5);
  b.checkpoint(vec3(-74, -14, 18), 5);
  b.checkpoint(vec3(-86, -4, 0), 5);
  b.checkpoint(vec3(-20, 0.5, -34), 5);
  b.checkpoint(vec3(34, 0.5, -34), 5);
  b.checkpoint(vec3(70, 8, 0), 5);
  b.checkpoint(vec3(90, 14, 16), 6, true);
}

registerLevel({
  id: 'outback-station',
  name: 'Outback Station',
  description: 'Red dirt and long sightlines. You will see them coming from eighty metres — and so will they.',
  build: buildOutbackWorld,
});
