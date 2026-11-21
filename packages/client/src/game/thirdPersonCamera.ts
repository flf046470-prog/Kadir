import { THIRD_PERSON_CAMERA_DISTANCE } from '@kc/core';
import type { RaycastResult, Vec3 } from '@kc/core';

// The distance is owned by `@kc/core` because the server tests sight from wherever this camera can
// be: in a mode about hiding, an opponent it could see must be sent (`sim/concealment.ts`). This
// camera only ever stands nearer the head than that, so it never sees what concealment assumed it
// could not.

/**
 * Where the flat-screen third-person camera may stand without being in, or behind, geometry.
 *
 * Measured with six bots over Kangaroo Chase (`.probe/a4-occlusion.ts`), the camera it replaces
 * was within 10 cm of a wall on 3.7 % of frames on the jungle and 3.4 % on the outback, and the
 * player was hidden from it (camera to chest and to head both blocked) on 3.1 % / 2.7 %. Three
 * causes, each fixed here:
 *
 * - **The pull-in ray was not the camera's line.** It was cast from the head along the orbit
 *   direction tilted up by 0.12, while the camera was placed along the orbit direction and then
 *   raised by a quarter of `CAMERA_HEIGHT` — so it tested one line and stood on another. It is
 *   cast along the line to the camera now.
 * - **A ray is not a camera.** Running beside a wall, the line to the camera can miss it by a
 *   centimetre while the camera stands in it. The point is walked in towards the head until it is
 *   `CAMERA_CLEARANCE` from every solid.
 * - **The ease dragged the camera through walls.** It lerps towards its target at 16/s; a target
 *   that jumped (the player turned a corner) was reached through the corner. An eased point that
 *   is not clear takes the target at once.
 *
 * And where there is no room behind at all — the player backed into a corner — it rises over the
 * head and looks down rather than standing inside the avatar.
 */
export const CAMERA_HEIGHT = 1.35;
/** How far from every solid the camera keeps; the near plane's corners reach about 0.07 m. */
export const CAMERA_CLEARANCE = 0.2;
/** Never closer to the head than this share of the full offset: inside it the avatar fills the view. */
const MIN_REACH = 0.15;
const STEP = 0.07;
const RAY_MARGIN = 0.3;

/** The two queries the camera needs from `PhysicsWorld`. */
export interface CameraWorld {
  raycast(out: RaycastResult, origin: Vec3, dir: Vec3, maxDist: number): RaycastResult;
  solidClearance(point: Vec3, maxDist: number): number;
}

const _dir = { x: 0, y: 0, z: 0 };
const _probe = { x: 0, y: 0, z: 0 };

/**
 * Write into `out` where the camera should stand for a head at `head` orbiting at `yaw` /
 * `orbitPitch`, and return the share of the full distance it kept (1 = nothing in the way).
 */
export function thirdPersonCameraTarget(
  out: Vec3,
  world: CameraWorld,
  ray: RaycastResult,
  head: Vec3,
  yaw: number,
  orbitPitch: number,
): number {
  const f = placeAlong(out, world, ray, head, yaw, orbitPitch);
  if (f > MIN_REACH) return f;
  // Walled in behind (a corner, a crevice): the line behind the head has no room, so look for it
  // higher up, over the head looking down, before settling for a camera inside the avatar.
  for (const lift of LIFTS) {
    const g = placeAlong(_lifted, world, ray, head, yaw, orbitPitch - lift);
    if (g > MIN_REACH) {
      out.x = _lifted.x;
      out.y = _lifted.y;
      out.z = _lifted.z;
      return g;
    }
  }
  return placeAlong(out, world, ray, head, yaw, orbitPitch);
}

/** Extra elevation tried, in order, when the camera's own line has no room. */
const LIFTS = [0.5, 0.9, 1.3] as const;
const _lifted = { x: 0, y: 0, z: 0 };

function placeAlong(
  out: Vec3,
  world: CameraWorld,
  ray: RaycastResult,
  head: Vec3,
  yaw: number,
  orbitPitch: number,
): number {
  const cosPitch = Math.cos(orbitPitch);
  const ox = -Math.sin(yaw) * cosPitch * THIRD_PERSON_CAMERA_DISTANCE;
  const oy = -Math.sin(orbitPitch) * THIRD_PERSON_CAMERA_DISTANCE + CAMERA_HEIGHT * 0.25;
  const oz = -Math.cos(yaw) * cosPitch * THIRD_PERSON_CAMERA_DISTANCE;
  const len = Math.hypot(ox, oy, oz);
  _dir.x = ox / len;
  _dir.y = oy / len;
  _dir.z = oz / len;
  world.raycast(ray, head, _dir, len + RAY_MARGIN);
  let f = ray.hit ? Math.max(MIN_REACH, (ray.distance - RAY_MARGIN) / len) : 1;
  for (; f > MIN_REACH; f -= STEP) {
    _probe.x = head.x + ox * f;
    _probe.y = head.y + oy * f;
    _probe.z = head.z + oz * f;
    if (world.solidClearance(_probe, CAMERA_CLEARANCE * 1.5) >= CAMERA_CLEARANCE) break;
  }
  f = Math.max(MIN_REACH, f);
  out.x = head.x + ox * f;
  out.y = head.y + oy * f;
  out.z = head.z + oz * f;
  return f;
}

/**
 * Ease `camera` towards `target` by `follow` (0..1), unless the eased point would not be clear
 * of geometry: then take the target, which is.
 */
export function easeCameraTo(camera: Vec3, target: Vec3, follow: number, world: CameraWorld): void {
  _probe.x = camera.x + (target.x - camera.x) * follow;
  _probe.y = camera.y + (target.y - camera.y) * follow;
  _probe.z = camera.z + (target.z - camera.z) * follow;
  const clear = follow >= 1 || world.solidClearance(_probe, CAMERA_CLEARANCE) >= CAMERA_CLEARANCE * 0.6;
  const from = clear ? _probe : target;
  camera.x = from.x;
  camera.y = from.y;
  camera.z = from.z;
}
