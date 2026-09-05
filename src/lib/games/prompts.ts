/**
 * Prompt banks for Match Games.
 *
 * Prompts are stored as stable ids; the text lives in the i18n catalogs under
 * `games.prompts.<id>` (and `games.prompts.<id>.a` / `.b` for two-option
 * games). That keeps every prompt translatable and keeps game content out of
 * code, so the admin panel can extend the banks without a deploy.
 *
 * Content rule: prompts stay light and non-invasive. Nothing here asks about
 * income, health, religion, politics, sexual history, or precise location.
 */

export type GameId =
  | "this_or_that"
  | "would_you_rather"
  | "two_truths"
  | "quick_questions"
  | "guess_my_answer";

export const gameIds: GameId[] = [
  "this_or_that",
  "would_you_rather",
  "two_truths",
  "quick_questions",
  "guess_my_answer"
];

/** Two-option prompts: the member picks A or B. */
export const twoOptionPrompts: Record<"this_or_that" | "would_you_rather", string[]> = {
  this_or_that: [
    "coffee_tea",
    "beach_mountains",
    "morning_night",
    "city_countryside",
    "cook_eat_out",
    "call_text",
    "books_films",
    "plan_improvise"
  ],
  would_you_rather: [
    "live_abroad_forever_or_travel_always",
    "speak_every_language_or_visit_every_country",
    "always_summer_or_always_winter",
    "famous_meal_or_famous_view",
    "no_music_or_no_films",
    "meet_your_heroes_or_be_someone_hero"
  ]
};

/** Open-ended prompts: the member writes a short free-text answer. */
export const openPrompts: Record<"quick_questions" | "guess_my_answer", string[]> = {
  quick_questions: [
    "best_trip",
    "comfort_food",
    "song_on_repeat",
    "perfect_sunday",
    "learning_right_now",
    "makes_you_laugh"
  ],
  guess_my_answer: [
    "my_ideal_first_date",
    "my_most_used_emoji",
    "my_go_to_karaoke_song",
    "my_dream_city_to_live_in",
    "my_useless_talent"
  ]
};

/** Every prompt id a game can draw, for validation and admin tooling. */
export function promptsFor(game: GameId): string[] {
  if (game === "this_or_that" || game === "would_you_rather") return twoOptionPrompts[game];
  if (game === "quick_questions" || game === "guess_my_answer") return openPrompts[game];
  // Two Truths and a Lie has no prompt bank — players author their own statements.
  return [];
}

export const MAX_ANSWER_LENGTH = 140;
export const TWO_TRUTHS_STATEMENT_COUNT = 3;
