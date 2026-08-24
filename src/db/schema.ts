import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  boolean,
  date,
  index,
  uniqueIndex,
  primaryKey
} from "drizzle-orm/pg-core";

/**
 * Database schema.
 *
 * Two conventions run through this file:
 *
 *  - **Deletion is complete.** Every table that holds member data cascades from
 *    `users`, so account deletion is a single delete rather than a checklist
 *    someone can forget to update. GDPR/KVKK erasure is tested against this.
 *  - **Location stays coarse.** We store city and country ids, never
 *    coordinates or an address, and future moves are stored to the month. The
 *    matching engine is given a pre-rounded distance by the caller.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /** Optional: members may register by phone instead. */
    phone: text("phone"),
    /** argon2id hash. Never a plaintext or reversible value. */
    passwordHash: text("password_hash").notNull(),
    birthdate: date("birthdate").notNull(),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("en"),
    /**
     * member | moderator | admin. Granted out of band (a migration or an admin
     * action), never self-service — a role a member can set is not a role.
     */
    role: text("role").notNull().default("member"),
    /** Set when a moderator suspends the account; blocks login and Discover. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the member requests deletion; the row is then purged by a job. */
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [
    // Case-insensitive uniqueness is enforced by storing email already lowercased.
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_phone_unique").on(table.phone)
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token. The raw token only ever lives in the cookie. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (table) => [index("sessions_user_idx").on(table.userId)]
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    bio: text("bio"),
    /** Coarse location only. */
    cityId: text("city_id"),
    countryId: text("country_id").notNull(),
    relationshipGoal: text("relationship_goal").notNull().default("unsure"),
    connectionMode: text("connection_mode").notNull().default("dating"),
    openToOtherCultures: boolean("open_to_other_cultures").notNull().default(false),
    /** Future location, stored to the month — never an exact date or address. */
    futureCityId: text("future_city_id"),
    futureCountryId: text("future_country_id"),
    futureMonth: text("future_month"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // Discover filters on these together.
    index("profiles_discover_idx").on(table.countryId, table.cityId, table.relationshipGoal)
  ]
);

/**
 * Multi-valued profile attributes. One table with a `kind` column rather than
 * six near-identical tables: they are all "list of tags for a member", queried
 * the same way, and this keeps adding a new attribute kind a data change.
 */
export const profileAttributes = pgTable(
  "profile_attributes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** interest | ideal_date | communication_style | language_spoken |
     *  language_learning | culture_interest | match_intent | future_plan */
    kind: text("kind").notNull(),
    value: text("value").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.value] }),
    index("profile_attributes_lookup_idx").on(table.kind, table.value)
  ]
);

/** Per-field visibility. Enforced before matching reads a profile. */
export const profileVisibility = pgTable("profile_visibility", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  location: text("location").notNull().default("everyone"),
  travelPlans: text("travel_plans").notNull().default("matches"),
  futureLocation: text("future_location").notNull().default("matches"),
  languages: text("languages").notNull().default("everyone"),
  cultureInterests: text("culture_interests").notNull().default("everyone"),
  relationshipGoal: text("relationship_goal").notNull().default("everyone")
});

export const quizAnswers = pgTable(
  "quiz_answers",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    optionId: text("option_id").notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })]
);

export const travelPlans = pgTable(
  "travel_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    destinationCityId: text("destination_city_id").notNull(),
    destinationCountryId: text("destination_country_id").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    styles: text("styles").array().notNull().default([])
  },
  (table) => [
    // Travel Match queries overlapping windows in one destination.
    index("travel_plans_window_idx").on(table.destinationCityId, table.startDate, table.endDate)
  ]
);

/** Like / Pass / Super Like. One row per direction. */
export const likes = pgTable(
  "likes",
  {
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** like | pass | super_like */
    kind: text("kind").notNull(),
    /** Optional pass reason, used by the learning loop. Never required. */
    passReason: text("pass_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.fromUserId, table.toUserId] }),
    // "Who liked me" and mutual-like detection.
    index("likes_to_idx").on(table.toUserId, table.kind)
  ]
);

/**
 * A match. `userAId` is always the lexicographically smaller uuid so a pair can
 * only ever produce one row — the uniqueness is structural, not a convention
 * the application has to remember.
 */
export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("matches_pair_unique").on(table.userAId, table.userBId),
    index("matches_b_idx").on(table.userBId)
  ]
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] })]
);

/**
 * Profile photos.
 *
 * `moderationStatus` starts as `pending` and a pending photo is visible only to
 * its owner. That is the safe default: an un-screened photo reaching other
 * members is the failure mode that matters, so the system fails closed.
 *
 * **Launch blocker:** automated NSFW and CSAM screening (e.g. a hash-matching
 * service such as PhotoDNA, plus a classifier) MUST be wired into the approval
 * path before public signups. Nothing in this repository performs that
 * screening — `approvePhoto` is the hook it belongs in. See docs/ARCHITECTURE.md.
 */
export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Content-addressed storage key. */
    storageKey: text("storage_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Display order within the member's profile; 0 is the primary photo. */
    position: integer("position").notNull().default(0),
    /** pending | approved | rejected */
    moderationStatus: text("moderation_status").notNull().default("pending"),
    moderationNote: text("moderation_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("photos_user_idx").on(table.userId, table.position),
    index("photos_moderation_idx").on(table.moderationStatus)
  ]
);

/**
 * Messages within a match.
 *
 * `language` is stored per message from the start, even though nothing reads it
 * yet: AI translation (roadmap Phase 5) needs to know the source language of
 * historic messages, and backfilling that later means guessing.
 *
 * Deletion is soft. A member deleting their message should remove it from both
 * views, but a hard delete would also destroy evidence in an abuse report filed
 * minutes later — which is exactly when it matters most.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** BCP-47 primary subtag the message was written in, best effort. */
    language: text("language"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [
    // The conversation view reads newest-last for one match.
    index("messages_match_idx").on(table.matchId, table.createdAt)
  ]
);

/**
 * Scam Shield assessments on messages.
 *
 * Stored separately from the message so a risk signal is an observation *about*
 * a message rather than a property of it — the message stands on its own, and
 * an assessment can be revised or dismissed by a moderator without editing what
 * someone actually wrote.
 */
export const messageRiskAssessments = pgTable(
  "message_risk_assessments",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    /** none | low | elevated | high */
    band: text("band").notNull(),
    /** Signal ids that fired, as JSON. For moderator context only. */
    signals: text("signals").notNull(),
    /** warning | reported | human_review | action | dismissed */
    stage: text("stage").notNull().default("warning"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("message_risk_stage_idx").on(table.stage, table.band)]
);

/** Abuse reports raised by members. Always routed to a human. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedId: uuid("reported_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional: the message that prompted the report. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    details: text("details"),
    stage: text("stage").notNull().default("reported"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("reports_stage_idx").on(table.stage)]
);

/**
 * Audit log of moderator actions.
 *
 * Every enforcement decision writes a row here, including dismissals. A
 * moderation system where you cannot tell who acted, on whom, and why is not
 * accountable — this table is what makes an appeal, an internal review, or a
 * regulator's question answerable.
 *
 * Rows are append-only and deliberately survive the *subject's* deletion, so
 * the record of a decision does not vanish with the account it was about; the
 * subject reference is nulled instead. Deleting a moderator's own account also
 * keeps their action history, for the same reason.
 */
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null once the acting moderator's account is deleted. */
    moderatorId: uuid("moderator_id").references(() => users.id, { onDelete: "set null" }),
    /** Null once the subject's account is deleted. */
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    /** photo | report | risk_assessment | account */
    targetType: text("target_type").notNull(),
    /** Id of the photo/report/assessment acted on, when applicable. */
    targetId: text("target_id"),
    /** approve | reject | dismiss | suspend | reinstate */
    action: text("action").notNull(),
    /** Free-text rationale. Required for anything punitive. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("moderation_actions_subject_idx").on(table.subjectUserId, table.createdAt),
    index("moderation_actions_moderator_idx").on(table.moderatorId, table.createdAt)
  ]
);

/** Learned signal weight multipliers, from volunteered pass feedback only. */
export const signalWeights = pgTable(
  "signal_weights",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    signalId: text("signal_id").notNull(),
    multiplier: integer("multiplier").notNull().default(100)
  },
  (table) => [primaryKey({ columns: [table.userId, table.signalId] })]
);

/** Today's 5, persisted so the day's list is stable across requests. */
export const dailySuggestions = pgTable(
  "daily_suggestions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    forDate: date("for_date").notNull(),
    suggestedUserId: uuid("suggested_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    reasons: text("reasons").notNull(),
    rank: integer("rank").notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.forDate, table.suggestedUserId] })]
);

/**
 * Match Games.
 *
 * One row per session between a matched pair. The rounds live as JSON because
 * their shape belongs to the game engine, not to the database: a two-option
 * round, a free-text round and a Two Truths round have genuinely different
 * fields, and modelling that relationally would mean three tables and a join
 * to answer "what is the state of this game?".
 *
 * Player slots map to the match's own ordered pair — `user_a_id` is always
 * slot "a" — so a slot means the same thing whoever opened the invite, and a
 * rematch cannot silently swap the two members' answers.
 */
export const gameSessions = pgTable(
  "game_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** Who opened the invite. The other member is the one who accepts. */
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** this_or_that | would_you_rather | quick_questions | guess_my_answer | two_truths */
    game: text("game").notNull(),
    /** invited | active | completed | declined | ended */
    status: text("status").notNull().default("invited"),
    targetRounds: integer("target_rounds").notNull(),
    /** `Round[]` as JSON. The engine owns the shape; this is storage. */
    rounds: text("rounds").notNull().default("[]"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // "What is happening on this match?" is the only query the UI makes.
    index("game_sessions_match_idx").on(table.matchId, table.status)
  ]
);

/**
 * Referral codes. One per member, minted on first request rather than at
 * registration — most members never open the referral screen, and a code
 * nobody has seen is a row nobody needs.
 */
export const referralCodes = pgTable(
  "referral_codes",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Crockford Base32, always stored in the normalised (folded) form. */
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("referral_codes_code_unique").on(table.code)]
);

/**
 * Who referred whom.
 *
 * Keyed by the *referee*, which is the anti-abuse constraint that matters: a
 * person can be referred exactly once, ever, and the database enforces it
 * rather than the application remembering to check. Re-entering a code later,
 * or two tabs racing the same signup, cannot produce a second payout.
 *
 * Both sides cascade. A referral is a relationship between two accounts, so
 * when either account is erased the relationship goes with it — unlike the
 * reward ledger below, which is the referrer's own property.
 */
export const referrals = pgTable(
  "referrals",
  {
    refereeId: uuid("referee_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    referrerId: uuid("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The code as entered, after normalisation. Kept for support and audit. */
    code: text("code").notNull(),
    /** granted | pending_qualification | held_for_review | rejected */
    outcome: text("outcome").notNull().default("pending_qualification"),
    /** `FraudSignal[]` as JSON — what the decision saw, for a human reviewer. */
    signals: text("signals").notNull().default("[]"),
    signedUpAt: timestamp("signed_up_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the outcome last stopped being provisional. */
    decidedAt: timestamp("decided_at", { withTimezone: true })
  },
  (table) => [
    // "My referrals", the monthly cap, and the burst signal all read this.
    index("referrals_referrer_idx").on(table.referrerId, table.signedUpAt),
    index("referrals_outcome_idx").on(table.outcome)
  ]
);

/**
 * Rewards actually earned.
 *
 * A ledger, not a balance: rows are appended when a referral qualifies and
 * stamped when the reward is spent. A balance column would have to be right
 * after every concurrent grant and spend; a ledger is right by construction and
 * can answer "where did this boost come from?" a year later.
 *
 * `refereeId` nulls rather than cascades on purpose. The reward belongs to the
 * referrer and was genuinely earned; if the referee later deletes their
 * account, erasure should remove the link to them, not confiscate someone
 * else's boost.
 */
export const referralRewards = pgTable(
  "referral_rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The referrer — whoever the reward is spendable by. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refereeId: uuid("referee_id").references(() => users.id, { onDelete: "set null" }),
    /** boost | super_like | premium_trial */
    rewardId: text("reward_id").notNull(),
    quantity: integer("quantity").notNull(),
    /** Premium trial only. */
    trialDays: integer("trial_days"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
  },
  (table) => [
    // "What can I spend?" — the only hot query.
    index("referral_rewards_wallet_idx").on(table.userId, table.consumedAt)
  ]
);

/**
 * Live state for one member in one conversation: are they typing, and when
 * were they last actually looking at it.
 *
 * There is no socket here, so "live" means a row the other side polls. Keeping
 * it in its own table rather than on `messages` matters: this row is rewritten
 * every few seconds while someone types, and putting that write traffic on the
 * table that holds the conversation itself would churn the index the whole
 * chat reads through.
 *
 * `lastSeenAt` is the honest input for a read receipt. Polling alone must not
 * mark a conversation read — a tab left open in the background is not someone
 * reading — so the client says when it is genuinely visible, and this is where
 * that lands.
 */
export const matchPresence = pgTable(
  "match_presence",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Last keystroke. Meaningless once older than the typing window. */
    typingAt: timestamp("typing_at", { withTimezone: true }),
    /** Last time the conversation was actually on screen for this member. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.matchId, table.userId] })]
);

/**
 * Cached machine translations of messages.
 *
 * A cache, not a column on `messages`, for three reasons. The conversation
 * polls every couple of seconds and would otherwise re-bill a provider for
 * text that has not changed; one message can be wanted in several languages at
 * once; and translation is a derived artefact — losing this table costs money
 * to rebuild, never data.
 *
 * Deliberately not part of the moderation surface: a translation is machine
 * output *about* a message, and Scam Shield reads what the sender actually
 * wrote.
 */
export const messageTranslations = pgTable(
  "message_translations",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    /** BCP-47 target, as the viewer's locale gives it. */
    targetLanguage: text("target_language").notNull(),
    body: text("body").notNull(),
    /** Which provider produced this, so a switch is traceable in the data. */
    provider: text("provider").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.messageId, table.targetLanguage] })]
);

/**
 * A member's paid tier.
 *
 * One row per member, not a history: "what may they do right now" is the only
 * question the app asks on every request, and it should not have to fold a
 * ledger to answer it. Billing history belongs to the payment provider, which
 * keeps it properly and is the system of record for money.
 *
 * `currentPeriodEnd` is authoritative and `status` is a hint. A webhook that
 * never arrives must not leave a lapsed subscription running forever, so
 * access expires on the clock even if nothing told us it had.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** plus | vip */
    tier: text("tier").notNull(),
    /** active | past_due | canceled | expired */
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    /** The provider's own id, so a webhook can find this row. Never shown. */
    providerRef: text("provider_ref"),
    provider: text("provider"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // The webhook arrives knowing only the provider's id.
    uniqueIndex("subscriptions_provider_ref_unique").on(table.providerRef)
  ]
);

/**
 * A running Boost.
 *
 * Rows are kept after they expire rather than deleted: "did my boost actually
 * run?" is the first question anyone asks after paying for one, and a deleted
 * row cannot answer it. Expiry is a comparison against `expiresAt`, so nothing
 * has to sweep.
 */
export const boosts = pgTable(
  "boosts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (table) => [
    // "Who is boosted right now", which Discover asks on every feed build.
    index("boosts_active_idx").on(table.expiresAt, table.userId)
  ]
);

/**
 * Gifts sent inside a conversation.
 *
 * Its own table rather than a `kind` column on `messages`. A message carries
 * text that Scam Shield assesses, is editable in principle, and can be
 * soft-deleted; a gift is a fixed token from a closed catalogue with none of
 * that machinery. Folding them together would mean every message query
 * carrying a discriminator, and every gift row carrying five columns it can
 * never use.
 *
 * There is no note column on purpose — see `lib/gifts/catalogue`.
 */
export const gifts = pgTable(
  "gifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** An id from the closed catalogue, never arbitrary text. */
    giftId: text("gift_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // The conversation reads one match's gifts in timeline order.
    index("gifts_match_idx").on(table.matchId, table.createdAt),
    // The daily allowance counts a sender's recent gifts.
    index("gifts_sender_idx").on(table.senderId, table.createdAt)
  ]
);
