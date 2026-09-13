CREATE TABLE "store_notifications" (
	"provider" text NOT NULL,
	"notification_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_notifications_provider_notification_id_pk" PRIMARY KEY("provider","notification_id")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "store_notifications_received_at_idx" ON "store_notifications" USING btree ("received_at");