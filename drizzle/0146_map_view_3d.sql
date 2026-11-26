-- 3D view (2026-11-25, x's call after seeing a 3D lane-nav ad:
-- "make it optional"). map_view_3d is the driver's opt-in for the
-- 3D driving view — the Go camera leans in and the Streets style's
-- building-3d extrusions show. Default OFF: the simple flat driving
-- face x approved stays the standard. Display-only, like every map
-- pref; routing, alerts, and data never consult it.
ALTER TABLE `app_settings` ADD COLUMN `map_view_3d` integer DEFAULT false NOT NULL;
