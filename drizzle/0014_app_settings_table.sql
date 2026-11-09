CREATE TABLE `app_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `appearance` text DEFAULT 'dark' NOT NULL,
  `font_size` text DEFAULT 'standard' NOT NULL,
  `units` text DEFAULT 'mi' NOT NULL,
  `overspeed_threshold_mph` integer DEFAULT 5 NOT NULL,
  `voice_alerts` integer DEFAULT 1 NOT NULL,
  `banner_alerts` integer DEFAULT 1 NOT NULL,
  `notify_hos` integer DEFAULT 1 NOT NULL,
  `notify_delivery` integer DEFAULT 1 NOT NULL,
  `notify_chat` integer DEFAULT 1 NOT NULL,
  `notify_owner_log` integer DEFAULT 1 NOT NULL,
  `updated_at` integer NOT NULL
);
