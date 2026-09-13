-- Statement order corrected by hand: drizzle-kit emitted the primary key change
-- before the column it keys on, which fails on an empty database as readily as
-- on a full one.
ALTER TABLE "boost_grants" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boost_grants" DROP CONSTRAINT "boost_grants_user_id_period_pk";--> statement-breakpoint
ALTER TABLE "boost_grants" ADD CONSTRAINT "boost_grants_user_id_period_seq_pk" PRIMARY KEY("user_id","period","seq");--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "closed_at" timestamp with time zone;
