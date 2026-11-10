ALTER TABLE "board_loads" ADD COLUMN "reference_number" text;--> statement-breakpoint
ALTER TABLE "board_loads" ADD COLUMN "pickup_appt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_loads" ADD COLUMN "delivery_appt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_loads" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "board_loads" ADD COLUMN "declined_by" text;--> statement-breakpoint
ALTER TABLE "board_loads" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "reference_number" text;