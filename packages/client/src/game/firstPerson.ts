import type { HandSnapshot, PlayerState } from '@kc/core';

/**
 * The simulation's own hands for a player who has no tracked ones, relative to the body, as a
 * snapshot carries tracked hands.
 *
 * PC and mobile players have hands too: `locomotion.ts` places them at the chest, throws them for
 * a punch and raises them for a guard, and `combat.ts` resolves hits from exactly these positions.
 * A first-person view draws them, so what the player sees land is what the server lands.
 */
export function placedHands(player: PlayerState): [HandSnapshot, HandSnapshot] {
  const [left, right] = player.hands;
  return [
    { x: left.world.x - player.position.x, y: left.world.y - player.position.y, z: left.world.z - player.position.z },
    { x: right.world.x - player.position.x, y: right.world.y - player.position.y, z: right.world.z - player.position.z },
  ];
}
