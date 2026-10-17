import type { Vec3 } from '../math/vec3.js';
import { v3set, vec3 } from '../math/vec3.js';
import { VOICE_FAR } from '../modes/social.js';
import type { PhysicsWorld } from '../physics/world.js';
import { makeRaycastResult } from '../physics/types.js';
import type { PlayerState } from '../player/state.js';

/**
 * Which players a viewer is not sent, in a mode about hiding.
 *
 * The server used to send every player to every client. A client only *draws* what is in sight,
 * but what it is sent is what a modified client can draw — and in the Hunt, measured with six
 * bots, 56–77 % of the survivors a hunter was sent were behind something. A wallhack was a
 * renderer change, with nothing on the server to detect.
 *
 * The rule is deliberately generous, because withholding a player the screen could legitimately
 * show is a worse bug than the leak: the player pops out of a view they were standing in.
 * - **Within `CONCEAL_GRACE` everyone is sent.** That is `VOICE_FAR`, the distance a voice
 *   carries: inside it you can hear them, so their position is not a secret. Measured, only 4–8 %
 *   of hidden pairs are that close; the leak is almost all further out.
 * - **Sight is tested from everywhere the viewer's camera can be**, not only from their eyes. The
 *   third-person camera orbits `THIRD_PERSON_CAMERA_DISTANCE` behind the head and rises over it
 *   when the player looks down; turning puts it on any side. A player is sent if any of those
 *   vantage points sees their head or their chest.
 * - **Only the mode decides who is an opponent** (`GameMode.conceals`). Teammates always see each
 *   other, and a mode that is not about hiding conceals nobody.
 *
 * Pure and deterministic: the server and a probe run the same arithmetic on the same world.
 */

/** Everyone within this distance is sent, seen or not: their voice already carries this far. */
export const CONCEAL_GRACE = VOICE_FAR;

/**
 * How far behind the head the flat-screen camera sits. `GameClient` places its camera by this
 * number, and concealment tests sight from wherever it can be — two copies would drift, and the
 * day the camera moved further back, players would vanish from its edges.
 */
export const THIRD_PERSON_CAMERA_DISTANCE = 5.4;

/** Directions (unit, around the head) the camera can be found in: above, and two rings. */
const VANTAGE_DIRS: readonly Vec3[] = buildVantageDirs();

function buildVantageDirs(): Vec3[] {
  const dirs: Vec3[] = [vec3(0, 1, 0)];
  // A level camera sits a little above the head; one looking down, well above it.
  for (const [elevation, count] of [
    [0.3, 8],
    [0.8, 4],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const c = Math.cos(elevation);
      dirs.push(vec3(Math.sin(a) * c, Math.sin(elevation), Math.cos(a) * c));
    }
  }
  return dirs;
}

const _ray = makeRaycastResult();
const _dir = vec3();
const _target = vec3();
const _vantages: Vec3[] = [vec3(), ...VANTAGE_DIRS.map(() => vec3())];
/** How many of `_vantages` are filled for the current viewer. */
let _vantageCount = 0;

/** The mode's half of the rule: may `other` be withheld from `viewer` when out of sight? */
export interface ConcealmentRule {
  conceals?(viewer: PlayerState, other: PlayerState): boolean;
}

/**
 * Fill `out` with the ids `viewer` must not be sent. Empty when the mode conceals nobody, which is
 * every mode but the ones about hiding — and then it costs one call and no rays.
 */
export function concealedFrom(
  viewer: PlayerState,
  players: Iterable<PlayerState>,
  world: PhysicsWorld,
  rule: ConcealmentRule,
  out: Set<string>,
): Set<string> {
  out.clear();
  if (!rule.conceals) return out;
  _vantageCount = 0;
  for (const other of players) {
    if (other.id === viewer.id || !rule.conceals(viewer, other)) continue;
    const distance = Math.hypot(
      other.position.x - viewer.position.x,
      other.position.y - viewer.position.y,
      other.position.z - viewer.position.z,
    );
    if (distance <= CONCEAL_GRACE) continue;
    if (_vantageCount === 0) placeVantages(viewer, world);
    if (!inSight(other, world)) out.add(other.id);
  }
  return out;
}

/** The head, and every point the camera can reach from it without passing through a wall. */
function placeVantages(viewer: PlayerState, world: PhysicsWorld): void {
  const head = viewer.head;
  v3set(_vantages[0] as Vec3, head.x, head.y, head.z);
  _vantageCount = 1;
  for (const dir of VANTAGE_DIRS) {
    world.raycast(_ray, head, dir, THIRD_PERSON_CAMERA_DISTANCE + 0.4);
    // The camera pulls in on a hit, as `GameClient` does.
    const reach = _ray.hit ? Math.max(0, _ray.distance - 0.35) : THIRD_PERSON_CAMERA_DISTANCE;
    if (reach < 0.5) continue;
    v3set(_vantages[_vantageCount++] as Vec3, head.x + dir.x * reach, head.y + dir.y * reach, head.z + dir.z * reach);
  }
}

function inSight(other: PlayerState, world: PhysicsWorld): boolean {
  const chestY = other.position.y + other.height * 0.5;
  for (let t = 0; t < 2; t++) {
    if (t === 0) v3set(_target, other.head.x, other.head.y, other.head.z);
    else v3set(_target, other.position.x, chestY, other.position.z);
    for (let i = 0; i < _vantageCount; i++) {
      const from = _vantages[i] as Vec3;
      const dx = _target.x - from.x;
      const dy = _target.y - from.y;
      const dz = _target.z - from.z;
      const reach = Math.hypot(dx, dy, dz);
      if (reach < 1e-6) return true;
      v3set(_dir, dx / reach, dy / reach, dz / reach);
      world.raycast(_ray, from, _dir, reach);
      if (!_ray.hit) return true;
    }
  }
  return false;
}
