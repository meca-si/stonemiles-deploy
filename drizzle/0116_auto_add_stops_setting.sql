-- Auto-add stops to route (Settings → Driving switch, default ON):
-- when a route is planned, the app adds the Fuel + Stop Planner's
-- picks (best fuel stop when the tank calls for it, the 30-min break
-- stop, the 10-hr rest stop) to the route as waypoints. Client-side
-- preference only — see client/src/autoAddStops.ts.
ALTER TABLE `app_settings` ADD COLUMN `auto_add_stops` integer DEFAULT true NOT NULL;
