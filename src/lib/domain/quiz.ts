/**
 * Compatibility Quiz — a short, light questionnaire that feeds three
 * explainable signals: lifestyle, communication, and interest compatibility.
 *
 * This is explicitly NOT a personality test. It produces no psychological
 * classification, no diagnosis, and no trait label about a member. Each
 * question maps to one signal, and scoring is a plain answer-overlap
 * calculation the member could reproduce by hand.
 */

export type QuizSignal = "lifestyle" | "communication" | "interest";

export type QuizQuestion = {
  id: string;
  signal: QuizSignal;
  /** i18n key suffix: `quiz.<id>.prompt` and `quiz.<id>.options.<optionId>`. */
  options: string[];
};

export const quizQuestions: QuizQuestion[] = [
  {
    id: "ideal_weekend",
    signal: "lifestyle",
    options: ["out_exploring", "quiet_at_home", "with_friends", "depends_on_mood"]
  },
  {
    id: "social_energy",
    signal: "lifestyle",
    options: ["big_groups", "small_groups", "one_on_one", "mostly_solo"]
  },
  {
    id: "planning_style",
    signal: "lifestyle",
    options: ["plan_everything", "loose_plan", "spontaneous"]
  },
  {
    id: "travel_importance",
    signal: "interest",
    options: ["essential", "love_it", "occasionally", "prefer_home"]
  },
  {
    id: "morning_or_night",
    signal: "lifestyle",
    options: ["early_bird", "night_owl", "flexible"]
  },
  {
    id: "reply_pace",
    signal: "communication",
    options: ["right_away", "few_times_a_day", "when_i_can", "prefer_calls"]
  },
  {
    id: "conversation_depth",
    signal: "communication",
    options: ["deep_talks", "light_and_fun", "mix_of_both"]
  },
  {
    id: "humor_style",
    signal: "communication",
    options: ["dry", "silly", "witty", "warm"]
  },
  {
    id: "free_time",
    signal: "interest",
    options: ["sport", "arts", "food", "gaming", "outdoors", "reading"]
  },
  {
    id: "music_or_film",
    signal: "interest",
    options: ["live_music", "cinema", "both", "neither"]
  },
  {
    id: "cooking",
    signal: "interest",
    options: ["love_cooking", "love_eating_out", "both", "not_fussed"]
  },
  {
    id: "pace_of_dating",
    signal: "communication",
    options: ["take_it_slow", "see_where_it_goes", "know_quickly"]
  }
];

export const quizQuestionsById = new Map(quizQuestions.map((q) => [q.id, q]));

export type QuizSignalScores = Record<QuizSignal, number>;

/**
 * Per-signal agreement between two members' answers, as a 0–1 ratio over the
 * questions they have *both* answered. Signals with no shared answers score 0
 * and are reported as unknown rather than assumed.
 */
export function compareQuizAnswers(
  a: Record<string, string>,
  b: Record<string, string>
): { scores: QuizSignalScores; answeredCounts: QuizSignalScores } {
  const agreed: QuizSignalScores = { lifestyle: 0, communication: 0, interest: 0 };
  const shared: QuizSignalScores = { lifestyle: 0, communication: 0, interest: 0 };

  for (const question of quizQuestions) {
    const answerA = a[question.id];
    const answerB = b[question.id];
    if (!answerA || !answerB) continue;

    shared[question.signal] += 1;
    if (answerA === answerB) agreed[question.signal] += 1;
  }

  return {
    scores: {
      lifestyle: shared.lifestyle ? agreed.lifestyle / shared.lifestyle : 0,
      communication: shared.communication ? agreed.communication / shared.communication : 0,
      interest: shared.interest ? agreed.interest / shared.interest : 0
    },
    answeredCounts: shared
  };
}

/** Fraction of the quiz a member has completed, for prompting (never gating). */
export function completionRatio(answers: Record<string, string>): number {
  const answered = quizQuestions.filter((q) => Boolean(answers[q.id])).length;
  return answered / quizQuestions.length;
}
