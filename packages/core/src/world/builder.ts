import type { Rand } from '../math/rand.js';
import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';
import type { Collider, SurfaceMaterial, SurfaceProps } from '../physics/types.js';
import { SurfaceFlags } from '../physics/types.js';
import type { CheckpointDef, GripDef, GripKind, LevelDef, PortalDef, PropInstance, PropKind, SpawnPoint, ZoneDef } from './level.js';

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
} as const satisfies Record<string, SurfacePreset>;

export type SurfaceName = keyof typeof SURFACES;

/**
 * Fluent level builder. Deterministic: given the same `Rand` seed it produces byte-identical
 * levels on the server and on every client, which is what lets us ship the map as ~10 lines of
 * seed metadata instead of a mesh download.
 */
export class LevelBuilder {
  readonly colliders: Collider[] = [];
  readonly props: PropInstance[] = [];
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

  prop(kind: PropKind, position: Vec3, yaw = 0, scale = 1, tint = 0): void {
    this.props.push({ kind, position, yaw, scale, tint });
  }

  grip(position: Vec3, normal: Vec3, kind: GripKind): void {
    this.grips.push({ position, normal, kind });
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
      const bottom = Math.min(0, top - MIN_STEP_THICKNESS);
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

  build(
    meta: Omit<LevelDef, 'colliders' | 'props' | 'grips' | 'spawns' | 'checkpoints' | 'zones' | 'portals'>,
  ): LevelDef {
    return {
      ...meta,
      colliders: this.colliders,
      props: this.props,
      grips: this.grips,
      spawns: this.spawns,
      checkpoints: this.checkpoints,
      zones: this.zones,
      portals: this.portals,
    };
  }
}
