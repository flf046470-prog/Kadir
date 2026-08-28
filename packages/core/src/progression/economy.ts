import type { MatchResult, PlayerResult } from '../modes/types.js';
import type { PlayerProfile } from './profile.js';
import { levelForXp } from './profile.js';

export interface MatchAward {
  coins: number;
  xp: number;
  seasonXp: number;
  breakdown: { reason: string; coins: number; xp: number }[];
}

/**
 * Match rewards.
 *
 * Computed on the **server** from the server's own `MatchResult` — the client never reports its
 * own performance. Generous enough that everything cosmetic is reachable for free; nothing here
 * is gated behind spending.
 */
export function computeMatchAward(result: MatchResult, playerId: string): MatchAward {
  const entry = result.players.find((p) => p.playerId === playerId);
  const breakdown: MatchAward['breakdown'] = [];
  if (!entry) return { coins: 0, xp: 0, seasonXp: 0, breakdown };

  const minutes = result.durationTicks / 60 / 60;
  const participation = { reason: 'played', coins: Math.round(12 + minutes * 6), xp: Math.round(25 + minutes * 20) };
  breakdown.push(participation);

  const performance = {
    reason: 'score',
    coins: Math.round(entry.score * 0.35),
    xp: Math.round(entry.score * 0.8),
  };
  breakdown.push(performance);

  const placementBonus = placementCoins(entry, result.players.length);
  if (placementBonus > 0) breakdown.push({ reason: 'placement', coins: placementBonus, xp: placementBonus });

  const winBonus = entry.won ? { reason: 'win', coins: 60, xp: 120 } : null;
  if (winBonus) breakdown.push(winBonus);

  const coins = breakdown.reduce((sum, b) => sum + b.coins, 0);
  const xp = breakdown.reduce((sum, b) => sum + b.xp, 0);
  return { coins, xp, seasonXp: Math.round(xp * 0.75), breakdown };
}

function placementCoins(entry: PlayerResult, total: number): number {
  if (total < 2) return 0;
  if (entry.placement === 1) return 40;
  if (entry.placement === 2) return 25;
  if (entry.placement === 3) return 15;
  return 0;
}

export function grantAward(profile: PlayerProfile, award: MatchAward, now = Date.now()): void {
  profile.coins += award.coins;
  profile.xp += award.xp;
  profile.level = levelForXp(profile.xp);
  profile.season.xp += award.seasonXp;
  profile.updatedAt = now;
}

export function spendCoins(profile: PlayerProfile, amount: number): boolean {
  if (amount <= 0 || profile.coins < amount) return false;
  profile.coins -= amount;
  profile.updatedAt = Date.now();
  return true;
}
