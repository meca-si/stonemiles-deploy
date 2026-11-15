-- Invoicing + P&L. PG twin of drizzle/0126_invoicing_pl.sql — see
-- that file's header. profile gains the business identity (biz_*)
-- that brands the driver's invoices and P&L statements, and
-- load_invoices carries one snapshot invoice per sealed load
-- (draft → issued → paid; overdue derived at read; load_id unique;
-- the rate lives only on the invoice).
ALTER TABLE "profile" ADD COLUMN "biz_name" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "biz_address" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "biz_phone" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "biz_email" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "biz_payment_instructions" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "biz_logo_blob_key" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "biz_logo_mime" text;
--> statement-breakpoint
CREATE TABLE "load_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer,
	"load_id" integer NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"bill_to_name" text NOT NULL,
	"bill_to_company" text,
	"shipper" text,
	"pickup_city" text,
	"pickup_state" text,
	"delivery_city" text,
	"delivery_state" text,
	"reference_number" text,
	"commodity" text,
	"delivered_at" timestamp with time zone NOT NULL,
	"lines_json" text DEFAULT '[]' NOT NULL,
	"amount" double precision NOT NULL,
	"due_days" integer DEFAULT 30 NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"notes" text,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "load_invoices_load_id_unique" UNIQUE("load_id")
);
