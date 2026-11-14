-- Auto-add stops setting. PG twin of
-- drizzle/0116_auto_add_stops_setting.sql — see that file's header.
ALTER TABLE "app_settings" ADD COLUMN "auto_add_stops" boolean DEFAULT true NOT NULL;
