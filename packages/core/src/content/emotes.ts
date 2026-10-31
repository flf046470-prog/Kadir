/**
 * Emotes: the numbering that ties a button press to an animation clip.
 *
 * Every piece of this existed except the middle. `PlayerState` carried `emoteId` and `emoteTimer`,
 * the snapshot codec had a delta field for the id, `locomotion` counted the timer down and cleared
 * the id when it hit zero, every animal declared four emote names, and three emote cosmetics were
 * on sale with ids 5, 6 and 7. The button was bound on PC (X), on the mobile pad and on a VR grip.
 *
 * Nothing ever *set* `emoteId`. The whole system was inert, and the three cosmetics were items a
 * player could unlock, equip, and never once see — which matters more than an unused feature,
 * because the promise made about premium content is that it is cosmetic. A cosmetic that does not
 * render is not cosmetic, it is nothing.
 *
 * Ids are 1-based so that 0 keeps its meaning of "not emoting", which is what the snapshot field
 * and the timer reset already assumed.
 */

/** Clip names, in id order. `id - 1` indexes this; these are the names baked into every model. */
export const EMOTE_CLIPS = [
  'emote_wave',
  'emote_dance',
  'emote_taunt',
  'emote_sit',
  'emote_backflip',
  'emote_sleep',
  'emote_victory',
] as const;

export type EmoteClip = (typeof EMOTE_CLIPS)[number];

/**
 * How long each one holds, in seconds, matching the clip lengths in `tools/blender/characters.py`
 * at 24 fps. The simulation holds `emoteTimer` for exactly this long so the state clears on the
 * frame the animation ends rather than snapping out early or sticking.
 */
export const EMOTE_SECONDS: Record<number, number> = {
  1: 36 / 24,
  2: 36 / 24,
  3: 36 / 24,
  4: 36 / 24,
  5: 30 / 24,
  6: 72 / 24,
  7: 36 / 24,
};

/** The four every animal carries. Ids 5+ come from an equipped cosmetic. */
export const BUILT_IN_EMOTES = 4;

export function isEmoteId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= EMOTE_CLIPS.length;
}

export function emoteClip(id: number): EmoteClip | null {
  return isEmoteId(id) ? (EMOTE_CLIPS[id - 1] as EmoteClip) : null;
}

export function emoteSeconds(id: number): number {
  return EMOTE_SECONDS[id] ?? 1.5;
}

/**
 * Which emote a press plays.
 *
 * With a cosmetic equipped, that one — it is the thing the player chose, and making them cycle
 * past it to reach it would be a strange reward. With nothing equipped, the press walks through
 * the animal's own four, so the button is expressive rather than a single canned gesture.
 *
 * `previous` is the id played last, which the player carries as `lastEmote` rather than as the
 * live `emoteId`. The first version read `emoteId` on the grounds that it needed no extra field —
 * but `locomotion` clears that to 0 the moment an emote finishes, so every press saw "nothing
 * playing" and the cycle restarted at the first gesture forever. Either way nothing goes on the
 * wire: a viewer only needs to know what is playing now.
 */
export function nextEmote(previous: number, equipped: number): number {
  if (isEmoteId(equipped) && equipped > BUILT_IN_EMOTES) return equipped;
  if (!isEmoteId(previous) || previous >= BUILT_IN_EMOTES) return 1;
  return previous + 1;
}

/**
 * The emote animation a player's equipped cosmetic grants, re-validated against what they own.
 *
 * Checked here rather than trusted from the saved loadout for the same reason the gadget loadout
 * is re-resolved on every join: the profile was written at some earlier moment, and a refund or a
 * catalogue change since then must not put an item the player no longer owns into a live round.
 * Anything unowned, unknown, or not actually an emote resolves to 0, which means "use the animal's
 * own four" — never an error, because a stale cosmetic should cost a player their gesture, not
 * their place in the match.
 */
export function resolveEquippedEmote(
  equipped: Partial<Record<string, string>>,
  owned: readonly string[],
  lookup: (id: string) => { slot: string; emoteId?: number } | undefined,
): number {
  const id = equipped['emote'];
  if (!id || !owned.includes(id)) return 0;
  const def = lookup(id);
  if (!def || def.slot !== 'emote') return 0;
  return isEmoteId(def.emoteId ?? 0) ? (def.emoteId as number) : 0;
}
