CREATE TABLE "virtual_date_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"environment" text,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "virtual_date_invites" ADD CONSTRAINT "virtual_date_invites_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_date_invites" ADD CONSTRAINT "virtual_date_invites_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_date_invites" ADD CONSTRAINT "virtual_date_invites_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_date_invites_one_pending_idx" ON "virtual_date_invites" USING btree ("match_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "virtual_date_invites_to_idx" ON "virtual_date_invites" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE INDEX "virtual_date_invites_from_idx" ON "virtual_date_invites" USING btree ("from_user_id","status");