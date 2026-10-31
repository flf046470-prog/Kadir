import { describe, expect, it } from 'vitest';

import { DAILY_REWARDS, SEASONS } from './rewards.js';
import type { Reward } from './rewards.js';
import { listStoreItems, validateCatalog } from './store.js';
import { getAnimal, listAnimals } from './animals.js';
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
    // track, so charging for it — in money or in coins — would remove something they have. The
    // shelf sells the season's cosmetics for coins; it never sells the pass.
    for (const item of listStoreItems()) {
      expect(item.kind, item.id).not.toBe('season');
      expect(item.grants.some((g) => g.startsWith('season:')), item.id).toBe(false);
    }
    expect(validateCatalog()).toEqual([]);
  });

  /**
   * The defect this guards was measured, not imagined: 9 of the track's 13 rewards and 4 of the 7
   * daily rewards were items every account already owned from creation, so claiming them granted
   * nothing — and the coins the rest paid out bought nothing either. Held against a brand new
   * profile, because that is who a reward has to mean something to.
   */
  it('pays out only things a new account does not already own', () => {
    const fresh = createProfile('fresh', 'Tester');
    const owned = (reward: Reward): boolean =>
      reward.kind === 'cosmetic'
        ? fresh.ownedCosmetics.includes(reward.contentId ?? '')
        : reward.kind === 'animal'
          ? fresh.ownedAnimals.includes(reward.contentId ?? '')
          : false;
    const track = (season?.track ?? []).flatMap((entry) => [entry.free, entry.premium]).filter((r): r is Reward => r !== undefined);
    const pointless = [...track, ...DAILY_REWARDS].filter(owned).map((r) => r.contentId);
    expect(pointless).toEqual([]);
    // And the season's cosmetics are really on it, not only coins.
    expect(track.filter((r) => r.kind === 'cosmetic').length).toBeGreaterThanOrEqual(5);
  });

  it('can claim everything and end up owning every cosmetic it names', () => {
    const profile = createProfile('grinder', 'Tester');
    profile.season.xp = 1e9;
    const coins = profile.coins;
    claimSeasonRewards(profile);
    for (const entry of season?.track ?? []) {
      for (const reward of [entry.free, entry.premium]) {
        if (reward?.kind === 'cosmetic') expect(profile.ownedCosmetics, reward.contentId).toContain(reward.contentId);
      }
    }
    expect(profile.coins).toBeGreaterThan(coins);
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
    // The one reward kind that touches the simulation at all. The track grants no animal today —
    // every animal is owned from creation — so the clamp is held over the whole roster, which is
    // every animal a track could ever name.
    const animals = listAnimals();
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
