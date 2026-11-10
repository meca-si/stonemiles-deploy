ALTER TABLE "broker_links" ADD COLUMN "kind" text DEFAULT 'broker' NOT NULL;--> statement-breakpoint
ALTER TABLE "broker_submissions" ADD COLUMN "sender_contact" text;--> statement-breakpoint
ALTER TABLE "broker_submissions" ADD COLUMN "reference_number" text;--> statement-breakpoint
ALTER TABLE "broker_submissions" ADD COLUMN "pickup_appt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broker_submissions" ADD COLUMN "delivery_appt_at" timestamp with time zone;