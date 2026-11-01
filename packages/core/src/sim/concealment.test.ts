import { describe, expect, it } from 'vitest';
import { CONCEAL_GRACE, THIRD_PERSON_CAMERA_DISTANCE, concealedFrom } from './concealment.js';
import type { ConcealmentRule } from './concealment.js';
import { PhysicsWorld } from '../physics/world.js';
import { DEFAULT_SURFACE } from '../physics/types.js';
import type { Collider } from '../physics/types.js';
import { vec3 } from '../math/vec3.js';
import { createPlayerState } from '../player/state.js';
import type { PlayerState } from '../player/state.js';
import { VOICE_FAR } from '../modes/social.js';

function box(x: number, y: number, z: number, hx: number, hy: number, hz: number, id: number): Collider {
  return { kind: 'box', id, center: vec3(x, y, z), half: vec3(hx, hy, hz), yaw: 0, surface: { ...DEFAULT_SURFACE } };
}

const GROUND = box(0, -1, 0, 200, 1, 200, 0);

function player(id: string, x: number, z: number): PlayerState {
  const p = createPlayerState({ id, position: vec3(x, 0, z) });
  return p;
}

const opponents: ConcealmentRule = { conceals: () => true };

function hiddenFrom(viewer: PlayerState, other: PlayerState, world: PhysicsWorld, rule = opponents): boolean {
  return concealedFrom(viewer, [viewer, other], world, rule, new Set()).has(other.id);
}

describe('concealment', () => {
  // A wall 40 m tall and 80 m wide at x = 15, between a viewer at 0 and an opponent at 30.
  const tallWall = new PhysicsWorld([GROUND, box(15, 20, 0, 0.5, 20, 40, 1)]);
  const open = new PhysicsWorld([GROUND]);

  it('withholds an opponent beyond the grace distance that nobody could see', () => {
    expect(hiddenFrom(player('v', 0, 0), player('o', 30, 0), tallWall)).toBe(true);
  });

  it('sends an opponent in plain sight', () => {
    expect(hiddenFrom(player('v', 0, 0), player('o', 30, 0), open)).toBe(false);
  });

  it('sends everyone within a voice of the viewer, seen or not', () => {
    // The wall is still between them; they are close enough to be heard.
    expect(CONCEAL_GRACE).toBe(VOICE_FAR);
    const viewer = player('v', 0, 0);
    const near = player('o', CONCEAL_GRACE - 1, 0);
    const wall = new PhysicsWorld([GROUND, box(CONCEAL_GRACE / 2, 20, 0, 0.5, 20, 40, 1)]);
    expect(hiddenFrom(viewer, near, wall)).toBe(false);
  });

  it('never withholds a teammate, or anyone in a mode that is not about hiding', () => {
    const viewer = player('v', 0, 0);
    const other = player('o', 30, 0);
    expect(hiddenFrom(viewer, other, tallWall, { conceals: () => false })).toBe(false);
    expect(hiddenFrom(viewer, other, tallWall, {})).toBe(false);
  });

  it('sends someone the eyes cannot see but the flat-screen camera can', () => {
    // A 2.5 m wall hides a kangaroo's head from another's, and a camera that rises over the head
    // when its player looks down sees straight over it. Withholding them would make a player pop
    // out of a view they were standing in — worse than the leak this exists to close.
    const lowWall = new PhysicsWorld([GROUND, box(15, 1.25, 0, 0.5, 1.25, 40, 1)]);
    const viewer = player('v', 0, 0);
    const other = player('o', 30, 0);
    expect(viewer.head.y).toBeLessThan(2.5);
    expect(hiddenFrom(viewer, other, lowWall)).toBe(false);
    // ...and the camera's reach is the client's own number, not a second copy of it.
    expect(THIRD_PERSON_CAMERA_DISTANCE).toBeGreaterThan(2.5);
  });

  it('does not let the camera see through a ceiling', () => {
    // The low wall the camera could see over in the open — but the viewer is under a roof, which
    // pulls the camera in below it, as it does in the game. A camera that passed through the roof
    // would rise over the wall and send the opponent.
    const lowWall = box(15, 1.25, 0, 0.5, 1.25, 40, 1);
    const roofed = new PhysicsWorld([GROUND, lowWall, box(0, 3, 0, 10, 0.2, 10, 2)]);
    expect(hiddenFrom(player('v', 0, 0), player('o', 30, 0), new PhysicsWorld([GROUND, lowWall]))).toBe(false);
    expect(hiddenFrom(player('v', 0, 0), player('o', 30, 0), roofed)).toBe(true);
  });
});
