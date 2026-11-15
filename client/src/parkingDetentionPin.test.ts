// Pins the Wave 2 items 4+5 client wiring and honesty rules:
//   (a) parking — the planner's picks carry the HOS fit verdict,
//       the reserve control exists and is DISABLED with the plain
//       reason while no partner is connected (never a fake hold),
//       and the reservations list renders with cancel / parked
//       actions; the Stop Planner's night picks carry the fit too.
//   (b) detention collection — the Money tab detention panel
//       builds the claim pack, emails it through the Library door
//       pattern, records the driver's terms on the load, walks the
//       claim lifecycle, and shows facility stats from sealed
//       records with the thin-data honesty line.
//
// Run: bun test client/src/parkingDetentionPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const sheetSource = readFileSync(`${import.meta.dir}/StopPlannerSheet.tsx`, "utf8");
const moneySource = readFileSync(`${import.meta.dir}/MoneyFlow.tsx`, "utf8");

describe("parking reservations (item 4) — client wiring", () => {
  test("the planner calls the reservation actions", () => {
    expect(appSource).toContain("api.getParkingReservations");
    expect(appSource).toContain("api.reserveParking");
    expect(appSource).toContain("api.cancelParkingReservation");
    expect(appSource).toContain("api.markParkingReservationUsed");
  });

  test("the fit verdict renders on planner picks and night picks", () => {
    expect(appSource).toContain("parkingFitFor");
    expect(appSource).toContain("PARKING_FIT_LABEL[fit.verdict]");
    expect(sheetSource).toContain("parkingFitFor");
    expect(sheetSource).toContain("PARKING_FIT_LABEL[fit.verdict]");
  });

  test("reserving is disabled with the honest reason while unconnected", () => {
    expect(appSource).toContain("disabled={!partnerConfigured || cantReach || reserveBusyKey === c.key}");
    expect(appSource).toContain("Reservations aren't connected yet — no parking partner is linked to STONEMILES");
    expect(appSource).toContain("Not offered for reserving — your hours run out before you'd get here.");
  });

  test("the reservations section lists holds with their window and actions", () => {
    expect(appSource).toContain("Your parking reservations");
    expect(appSource).toContain("Parked here ✓");
  });
});

describe("detention collection (item 5) — client wiring", () => {
  test("the detention panel calls the claim actions", () => {
    expect(moneySource).toContain("api.getDetentionClaimPack");
    expect(moneySource).toContain("api.sendDetentionClaimPack");
    expect(moneySource).toContain("api.setDetentionClaimStatus");
    expect(moneySource).toContain("api.setLoadDetentionTerms");
    expect(moneySource).toContain("api.getFacilityDetentionStats");
  });

  test("the claim pack PDF goes through the Library door ref", () => {
    expect(moneySource).toContain("detention-claim:${id}");
  });

  test("the no-terms honesty copy is on the panel", () => {
    expect(moneySource).toContain("No detention terms recorded on this load — the claim pack prints time facts only");
    expect(moneySource).toContain("your recorded terms; the claim pack prices from these");
  });

  test("facility stats print facts with the thin-data line", () => {
    expect(moneySource).toContain("Facilities in your sealed records");
    expect(moneySource).toContain("facts only, no pattern claimed yet");
    expect(moneySource).toContain("From your own sealed detention clocks only");
  });

  test("the lifecycle buttons cover the claim states", () => {
    expect(moneySource).toContain("Build claim pack");
    expect(moneySource).toContain("Mark acknowledged");
    expect(moneySource).toContain("Mark paid");
    expect(moneySource).toContain("Mark disputed");
  });
});
