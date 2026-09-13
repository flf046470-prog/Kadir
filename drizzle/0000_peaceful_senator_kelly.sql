CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "daily_suggestions" (
	"user_id" uuid NOT NULL,
	"for_date" date NOT NULL,
	"suggested_user_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"reasons" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "daily_suggestions_user_id_for_date_suggested_user_id_pk" PRIMARY KEY("user_id","for_date","suggested_user_id")
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"pass_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_from_user_id_to_user_id_pk" PRIMARY KEY("from_user_id","to_user_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_attributes" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "profile_attributes_user_id_kind_value_pk" PRIMARY KEY("user_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "profile_visibility" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"location" text DEFAULT 'everyone' NOT NULL,
	"travel_plans" text DEFAULT 'matches' NOT NULL,
	"future_location" text DEFAULT 'matches' NOT NULL,
	"languages" text DEFAULT 'everyone' NOT NULL,
	"culture_interests" text DEFAULT 'everyone' NOT NULL,
	"relationship_goal" text DEFAULT 'everyone' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"bio" text,
	"city_id" text,
	"country_id" text NOT NULL,
	"relationship_goal" text DEFAULT 'unsure' NOT NULL,
	"connection_mode" text DEFAULT 'dating' NOT NULL,
	"open_to_other_cultures" boolean DEFAULT false NOT NULL,
	"future_city_id" text,
	"future_country_id" text,
	"future_month" text,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"option_id" text NOT NULL,
	CONSTRAINT "quiz_answers_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_weights" (
	"user_id" uuid NOT NULL,
	"signal_id" text NOT NULL,
	"multiplier" integer DEFAULT 100 NOT NULL,
	CONSTRAINT "signal_weights_user_id_signal_id_pk" PRIMARY KEY("user_id","signal_id")
);
--> statement-breakpoint
CREATE TABLE "travel_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"destination_city_id" text NOT NULL,
	"destination_country_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"styles" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"birthdate" date NOT NULL,
	"display_name" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_suggestions" ADD CONSTRAINT "daily_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_suggestions" ADD CONSTRAINT "daily_suggestions_suggested_user_id_users_id_fk" FOREIGN KEY ("suggested_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_attributes" ADD CONSTRAINT "profile_attributes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_visibility" ADD CONSTRAINT "profile_visibility_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_weights" ADD CONSTRAINT "signal_weights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "likes_to_idx" ON "likes" USING btree ("to_user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_pair_unique" ON "matches" USING btree ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "matches_b_idx" ON "matches" USING btree ("user_b_id");--> statement-breakpoint
CREATE INDEX "profile_attributes_lookup_idx" ON "profile_attributes" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "profiles_discover_idx" ON "profiles" USING btree ("country_id","city_id","relationship_goal");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "travel_plans_window_idx" ON "travel_plans" USING btree ("destination_city_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");