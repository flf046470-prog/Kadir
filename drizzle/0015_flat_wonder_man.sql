CREATE TABLE "user_platform_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_platform_accounts" ADD CONSTRAINT "user_platform_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_platform_accounts_identity_idx" ON "user_platform_accounts" USING btree ("platform","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_platform_accounts_member_idx" ON "user_platform_accounts" USING btree ("user_id","platform");