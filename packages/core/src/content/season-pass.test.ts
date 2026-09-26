import { describe, expect, it } from 'vitest';

import { SEASONS } from './rewards.js';
import { listStoreItems, validateCatalog } from './store.js';
import { getAnimal } from './animals.js';
import { getCosmetic } from './cosmetics.js';
import { DEFAULT_MOVEMENT, applyFeelProfile } from '../player/config.js';
import { createProfile } from '../progression/profile.js';
import { claimSeasonRewards, getSeasonProgress } from '../progression/season.js';

/**
 * The season pass, held to the promise the rest of the game makes.
 *
 * Two rules have to survive the existence of a premium track, and they are not the same rule.
 * Nothing may be sold for money — enforced by `validateCatalog`, which the server runs at boot and
 * refuses to start without. And nothing on either track may make a player better at the game,
 * which is enforced far below the UI: an animal's feel is clamped to a narrow band and its health,
 * damage and hitbox cannot be changed at all.
 *
 * Asserted against the shipped track rather than a fixture, because the risk here is not that the
 * mechanism breaks. It is that somebody later adds a reward that is more than a costume.
 */
describe('season pass', () => {
  const season = SEASONS[0];

  it('is unlocked on a brand new account, both tracks', () => {
    // The thing the screen exists to show, and the thing a price would have taken away: every
    // profile is created with the premium track already owned.
    const profile = createProfile('fresh', 'Tester');
    expect(profile.season.premiumOwned).toBe(true);
    expect(getSeasonProgress(profile).premiumOwned).toBe(true);
  });

  it('is on no shelf at all, at any price', () => {
    // Not even a coin price. A pass item was written and removed: every player already owns the
    // track, so charging for it — in money or in coins — would remove something they have.
    expect(listStoreItems()).toEqual([]);
    expect(validateCatalog()).toEqual([]);
  });

  it('gives away only costumes, coins and XP — on both tracks', () => {
    const rewards = (season?.track ?? []).flatMap((entry) => [entry.free, entry.premium].filter((r) => r !== undefined));
    expect(rewards.length).toBeGreaterThan(5);
    for (const reward of rewards) {
      expect(['coins', 'xp', 'cosmetic', 'animal']).toContain(reward.kind);
      if (reward.kind === 'cosmetic') expect(getCosmetic(reward.contentId ?? '')).toBeDefined();
      if (reward.kind === 'animal') expect(getAnimal(reward.contentId ?? '')).toBeDefined();
    }
  });

  it('cannot hand out an animal that is better than any other', () => {
    // The one reward kind that touches the simulation at all. Every animal the track can grant
    // goes through the same clamp as every animal already in the game.
    const animals = (season?.track ?? [])
      .flatMap((entry) => [entry.free, entry.premium])
      .filter((r) => r?.kind === 'animal')
      .map((r) => getAnimal(r?.contentId ?? ''));

    expect(animals.length).toBeGreaterThan(0);
    for (const animal of animals) {
      const config = applyFeelProfile(DEFAULT_MOVEMENT, animal?.feel ?? {});
      expect(config.maxSpeed).toBeLessThanOrEqual(DEFAULT_MOVEMENT.maxSpeed * 1.03 + 1e-9);
      expect(config.jumpForce).toBeLessThanOrEqual(DEFAULT_MOVEMENT.jumpForce * 1.03 + 1e-9);
      expect(config.radius).toBe(DEFAULT_MOVEMENT.radius);
      expect(config.standHeight).toBe(DEFAULT_MOVEMENT.standHeight);
    }
  });

  it('still refuses the premium track to a profile that does not own it', () => {
    /**
     * The security property, kept under test even though every account is currently granted the
     * pass. It is the server's own copy of the profile that decides, never the client, and an
     * older save or a future season that is not granted by default must not be able to claim a
     * premium reward by asking. Level is set absurdly high so that only ownership can be what
     * withholds it.
     */
    const profile = createProfile('p1', 'Tester');
    profile.season = { seasonId: season?.id ?? '', xp: 999_000, premiumOwned: false, claimedFree: [], claimedPremium: [] };

    const before = getSeasonProgress(profile);
    expect(before.claimable.length).toBeGreaterThan(0);
    expect(before.claimable.some((c) => c.track === 'premium')).toBe(false);
  });




  it('does not pay the same reward twice', () => {
    const profile = createProfile('p5', 'Tester');
    profile.season = { seasonId: season?.id ?? '', xp: 999_000, premiumOwned: true, claimedFree: [], claimedPremium: [] };

    const first = claimSeasonRewards(profile);
    expect(first.claimed.length).toBeGreaterThan(0);
    const coinsAfterFirst = profile.coins;

    const second = claimSeasonRewards(profile);
    expect(second.claimed).toEqual([]);
    expect(profile.coins).toBe(coinsAfterFirst);
  });

  it('pays nothing for levels the player has not reached', () => {
    const profile = createProfile('p6', 'Tester');
    profile.season = { seasonId: season?.id ?? '', xp: 0, premiumOwned: true, claimedFree: [], claimedPremium: [] };
    const progress = getSeasonProgress(profile);
    expect(progress.level).toBe(1);
    expect(progress.claimable.every((c) => c.level === 1)).toBe(true);
  });
});
