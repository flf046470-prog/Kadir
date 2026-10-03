import type { PlayerRole } from '@kc/core';

/**
 * What the HUD's role badge says for each role, and which colour it wears: the threat red, the
 * prey blue, everything else grey.
 *
 * A `Record` over `PlayerRole`, so a role the game gains without a badge here is a type error. It
 * was a `switch` ending in `default: return 'WARM-UP'`, and the Hunt's two roles were never added
 * to it: a whole Hunt was played with the badge reading WARM-UP — measured in a store screenshot
 * at 3:44 left with four survivors standing — and the hunter was never told they were the hunter.
 * The role-change toast said "You are now WARM-UP".
 */
export const ROLE_BADGES: Record<PlayerRole, { label: string; tone: 'threat' | 'prey' | 'other' }> = {
  idle: { label: 'WARM-UP', tone: 'other' },
  runner: { label: 'RUNNER', tone: 'prey' },
  chaser: { label: 'CHASER', tone: 'threat' },
  infected: { label: 'INFECTED', tone: 'threat' },
  racer: { label: 'RACER', tone: 'other' },
  fighter: { label: 'FIGHTER', tone: 'other' },
  spectator: { label: 'SPECTATING', tone: 'other' },
  hunter: { label: 'HUNTER', tone: 'threat' },
  survivor: { label: 'SURVIVOR', tone: 'prey' },
  red: { label: 'RED TEAM', tone: 'other' },
  blue: { label: 'BLUE TEAM', tone: 'other' },
};

/** The badge for a role as it arrives off the wire or in an event, where it is only a string. */
export function roleBadge(role: string): { label: string; tone: 'threat' | 'prey' | 'other' } {
  return ROLE_BADGES[role as PlayerRole] ?? ROLE_BADGES.idle;
}

/** The badge's CSS class: `.kc-role--chaser` is the threat colour, `--runner` the prey's. */
export function roleBadgeClass(role: string): string {
  const { tone } = roleBadge(role);
  return `kc-role kc-role--${tone === 'threat' ? 'chaser' : tone === 'prey' ? 'runner' : 'other'}`;
}
