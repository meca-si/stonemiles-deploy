-- Chat email alerts (2026-11-14): per-member chat read + alert state.
-- chat_reads carries ONE read marker per group (staging shape) — enough
-- for the shared unread badge, but the new-message email alert needs
-- each member's own position: last_read_id mirrors what that member has
-- actually opened (their markChatRead calls and their own sends), and
-- last_alerted_id is the newest message id they were already emailed
-- about. Together they make a burst of messages produce ONE alert per
-- member, and a member who already has unread mail waiting is not
-- re-alerted until they catch up.
CREATE TABLE `chat_member_reads` (
	`group_id` integer NOT NULL,
	`username` text NOT NULL,
	`last_read_id` integer DEFAULT 0 NOT NULL,
	`last_alerted_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`group_id`, `username`)
);
