import { describe, expect, it } from 'vitest';
import { LAUNCH_ANIMALS, FUTURE_ANIMALS, getAnimal, listAnimals, registerAnimals } from '../content/animals.js';
import { LAUNCH_COSMETICS, getCosmetic } from '../content/cosmetics.js';
import { LAUNCH_STORE, PRICE_POINTS, validateCatalog } from '../content/store.js';
import { DAILY_REWARDS } from '../content/rewards.js';
import { applyFeelProfile, DEFAULT_MOVEMENT, FEEL_BAND, FEEL_FIELDS } from '../player/config.js';
import type { MatchResult } from '../modes/types.js';
import { STARTER_GADGETS } from '../gadgets/catalog.js';
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

  it('ships six launch animals and keeps the roadmap roster valid', () => {
    expect(LAUNCH_ANIMALS.map((a) => a.id)).toEqual(['kangaroo', 'wolf', 'fox', 'tiger', 'frog', 'penguin']);
    expect(LAUNCH_ANIMALS[0]?.priceCents).toBe(0);
    expect(FUTURE_ANIMALS.length).toBeGreaterThanOrEqual(9);
    for (const animal of FUTURE_ANIMALS) expect(Object.keys(animal.feel)).toHaveLength(0);
  });
});

describe('store', () => {
  it('passes catalog validation', () => {
    expect(validateCatalog(LAUNCH_STORE)).toEqual([]);
  });

  it('only uses approved price points and sells no randomised content', () => {
    for (const item of LAUNCH_STORE) {
      expect(PRICE_POINTS).toContain(item.priceCents as (typeof PRICE_POINTS)[number]);
      expect(item.grants.length).toBeGreaterThan(0);
      expect(item.name.toLowerCase()).not.toMatch(/box|crate|gacha|spin|random/);
    }
  });

  it('rejects a bundle that is not cheaper than its parts', () => {
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
    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toMatch(/bundle costs/);
  });

  it('grants content once per verified receipt and is idempotent on replay', () => {
    const profile = createProfile('p1', 'Roo');
    const first = applyVerifiedPurchase(profile, 'animal_wolf', 'txn-123');
    expect(first.ok).toBe(true);
    expect(profile.ownedAnimals).toContain('wolf');
    const replay = applyVerifiedPurchase(profile, 'animal_wolf', 'txn-123');
    expect(replay.granted).toEqual([]);
    expect(profile.purchases).toHaveLength(1);
  });

  it('rejects a purchase without a verified receipt', () => {
    const profile = createProfile('p1', 'Roo');
    const outcome = applyVerifiedPurchase(profile, 'animal_wolf', '');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('invalid-receipt');
    expect(profile.ownedAnimals).not.toContain('wolf');
  });

  it('lets players buy most content with earned coins', () => {
    const profile = createProfile('p1', 'Roo');
    profile.coins = 10_000;
    const outcome = purchaseWithCoins(profile, 'animal_fox');
    expect(outcome.ok).toBe(true);
    expect(profile.ownedAnimals).toContain('fox');
    expect(profile.coins).toBe(10_000 - 6000);

    const broke = purchaseWithCoins(profile, 'animal_tiger');
    expect(broke.error).toBe('insufficient-coins');
  });
});

describe('inventory equip validation', () => {
  it('refuses to equip content the player does not own', () => {
    const profile = createProfile('p1', 'Roo');
    expect(equipAnimal(profile, 'tiger').error).toBe('not-owned');
    expect(equipAnimal(profile, 'kangaroo').ok).toBe(true);
    expect(equipCosmetic(profile, 'hat', 'hat_crown').error).toBe('not-owned');
  });

  it('refuses a cosmetic in the wrong slot', () => {
    const profile = createProfile('p1', 'Roo');
    profile.ownedCosmetics.push('hat_crown');
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
  it('unlocks free rewards by level and gates premium behind the optional pass', () => {
    const profile = createProfile('p1', 'Roo');
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    profile.season.xp = 5000; // level 6
    const progress = getSeasonProgress(profile, now);
    expect(progress.level).toBe(6);
    expect(progress.claimable.every((c) => c.track === 'free')).toBe(true);

    profile.season.premiumOwned = true;
    const premium = getSeasonProgress(profile, now);
    expect(premium.claimable.some((c) => c.track === 'premium')).toBe(true);

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
    expect(profile.ownedCosmetics).toEqual(['hat_leaf']);
    expect(profile.level).toBe(levelForXp(4000));
  });

  it('gives an account written before gadgets existed the free starter set', () => {
    // A save from v1 has no gadget fields at all. Rather than dropping that player into Hunt
    // empty-handed, the migration hands them what every new account gets for free.
    const v1 = { version: 1, coins: 100, ownedAnimals: ['kangaroo', 'fox'] };
    const profile = migrateProfile(v1, 'p1');

    for (const id of STARTER_GADGETS) expect(profile.ownedGadgets).toContain(id);
    expect(profile.equipped.gadgets.primary).toBe('freeze_gun');
    expect(profile.ownedAnimals).toContain('fox');
  });

  it('drops a gadget that no longer exists rather than leaving it in the loadout', () => {
    const stale = { version: 2, ownedGadgets: ['freeze_gun', 'retired_gadget'] };
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
