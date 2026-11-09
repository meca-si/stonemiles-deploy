import { describe, expect, test } from "bun:test";
import { SI_RULES, checkFuelPurchase, checkTripSheet, personalDataRefusal, vetEntity, vetLoadForBoard } from "./si";

describe("SI rules", () => {
  test("eight rules, duty-ask and standard-rules included", () => {
    expect(SI_RULES.length).toBe(8);
    expect(SI_RULES[6]!.title).toContain("Duty status");
    expect(SI_RULES[7]!.title).toContain("Standard rules");
    expect(SI_RULES[0]!.text).toContain("never reads or accesses anyone's personal data");
  });
});

describe("personalDataRefusal (Rule 1)", () => {
  test("refuses SSN, card, seed phrase", () => {
    expect(personalDataRefusal("call 123-45-6789")).not.toBeNull();
    expect(personalDataRefusal("card 4111 1111 1111 1111")).not.toBeNull();
    expect(personalDataRefusal("my seed phrase is…")).not.toBeNull();
  });
  test("allows plain business identifiers", () => {
    expect(personalDataRefusal("RUGGS LOGISTICS MC 812024 USDOT 293351")).toBeNull();
    expect(personalDataRefusal(null)).toBeNull();
    expect(personalDataRefusal("")).toBeNull();
  });
});

describe("vetEntity (public records only)", () => {
  test("broker with MC clears and builds the SAFER link", () => {
    const r = vetEntity({ entityType: "broker", name: "Acme Brokerage", mcNumber: "MC-812024", dotNumber: null });
    expect(r.verdict).toBe("clear");
    expect(r.saferUrl).toContain("safer.fmcsa.dot.gov");
    expect(r.saferUrl).toContain("812024");
  });
  test("broker without MC is held for a human", () => {
    const r = vetEntity({ entityType: "broker", name: "No MC Brokers", mcNumber: null, dotNumber: null });
    expect(r.verdict).toBe("hold");
    expect(r.flags.some((f) => f.code === "broker_missing_mc")).toBe(true);
  });
  test("carrier without any authority is held", () => {
    const r = vetEntity({ entityType: "carrier", name: "Mystery Carrier", mcNumber: "", dotNumber: "" });
    expect(r.verdict).toBe("hold");
  });
  test("shipper without authority is a review note, not a hold", () => {
    const r = vetEntity({ entityType: "shipper", name: "Acme Shippers", mcNumber: null, dotNumber: null });
    expect(r.verdict).toBe("review");
  });
  test("typo-shaped MC is a review flag", () => {
    const r = vetEntity({ entityType: "broker", name: "Typo Co", mcNumber: "12", dotNumber: null });
    expect(r.flags.some((f) => f.code === "mc_shape")).toBe(true);
  });
  test("missing name holds", () => {
    const r = vetEntity({ entityType: "broker", name: "  ", mcNumber: "812024", dotNumber: null });
    expect(r.verdict).toBe("hold");
  });
});

describe("vetLoadForBoard", () => {
  const good = {
    shipper: "Acme", pickupCity: "Mobile", pickupState: "Alabama", deliveryCity: "Dallas", deliveryState: "Texas",
    rate: 2400, loadedMiles: 800, weightLbs: 40000, commodity: "Steel coils", hazmat: false, equipmentType: "flatbed",
  };
  test("complete load clears with $/mi", () => {
    const r = vetLoadForBoard(good);
    expect(r.verdict).toBe("clear");
    expect(r.ratePerMile).toBe(3);
  });
  test("missing rate holds", () => {
    expect(vetLoadForBoard({ ...good, rate: null }).verdict).toBe("hold");
  });
  test("missing delivery holds", () => {
    expect(vetLoadForBoard({ ...good, deliveryCity: null, deliveryState: null }).verdict).toBe("hold");
  });
  test("very low $/mi is a review flag", () => {
    const r = vetLoadForBoard({ ...good, rate: 400 });
    expect(r.verdict).toBe("review");
    expect(r.flags.some((f) => f.code === "rpm_very_low")).toBe(true);
  });
  test("overweight is flagged", () => {
    const r = vetLoadForBoard({ ...good, weightLbs: 90000 });
    expect(r.flags.some((f) => f.code === "overweight")).toBe(true);
  });
});

describe("bad-data checks never auto-correct sealed records", () => {
  test("state sum mismatch flags", () => {
    const flags = checkTripSheet({ totalMiles: 500, totalPay: 275, payRate: 0.55, stateBreakdown: [{ state: "Alabama", miles: 400, pay: 220 }] });
    expect(flags.some((f) => f.code === "state_sum_mismatch")).toBe(true);
    expect(flags.every((f) => f.autoCorrectable === false)).toBe(true);
  });
  test("clean sheet passes", () => {
    const flags = checkTripSheet({ totalMiles: 500, totalPay: 275, payRate: 0.55, stateBreakdown: [{ state: "Alabama", miles: 500, pay: 275 }] });
    expect(flags.length).toBe(0);
  });
  test("fuel total mismatch flags", () => {
    const flags = checkFuelPurchase({ gallons: 100, pricePerGallon: 3.5, total: 999 });
    expect(flags.some((f) => f.code === "fuel_total_mismatch")).toBe(true);
  });
  test("clean fuel passes", () => {
    expect(checkFuelPurchase({ gallons: 100, pricePerGallon: 3.5, total: 350 }).length).toBe(0);
  });
});
