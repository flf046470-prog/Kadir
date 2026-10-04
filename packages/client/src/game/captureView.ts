import { makeRaycastResult, v3set } from '@kc/core';
import type { PhysicsWorld, PlayerState, Vec3 } from '@kc/core';

/** Another player as the camera sees them. */
export interface CaptureTarget {
  id: string;
  role: string;
  /** Horizontal distance from the local player, in metres. */
  distance: number;
  /** Angle off the camera's heading, radians in (-π, π]; positive is to the left of the view. */
  bearing: number;
  /** Nothing solid between the local player's head and theirs. */
  visible: boolean;
}

export interface CaptureView {
  /** The camera's heading: the local player's yaw, which the third-person camera follows. */
  yaw: number;
  others: CaptureTarget[];
}

const _ray = makeRaycastResult();
const _from: Vec3 = { x: 0, y: 0, z: 0 };
const _dir: Vec3 = { x: 0, y: 0, z: 0 };

/** Head height a sight line is drawn from and to — above a kerb, below a branch. */
const EYE = 1.2;

/**
 * Where everyone else is, relative to the local player's view, for the store-capture scripts.
 *
 * Those scripts used to sprint the kangaroo forward blind and keep the frame with the most
 * contrast. On every map that ran it into the nearest wall: four of five Steam screenshots looked
 * at rock or ice, and not one showed another player, in a game about chasing them. With this they
 * turn towards someone they can see, and a shot is ranked by who is in it.
 *
 * Read only, and reachable only when automation drives the browser (`main.ts`): it reports what
 * the player's own screen already shows, and changes nothing.
 */
export function captureViewOf(
  players: Iterable<PlayerState>,
  localId: string,
  cameraYaw: number,
  world: PhysicsWorld,
): CaptureView | null {
  const all = [...players];
  const self = all.find((p) => p.id === localId);
  if (!self) return null;
  const others: CaptureTarget[] = [];
  for (const p of all) {
    if (p.id === localId || !p.alive) continue;
    const dx = p.position.x - self.position.x;
    const dz = p.position.z - self.position.z;
    const dy = p.position.y - self.position.y;
    const distance = Math.hypot(dx, dz);
    // The camera faces (sin yaw, cos yaw), as the player does (`locomotion.ts`).
    let bearing = Math.atan2(dx, dz) - cameraYaw;
    bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
    const reach = Math.hypot(dx, dy, dz);
    v3set(_from, self.position.x, self.position.y + EYE, self.position.z);
    v3set(_dir, dx / reach, dy / reach, dz / reach);
    world.raycast(_ray, _from, _dir, reach);
    others.push({ id: p.id, role: p.role, distance, bearing, visible: !_ray.hit });
  }
  others.sort((a, b) => a.distance - b.distance);
  return { yaw: cameraYaw, others };
}
