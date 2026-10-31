import type { Rand } from '../math/rand.js';
import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';
import type { Collider, HeightfieldCollider, RaycastResult, SurfaceMaterial, SurfaceProps } from '../physics/types.js';
import { SurfaceFlags, makeRaycastResult } from '../physics/types.js';
import { PhysicsWorld } from '../physics/world.js';
import { colliderAabb, colliderBottom, colliderReach, colliderTop, makeAabb } from '../physics/geometry.js';
import { heightfieldHeight, heightfieldMaxX, heightfieldMaxZ } from '../physics/heightfield.js';
import type { ArenaDef, BodyKind, BodySpawn, CheckpointDef, GripDef, GripKind, LevelDef, PortalDef, PropInstance, PropKind, SecretDef, SpawnPoint, ZoneDef } from './level.js';

/** A boomerang is a climb, not a hop: its top at least this far over the ground beside it… */
const SECRET_MIN_HEIGHT = 3;
/** …and not so high that only a perfect climb gets there. */
const SECRET_MAX_HEIGHT = 16;
/** Two boomerangs on one map are never on neighbouring perches: this share of the search reach apart. */
const SECRET_SPACING = 0.4;
/** A scattered rock's sphere radius per unit of prop scale (the model is ~2 m across at scale 1). */
const ROCK_RADIUS = 0.9;
/**
 * The least clear ground a solid rock leaves round itself, so two never make a slot just wider
 * than a kangaroo for a bot to hop into and wedge.
 */
const SOLID_ROCK_GAP = 1;
/** How far over its perch a boomerang floats — about a kangaroo's chest. */
export const SECRET_LIFT = 0.9;

function v3setTo(out: Vec3, x: number, y: number, z: number): void {
  out.x = x;
  out.y = y;
  out.z = z;
}

export interface SurfacePreset {
  friction: number;
  bounciness: number;
  flags: number;
  material: SurfaceMaterial;
}

/** A fight cage: centre to each fence panel, the fence's height, the floor's, and the floor's margin past the fence. */
export const CAGE_RADIUS = 6;
export const CAGE_FENCE = 3.2;
export const CAGE_FLOOR = 0.5;
export const CAGE_APRON = 1.2;
/** A fence panel's thickness. */
const CAGE_PANEL = 0.08;

/**
 * Thinnest a ramp step may be, in metres.
 *
 * A step is a box, and a box with no thickness is a plane the capsule solver can tunnel through
 * at speed. The number is the one the old `max(0.3, …)` half-height implied; what changed is the
 * direction it is applied in — downward, so it can never push a step's walking surface above the
 * height the ramp asked for.
 */
const MIN_STEP_THICKNESS = 0.6;

/**
 * A fallen log at scale 1: half its length and its radius. The body of `log-1.glb`, which is what
 * draws it, measured: 4.0 m long, top 0.93–0.98 m, ±0.48 m wide at mid-height.
 */
export const LOG_HALF_LENGTH = 2;
export const LOG_RADIUS = 0.48;
/** How far ground may rise into a resting log, as a share of its radius: a log settles, it does not perch. */
const LOG_MAX_SINK = 1 / 3;

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
  /**
   * A fight cage's chain-link fence and its posts. No grip for the boundary's reason: a fence a
   * headset player can climb is a way out of the fight.
   */
  cageMesh: { friction: 0.6, bounciness: 0.15, flags: SurfaceFlags.NoGrip, material: 'metal' },
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
  readonly arenas: ArenaDef[] = [];
  readonly secrets: SecretDef[] = [];
  private nextId = 0;
  /** Raycasts against what is built so far, rebuilt when something is added. */
  private probe: { world: PhysicsWorld; count: number } | null = null;

  constructor(readonly rand: Rand) {}

  private probeWorld(): PhysicsWorld {
    if (!this.probe || this.probe.count !== this.colliders.length) {
      this.probe = { world: new PhysicsWorld(this.colliders), count: this.colliders.length };
    }
    return this.probe.world;
  }

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
  sculpt(
    hf: HeightfieldCollider,
    height: (x: number, z: number, free: number) => number,
    options: { flatEdges?: boolean } = {},
  ): void {
    const base = hf.heights[0] as number;
    const maxX = heightfieldMaxX(hf);
    const maxZ = heightfieldMaxZ(hf);
    const reach = TERRAIN_CLEARANCE + TERRAIN_BLEND;

    // What was built on the flat ground, as XZ rectangles (points are zero-size rectangles).
    const keep: { minX: number; maxX: number; minZ: number; maxZ: number; pad: number }[] = [];
    for (const { position: p, pad, anyHeight } of this.sites()) {
      if (anyHeight || Math.abs(p.y - base) < 2) keep.push({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z, pad });
    }
    const box = makeAabb();
    for (const c of this.colliders) {
      // Other terrain is not something built on the plane, it is the plane: counting it flattened two
      // pieces of ground along every seam between them, as a valley neither was shaped to have.
      if (c.kind === 'heightfield') continue;
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
        // The footprint's own edge is a feature too: whatever meets the terrain there met a plane —
        // unless the caller says nothing does, as at the outer edge of the world.
        let nearest = options.flatEdges === false ? Infinity : Math.min(x - hf.minX, maxX - x, z - hf.minZ, maxZ - z);
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

  /**
   * Places that need clear ground round them, and how wide a pad: a spawn, a door, a checkpoint, a
   * ball, a pit's way out. `anyHeight` marks the ones that count wherever they are, rather than
   * only on the ground being shaped. One list, so terrain and logs keep clear of the same things.
   */
  private sites(): { position: Vec3; pad: number; anyHeight: boolean }[] {
    const out: { position: Vec3; pad: number; anyHeight: boolean }[] = [];
    for (const s of this.spawns) out.push({ position: s.position, pad: 2, anyHeight: false });
    for (const p of this.portals) out.push({ position: p.position, pad: p.radius + 1.5, anyHeight: false });
    for (const c of this.checkpoints) out.push({ position: c.position, pad: Math.min(c.radius, 3), anyHeight: false });
    for (const body of this.bodies) out.push({ position: body.position, pad: 1, anyHeight: true });
    // The floor's corners, and a step's width round them where people stand to watch.
    for (const arena of this.arenas) out.push({ position: arena.center, pad: (arena.radius + CAGE_APRON) * Math.SQRT2 + 1.5, anyHeight: false });
    for (const zone of this.zones) {
      for (const exit of zone.exits ?? []) {
        out.push({ position: exit.foot, pad: 2, anyHeight: true });
        out.push({ position: exit.top, pad: 2, anyHeight: true });
      }
    }
    return out;
  }

  /**
   * A fallen log: solid, lying down, long along the box's local X, and drawn as `log-1.glb` fitted
   * to the box (`BoxCollider.drawAs`), so the log a player sees is the one they stand on.
   *
   * It rests on the lowest ground under it, turned in 45° steps from `yaw` to whichever way lies
   * flattest, so it never hangs over a hollow. It is refused — and nothing is placed — where the
   * ground rises more than a third of its radius into it, where it would run into anything solid,
   * where it would overhang a drop or lie in water, and on the pad round a spawn, a door, a
   * checkpoint, a ball or a pit's way out. Returns whether it was placed.
   *
   * `y` is the ground it is meant for; anything more than a metre off it is not that ground.
   */
  fallenLog(x: number, y: number, z: number, yaw: number, halfLength: number, radius: number, zone = 'jungle'): boolean {
    const world = this.probeWorld();
    const fits: { yaw: number; ground: number; spread: number }[] = [];
    for (let k = 0; k < 4; k++) {
      const turn = yaw + (k * Math.PI) / 4;
      const fit = this.logGround(world, x, y, z, turn, halfLength, radius);
      if (fit && fit.spread <= radius * LOG_MAX_SINK) fits.push({ yaw: turn, ...fit });
    }
    fits.sort((a, b) => a.spread - b.spread);
    const fit = fits.find((f) => !this.logBlocked(x, z, f.yaw, halfLength, radius, f.ground));
    if (!fit) return false;
    const log = this.box(vec3(x, fit.ground + radius, z), vec3(halfLength, radius, radius), 'wood', fit.yaw, zone);
    if (log.kind === 'box') log.drawAs = 'log';
    return true;
  }

  /** The ground under a log lying at `yaw`: its lowest point and how far it rises. Null if unsupported. */
  private logGround(world: PhysicsWorld, x: number, y: number, z: number, yaw: number, halfLength: number, radius: number): { ground: number; spread: number } | null {
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    // From just over where the log's top would be, so only what the log itself would occupy is met.
    const from = y + radius * 2 + 0.5;
    const reach = from - (y - 1);
    const ray = makeRaycastResult();
    const origin = vec3();
    const down = vec3(0, -1, 0);
    // Terrain is flat between grid points and turns at them, so a dip between two samples is
    // missed by at most the slope times half the spacing — a few millimetres at these spacings.
    const steps = 2 * Math.max(2, Math.ceil(halfLength / 0.25));
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const t = -halfLength + (i / steps) * halfLength * 2;
      for (const u of [-radius * 0.9, -radius * 0.45, 0, radius * 0.45, radius * 0.9]) {
        origin.x = x + ax * t + sx * u;
        origin.y = from;
        origin.z = z + az * t + sz * u;
        world.raycast(ray, origin, down, reach);
        if (!ray.hit || ray.surface.flags & SurfaceFlags.Water) return null;
        low = Math.min(low, ray.point.y);
        high = Math.max(high, ray.point.y);
      }
    }
    // Resting on top of something standing on the ground meant for it — another log, a rock — is
    // not lying on that ground.
    if (low > y + radius * LOG_MAX_SINK) return null;
    return { ground: low, spread: high - low };
  }

  /** Whether a log resting on `ground` would run into a solid or onto a site's pad. */
  private logBlocked(x: number, z: number, yaw: number, halfLength: number, radius: number, ground: number): boolean {
    return this.footprintBlocked(x, z, yaw, halfLength, radius, ground, ground + radius * LOG_MAX_SINK, ground + radius * 2, 0.05);
  }

  /**
   * Whether a solid with this yawed rectangle footprint, standing from `floor` to `top`, would run
   * into another solid or onto a site's pad. Anything whose top is at or below `clear` is ground it
   * stands on, not in its way.
   */
  private footprintBlocked(x: number, z: number, yaw: number, halfLength: number, radius: number, ground: number, clear: number, top: number, margin: number): boolean {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // A world point in the log's own frame: local +X is (cos, 0, −sin), local +Z is (sin, 0, cos).
    const local = (px: number, pz: number): [number, number] => {
      const dx = px - x;
      const dz = pz - z;
      return [dx * cos - dz * sin, dx * sin + dz * cos];
    };
    const distance = (px: number, pz: number): number => {
      const [lx, lz] = local(px, pz);
      return Math.hypot(Math.max(Math.abs(lx) - halfLength, 0), Math.max(Math.abs(lz) - radius, 0));
    };
    for (const c of this.colliders) {
      if (c.kind === 'heightfield') continue;
      // Ground it rests on, or sinks into no deeper than the terrain may, is not in the way.
      if (colliderTop(c) <= clear || colliderBottom(c) >= top) continue;
      if (c.kind === 'sphere' || c.kind === 'cylinder') {
        if (distance(c.center.x, c.center.z) < c.radius + margin) return true;
        continue;
      }
      // Two yawed rectangles overlap unless one of their four edge directions separates them.
      const ccos = Math.cos(c.yaw);
      const csin = Math.sin(c.yaw);
      const dx = c.center.x - x;
      const dz = c.center.z - z;
      const separated = ([[cos, -sin], [sin, cos], [ccos, -csin], [csin, ccos]] as const).some(([nx, nz]) => {
        const gap = Math.abs(dx * nx + dz * nz);
        const mine = halfLength * Math.abs(cos * nx - sin * nz) + radius * Math.abs(sin * nx + cos * nz);
        const theirs = c.half.x * Math.abs(ccos * nx - csin * nz) + c.half.z * Math.abs(csin * nx + ccos * nz);
        return gap >= mine + theirs + margin;
      });
      if (!separated) return true;
    }
    for (const site of this.sites()) {
      if (Math.abs(site.position.y - ground) > 3) continue;
      if (distance(site.position.x, site.position.z) < site.pad) return true;
    }
    return false;
  }

  /**
   * A scattered rock that is solid, rather than a prop a player walks through (A32).
   *
   * A rock sphere with its rock prop on it, the convention `rocks` already uses: the renderer draws
   * the sphere as a Meshy rock fitted to it and skips the prop, so what is drawn is what collides,
   * and a collider is never thinned out by `foliageBudget` the way a prop is — a solid prop the
   * renderer skipped would be an invisible wall. At scale 1 the rock model is about 2 m across and
   * 1.4 m tall (`props.py` `SIZES`), so the sphere's radius is `ROCK_RADIUS` × scale.
   *
   * It stands on the ground under it, found by a ray, and is refused — nothing is placed, and it
   * returns false — over water or a drop, on ground more than half a metre from `y`, within
   * `SOLID_ROCK_GAP` of another solid, and on a site's pad.
   */
  solidRock(x: number, y: number, z: number, yaw: number, scale: number, zone = 'jungle'): boolean {
    const world = this.probeWorld();
    const ray = makeRaycastResult();
    // From just above the ground meant for it: a cave has a ceiling a few metres up.
    world.raycast(ray, vec3(x, y + 1, z), vec3(0, -1, 0), 3);
    if (!ray.hit || ray.surface.flags & SurfaceFlags.Water || Math.abs(ray.point.y - y) > 0.5) return false;
    const ground = ray.point.y;
    const r = ROCK_RADIUS * scale;
    if (this.footprintBlocked(x, z, yaw, r, r, ground, ground + 0.1, ground + r * 1.55, SOLID_ROCK_GAP)) return false;
    this.sphere(vec3(x, ground + r * 0.55, z), r, 'rock', zone);
    this.prop('rock', vec3(x, ground, z), yaw, r, 1);
    return true;
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
      const branch = this.box(vec3(bx, y, bz), vec3(0.28, 0.18, length * 0.5), 'wood', angle, zone);
      // Drawn as a branch, not as the plank it collides as (`LevelRenderer.buildBranches`).
      if (branch.kind === 'box') branch.drawAs = 'branch';
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
   * A fight cage: a square floor `CAGE_FLOOR` high with an octagon of fence on it, the fence
   * `radius` from the centre to each panel and `CAGE_FENCE` tall. `groundY` is the ground it stands
   * on; the floor reaches half a metre below it, so ground that rolls a little leaves no gap under
   * the edge.
   *
   * The fence is eight thin panels marked `drawAs: 'cage'` (drawn as chain-link, see
   * `render/Cage.ts`) and a post at each corner. It is taller than any hop and lower than a charged
   * one (about 5 m), so in Cage Fight leaving it is a choice, and is scored as one (a ring-out).
   * Decoration already standing in the footprint is removed: a bush through a fight floor is a bush
   * growing out of the canvas.
   *
   * Call it before `sculpt` and before anything is scattered, so the ground and the undergrowth
   * both work round it; `sites()` keeps a pad round its corners clear.
   */
  cage(x: number, groundY: number, z: number, zone: string, radius = CAGE_RADIUS): ArenaDef {
    const top = groundY + CAGE_FLOOR;
    const half = radius + CAGE_APRON;
    this.box(vec3(x, (top + groundY - 0.5) / 2, z), vec3(half, (top - groundY + 0.5) / 2, half), 'wood', 0, zone);

    const side = 2 * radius * Math.tan(Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      // A box's local +Z faces (sin yaw, 0, cos yaw): yawed to `angle`, its long local X runs across
      // the line from the centre, which is what a fence panel does.
      const panel = this.box(
        vec3(x + Math.sin(angle) * radius, top + CAGE_FENCE / 2, z + Math.cos(angle) * radius),
        vec3(side / 2, CAGE_FENCE / 2, CAGE_PANEL / 2),
        'cageMesh',
        angle,
        zone,
      );
      if (panel.kind === 'box') panel.drawAs = 'cage';
      const corner = angle + Math.PI / 8;
      const reach = radius / Math.cos(Math.PI / 8);
      this.cylinder(vec3(x + Math.sin(corner) * reach, top + CAGE_FENCE / 2 + 0.1, z + Math.cos(corner) * reach), 0.09, CAGE_FENCE / 2 + 0.1, 'cageMesh', zone);
    }

    // So are the loose rock spheres a map strews about: one at a corner stood 10 cm proud of the floor.
    const cleared: Vec3[] = [];
    for (let i = this.colliders.length - 1; i >= 0; i--) {
      const c = this.colliders[i] as Collider;
      if (c.kind !== 'sphere' || c.center.y - c.radius > top) continue;
      if (Math.abs(c.center.x - x) <= half + c.radius && Math.abs(c.center.z - z) <= half + c.radius) {
        this.colliders.splice(i, 1);
        cleared.push(c.center);
      }
    }
    // The prop drawn on a cleared boulder goes with it, wherever its centre is: a sphere reaches
    // further than the footprint a prop is cleared from, and a rock left behind would be one you
    // walk through.
    // `rocks` stands the prop on the ground under the sphere's centre, so match it in plan.
    const onCleared = (prop: PropInstance): boolean =>
      prop.kind === 'rock' && cleared.some((c) => Math.abs(c.x - prop.position.x) < 0.01 && Math.abs(c.z - prop.position.z) < 0.01);
    for (let i = this.props.length - 1; i >= 0; i--) {
      const prop = this.props[i] as PropInstance;
      const inside = Math.abs(prop.position.x - x) <= half + 0.5 && Math.abs(prop.position.z - z) <= half + 0.5 && prop.position.y < top + CAGE_FENCE;
      if (inside || onCleared(prop)) this.props.splice(i, 1);
    }
    // Colliders were taken out as well as added, so a count no longer says the probe is current.
    this.probe = null;

    const arena: ArenaDef = { center: vec3(x, top, z), radius, fenceHeight: CAGE_FENCE };
    this.arenas.push(arena);
    return arena;
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
  /**
   * Hide `count` golden boomerangs on the highest climbable tops within `reach` of the middle: a
   * box or trunk whose top is between `SECRET_MIN_HEIGHT` and `SECRET_MAX_HEIGHT` over the ground
   * beside it, nothing over it, and `SECRET_SPACING` of `reach` from any other. Chosen from
   * the built geometry rather than written down, so a map that changes still has its boomerangs
   * somewhere a hand or a stick climb can reach. Call it after `enclose`. Draws nothing and uses
   * no random numbers, so it moves nothing else on the map.
   */
  hideSecrets(reach: number, count = 3): SecretDef[] {
    const world = this.probeWorld();
    const ray = makeRaycastResult();
    const origin = vec3();
    const down = vec3(0, -1, 0);
    const candidates: { x: number; z: number; top: number }[] = [];
    for (const c of this.colliders) {
      if (c.kind !== 'box' && c.kind !== 'cylinder') continue;
      if (!(c.surface.flags & SurfaceFlags.Climbable) || c.zone === 'edge') continue;
      if (c.kind === 'box' && (c.drawAs === 'cliff' || Math.min(c.half.x, c.half.z) < 0.35)) continue;
      if (Math.hypot(c.center.x, c.center.z) > reach) continue;
      const top = colliderTop(c);
      // Nothing over it: a ray from above lands on this top, not on a branch or a roof.
      v3setTo(origin, c.center.x, top + 6, c.center.z);
      world.raycast(ray, origin, down, 6.2);
      if (!ray.hit || Math.abs(ray.point.y - top) > 0.05) continue;
      // How high it is over the ground beside it: the climb, not the altitude.
      const side = c.kind === 'box' ? Math.max(c.half.x, c.half.z) + 0.6 : c.radius + 0.6;
      v3setTo(origin, c.center.x + side, top - 0.2, c.center.z);
      world.raycast(ray, origin, down, 40);
      const climb = ray.hit ? top - ray.point.y : Infinity;
      if (climb < SECRET_MIN_HEIGHT || climb > SECRET_MAX_HEIGHT) continue;
      candidates.push({ x: c.center.x, z: c.center.z, top });
    }
    candidates.sort((a, b) => b.top - a.top || a.x - b.x || a.z - b.z);
    for (const c of candidates) {
      if (this.secrets.length >= count) break;
      if (this.secrets.some((s) => Math.hypot(s.position.x - c.x, s.position.z - c.z) < SECRET_SPACING * reach)) continue;
      this.secrets.push({ id: `boomerang-${this.secrets.length + 1}`, position: vec3(c.x, c.top + SECRET_LIFT, c.z) });
    }
    return this.secrets;
  }

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
    // Something to land on in a cell, at a height a cliff standing there would fill.
    const groundIn = (i: number, j: number, low: number, high: number): boolean =>
      column(i, j).some((l) => !l.edge && l.top > low && l.top <= high);
    let made = 0;
    let run: EdgeCell[] = [];
    const flush = (): void => {
      if (run.length > 0) made += this.cliffRun(x0, z0, run, surface, zone, groundIn);
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
  private cliffRun(
    x0: number,
    z0: number,
    run: EdgeCell[],
    surface: SurfaceName,
    zone: string,
    groundIn: (i: number, j: number, low: number, high: number) => boolean,
  ): number {
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
    const first0 = Math.min(...run.map(along));
    const last0 = Math.max(...run.map(along));
    const from = first0 - pad;
    const to = last0 + 1 + pad;
    // A run also ends where the void beside it turns into floor, and a pad there stands the wall on
    // that floor. Measured on the jungle: the plunge pool's west edge padded 1.5 m onto the canyon
    // floor and closed the 2 m gap between the canyon's west wall and the map's edge to 0.5 m —
    // narrower than a player — so the slot behind that wall was a dead end 31 m deep, and the
    // corner runners fled into. Such an end keeps the wall to the run; the segments are still laid
    // over the padded length, so every random draw, and every other cliff, is what it was.
    const onGround = (past: number): boolean => {
      for (let m = 1; m <= 3; m++) {
        const i = alongI ? past : first.i + di * m;
        const j = alongI ? first.j + dj * m : past;
        if (groundIn(i, j, ground - 8, ground + 0.6)) return true;
      }
      return false;
    };
    const lowEnd = pad > 0 && (onGround(first0 - 1) || onGround(first0 - 2)) ? first0 : from;
    const highEnd = pad > 0 && (onGround(last0 + 1) || onGround(last0 + 2)) ? last0 + 1 : to;
    const base = alongI ? x0 : z0;
    let made = 0;
    for (let a = from; a < to - 1e-6; ) {
      const next = first.crack ? to : Math.min(to, a + this.rand.range(8, 14));
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
      const start = Math.max(a, lowEnd);
      const end = Math.min(next, highEnd);
      a = next;
      if (end <= start + 1e-6) continue;
      const middle = inner + sign * depth * 0.5;
      const centreAlong = base + (start + end) / 2;
      const half = (end - start) / 2;
      const center = alongI ? vec3(centreAlong, (bottom + topY) / 2, middle) : vec3(middle, (bottom + topY) / 2, centreAlong);
      const halves = alongI ? vec3(half, (topY - bottom) / 2, depth / 2) : vec3(depth / 2, (topY - bottom) / 2, half);
      const wall = this.box(center, halves, surface, 0, zone);
      // A plug is floor; only a wall is drawn as cliff rock.
      if (!first.crack && wall.kind === 'box') wall.drawAs = 'cliff';
      made++;
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
      arenas: this.arenas,
      secrets: this.secrets,
    };
  }
}
