CREATE TABLE "boost_grants" (
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boost_grants_user_id_period_pk" PRIMARY KEY("user_id","period")
);
--> statement-breakpoint
CREATE TABLE "profile_views" (
	"subject_user_id" uuid NOT NULL,
	"viewer_user_id" uuid NOT NULL,
	"view_count" integer DEFAULT 1 NOT NULL,
	"first_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_views_subject_user_id_viewer_user_id_pk" PRIMARY KEY("subject_user_id","viewer_user_id")
);
--> statement-breakpoint
ALTER TABLE "boost_grants" ADD CONSTRAINT "boost_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_views_subject_idx" ON "profile_views" USING btree ("subject_user_id","last_viewed_at");