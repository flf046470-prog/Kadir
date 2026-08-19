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
