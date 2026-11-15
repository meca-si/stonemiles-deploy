-- Trailer model. PG twin of drizzle/0123_trailer_model.sql — see
-- that file's header. One optional text column on profile: the My
-- Trailer identity's model, beside the make (public identity; VIN
-- and plate stay owner-only).
ALTER TABLE "profile" ADD COLUMN "trailer_model" text;
