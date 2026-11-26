-- 3D view (2026-11-25). PG twin of drizzle/0146_map_view_3d.sql —
-- see that file's header. map_view_3d: the driver's opt-in 3D
-- driving view, default OFF (simple face stays the standard).
ALTER TABLE "app_settings" ADD COLUMN "map_view_3d" boolean DEFAULT false NOT NULL;
