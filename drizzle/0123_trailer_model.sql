-- Trailer model (x approved from the DVIR build's option card,
-- 2026-11-15): My Trailer identity gains a MODEL field beside the
-- make, mirroring My Truck's truck_model (migration 0118). One
-- optional text column on the profile row, typed in by the driver in
-- Settings -> Truck in the My Trailer block. The model is part of
-- the PUBLIC trailer identity — it rides the profile trailer line
-- ("2022 Great Dane <model> · Step Deck") and the DVIR identity
-- snapshot — while trailer VIN and plate stay owner-only, exactly
-- as before.
ALTER TABLE `profile` ADD COLUMN `trailer_model` text;
