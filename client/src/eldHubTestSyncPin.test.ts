// Pins the Step 0 structural fix (Wave 2 items 4+5): the ELD
// test-sync harness must be reachable on an account with ZERO
// saved connections.
//
// The bug this guards: the "🧪 Run test sync" button used to live
// ONLY inside the saved-connections map
// ({hub.connections.length > 0 && hub.connections.map(...)}), so
// with no saved connection the map rendered nothing and the
// button had no host — two live checks on the owner account (zero
// connections) confirmed it never appeared, even though the
// per-connection gate had already been widened. These pins assert
// the hub-level card exists, calls runEldTestSync with NO
// connectionId, and sits in the source AFTER the connections map
// closes and BEFORE the identity log — i.e. structurally outside
// the map, not nested inside it.
//
// Run: bun test client/src/eldHubTestSyncPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");

const MAP_OPEN = 'aria-label="Your ELD connections"';
const HUB_CARD = 'aria-label="ELD test sync — simulated device"';
const IDENTITY_LOG = "<EldIdentityCard />";

describe("ELD hub-level test sync (Step 0)", () => {
  test("the hub-level card exists with its own aria label", () => {
    expect(appSource).toContain(HUB_CARD);
    expect(appSource).toContain("Run a test sync with the simulated ELD device");
  });

  test("the hub-level run calls runEldTestSync with no connection id", () => {
    expect(appSource).toContain("doHubTestSync");
    expect(appSource).toContain(".runEldTestSync({})");
  });

  test("the hub-level card is NOT nested inside the connections map", () => {
    const mapIdx = appSource.indexOf(MAP_OPEN);
    const cardIdx = appSource.indexOf(HUB_CARD);
    const identityIdx = appSource.indexOf(IDENTITY_LOG);
    expect(mapIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeGreaterThan(-1);
    // The card renders after the map block and before the identity
    // log — both live at hub level, outside the map's JSX. If the
    // card ever moves back inside the map it will sit between the
    // map's opening and its per-connection test-sync block, which
    // is before the identity log too — so also assert the card
    // comes after the map's own per-connection test-sync button:
    const perConnIdx = appSource.indexOf("Run a test sync with simulated device data for");
    expect(perConnIdx).toBeGreaterThan(mapIdx);
    expect(cardIdx).toBeGreaterThan(perConnIdx);
    expect(cardIdx).toBeLessThan(identityIdx);
  });

  test("the hub-level card is gated on manage rights, not on connections", () => {
    const cardIdx = appSource.indexOf(HUB_CARD);
    const gateIdx = appSource.lastIndexOf("{hub.canManage && (", cardIdx);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(cardIdx);
  });

  test("the per-connection test sync still exists inside the map", () => {
    expect(appSource).toContain("🧪 Run test sync (simulated device)");
    expect(appSource).toContain(".runEldTestSync({ connectionId: conn.id })");
  });

  test("the simulated connection status has an honest client label", () => {
    expect(appSource).toContain('simulated: "Simulated device (test data)"');
  });
});
