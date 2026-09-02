import { describe, expect, it } from 'vitest';
import { LAUNCH_ANIMALS, FUTURE_ANIMALS, getAnimal, listAnimals, registerAnimals } from '../content/animals.js';
import { LAUNCH_COSMETICS, getCosmetic, listCosmetics } from '../content/cosmetics.js';
import { LAUNCH_STORE, PRICE_POINTS, registerStoreItems, validateCatalog } from '../content/store.js';
import { DAILY_REWARDS } from '../content/rewards.js';
import { applyFeelProfile, DEFAULT_MOVEMENT, FEEL_BAND, FEEL_FIELDS } from '../player/config.js';
import type { MatchResult } from '../modes/types.js';
import { freeGadgetIds } from '../gadgets/catalog.js';
import { SAVE_VERSION, createProfile, levelForXp } from './profile.js';
import { computeMatchAward, grantAward, spendCoins } from './economy.js';
import { applyVerifiedPurchase, equipAnimal, equipCosmetic, purchaseWithCoins } from './inventory.js';
import { applyMatchStats, evaluateAchievements, addMetric } from './achievements.js';
import { claimDaily, dailyPreview } from './daily.js';
import { claimSeasonRewards, getSeasonProgress } from './season.js';
import { MemorySaveStore, migrateProfile, parseProfile, serializeProfile } from '../save/index.js';

function matchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    modeId: 'kangaroo-chase',
    levelId: 'jungle-world',
    durationTicks: 60 * 120,
    players: [
      {
        playerId: 'me',
        name: 'Me',
        animalId: 'kangaroo',
        placement: 1,
        score: 140,
        tags: 3,
        escapes: 1,
        survivalTicks: 5000,
        bestLapTicks: -1,
        won: true,
      },
    ],
    winnerIds: ['me'],
    ...overrides,
  };
}

describe('animal fairness', () => {
  it('clamps every animal feel modifier into the ±3 % band', () => {
    for (const animal of listAnimals()) {
      for (const field of FEEL_FIELDS) {
        const mod = animal.feel[field];
        if (mod === undefined) continue;
        expect(Math.abs(mod)).toBeLessThanOrEqual(FEEL_BAND + 1e-9);
      }
    }
  });

  it('clamps a hostile animal definition on registration', () => {
    registerAnimals([
      {
        ...(LAUNCH_ANIMALS[0] as (typeof LAUNCH_ANIMALS)[number]),
        id: 'pay-to-win',
        feel: { maxSpeed: 5, jumpForce: 2 },
      },
    ]);
    const loaded = getAnimal('pay-to-win');
    expect(loaded?.feel.maxSpeed).toBeCloseTo(FEEL_BAND);
    const config = applyFeelProfile(DEFAULT_MOVEMENT, loaded?.feel ?? {});
    expect(config.maxSpeed).toBeLessThanOrEqual(DEFAULT_MOVEMENT.maxSpeed * 1.03 + 1e-9);
    expect(config.jumpForce).toBeLessThanOrEqual(DEFAULT_MOVEMENT.jumpForce * 1.03 + 1e-9);
  });

  it('never lets an animal change health, damage or hitbox size', () => {
    const config = applyFeelProfile(DEFAULT_MOVEMENT, { maxSpeed: FEEL_BAND });
    expect(config.radius).toBe(DEFAULT_MOVEMENT.radius);
    expect(config.standHeight).toBe(DEFAULT_MOVEMENT.standHeight);
    expect(config.wallPush).toBe(DEFAULT_MOVEMENT.wallPush);
  });

  it('ships seven launch animals and keeps the roadmap roster valid', () => {
    expect(LAUNCH_ANIMALS.map((a) => a.id)).toEqual(['kangaroo', 'human', 'wolf', 'fox', 'tiger', 'frog', 'penguin']);
    expect(FUTURE_ANIMALS.length).toBeGreaterThanOrEqual(9);
    for (const animal of FUTURE_ANIMALS) expect(Object.keys(animal.feel)).toHaveLength(0);
  });

  it('keeps both sides of the hunt free to play', () => {
    // Hunt and Conversion Duel are kangaroo-versus-human. If either body cost money, half of
    // two whole modes would sit behind a paywall.
    for (const id of ['kangaroo', 'human']) {
      const animal = LAUNCH_ANIMALS.find((a) => a.id === id);
      expect(animal?.priceCents, id).toBe(0);
      expect(animal?.unlock, id).toBe('free');
    }
  });
});

describe('store', () => {
  it('passes catalog validation', () => {
    expect(validateCatalog(LAUNCH_STORE)).toEqual([]);
  });

  it('has nothing on the shelf, because the game is free', () => {
    expect(LAUNCH_STORE).toEqual([]);
  });

  it('rejects an item with a price', () => {
    const problems = validateCatalog([
      {
        id: 'bad_bundle',
        kind: 'bundle',
        name: 'Bad Bundle',
        description: '',
        priceCents: 499,
        priceCoins: -1,
        grants: ['wolf', 'fox'],
      },
    ]);
    expect(problems.map((p) => p.problem).join(' ')).toMatch(/nothing in this game is sold/);
  });

  it('keeps the approved price points as a constraint, even with nothing to price', () => {
    // Retained so a future decision to sell anything starts from the agreed list rather than
    // from scratch — see the module comment in store.ts.
    expect(PRICE_POINTS).toContain(99);
  });

  /**
   * The shipped catalog is empty, but the purchase machinery is not gone — it is the part that
   * takes real care to get right (verified receipts, idempotent grants, an audit trail), and it
   * stays covered against a catalog registered here rather than one shipped to players. Coins
   * are the grant used, because every piece of *content* is already owned.
   */
  it('grants once per verified receipt and is idempotent on replay', () => {
    registerStoreItems([
      { id: 'test_coins', kind: 'bundle', name: 'Test Coins', description: '', priceCents: 0, priceCoins: 0, grants: ['coins:500'] },
    ]);
    const profile = createProfile('p1', 'Roo');
    const before = profile.coins;

    const first = applyVerifiedPurchase(profile, 'test_coins', 'txn-123');
    const replay = applyVerifiedPurchase(profile, 'test_coins', 'txn-123');

    expect(first.ok).toBe(true);
    expect(profile.coins).toBe(before + 500);
    expect(replay.granted).toEqual([]);
    expect(profile.coins, 'a replayed receipt must not grant twice').toBe(before + 500);
    expect(profile.purchases).toHaveLength(1);
  });

  it('rejects a purchase without a verified receipt', () => {
    registerStoreItems([
      { id: 'test_coins2', kind: 'bundle', name: 'Test Coins', description: '', priceCents: 0, priceCoins: 0, grants: ['coins:500'] },
    ]);
    const profile = createProfile('p1', 'Roo');
    const before = profile.coins;

    const outcome = applyVerifiedPurchase(profile, 'test_coins2', '');

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('invalid-receipt');
    expect(profile.coins).toBe(before);
  });

  it('still refuses a coin purchase the player cannot afford', () => {
    registerStoreItems([
      { id: 'test_expensive', kind: 'bundle', name: 'Expensive', description: '', priceCents: 0, priceCoins: 999_999, grants: ['coins:1'] },
    ]);
    const profile = createProfile('p1', 'Roo');
    profile.coins = 10;

    expect(purchaseWithCoins(profile, 'test_expensive').error).toBe('insufficient-coins');
    expect(profile.coins).toBe(10);
  });
});

describe('inventory equip validation', () => {
  it('lets a player equip anything, because they own everything', () => {
    const profile = createProfile('p1', 'Roo');
    for (const id of ['kangaroo', 'human', 'tiger', 'penguin']) {
      expect(equipAnimal(profile, id).ok, id).toBe(true);
    }
    expect(equipCosmetic(profile, 'hat', 'hat_crown').ok).toBe(true);
  });

  /**
   * The ownership check itself still works, and still matters: the server validates every equip
   * against the profile, and a save that predates a piece of content — or one that lost it —
   * must not be able to equip it just because the request said so.
   */
  it('still refuses to equip something the profile does not list', () => {
    const profile = createProfile('p1', 'Roo');
    profile.ownedAnimals = profile.ownedAnimals.filter((id) => id !== 'tiger');
    profile.ownedCosmetics = profile.ownedCosmetics.filter((id) => id !== 'hat_crown');

    expect(equipAnimal(profile, 'tiger').error).toBe('not-owned');
    expect(equipCosmetic(profile, 'hat', 'hat_crown').error).toBe('not-owned');
  });

  it('refuses content that does not exist at all', () => {
    const profile = createProfile('p1', 'Roo');
    expect(equipAnimal(profile, 'dragon').error).toBe('unknown');
  });

  it('refuses a cosmetic in the wrong slot', () => {
    const profile = createProfile('p1', 'Roo');
    expect(equipCosmetic(profile, 'mask', 'hat_crown').error).toBe('wrong-slot');
    expect(equipCosmetic(profile, 'hat', 'hat_crown').ok).toBe(true);
    expect(profile.equipped.cosmetics.hat).toBe('hat_crown');
    expect(equipCosmetic(profile, 'hat', null).ok).toBe(true);
    expect(profile.equipped.cosmetics.hat).toBeUndefined();
  });

  it('keeps every cosmetic purely visual', () => {
    for (const cosmetic of LAUNCH_COSMETICS) {
      expect(Object.keys(cosmetic)).not.toContain('feel');
      expect(Object.keys(cosmetic.visual).toSorted()).toEqual(expect.arrayContaining(['color', 'shape']));
    }
  });
});

describe('economy', () => {
  it('rewards a match from the server-side result', () => {
    const profile = createProfile('p1', 'Roo');
    const award = computeMatchAward(matchResult(), 'me');
    expect(award.coins).toBeGreaterThan(0);
    expect(award.xp).toBeGreaterThan(0);
    grantAward(profile, award);
    expect(profile.coins).toBe(250 + award.coins);
    expect(profile.level).toBe(levelForXp(profile.xp));
    expect(profile.season.xp).toBe(award.seasonXp);
  });

  it('gives nothing to a player who was not in the match', () => {
    const award = computeMatchAward(matchResult(), 'someone-else');
    expect(award.coins).toBe(0);
  });

  it('refuses to overspend', () => {
    const profile = createProfile('p1', 'Roo');
    expect(spendCoins(profile, 10_000)).toBe(false);
    expect(profile.coins).toBe(250);
  });
});

describe('achievements', () => {
  it('unlocks from match stats and never double-grants', () => {
    const profile = createProfile('p1', 'Roo');
    applyMatchStats(profile, matchResult(), 'me');
    const unlocked = evaluateAchievements(profile);
    const ids = unlocked.map((u) => u.def.id);
    expect(ids).toContain('first_tag');
    expect(ids).toContain('wins_1');
    const again = evaluateAchievements(profile);
    expect(again).toHaveLength(0);
  });

  it('tracks continuous metrics like climbing', () => {
    const profile = createProfile('p1', 'Roo');
    addMetric(profile, 'climbMetres', 1200);
    const unlocked = evaluateAchievements(profile);
    expect(unlocked.map((u) => u.def.id)).toContain('master_climber');
    expect(profile.ownedCosmetics).toContain('hands_gloves');
  });

  it('handles lower-is-better goals such as speedrunning', () => {
    const profile = createProfile('p1', 'Roo');
    applyMatchStats(
      profile,
      matchResult({
        modeId: 'parkour',
        players: [
          {
            playerId: 'me',
            name: 'Me',
            animalId: 'kangaroo',
            placement: 1,
            score: 100,
            tags: 0,
            escapes: 0,
            survivalTicks: 100,
            bestLapTicks: 60 * 80,
            won: true,
          },
        ],
      }),
      'me',
    );
    expect(profile.stats.bestLapSeconds).toBeCloseTo(80);
    expect(evaluateAchievements(profile).map((u) => u.def.id)).toContain('speedrunner');
  });
});

describe('daily rewards', () => {
  const DAY = 86_400_000;

  it('grants one reward per server day and builds a streak', () => {
    const profile = createProfile('p1', 'Roo');
    const day0 = DAY * 20_000;
    const first = claimDaily(profile, day0);
    expect(first.ok).toBe(true);
    expect(first.streak).toBe(1);
    expect(profile.coins).toBe(250 + (DAILY_REWARDS[0]?.amount ?? 0));

    expect(claimDaily(profile, day0 + 1000).ok).toBe(false);
    const second = claimDaily(profile, day0 + DAY);
    expect(second.streak).toBe(2);
    expect(profile.ownedCosmetics).toContain('emote_sleep');
  });

  it('resets the streak after a missed day but keeps everything earned', () => {
    const profile = createProfile('p1', 'Roo');
    const day0 = DAY * 20_000;
    claimDaily(profile, day0);
    claimDaily(profile, day0 + DAY);
    const owned = [...profile.ownedCosmetics];
    const afterGap = claimDaily(profile, day0 + DAY * 5);
    expect(afterGap.streak).toBe(1);
    expect(profile.ownedCosmetics).toEqual(expect.arrayContaining(owned));
  });

  it('previews the seven-day cycle with exactly one claimable day', () => {
    const profile = createProfile('p1', 'Roo');
    const preview = dailyPreview(profile, 86_400_000 * 20_000);
    expect(preview).toHaveLength(7);
    expect(preview.filter((p) => p.claimable)).toHaveLength(1);
  });
});

describe('seasons', () => {
  it('unlocks both reward tracks by level, because the premium track is free too', () => {
    const profile = createProfile('p1', 'Roo');
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    profile.season.xp = 5000; // level 6
    expect(profile.season.premiumOwned).toBe(true);

    const premium = getSeasonProgress(profile, now);
    expect(premium.level).toBe(6);
    expect(premium.claimable.some((c) => c.track === 'premium')).toBe(true);

    // The two tracks still exist as separate reward lists; only the gate is gone.
    profile.season.premiumOwned = false;
    const freeOnly = getSeasonProgress(profile, now);
    expect(freeOnly.claimable.every((c) => c.track === 'free')).toBe(true);
    profile.season.premiumOwned = true;

    const claimed = claimSeasonRewards(profile, now);
    expect(claimed.ok).toBe(true);
    expect(getSeasonProgress(profile, now).claimable).toHaveLength(0);
  });
});

describe('save system', () => {
  it('round-trips a profile', async () => {
    const store = new MemorySaveStore();
    const profile = createProfile('p1', 'Roo');
    profile.coins = 1234;
    profile.ownedCosmetics.push('hat_leaf');
    await store.save(profile);
    const loaded = await store.load('p1');
    expect(loaded?.coins).toBe(1234);
    expect(loaded?.ownedCosmetics).toContain('hat_leaf');
  });

  it('migrates a legacy save without losing content', () => {
    const legacy = { version: 0, coins: 500, ownedCosmetics: ['hat_leaf', 'hat_leaf'], xp: 4000 };
    const profile = migrateProfile(legacy, 'p1');
    expect(profile.version).toBe(SAVE_VERSION);
    expect(profile.coins).toBe(500);
    expect(profile.ownedAnimals).toContain('kangaroo');
    // The old inventory survives, and the rest of the game is granted alongside it.
    expect(profile.ownedCosmetics).toContain('hat_leaf');
    expect(profile.ownedCosmetics.length).toBe(listCosmetics().length);
    expect(profile.level).toBe(levelForXp(4000));
  });

  it('gives an account written before gadgets existed the whole set', () => {
    const v1 = { version: 1, coins: 100, ownedAnimals: ['kangaroo', 'fox'] };
    const profile = migrateProfile(v1, 'p1');

    expect(profile.ownedGadgets.toSorted()).toEqual(freeGadgetIds().toSorted());
    expect(profile.equipped.gadgets.primary).toBe('freeze_gun');
    expect(profile.ownedAnimals).toContain('fox');
  });

  /**
   * The migration a returning player actually notices.
   *
   * Their old save records exactly what they once bought. The game no longer has purchases, so
   * finding a locked roster would be strictly worse than before — everything is granted instead.
   */
  it('unlocks the whole game for an account that predates it being free', () => {
    const paid = { version: 2, ownedAnimals: ['kangaroo'], ownedCosmetics: [], ownedGadgets: ['freeze_gun'] };
    const profile = migrateProfile(paid, 'p1');

    for (const animal of listAnimals()) expect(profile.ownedAnimals, animal.id).toContain(animal.id);
    for (const cosmetic of listCosmetics()) expect(profile.ownedCosmetics, cosmetic.id).toContain(cosmetic.id);
    for (const id of freeGadgetIds()) expect(profile.ownedGadgets, id).toContain(id);
    expect(profile.season.premiumOwned).toBe(true);
  });

  it('drops a gadget that no longer exists rather than leaving it in the loadout', () => {
    const stale = { version: 3, ownedGadgets: ['freeze_gun', 'retired_gadget'] };
    const profile = migrateProfile(stale, 'p1');
    expect(profile.ownedGadgets).toContain('freeze_gun');
    expect(profile.ownedGadgets).not.toContain('retired_gadget');
  });

  it('repairs a corrupt save instead of crashing', () => {
    const profile = parseProfile('{not json', 'p1');
    expect(profile.playerId).toBe('p1');
    expect(profile.ownedAnimals).toContain('kangaroo');

    const hostile = migrateProfile({ coins: 'lots', ownedAnimals: 'wolf', equipped: { animalId: 'dragon' } }, 'p1');
    expect(hostile.coins).toBe(0);
    expect(hostile.equipped.animalId).toBe('kangaroo'); // not owned → reset
  });

  it('serialises to compact JSON', () => {
    const json = serializeProfile(createProfile('p1', 'Roo'));
    expect(json.length).toBeLessThan(1200);
    expect(getCosmetic('hat_leaf')).toBeDefined();
  });
});
