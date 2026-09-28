import type { Rand } from '../math/rand.js';
import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';
import type { Collider, HeightfieldCollider, RaycastResult, SurfaceMaterial, SurfaceProps } from '../physics/types.js';
import { SurfaceFlags } from '../physics/types.js';
import { PhysicsWorld } from '../physics/world.js';
import { colliderAabb, colliderBottom, colliderReach, colliderTop, makeAabb } from '../physics/geometry.js';
import { heightfieldHeight, heightfieldMaxX, heightfieldMaxZ } from '../physics/heightfield.js';
import type { BodyKind, BodySpawn, CheckpointDef, GripDef, GripKind, LevelDef, PortalDef, PropInstance, PropKind, SpawnPoint, ZoneDef } from './level.js';

export interface SurfacePreset {
  friction: number;
  bounciness: number;
  flags: number;
  material: SurfaceMaterial;
}

/**
 * Thinnest a ramp step may be, in metres.
 *
 * A step is a box, and a box with no thickness is a plane the capsule solver can tunnel through
 * at speed. The number is the one the old `max(0.3, …)` half-height implied; what changed is the
 * direction it is applied in — downward, so it can never push a step's walking surface above the
 * height the ramp asked for.
 */
const MIN_STEP_THICKNESS = 0.6;

/** How far inside an edge `enclose` looks for something to stand on, in 1 m cells. */
const CLIFF_REACH = 8;
/**
 * How far a cliff top clears the highest thing standing within `CLIFF_REACH` of it. A full charge
 * jump peaks near 5 m (8.2 m/s × 1.75 under 24 m/s²), a crouched one about 5.1.
 */
export const CLIFF_CLEARANCE = 6;

/** One solid in a column: where its top is (to stand on) and where its bottom is (to pass under). */
interface Layer {
  top: number;
  bottom: number;
  /** Made by `enclose` itself. */
  edge: boolean;
}

/** A standing cell whose neighbour in (`di`, `dj`) drops to the kill plane. */
interface EdgeCell {
  i: number;
  j: number;
  di: number;
  dj: number;
  /** Height of the surface at the edge. */
  h: number;
  /** Cells of void beyond it, up to 4. */
  span: number;
  /** Ground at this height resumes within 4 m: a crack to plug, not an edge to wall. */
  crack: boolean;
  /** Underside of anything overhead in the void column. */
  ceiling: number;
  /** Highest thing standing within CLIFF_REACH inside the edge. */
  reach: number;
}

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Named surface presets keep level authoring readable and consistent. */
export const SURFACES = {
  dirt: { friction: 1, bounciness: 0, flags: SurfaceFlags.Climbable, material: 'dirt' },
  rock: { friction: 1, bounciness: 0.05, flags: SurfaceFlags.Climbable, material: 'rock' },
  wood: { friction: 1, bounciness: 0.05, flags: SurfaceFlags.Climbable, material: 'wood' },
  foliage: { friction: 0.85, bounciness: 0.1, flags: SurfaceFlags.Climbable, material: 'foliage' },
  smoothStone: { friction: 1, bounciness: 0, flags: SurfaceFlags.NoGrip, material: 'stone' },
  wetRock: { friction: 0.35, bounciness: 0, flags: SurfaceFlags.Climbable | SurfaceFlags.Slippery, material: 'rock' },
  mushroom: { friction: 0.9, bounciness: 0.85, flags: SurfaceFlags.Bouncy | SurfaceFlags.Climbable, material: 'foliage' },
  water: { friction: 0.3, bounciness: 0, flags: SurfaceFlags.Water, material: 'water' },
  sand: { friction: 1.15, bounciness: 0, flags: SurfaceFlags.Climbable, material: 'sand' },
  platform: { friction: 1, bounciness: 0, flags: SurfaceFlags.Climbable | SurfaceFlags.OneWay, material: 'wood' },
  /**
   * Glacier ice: `wetRock`'s physics with ice's appearance.
   *
   * Reusing `wetRock` for the glacier was the first attempt and it was wrong in the only way that
   * matters — driven in a browser, the rink read as grey concrete, because the renderer colours a
   * surface by its *material* and `wetRock` declares itself rock. A map whose whole identity is
   * "this is ice" cannot be the same colour as the cave floor.
   */
  ice: { friction: 0.35, bounciness: 0, flags: SurfaceFlags.Climbable | SurfaceFlags.Slippery, material: 'ice' },
  /** Packed snow: grip, and the one place on the glacier you can actually stop. */
  snow: { friction: 1.05, bounciness: 0, flags: SurfaceFlags.Climbable, material: 'snow' },
  /** A hard ice wall — no grip at all, which is what makes the seracs a committed jump. */
  glazedIce: { friction: 0.28, bounciness: 0.05, flags: SurfaceFlags.NoGrip | SurfaceFlags.Slippery, material: 'ice' },
  /**
   * Corrugated iron: the station's roofs, tank and crates.
   *
   * Between dirt and ice on purpose. At 0.72 you can run flat out along a shed roof and you cannot
   * turn hard on one, which is exactly the bargain the station is built around — the fastest way
   * across the yard is also the one that will not hold a swerve.
   *
   * It is the first surface to use the `metal` material, which the renderer has always had a
   * colour, a tile size and a brushed procedural texture for and which no level had ever reached.
   */
  corrugatedIron: { friction: 0.72, bounciness: 0.08, flags: SurfaceFlags.Climbable, material: 'metal' },
  /**
   * Baked red earth, and the sandstone it sits on.
   *
   * `sand`'s and `rock`'s physics exactly — the outback plays no differently underfoot, and
   * pretending otherwise would be inventing a mechanic to justify a colour. They exist because the
   * renderer picks colour and texture from the *material*, so the first build of Outback Station
   * came out as a pale yellow beach between concrete-grey cliffs. Same reason `ice` is not
   * `wetRock`.
   */
  redEarth: { friction: 1.15, bounciness: 0, flags: SurfaceFlags.Climbable, material: 'redEarth' },
  redRock: { friction: 1, bounciness: 0.05, flags: SurfaceFlags.Climbable, material: 'redRock' },
  /**
   * The edge of the world: cliff faces in each map's own stone, with no grip. See `enclose`.
   *
   * `NoGrip` is the point. Climbing is how a headset player moves, so a boundary made of climbable
   * rock is a ladder out of the map.
   */
  cliffRock: { friction: 1, bounciness: 0.05, flags: SurfaceFlags.NoGrip, material: 'rock' },
  cliffIce: { friction: 0.28, bounciness: 0.05, flags: SurfaceFlags.NoGrip | SurfaceFlags.Slippery, material: 'ice' },
  cliffRedRock: { friction: 1, bounciness: 0.05, flags: SurfaceFlags.NoGrip, material: 'redRock' },
} as const satisfies Record<string, SurfacePreset>;

export type SurfaceName = keyof typeof SURFACES;

export interface TerrainOptions {
  /** Footprint. Widened to whole cells from `minX`/`minZ`. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cellSize: number;
  /** Height of the flat ground everything is built on until `sculpt` shapes it. */
  base: number;
  /** Where the solid ends below. */
  bottom: number;
  surface: SurfaceName;
  zone?: string;
}

/**
 * How far from anything built on flat ground terrain stays flat, and how far beyond that it takes
 * to rise to its full shape. A spawn, a door, a mushroom or a ramp's foot was placed on a plane;
 * keeping a flat pad round it is what lets a map gain relief without re-authoring every placement.
 */
export const TERRAIN_CLEARANCE = 1.5;
export const TERRAIN_BLEND = 5;

/**
 * Fluent level builder. Deterministic: given the same `Rand` seed it produces byte-identical
 * levels on the server and on every client, which is what lets us ship the map as ~10 lines of
 * seed metadata instead of a mesh download.
 */
export class LevelBuilder {
  readonly colliders: Collider[] = [];
  readonly props: PropInstance[] = [];
  readonly bodies: BodySpawn[] = [];
  readonly grips: GripDef[] = [];
  readonly spawns: SpawnPoint[] = [];
  readonly checkpoints: CheckpointDef[] = [];
  readonly zones: ZoneDef[] = [];
  readonly portals: PortalDef[] = [];
  private nextId = 0;

  constructor(readonly rand: Rand) {}

  private surface(name: SurfaceName, zone?: string): SurfaceProps {
    const preset = SURFACES[name];
    void zone;
    return { friction: preset.friction, bounciness: preset.bounciness, flags: preset.flags, material: preset.material };
  }

  box(
    center: Vec3,
    half: Vec3,
    surface: SurfaceName = 'dirt',
    yaw = 0,
    zone?: string,
  ): Collider {
    const collider: Collider = {
      kind: 'box',
      id: this.nextId++,
      center,
      half,
      yaw,
      surface: this.surface(surface, zone),
      ...(zone ? { zone } : {}),
    };
    this.colliders.push(collider);
    return collider;
  }

  cylinder(center: Vec3, radius: number, halfHeight: number, surface: SurfaceName = 'wood', zone?: string): Collider {
    const collider: Collider = {
      kind: 'cylinder',
      id: this.nextId++,
      center,
      radius,
      halfHeight,
      surface: this.surface(surface, zone),
      ...(zone ? { zone } : {}),
    };
    this.colliders.push(collider);
    return collider;
  }

  sphere(center: Vec3, radius: number, surface: SurfaceName = 'rock', zone?: string): Collider {
    const collider: Collider = {
      kind: 'sphere',
      id: this.nextId++,
      center,
      radius,
      surface: this.surface(surface, zone),
      ...(zone ? { zone } : {}),
    };
    this.colliders.push(collider);
    return collider;
  }

  /**
   * Ground as a grid of heights instead of a slab. Flat at `base` until `sculpt` shapes it, so
   * everything placed in the meantime — trees, scatter, spawns — stands on it as it would on a box.
   */
  terrain(opts: TerrainOptions): HeightfieldCollider {
    const cols = Math.max(2, Math.ceil((opts.maxX - opts.minX) / opts.cellSize) + 1);
    const rows = Math.max(2, Math.ceil((opts.maxZ - opts.minZ) / opts.cellSize) + 1);
    const collider: HeightfieldCollider = {
      kind: 'heightfield',
      id: this.nextId++,
      center: vec3(opts.minX + ((cols - 1) * opts.cellSize) / 2, (opts.base + opts.bottom) / 2, opts.minZ + ((rows - 1) * opts.cellSize) / 2),
      minX: opts.minX,
      minZ: opts.minZ,
      cellSize: opts.cellSize,
      cols,
      rows,
      heights: Array.from({ length: cols * rows }, () => opts.base),
      bottom: opts.bottom,
      top: opts.base,
      surface: this.surface(opts.surface, opts.zone),
      ...(opts.zone ? { zone: opts.zone } : {}),
    };
    this.colliders.push(collider);
    return collider;
  }

  /**
   * Shape terrain once everything that stands on it exists.
   *
   * `height(x, z, free)` returns the surface height at a sample. `free` runs from 0 within
   * `TERRAIN_CLEARANCE` of anything built on the flat ground — a spawn, a door, a checkpoint, a
   * ball, a pit's way out, a collider standing at ground level, the footprint's own edge — to 1
   * past `TERRAIN_BLEND` further out; multiply relief by it and nothing placed on the plane ends
   * up buried or hanging over a hollow. A level may still carve beneath a feature on purpose (a
   * slope into a cave) by adding a term `free` does not scale.
   *
   * Then every prop that sat on the old flat ground, or is now inside the new one, is set down on
   * the surface. Call it after everything is placed and before `enclose`, which measures floors.
   */
  sculpt(hf: HeightfieldCollider, height: (x: number, z: number, free: number) => number): void {
    const base = hf.heights[0] as number;
    const maxX = heightfieldMaxX(hf);
    const maxZ = heightfieldMaxZ(hf);
    const reach = TERRAIN_CLEARANCE + TERRAIN_BLEND;

    // What was built on the flat ground, as XZ rectangles (points are zero-size rectangles).
    const keep: { minX: number; maxX: number; minZ: number; maxZ: number; pad: number }[] = [];
    const point = (p: Vec3, pad: number): void => {
      keep.push({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z, pad });
    };
    for (const s of this.spawns) if (Math.abs(s.position.y - base) < 2) point(s.position, 2);
    for (const p of this.portals) if (Math.abs(p.position.y - base) < 2) point(p.position, p.radius + 1.5);
    for (const c of this.checkpoints) if (Math.abs(c.position.y - base) < 2) point(c.position, Math.min(c.radius, 3));
    for (const body of this.bodies) point(body.position, 1);
    for (const zone of this.zones) {
      for (const exit of zone.exits ?? []) {
        point(exit.foot, 2);
        point(exit.top, 2);
      }
    }
    const box = makeAabb();
    for (const c of this.colliders) {
      if (c === hf) continue;
      colliderAabb(box, c);
      // Standing on the ground, or reaching down into it: anything whose span crosses the floor band.
      if (box.minY > base + 1 || box.maxY < base - 0.5) continue;
      if (box.maxX < hf.minX - reach || box.minX > maxX + reach || box.maxZ < hf.minZ - reach || box.minZ > maxZ + reach) continue;
      keep.push({ minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ, pad: 0 });
    }

    let top = -Infinity;
    for (let j = 0; j < hf.rows; j++) {
      for (let i = 0; i < hf.cols; i++) {
        const x = hf.minX + i * hf.cellSize;
        const z = hf.minZ + j * hf.cellSize;
        // The footprint's own edge is a feature too: whatever meets the terrain there met a plane.
        let nearest = Math.min(x - hf.minX, maxX - x, z - hf.minZ, maxZ - z);
        for (const k of keep) {
          const dx = Math.max(k.minX - x, 0, x - k.maxX);
          const dz = Math.max(k.minZ - z, 0, z - k.maxZ);
          nearest = Math.min(nearest, Math.hypot(dx, dz) - k.pad);
          if (nearest <= TERRAIN_CLEARANCE) break;
        }
        const t = Math.min(1, Math.max(0, (nearest - TERRAIN_CLEARANCE) / TERRAIN_BLEND));
        const free = t * t * (3 - 2 * t);
        const h = height(x, z, free);
        hf.heights[j * hf.cols + i] = h;
        top = Math.max(top, h);
      }
    }
    hf.top = top;
    hf.center.y = (top + hf.bottom) / 2;

    // Set down every prop that stood on the plane, or that the new ground has swallowed.
    for (const prop of this.props) {
      const { x, y, z } = prop.position;
      if (x < hf.minX || x > maxX || z < hf.minZ || z > maxZ) continue;
      const ground = heightfieldHeight(hf, x, z);
      if (Math.abs(y - base) < 0.02 || (y < ground && y > hf.bottom)) prop.position = vec3(x, ground, z);
    }
  }

  prop(kind: PropKind, position: Vec3, yaw = 0, scale = 1, tint = 0): void {
    this.props.push({ kind, position, yaw, scale, tint });
  }

  grip(position: Vec3, normal: Vec3, kind: GripKind): void {
    this.grips.push({ position, normal, kind });
  }

  /** A loose ball; it settles onto whatever is under `position` in its first second. */
  body(kind: BodyKind, position: Vec3): void {
    this.bodies.push({ kind, position });
  }

  /**
   * The same few balls beside every lobby spawn, inside the ring of doors — the first thing a new
   * player can pick up, and the thing a room of friends waiting for a round does together.
   * `floorY` is the lobby floor's top.
   */
  lobbyToys(centre: Vec3, floorY: number): void {
    this.body('football', vec3(centre.x + 2.5, floorY + 0.3, centre.z + 5.5));
    this.body('beachball', vec3(centre.x - 3, floorY + 0.5, centre.z + 6));
    this.body('football', vec3(centre.x + 4.5, floorY + 0.3, centre.z - 3.5));
  }

  spawn(position: Vec3, yaw: number, zone: string, tag?: SpawnPoint['tag']): void {
    this.spawns.push({ position, yaw, zone, ...(tag ? { tag } : {}) });
  }

  checkpoint(position: Vec3, radius = 3.5, finish = false): void {
    this.checkpoints.push({ index: this.checkpoints.length, position, radius, ...(finish ? { finish } : {}) });
  }

  zone(name: string, center: Vec3, radius: number, ambience: ZoneDef['ambience'], darkness = 0): void {
    this.zones.push({ name, center, radius, ambience, darkness });
  }

  /** Declare the way out of a zone you can be down in: its foot, then its top. See `ZoneDef.exits`. */
  exit(zone: string, foot: Vec3, top: Vec3): void {
    const def = this.zones.find((z) => z.name === zone);
    if (!def) throw new Error(`exit for unknown zone '${zone}': declare the zone first`);
    (def.exits ??= []).push({ foot, top });
  }

  /**
   * A climbable tree: trunk, a spiral of branches (each a real collider *and* a grip), and a
   * canopy prop. Branches are the primary vertical route in the jungle.
   */
  tree(x: number, z: number, height: number, zone = 'jungle', tint = 0): void {
    const radius = 0.42 + height * 0.018;
    this.cylinder(vec3(x, height / 2, z), radius, height / 2, 'wood', zone);
    // The canopy cone is centred on its origin, so it is placed near the top of the trunk
    // rather than at ground level.
    this.prop('tree', vec3(x, height * 0.78, z), this.rand.range(0, Math.PI * 2), height / 13, tint);

    const branchCount = Math.max(2, Math.floor(height / 3.4));
    for (let i = 0; i < branchCount; i++) {
      const t = (i + 1) / (branchCount + 1);
      const y = height * (0.28 + t * 0.62);
      const angle = this.rand.range(0, Math.PI * 2) + i * 2.4;
      const length = this.rand.range(1.9, 3.4);
      const bx = x + Math.sin(angle) * (radius + length * 0.5);
      const bz = z + Math.cos(angle) * (radius + length * 0.5);
      // Long along local +Z, yawed by `angle`: local +Z is then (sin, cos) of it, which is the
      // direction the branch was pushed out along — so it runs out of the trunk rather than
      // across it. It was long along X at `-angle`, which is radial under neither rotation.
      this.box(vec3(bx, y, bz), vec3(0.28, 0.18, length * 0.5), 'wood', angle, zone);
      this.grip(vec3(bx + Math.sin(angle) * length * 0.4, y + 0.18, bz + Math.cos(angle) * length * 0.4), vec3(0, 1, 0), 'branch');
      if (this.rand.bool(0.35)) {
        this.prop('vine', vec3(bx, y, bz), angle, this.rand.range(0.8, 1.4), tint);
      }
    }
  }

  /** Rock cluster: cheap cover, a climbable route, and a wall-bounce surface. */
  rocks(x: number, z: number, count: number, scale: number, zone = 'jungle'): void {
    for (let i = 0; i < count; i++) {
      const angle = this.rand.range(0, Math.PI * 2);
      const dist = this.rand.range(0, scale * 1.6);
      const r = this.rand.range(scale * 0.5, scale);
      const px = x + Math.sin(angle) * dist;
      const pz = z + Math.cos(angle) * dist;
      this.sphere(vec3(px, r * 0.55, pz), r, 'rock', zone);
      this.prop('rock', vec3(px, 0, pz), angle, r, 1);
    }
  }

  /** Bouncy mushroom — a readable "go up here" affordance for new players. */
  mushroom(x: number, y: number, z: number, radius = 1.3, zone = 'jungle'): void {
    this.cylinder(vec3(x, y + 0.35, z), radius, 0.35, 'mushroom', zone);
    this.prop('mushroom', vec3(x, y, z), this.rand.range(0, Math.PI * 2), radius, 2);
  }

  /** Floating one-way platform used for tree villages and parkour routes. */
  platform(x: number, y: number, z: number, sx: number, sz: number, zone = 'jungle', yaw = 0): void {
    this.box(vec3(x, y, z), vec3(sx * 0.5, 0.22, sz * 0.5), 'platform', yaw, zone);
    this.grip(vec3(x, y + 0.22, z), vec3(0, 1, 0), 'ledge');
  }

  /**
   * Straight ramp between two heights, up or down.
   *
   * Approximated with stacked steps: keeps the solver on boxes (fast, stable) and reads well with
   * the stylised art direction. Each step is a pillar standing on the ground with its **top** at
   * the interpolated height, which is the only surface a player ever touches.
   *
   * That top used to be wrong for any low step. The half-height was `max(0.3, y / 2)` about a
   * centre of `y / 2`, so a minimum thickness was added *upward* — and below `y = 0.6` the step
   * rose above the height it was supposed to sit at. Measured on a 12 m ramp: a shallow 0 → 1
   * climb put six of its ten steps up to **0.28 m** too high, and any ramp that reaches the
   * ground ends in a **0.15 m lip** — a step up at the bottom of a slope down.
   *
   * This is not the "ramps cannot descend" that this repository's notes have claimed for a while.
   * A descent between two heights (10 → 6) is exact, measured at 0.00 m error on every step. The
   * defect was never about direction; it was about how close to the floor a step lands, which is
   * why it showed up on descents — those are the ramps that end at ground level.
   *
   * The minimum thickness goes downward now, so a step can never be thinner than
   * `MIN_STEP_THICKNESS` and its top is always exactly `y`. For every step at or above that
   * thickness the geometry is bit-for-bit what it was, which is what keeps the three shipped maps
   * unchanged except where they were already wrong.
   */
  ramp(x: number, z: number, width: number, length: number, y0: number, y1: number, yaw: number, zone = 'jungle'): void {
    const steps = Math.max(3, Math.round(length / 1.2));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const top = y0 + (y1 - y0) * t;
      // Solid down to the ramp's low end. A ramp into a pit used to be a stair of 0.6 m slabs in
      // mid-air — you could walk under it, and it read as floating rock.
      const bottom = Math.min(0, y0, y1, top - MIN_STEP_THICKNESS);
      const dist = (t - 0.5) * length;
      this.box(
        vec3(x + Math.sin(yaw) * dist, (top + bottom) * 0.5, z + Math.cos(yaw) * dist),
        vec3(width * 0.5, (top - bottom) * 0.5, (length / steps) * 0.62),
        'rock',
        yaw,
        zone,
      );
    }
  }

  /**
   * Ring the lobby with a doorway per mode.
   *
   * Laid out in a circle around the lobby spawn and facing inwards, so a player who spawns in
   * turns on the spot and reads every option — which is the job a mode menu used to do, done by
   * standing somewhere instead.
   *
   * Radius grows with the number of doors rather than being fixed, or a big list would put them
   * shoulder to shoulder and a player aiming for one would fall into its neighbour.
   */
  addModePortals(modeIds: readonly string[], centre: Vec3, portalRadius = 2.2): void {
    if (modeIds.length === 0) return;
    const spacing = portalRadius * 3.2;
    const ring = Math.max(9, (spacing * modeIds.length) / (Math.PI * 2));
    modeIds.forEach((modeId, index) => {
      const angle = (index / modeIds.length) * Math.PI * 2;
      const x = centre.x + Math.sin(angle) * ring;
      const z = centre.z + Math.cos(angle) * ring;
      this.portals.push({
        modeId,
        position: { x, y: centre.y, z },
        radius: portalRadius,
        // Facing back at the lobby centre, so the arch is broadside to anyone walking out to it.
        yaw: Math.atan2(centre.x - x, centre.z - z),
      });
    });
  }

  /**
   * Wall off every edge of standing ground that drops straight to the kill plane.
   *
   * Measured before this existed, six bots in a 90 s round of Kangaroo Chase: the jungle lost
   * about seven of them a round off the edges of its floors, the glacier nine (hopping over the
   * 1.8 m rim meant to stop exactly that) and the outback four. A player running from a chaser does
   * what a bot does. And a floor that simply stops is not a place: from inside the map it reads as
   * a slab hanging in fog, which is the opposite of what the maps are for.
   *
   * So it is measured rather than hand-placed. A 1 m grid of downward rays finds every standing
   * cell whose neighbour has nothing under it until the kill plane; those edges are merged into
   * runs and each run gets a cliff, and a little deeper or shallower per segment so it reads as
   * rock, not a fence. A cliff only ever occupies void, so it cannot block anything that was
   * walkable, and a map that gains a floor gets its edge walled the next time it is built.
   *
   * **Height comes from what stands near the edge, not from the floor.** A full charge jump peaks
   * near 5 m, so a cliff is at least `CLIFF_CLEARANCE` above the highest surface within
   * `CLIFF_REACH` cells inside it — the grid's rays already record the topmost surface in every
   * cell, trunk tops and platforms included. A first version used a flat 10–14 m above the floor,
   * and its own tops then read as a hundred metres of new edge 10–16 m up: unreachable from the
   * floor, reachable from a tree beside it, and a drop into the void from there.
   *
   * Cliffs carry the collider zone tag `edge`, which nothing but tests reads.
   *
   * Call it last: it measures the colliders that exist. Returns how many cliff segments it made.
   */
  enclose(killPlaneY: number, surface: 'cliffRock' | 'cliffIce' | 'cliffRedRock', zone = 'edge'): number {
    if (this.colliders.length === 0) return 0;
    const world = new PhysicsWorld(this.colliders);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxY = -Infinity;
    for (const c of this.colliders) {
      const reach = colliderReach(c);
      minX = Math.min(minX, c.center.x - reach);
      maxX = Math.max(maxX, c.center.x + reach);
      minZ = Math.min(minZ, c.center.z - reach);
      maxZ = Math.max(maxZ, c.center.z + reach);
      maxY = Math.max(maxY, colliderTop(c));
    }
    const x0 = Math.floor(minX) - 4;
    const z0 = Math.floor(minZ) - 4;
    const nx = Math.ceil(maxX) + 4 - x0;
    const nz = Math.ceil(maxZ) + 4 - z0;
    const ray: RaycastResult = {
      hit: false, distance: 0, point: vec3(), normal: vec3(), colliderIndex: -1, surface: this.colliders[0]!.surface,
    };
    const origin = vec3();
    const down = vec3(0, -1, 0);

    // Every solid stacked in each 1 m column, top down: where you can stand, and what is in the way.
    // One ray per layer, restarted under each solid it meets — a floor under a floor is the case a
    // single top-down ray cannot see, and it is exactly where the glacier and the outback lost bots.
    const columns: Layer[][] = Array.from({ length: nx * nz }, () => []);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const list: Layer[] = [];
        let y = maxY + 5;
        for (let guard = 0; guard < 16 && y > killPlaneY; guard++) {
          origin.x = x0 + i + 0.5;
          origin.y = y;
          origin.z = z0 + j + 0.5;
          world.raycast(ray, origin, down, y - killPlaneY);
          if (!ray.hit) break;
          const c = this.colliders[ray.colliderIndex] as Collider;
          const bottom = colliderBottom(c);
          // A ray that starts inside a solid meets it at distance 0. That solid overlaps the one
          // above it, so the two are one mass: nothing to stand on at the seam, and the lower one's
          // bottom is where the mass ends. Skipping it instead dropped it from the column outright —
          // measured on the outback, a cave's back wall under its roof vanished and grew a cliff.
          const last = list[list.length - 1];
          if (ray.distance > 1e-4 || !last) list.push({ top: ray.point.y, bottom, edge: c.zone === zone });
          else last.bottom = Math.min(last.bottom, bottom);
          y = Math.min(bottom, ray.point.y) - 0.01;
        }
        columns[i * nz + j] = list;
      }
    }
    const column = (i: number, j: number): Layer[] =>
      i < 0 || j < 0 || i >= nx || j >= nz ? [] : (columns[i * nz + j] as Layer[]);

    // Edges: a standing surface whose neighbour has nothing in the way at body height and nothing
    // to land on all the way down to the kill plane.
    const edges: EdgeCell[] = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        for (const layer of column(i, j)) {
          if (layer.edge) continue; // a cliff top is out of reach by construction; see CLIFF_CLEARANCE
          const h = layer.top;
          for (const [di, dj] of DIRECTIONS) {
            const next = column(i + di, j + dj);
            if (next.some((l) => l.bottom < h + 1.4 && l.top > h + 0.3)) continue; // a wall
            if (next.some((l) => l.top <= h + 0.6)) continue; // somewhere to land
            // How much void lies beyond, and whether ground at this height resumes: a crack.
            let span = 1;
            let crack = false;
            for (let d = 2; d <= 4; d++) {
              const far = column(i + di * d, j + dj * d);
              if (far.some((l) => Math.abs(l.top - h) < 0.6)) {
                crack = true;
                break;
              }
              if (far.some((l) => l.top <= h + 0.6 || (l.bottom < h + 1.4 && l.top > h + 0.3))) break;
              span = d;
            }
            // Anything overhead where the cliff stands caps it: it seals up to the underside. Read
            // two cells out when the void is that wide, not in the boundary cell: geometry that ends
            // on a half metre lands exactly on that cell's sample point. Measured on the glacier,
            // the crevasse ramp's step ends grazed it and capped the wall sealing the crevasse floor
            // at 1.6 m — a hop — under a rink whose real underside is 6 m up.
            const under = span >= 2 ? column(i + di * 2, j + dj * 2) : next;
            let ceiling = Infinity;
            for (const l of under) if (l.bottom > h) ceiling = Math.min(ceiling, l.bottom);
            // The highest thing standing within CLIFF_REACH inside the edge.
            let reach = h;
            for (let d = 0; d <= CLIFF_REACH; d++) {
              for (const l of column(i - di * d, j - dj * d)) if (!l.edge && l.top < ceiling) reach = Math.max(reach, l.top);
            }
            edges.push({ i, j, di, dj, h, span, crack, ceiling, reach });
          }
        }
      }
    }

    // Runs: the same direction, the same boundary line, adjacent along it, at a similar height.
    edges.sort((a, b) =>
      a.di - b.di || a.dj - b.dj || (a.di !== 0 ? a.i - b.i : a.j - b.j) ||
      Math.round(a.h / 2) - Math.round(b.h / 2) || (a.di !== 0 ? a.j - b.j : a.i - b.i),
    );
    let made = 0;
    let run: EdgeCell[] = [];
    const flush = (): void => {
      if (run.length > 0) made += this.cliffRun(x0, z0, run, surface, zone);
      run = [];
    };
    for (const e of edges) {
      const last = run[run.length - 1];
      const along = (x: EdgeCell): number => (x.di !== 0 ? x.j : x.i);
      const line = (x: EdgeCell): number => (x.di !== 0 ? x.i : x.j);
      if (
        last &&
        (last.di !== e.di || last.dj !== e.dj || line(last) !== line(e) || along(e) - along(last) > 1 ||
          Math.round(last.h / 2) !== Math.round(e.h / 2) || last.crack !== e.crack)
      ) {
        flush();
      }
      run.push(e);
    }
    flush();
    return made;
  }

  /** One run of edge cells as jittered cliff segments, or as a flush plug over a crack. */
  private cliffRun(x0: number, z0: number, run: EdgeCell[], surface: SurfaceName, zone: string): number {
    const first = run[0] as EdgeCell;
    const { di, dj } = first;
    const alongI = di === 0; // a wall facing ±z runs along x (i); one facing ±x runs along z (j)
    const along = (e: EdgeCell): number => (alongI ? e.i : e.j);
    const ground = Math.max(...run.map((e) => e.h));
    const reach = Math.max(...run.map((e) => e.reach));
    const ceiling = Math.min(...run.map((e) => e.ceiling));
    const span = Math.min(...run.map((e) => e.span));
    // The boundary is the face of the edge cells; the inside face of what goes there sits 0.2 m
    // over it, so no sliver of void is left between floor and wall.
    const faceLine = alongI ? z0 + first.j + (dj > 0 ? 1 : 0) : x0 + first.i + (di > 0 ? 1 : 0);
    const sign = alongI ? dj : di;
    const inner = faceLine - sign * 0.2;
    // Past both ends, so two runs meeting at a corner overlap instead of touching at a point. Not
    // for a plug, which must not spill onto the floor on either side of the crack it fills.
    const pad = first.crack ? 0 : 1.5;
    const from = Math.min(...run.map(along)) - pad;
    const to = Math.max(...run.map(along)) + 1 + pad;
    const base = alongI ? x0 : z0;
    let made = 0;
    for (let a = from; a < to - 1e-6; ) {
      const b = first.crack ? to : Math.min(to, a + this.rand.range(8, 14));
      let depth: number;
      let bottom: number;
      let topY: number;
      if (first.crack) {
        // A crack in the floor: fill it flush, as floor, across its whole width.
        depth = span + 0.4;
        bottom = ground - 4;
        topY = ground;
      } else {
        depth = Math.min(this.rand.range(1.6, 3.2), span + 0.2);
        bottom = ground - 8;
        topY = Math.min(
          ceiling,
          Math.max(ground + this.rand.range(10, 14), reach + CLIFF_CLEARANCE + this.rand.range(0, 2)),
        );
      }
      const middle = inner + sign * depth * 0.5;
      const centreAlong = base + (a + b) / 2;
      const half = (b - a) / 2;
      const center = alongI ? vec3(centreAlong, (bottom + topY) / 2, middle) : vec3(middle, (bottom + topY) / 2, centreAlong);
      const halves = alongI ? vec3(half, (topY - bottom) / 2, depth / 2) : vec3(depth / 2, (topY - bottom) / 2, half);
      this.box(center, halves, surface, 0, zone);
      made++;
      a = b;
    }
    return made;
  }

  build(
    meta: Omit<LevelDef, 'colliders' | 'props' | 'grips' | 'spawns' | 'checkpoints' | 'zones' | 'portals'>,
  ): LevelDef {
    return {
      ...meta,
      colliders: this.colliders,
      props: this.props,
      bodies: this.bodies,
      grips: this.grips,
      spawns: this.spawns,
      checkpoints: this.checkpoints,
      zones: this.zones,
      portals: this.portals,
    };
  }
}
