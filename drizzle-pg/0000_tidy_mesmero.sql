CREATE TABLE "account_admin" (
	"username" text PRIMARY KEY NOT NULL,
	"tier" text,
	"trucks" integer,
	"dispatch_seats" integer,
	"beta_access" boolean,
	"status" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"retainer_id" integer,
	"branch" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_locks" (
	"username" text PRIMARY KEY NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "account_retainers" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"plan" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"lifted_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"referral_reward_stoner" double precision DEFAULT 100 NOT NULL,
	"yearly_credit_stoner" double precision DEFAULT 100 NOT NULL,
	"yearly_credit_usd" double precision DEFAULT 1 NOT NULL,
	"giveaway_weekly_cap" integer DEFAULT 10 NOT NULL,
	"giveaway_vest_pct" double precision DEFAULT 25 NOT NULL,
	"welcome_credit_gold_stoner" double precision DEFAULT 1000 NOT NULL,
	"welcome_credit_diamond_stoner" double precision DEFAULT 10000 NOT NULL,
	"welcome_credit_owner_stoner" double precision DEFAULT 100000 NOT NULL,
	"welcome_credit_gold_usd" double precision DEFAULT 1 NOT NULL,
	"welcome_credit_diamond_usd" double precision DEFAULT 5 NOT NULL,
	"welcome_credit_owner_usd" double precision DEFAULT 25 NOT NULL,
	"points_conversion_live" boolean DEFAULT false NOT NULL,
	"payout_manual_batch" boolean DEFAULT true NOT NULL,
	"usdg_backing_live" boolean DEFAULT false NOT NULL,
	"usdg_price_usd" double precision,
	"team_email" text DEFAULT 'stonervisionteam@gmail.com' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_health_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"screen" text,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"diagnosis" text,
	"fix_plan" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "app_health_reports_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "app_health_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"auto_report_enabled" boolean DEFAULT true NOT NULL,
	"last_check_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_live_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"report_id" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"appearance" text DEFAULT 'dark' NOT NULL,
	"font_size" text DEFAULT 'standard' NOT NULL,
	"units" text DEFAULT 'mi' NOT NULL,
	"overspeed_threshold_mph" integer DEFAULT 5 NOT NULL,
	"voice_alerts" boolean DEFAULT true NOT NULL,
	"banner_alerts" boolean DEFAULT true NOT NULL,
	"notify_hos" boolean DEFAULT true NOT NULL,
	"notify_delivery" boolean DEFAULT true NOT NULL,
	"notify_chat" boolean DEFAULT true NOT NULL,
	"notify_owner_log" boolean DEFAULT true NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"map_base_style" text DEFAULT 'streets' NOT NULL,
	"map_show_fuel" boolean DEFAULT true NOT NULL,
	"map_show_parking" boolean DEFAULT true NOT NULL,
	"map_show_hazards" boolean DEFAULT true NOT NULL,
	"map_show_intel" boolean DEFAULT true NOT NULL,
	"map_show_route" boolean DEFAULT true NOT NULL,
	"map_show_speed" boolean DEFAULT true NOT NULL,
	"map_show_labels" boolean DEFAULT true NOT NULL,
	"map_show_traffic_notes" boolean DEFAULT true NOT NULL,
	"map_day_night_mode" text DEFAULT 'auto' NOT NULL,
	"map_show_radar" boolean DEFAULT false NOT NULL,
	"weather_gust_threshold_mph" integer DEFAULT 35 NOT NULL,
	"weigh_prompts" boolean DEFAULT true NOT NULL,
	"drive_show_weather" boolean DEFAULT true NOT NULL,
	"drive_show_big_prompts" boolean DEFAULT true NOT NULL,
	"drive_show_traffic_legend" boolean DEFAULT false NOT NULL,
	"drive_show_eta_pill" boolean DEFAULT true NOT NULL,
	"drive_glass_level" text DEFAULT 'med' NOT NULL,
	"map_enhanced_view" boolean DEFAULT true NOT NULL,
	"map_tilt_mode" text DEFAULT 'auto' NOT NULL,
	"hill_grade_alerts" boolean DEFAULT true NOT NULL,
	"winter_weather_alerts" boolean DEFAULT true NOT NULL,
	"map_show_signals" boolean DEFAULT true NOT NULL,
	"car_mode_enabled" boolean DEFAULT false NOT NULL,
	"car_mode_auto_launch" boolean DEFAULT true NOT NULL,
	"car_voice_prompts" boolean DEFAULT true NOT NULL,
	"car_show_hos" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beta_access" (
	"id" integer PRIMARY KEY NOT NULL,
	"unlocked" boolean DEFAULT false NOT NULL,
	"account_kind" text,
	"code_used" text,
	"unlocked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "beta_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" text DEFAULT 'driver' NOT NULL,
	"single_use" boolean DEFAULT true NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_likes" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_loads" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"posted_by" text NOT NULL,
	"shipper" text,
	"pickup_city" text,
	"pickup_state" text,
	"delivery_city" text,
	"delivery_state" text,
	"pickup_text" text,
	"delivery_text" text,
	"rate" double precision,
	"loaded_miles" double precision,
	"miles_source" text,
	"extra_charges" double precision DEFAULT 0 NOT NULL,
	"extra_charges_note" text,
	"weight_lbs" integer,
	"commodity" text,
	"hazmat" boolean DEFAULT false NOT NULL,
	"equipment_type" text,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"claim_method" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"load_id" integer,
	"trip_queue_id" integer,
	"doc_sha256" text,
	"doc_blob_key" text,
	"doc_mime" text,
	"broker_name" text,
	"broker_company" text,
	"broker_mc" text,
	"broker_source" text,
	"broker_link_id" integer,
	"board_scope" text DEFAULT 'fleet' NOT NULL,
	"origin_kind" text,
	"origin_label" text,
	"origin_company_id" integer,
	"dispatcher_fee_pct" double precision,
	"vetted_only" boolean DEFAULT false NOT NULL,
	"overflow_reason" text,
	"overflow_from_board_load_id" integer,
	"broker_poster_load_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"area" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"location_source" text DEFAULT 'driver_entered' NOT NULL,
	"miles_reached" double precision,
	"detail_text" text,
	"edited" boolean DEFAULT false NOT NULL,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakdown_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"location_note" text,
	"note" text,
	"costs_json" text DEFAULT '[]' NOT NULL,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"contact_name" text,
	"logo_initials" text,
	"broker_mc" text,
	"dispatcher_fee_pct" double precision,
	"linked_username" text,
	"company_id" integer,
	"owner_username" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"default_pickup_address" text,
	"default_pickup_city" text,
	"default_pickup_state" text,
	"default_commodity" text,
	"default_freight_class" text,
	"default_contact_name" text,
	"default_contact_phone" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_key" text NOT NULL,
	"company_id" integer,
	"owner_username" text NOT NULL,
	"broker_name" text NOT NULL,
	"broker_company" text,
	"broker_contact" text,
	"broker_mc" text,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "broker_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "broker_optins" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"company_id" integer,
	"owner_username" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_poster_loads" (
	"id" serial PRIMARY KEY NOT NULL,
	"broker_id" integer NOT NULL,
	"company_id" integer,
	"created_by" text NOT NULL,
	"reference_number" text,
	"pickup_address" text,
	"pickup_city" text,
	"pickup_state" text,
	"pickup_date" text,
	"pickup_window" text,
	"delivery_address" text,
	"delivery_city" text,
	"delivery_state" text,
	"delivery_date" text,
	"delivery_window" text,
	"commodity" text,
	"freight_class" text,
	"weight_lbs" integer,
	"pieces" integer,
	"dimensions" text,
	"equipment" text,
	"tarps" boolean DEFAULT false NOT NULL,
	"edge_protectors" boolean DEFAULT false NOT NULL,
	"rate" double precision,
	"rate_con_blob_key" text,
	"rate_con_mime" text,
	"rate_con_sha256" text,
	"signoff_confirmed" boolean DEFAULT false NOT NULL,
	"offload_confirmed" boolean DEFAULT false NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"board_load_id" integer,
	"track_token" text,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"link_id" integer NOT NULL,
	"scope_key" text NOT NULL,
	"company_id" integer,
	"owner_username" text NOT NULL,
	"broker_name" text NOT NULL,
	"broker_company" text,
	"broker_mc" text,
	"shipper" text,
	"pickup_city" text,
	"pickup_state" text,
	"delivery_city" text,
	"delivery_state" text,
	"pickup_text" text,
	"delivery_text" text,
	"rate" double precision,
	"loaded_miles" double precision,
	"miles_source" text,
	"extra_charges" double precision DEFAULT 0 NOT NULL,
	"extra_charges_note" text,
	"weight_lbs" integer,
	"commodity" text,
	"hazmat" boolean DEFAULT false NOT NULL,
	"equipment_type" text,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"doc_sha256" text,
	"doc_blob_key" text,
	"doc_mime" text,
	"board_load_id" integer,
	"load_id" integer,
	"trip_queue_id" integer,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "burn_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"username" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cashout_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"reason" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref_kind" text NOT NULL,
	"ref_id" integer,
	"session_id" text,
	"event" text NOT NULL,
	"payload" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_blocks" (
	"username" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'group' NOT NULL,
	"created_by" text DEFAULT 'driver' NOT NULL,
	"company_id" integer,
	"pin_message_id" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"username" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"sender" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"payload" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_reads" (
	"group_id" integer PRIMARY KEY NOT NULL,
	"last_read_id" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer,
	"kind" text NOT NULL,
	"amount" double precision NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_fleets" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"mc_number" text,
	"usdot_number" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_username" text NOT NULL,
	"kind" text DEFAULT 'fleet' NOT NULL,
	"dispatcher_fee_pct" double precision,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_docs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"subject_username" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text,
	"blob_key" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"expires_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"username" text NOT NULL,
	"role" text DEFAULT 'driver' NOT NULL,
	"login_disabled" boolean DEFAULT false NOT NULL,
	"auto_log_override" text,
	"client_fleet_id" integer,
	"joined_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_setup" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"legal_name" text,
	"dba" text,
	"address" text,
	"ein" text,
	"mc_number" text,
	"usdot_number" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"fleet_size" integer,
	"complete" boolean DEFAULT false NOT NULL,
	"auto_log_enabled" boolean DEFAULT false NOT NULL,
	"auto_log_notify" text DEFAULT 'immediate' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"username" text NOT NULL,
	"log_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"start_miles" double precision,
	"start_miles_source" text,
	"fuel_start" text,
	"hos_start" text,
	"pretrip" text,
	"finish_miles" double precision,
	"total_miles" double precision,
	"fuel_usage" text,
	"hos_end" text,
	"loads_delivered" integer DEFAULT 0 NOT NULL,
	"detention_text" text,
	"critical_defect" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_fee_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"board_load_id" integer,
	"packet_id" integer,
	"company_id" integer NOT NULL,
	"carrier_username" text NOT NULL,
	"freight_amount" double precision NOT NULL,
	"fee_amount" double precision NOT NULL,
	"paid_amount" double precision DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"probe" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dispatch_fee_invoices_load_id_unique" UNIQUE("load_id")
);
--> statement-breakpoint
CREATE TABLE "dispatch_fee_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"load_id" integer NOT NULL,
	"rail" text NOT NULL,
	"reference" text NOT NULL,
	"amount" double precision NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"verification" text DEFAULT 'admin_confirmed' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_copy_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"pay_stub_email_enabled" boolean DEFAULT false NOT NULL,
	"driver_email" text,
	"dispatch_email" text,
	"owner_email" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_email_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"filed_copy_id" integer,
	"doc_kind" text NOT NULL,
	"recipient_role" text NOT NULL,
	"recipient_email" text,
	"recipient_username" text,
	"status" text NOT NULL,
	"detail" text,
	"provider_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "doc_email_deliveries_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "driver_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" text NOT NULL,
	"single_use" boolean DEFAULT true NOT NULL,
	"used_by" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"client_fleet_id" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_positions" (
	"username" text PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_weigh_stations" (
	"station_id" text PRIMARY KEY NOT NULL,
	"station_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"reporter" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dvir_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspected_at" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'pretrip' NOT NULL,
	"items_json" text DEFAULT '[]' NOT NULL,
	"defects_json" text DEFAULT '[]' NOT NULL,
	"signed_name" text NOT NULL,
	"status" text DEFAULT 'signed' NOT NULL,
	"odometer" double precision,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earning_pool_backing_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount_usdg" double precision NOT NULL,
	"username" text,
	"ref_key" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "earning_pool_backing_ledger_ref_key_unique" UNIQUE("ref_key")
);
--> statement-breakpoint
CREATE TABLE "earning_pool_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"username" text,
	"ref_key" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "earning_pool_ledger_ref_key_unique" UNIQUE("ref_key")
);
--> statement-breakpoint
CREATE TABLE "eia_diesel_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_of" text NOT NULL,
	"national" double precision NOT NULL,
	"gulf_coast" double precision NOT NULL,
	"west_coast" double precision NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "eia_diesel_snapshots_week_of_unique" UNIQUE("week_of")
);
--> statement-breakpoint
CREATE TABLE "eld_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"company_id" integer,
	"label" text NOT NULL,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"token_enc" text,
	"token_last4" text,
	"feeds_json" text DEFAULT '[]' NOT NULL,
	"last_error" text,
	"connected_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "eld_identity" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"provider" text NOT NULL,
	"driver_json" text DEFAULT '{}' NOT NULL,
	"truck_json" text DEFAULT '{}' NOT NULL,
	"pulled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eld_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"feed" text NOT NULL,
	"payload_json" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"spent_at" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"amount" double precision NOT NULL,
	"vendor" text,
	"state" text,
	"load_id" integer,
	"notes" text,
	"receipt_blob_key" text,
	"receipt_mime" text,
	"receipt_sha256" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filed_doc_copies" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"doc_kind" text NOT NULL,
	"label" text NOT NULL,
	"blob_key" text,
	"owns_blob" boolean DEFAULT false NOT NULL,
	"mime" text,
	"sha256" text NOT NULL,
	"source" text NOT NULL,
	"filed_by" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "filed_doc_copies_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "fleet_trucks" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"unit_label" text NOT NULL,
	"detail" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"follower" text NOT NULL,
	"followee" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_price_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"station" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"state" text,
	"price" double precision NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"grade" text DEFAULT 'reported' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"station" text,
	"gallons" double precision NOT NULL,
	"price_per_gallon" double precision NOT NULL,
	"total" double precision NOT NULL,
	"odometer" double precision,
	"receipt_blob_key" text,
	"receipt_mime" text,
	"receipt_sha256" text,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_cycle_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"username" text NOT NULL,
	"tier" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"gold_count" integer DEFAULT 0 NOT NULL,
	"diamond_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'filling' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"drawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "giveaway_draws" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_key" text NOT NULL,
	"prizes_json" text NOT NULL,
	"winners_json" text NOT NULL,
	"drawn_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"week_key" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_key" text NOT NULL,
	"prizes_json" text NOT NULL,
	"wallet_balance" double precision NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "giveaway_locks_week_key_unique" UNIQUE("week_key")
);
--> statement-breakpoint
CREATE TABLE "giveaway_vesting" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"draw_id" integer NOT NULL,
	"tranche_no" integer NOT NULL,
	"total_tranches" integer NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazard_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"note" text,
	"reporter" text,
	"confirm_count" integer DEFAULT 0 NOT NULL,
	"gone_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intel_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"points" integer DEFAULT 10 NOT NULL,
	"reporter" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"packet_id" integer NOT NULL,
	"load_id" integer NOT NULL,
	"packet_ref" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invoice_registry_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "learned_exclusions" (
	"pattern_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT true NOT NULL,
	"reset_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "load_doc_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"field" text NOT NULL,
	"field_label" text NOT NULL,
	"ratecon_value" text,
	"bol_value" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by_run" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"close_kind" text,
	"close_reason" text
);
--> statement-breakpoint
CREATE TABLE "load_doc_extractions" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"side" text NOT NULL,
	"source" text NOT NULL,
	"doc_sha256" text,
	"found" boolean DEFAULT false NOT NULL,
	"fields_json" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "load_doc_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"run_by" text NOT NULL,
	"verdict" text NOT NULL,
	"report_json" text NOT NULL,
	"outcomes_hash" text NOT NULL,
	"ratecon_sha256" text,
	"bol_sha256" text,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "load_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"amount" double precision NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"note" text,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipper" text,
	"pickup_city" text,
	"pickup_state" text,
	"delivery_city" text,
	"delivery_state" text,
	"pickup_text" text,
	"delivery_text" text,
	"rate" double precision,
	"loaded_miles" double precision,
	"miles_source" text,
	"deadhead_miles" double precision,
	"extra_charges" double precision DEFAULT 0 NOT NULL,
	"extra_charges_note" text,
	"weight_lbs" integer,
	"commodity" text,
	"hazmat" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"trip_queue_id" integer,
	"fuel_debrief" text,
	"doc_sha256" text,
	"doc_blob_key" text,
	"doc_mime" text,
	"pickup_load_blob_key" text,
	"pickup_load_mime" text,
	"pickup_load_sha256" text,
	"pickup_load_captured_at" timestamp with time zone,
	"pickup_load_lat" double precision,
	"pickup_load_lon" double precision,
	"pickup_load_source" text,
	"pickup_bol_blob_key" text,
	"pickup_bol_mime" text,
	"pickup_bol_sha256" text,
	"pickup_bol_captured_at" timestamp with time zone,
	"pickup_bol_lat" double precision,
	"pickup_bol_lon" double precision,
	"pickup_bol_source" text,
	"pickup_sealed_at" timestamp with time zone,
	"equipment_type" text,
	"trailer_number" text,
	"seal_entered" text,
	"seal_bol" text,
	"seal_status" text,
	"broker_name" text,
	"broker_company" text,
	"broker_mc" text,
	"broker_source" text,
	"broker_link_id" integer,
	"loaded_height_in" integer,
	"reefer_setpoint_f" double precision,
	"reefer_band_f" double precision,
	"dock_appt_at" timestamp with time zone,
	"dock_door" text,
	"lumper_fee" double precision,
	"dock_note" text,
	"lumper_receipt_blob_key" text,
	"lumper_receipt_mime" text,
	"lumper_receipt_sha256" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locker_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"username" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"device_id" text NOT NULL,
	"device_label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "maintenance_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"item" text NOT NULL,
	"interval_miles" double precision NOT NULL,
	"last_done_odometer" double precision,
	"last_done_at" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "maintenance_services_item_unique" UNIQUE("item")
);
--> statement-breakpoint
CREATE TABLE "market_pulse_weeks" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_number" integer NOT NULL,
	"week_ending" text NOT NULL,
	"total_rate_per_mile" double precision NOT NULL,
	"total_change_cents" double precision NOT NULL,
	"total_yoy_pct" double precision NOT NULL,
	"total_loads_change_pct" double precision NOT NULL,
	"mdi_note" text,
	"flatbed_change_cents" double precision NOT NULL,
	"flatbed_yoy_pct" double precision NOT NULL,
	"flatbed_loads_change_pct" double precision NOT NULL,
	"dryvan_change_cents" double precision NOT NULL,
	"dryvan_yoy_pct" double precision NOT NULL,
	"dryvan_loads_change_pct" double precision NOT NULL,
	"reefer_change_cents" double precision NOT NULL,
	"reefer_yoy_pct" double precision NOT NULL,
	"reefer_loads_change_pct" double precision NOT NULL,
	"flatbed_rate_per_mile" double precision,
	"dryvan_rate_per_mile" double precision,
	"reefer_rate_per_mile" double precision,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_pulse_weeks_week_ending_unique" UNIQUE("week_ending")
);
--> statement-breakpoint
CREATE TABLE "money_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"points" integer,
	"reason" text NOT NULL,
	"status" text DEFAULT 'review_hold' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_help_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"topic" text NOT NULL,
	"flag" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_state" (
	"username" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'driver' NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"owner_intro_seen" boolean DEFAULT false NOT NULL,
	"steps_json" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_giveaway_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"giveaway_id" integer NOT NULL,
	"username" text NOT NULL,
	"payout_address" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	"tx_hash" text,
	"verification" text,
	"verified_amount" double precision,
	"recorded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "owner_giveaways" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"owner_username" text NOT NULL,
	"currency" text NOT NULL,
	"pot_amount" double precision NOT NULL,
	"mode" text NOT NULL,
	"winner_count" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"commitment_hash" text,
	"seed_method" text,
	"draw_seed" text,
	"draw_head_hash" text,
	"distribution_note" text,
	"created_at" timestamp with time zone NOT NULL,
	"funded_at" timestamp with time zone,
	"distributed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "passport_prefs" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"show_miles" boolean DEFAULT true NOT NULL,
	"show_on_time" boolean DEFAULT true NOT NULL,
	"show_safety" boolean DEFAULT true NOT NULL,
	"show_seasons" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text,
	"kind" text NOT NULL,
	"is_form" boolean DEFAULT false NOT NULL,
	"payer" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"tax_year" integer,
	"gross" double precision NOT NULL,
	"federal_withheld" double precision DEFAULT 0 NOT NULL,
	"state_withheld" double precision DEFAULT 0 NOT NULL,
	"other_deductions" double precision DEFAULT 0 NOT NULL,
	"deduction_lines" text,
	"per_diem" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"stub_blob_key" text,
	"stub_mime" text,
	"stub_sha256" text,
	"source" text,
	"delivery_id" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_stub_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"sender_username" text NOT NULL,
	"recipient_username" text NOT NULL,
	"kind" text NOT NULL,
	"delivery_type" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"tax_year" integer,
	"gross" double precision NOT NULL,
	"federal_withheld" double precision DEFAULT 0 NOT NULL,
	"state_withheld" double precision DEFAULT 0 NOT NULL,
	"other_deductions" double precision DEFAULT 0 NOT NULL,
	"deduction_lines" text,
	"per_diem" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"stub_blob_key" text,
	"stub_mime" text,
	"stub_sha256" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"flag_reason" text,
	"pay_entry_id" integer,
	"sent_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pay_stub_email_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"pay_entry_id" integer,
	"delivery_id" integer,
	"kind" text NOT NULL,
	"is_form" boolean DEFAULT false NOT NULL,
	"payer" text NOT NULL,
	"recipient_role" text NOT NULL,
	"recipient_email" text,
	"recipient_username" text,
	"status" text NOT NULL,
	"detail" text,
	"provider_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "pay_stub_email_deliveries_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "payment_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'requires_provider' NOT NULL,
	"plan" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_ledger_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payment_packets" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"packet_ref" text NOT NULL,
	"fingerprint" text NOT NULL,
	"invoice_ref" text NOT NULL,
	"invoice_fingerprint" text NOT NULL,
	"invoice_amount" double precision,
	"broker_name" text,
	"broker_company" text,
	"broker_mc" text,
	"broker_source" text,
	"broker_link_id" integer,
	"rate_con_sha256" text,
	"bol_sha256" text,
	"pod_seal_hash" text,
	"invoice_seen_before" boolean DEFAULT false NOT NULL,
	"receivable_key" text,
	"receivable_seen_before" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_packets_load_id_unique" UNIQUE("load_id")
);
--> statement-breakpoint
CREATE TABLE "perf_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"duration_ms" integer,
	"ok" boolean,
	"trip_queue_id" integer,
	"detail" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permits" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"load_id" integer,
	"permit_number" text,
	"issuing_state" text,
	"issuing_agency" text,
	"route_steps" text NOT NULL,
	"route_places" text NOT NULL,
	"height_text" text,
	"width_text" text,
	"length_text" text,
	"weight_text" text,
	"height_in" double precision,
	"width_in" double precision,
	"length_in" double precision,
	"weight_lbs" double precision,
	"valid_from" text,
	"valid_to" text,
	"escorts" text,
	"curfews" text NOT NULL,
	"restrictions" text NOT NULL,
	"qr_text" text,
	"doc_blob_key" text,
	"doc_mime" text,
	"doc_sha256" text,
	"filed_copy_id" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_docs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone,
	"doc_number_last4" text,
	"notes" text,
	"blob_key" text,
	"mime" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pickup_extra_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"blob_key" text NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pin_guard" (
	"id" integer PRIMARY KEY NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_fee_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"board_load_id" integer,
	"company_id" integer,
	"poster_username" text,
	"carrier_username" text NOT NULL,
	"gross_amount" double precision NOT NULL,
	"fee_amount" double precision NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_fee_entries_load_id_unique" UNIQUE("load_id")
);
--> statement-breakpoint
CREATE TABLE "points_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"points" integer NOT NULL,
	"stoner_amount" double precision NOT NULL,
	"anchor_usd" double precision,
	"price_usd" double precision,
	"miles_points" integer DEFAULT 0 NOT NULL,
	"task_paid_at" timestamp with time zone,
	"miles_paid_at" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "points_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"ref_key" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pretrip_inspections" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer,
	"trailer_type" text NOT NULL,
	"items_json" text NOT NULL,
	"defect_count" integer DEFAULT 0 NOT NULL,
	"photo_blob_key" text,
	"photo_mime" text,
	"photo_sha256" text,
	"lat" double precision,
	"lon" double precision,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY NOT NULL,
	"height_ft" integer NOT NULL,
	"height_in" integer NOT NULL,
	"weight_lbs" integer NOT NULL,
	"length_ft" integer NOT NULL,
	"mpg" double precision NOT NULL,
	"diesel_price" double precision NOT NULL,
	"tank_range_mi" integer NOT NULL,
	"loves_off" boolean DEFAULT false NOT NULL,
	"pilot_off" boolean DEFAULT false NOT NULL,
	"brand_offs" text DEFAULT '' NOT NULL,
	"auto_route" boolean DEFAULT true NOT NULL,
	"auto_trip" boolean DEFAULT true NOT NULL,
	"auto_alerts" boolean DEFAULT true NOT NULL,
	"auto_fuel" boolean DEFAULT true NOT NULL,
	"auto_seal" boolean DEFAULT true NOT NULL,
	"priority_1" text DEFAULT 'safety' NOT NULL,
	"priority_2" text DEFAULT 'net' NOT NULL,
	"priority_3" text DEFAULT 'time' NOT NULL,
	"hazmat" boolean DEFAULT false NOT NULL,
	"hazmat_class" text,
	"pin_hash" text,
	"current_trailer" text,
	"trailer_type" text DEFAULT 'dry_van' NOT NULL,
	"chat_name" text DEFAULT 'Driver' NOT NULL,
	"company_name" text,
	"driver_cpm" double precision,
	"pay_basis" text DEFAULT 'cpm' NOT NULL,
	"driver_pay_pct" double precision,
	"social_username" text DEFAULT 'driver' NOT NULL,
	"plan" text DEFAULT 'diamond' NOT NULL,
	"owner_price" double precision,
	"owner_trucks" integer DEFAULT 3 NOT NULL,
	"owner_seats" integer DEFAULT 1 NOT NULL,
	"kyc_status" text DEFAULT 'not_started' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivable_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"receivable_key" text NOT NULL,
	"packet_id" integer NOT NULL,
	"load_id" integer NOT NULL,
	"packet_ref" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "receivable_registry_receivable_key_unique" UNIQUE("receivable_key")
);
--> statement-breakpoint
CREATE TABLE "recent_destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"gate_lat" double precision,
	"gate_lon" double precision,
	"use_count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"viewer_username" text NOT NULL,
	"subject_username" text NOT NULL,
	"kind" text NOT NULL,
	"what" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reefer_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"temp_f" double precision NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"note" text,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"username" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_username" text NOT NULL,
	"referred_username" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_username" text NOT NULL,
	"level_key" text NOT NULL,
	"threshold" integer NOT NULL,
	"bonus_points" integer NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"reversed" boolean DEFAULT false NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_username" text NOT NULL,
	"referred_username" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reward_wallet_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"username" text,
	"ref_key" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reward_wallet_ledger_ref_key_unique" UNIQUE("ref_key")
);
--> statement-breakpoint
CREATE TABLE "road_place_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"place_kind" text NOT NULL,
	"reporter" text NOT NULL,
	"reporter_lat" double precision NOT NULL,
	"reporter_lon" double precision NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_place_hides" (
	"place_id" text NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_place_retired" (
	"place_id" text PRIMARY KEY NOT NULL,
	"place_kind" text NOT NULL,
	"reason" text NOT NULL,
	"correction_count" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"address_label" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"gate_lat" double precision,
	"gate_lon" double precision,
	"gate_label" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scale_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"weighed_at" timestamp with time zone NOT NULL,
	"location" text,
	"state" text,
	"steer_lbs" integer,
	"drive_lbs" integer,
	"trailer_lbs" integer,
	"gross_lbs" integer,
	"load_id" integer,
	"photo_blob_key" text,
	"photo_mime" text,
	"photo_sha256" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_prefs" (
	"username" text PRIMARY KEY NOT NULL,
	"auto_lock_minutes" integer DEFAULT 0 NOT NULL,
	"track_retention_days" integer DEFAULT 30 NOT NULL,
	"last_purge_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier" text,
	"period_label" text,
	"gross" double precision,
	"net" double precision,
	"lines_json" text DEFAULT '[]' NOT NULL,
	"doc_blob_key" text,
	"doc_mime" text,
	"doc_sha256" text,
	"check_json" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipper_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"contact_name" text,
	"logo_initials" text,
	"linked_username" text,
	"company_id" integer,
	"owner_username" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"default_pickup_address" text,
	"default_pickup_city" text,
	"default_pickup_state" text,
	"default_commodity" text,
	"default_freight_class" text,
	"default_contact_name" text,
	"default_contact_phone" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipper_loads" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipper_id" integer NOT NULL,
	"company_id" integer,
	"created_by" text NOT NULL,
	"reference_number" text,
	"pickup_address" text,
	"pickup_city" text,
	"pickup_state" text,
	"pickup_date" text,
	"pickup_window" text,
	"delivery_address" text,
	"delivery_city" text,
	"delivery_state" text,
	"delivery_date" text,
	"delivery_window" text,
	"commodity" text,
	"freight_class" text,
	"weight_lbs" integer,
	"pieces" integer,
	"dimensions" text,
	"equipment" text,
	"tarps" boolean DEFAULT false NOT NULL,
	"edge_protectors" boolean DEFAULT false NOT NULL,
	"rate" double precision,
	"rate_con_blob_key" text,
	"rate_con_mime" text,
	"rate_con_sha256" text,
	"signoff_confirmed" boolean DEFAULT false NOT NULL,
	"offload_confirmed" boolean DEFAULT false NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"board_load_id" integer,
	"track_token" text,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "si_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"dedupe_key" text,
	"ref_kind" text,
	"ref_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "si_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "si_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules_version" text DEFAULT '2026-11-01' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "si_vetting_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_name" text,
	"mc_number" text,
	"dot_number" text,
	"board_load_id" integer,
	"load_id" integer,
	"verdict" text NOT NULL,
	"flags_json" text DEFAULT '[]' NOT NULL,
	"safer_url" text,
	"summary" text DEFAULT '' NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_users" (
	"username" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"bio" text,
	"company" text,
	"truck_info" text,
	"home_city" text,
	"home_state" text,
	"contact_phone" text,
	"contact_email" text,
	"mc_number" text,
	"dot_number" text,
	"twic_has" boolean DEFAULT false NOT NULL,
	"twic_expires" text,
	"endorsements" text DEFAULT '' NOT NULL,
	"avatar_blob_key" text,
	"avatar_mime" text,
	"dm_policy" text DEFAULT 'everyone' NOT NULL,
	"group_policy" text DEFAULT 'everyone' NOT NULL,
	"show_reputation" boolean DEFAULT false NOT NULL,
	"show_miles_panel" boolean DEFAULT true NOT NULL,
	"featured_badge" text,
	"dispatcher_poster" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stepup_state" (
	"username" text PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"plan" text NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"kind" text DEFAULT 'new' NOT NULL,
	"payment_ref" text NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"discounted" boolean DEFAULT false NOT NULL,
	"counted_for_giveaway" boolean DEFAULT false NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscription_events_payment_ref_unique" UNIQUE("payment_ref")
);
--> statement-breakpoint
CREATE TABLE "team_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_username" text NOT NULL,
	"action" text NOT NULL,
	"target_username" text,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_board_flags" (
	"board_load_id" integer PRIMARY KEY NOT NULL,
	"flagged_by" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_change_notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"actor_username" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"team_email" text DEFAULT 'stonervisionteam@gmail.com' NOT NULL,
	"email_status" text DEFAULT 'queued' NOT NULL,
	"email_detail" text DEFAULT '' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_consent_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_username" text NOT NULL,
	"requested_by" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"fields_json" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_giveaway_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"giveaway_id" integer NOT NULL,
	"username" text NOT NULL,
	"payout_address" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_giveaways" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"currency" text NOT NULL,
	"pot_amount" double precision NOT NULL,
	"mode" text NOT NULL,
	"winner_count" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"commitment_hash" text,
	"seed_method" text,
	"draw_seed" text,
	"draw_head_hash" text,
	"funding_source" text,
	"distribution_note" text,
	"created_at" timestamp with time zone NOT NULL,
	"funded_at" timestamp with time zone,
	"distributed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_invite_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'support' NOT NULL,
	"issued_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_by" text,
	"redeemed_at" timestamp with time zone,
	CONSTRAINT "team_invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "team_item_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"window_id" integer NOT NULL,
	"seat" text NOT NULL,
	"access_kind" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_item_consent_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_username" text NOT NULL,
	"team_seat" text NOT NULL,
	"item_kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"note" text,
	"item_id" integer,
	"item_label" text,
	"can_edit" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closeout_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_seats" (
	"username" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'support' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_credentials" (
	"username" text PRIMARY KEY NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "track_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trailer_swaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"trailer_number" text NOT NULL,
	"dropper_username" text NOT NULL,
	"receiver_kind" text NOT NULL,
	"receiver_username" text,
	"receiver_name" text,
	"receiver_company" text,
	"status" text NOT NULL,
	"drop_blob_key" text NOT NULL,
	"drop_mime" text NOT NULL,
	"drop_sha256" text NOT NULL,
	"drop_captured_at" timestamp with time zone NOT NULL,
	"drop_lat" double precision,
	"drop_lon" double precision,
	"drop_city" text,
	"drop_state" text,
	"drop_location_source" text NOT NULL,
	"hook_blob_key" text,
	"hook_mime" text,
	"hook_sha256" text,
	"hook_captured_at" timestamp with time zone,
	"hook_lat" double precision,
	"hook_lon" double precision,
	"hook_city" text,
	"hook_state" text,
	"hook_location_source" text,
	"hook_username" text,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"course_id" text NOT NULL,
	"season_number" integer NOT NULL,
	"score_pct" integer NOT NULL,
	"correct_count" integer NOT NULL,
	"total_questions" integer NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"course_id" text NOT NULL,
	"season_number" integer NOT NULL,
	"score_pct" integer NOT NULL,
	"chain_hash" text,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"mime" text NOT NULL,
	"blob_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"course_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"quiz_course_id" text,
	"custom_check_json" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_watch" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"media_id" integer NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"check_passed" boolean DEFAULT false NOT NULL,
	"chain_hash" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_watched_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trip_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"origin" text,
	"destination" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"load_id" integer,
	"notes" text,
	"pay_rate" double precision DEFAULT 0.55 NOT NULL,
	"pay_basis" text DEFAULT 'cpm' NOT NULL,
	"pay_percent" double precision,
	"extra_charges" double precision DEFAULT 0 NOT NULL,
	"extra_charges_note" text,
	"stops_json" text DEFAULT '[]' NOT NULL,
	"route_label" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"completed_trip_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"total_miles" double precision NOT NULL,
	"total_pay" double precision NOT NULL,
	"state_breakdown" text NOT NULL,
	"destination" text,
	"avg_speed_mph" double precision,
	"over_limit_min" double precision,
	"gaps" text,
	"duty_note" text,
	"miles_source" text DEFAULT 'GPS' NOT NULL,
	"trailer_number" text,
	"extra_charges" double precision DEFAULT 0 NOT NULL,
	"extra_charges_note" text,
	"pay_rate" double precision,
	"pay_basis" text DEFAULT 'cpm' NOT NULL,
	"pay_percent" double precision,
	"load_gross" double precision,
	"label" text,
	"queue_id" integer,
	"over65_min" double precision,
	"over70_min" double precision,
	"idle_min" double precision,
	"fix_quality" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_keys" (
	"id" integer PRIMARY KEY NOT NULL,
	"key_hex" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verify_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" integer,
	"record_hash" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "verify_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "weigh_station_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"station_name" text NOT NULL,
	"status" text NOT NULL,
	"reporter" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"station_lat" double precision NOT NULL,
	"station_lon" double precision NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weigh_station_status" (
	"station_id" text PRIMARY KEY NOT NULL,
	"station_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"status" text NOT NULL,
	"reporter" text NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welcome_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"amount_usd" double precision,
	"status" text DEFAULT 'queued' NOT NULL,
	"kind" text DEFAULT 'welcome' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"plan" text,
	"created_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "welcome_vesting" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"welcome_credit_id" integer NOT NULL,
	"plan" text NOT NULL,
	"tranche_no" integer NOT NULL,
	"total_tranches" integer NOT NULL,
	"amount_stoner" double precision NOT NULL,
	"amount_usd" double precision,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"note" text,
	"reporter" text,
	"confirm_count" integer DEFAULT 0 NOT NULL,
	"gone_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "welcome_vesting" ADD CONSTRAINT "welcome_vesting_welcome_credit_id_welcome_credits_id_fk" FOREIGN KEY ("welcome_credit_id") REFERENCES "public"."welcome_credits"("id") ON DELETE no action ON UPDATE no action;