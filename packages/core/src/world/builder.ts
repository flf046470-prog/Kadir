import type { Rand } from '../math/rand.js';
import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';
import type { Collider, SurfaceMaterial, SurfaceProps } from '../physics/types.js';
import { SurfaceFlags } from '../physics/types.js';
import type { CheckpointDef, GripDef, GripKind, LevelDef, PropInstance, PropKind, SpawnPoint, ZoneDef } from './level.js';

export interface SurfacePreset {
  friction: number;
  bounciness: number;
  flags: number;
  material: SurfaceMaterial;
}

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
      this.box(vec3(bx, y, bz), vec3(length * 0.5, 0.18, 0.28), 'wood', -angle, zone);
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

  /** Straight ramp between two heights. */
  ramp(x: number, z: number, width: number, length: number, y0: number, y1: number, yaw: number, zone = 'jungle'): void {
    // Approximated with stacked steps: keeps the solver on boxes (fast, stable) and reads well
    // with the stylised art direction.
    const steps = Math.max(3, Math.round(length / 1.2));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const y = y0 + (y1 - y0) * t;
      const dist = (t - 0.5) * length;
      this.box(
        vec3(x + Math.sin(yaw) * dist, y * 0.5, z + Math.cos(yaw) * dist),
        vec3(width * 0.5, Math.max(0.3, y * 0.5), (length / steps) * 0.62),
        'rock',
        yaw,
        zone,
      );
    }
  }

  build(meta: Omit<LevelDef, 'colliders' | 'props' | 'grips' | 'spawns' | 'checkpoints' | 'zones'>): LevelDef {
    return {
      ...meta,
      colliders: this.colliders,
      props: this.props,
      grips: this.grips,
      spawns: this.spawns,
      checkpoints: this.checkpoints,
      zones: this.zones,
    };
  }
}
