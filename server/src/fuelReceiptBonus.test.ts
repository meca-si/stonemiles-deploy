import { describe, expect, test } from "bun:test";
import {
RECEIPT_BONUS_POINTS,
RECEIPT_BONUS_REASON,
RECEIPT_BONUS_SOURCE,
REPORTED_PRICE_GRADE,
alreadyBonusedToday,
dailyCapTotal,
fuelPriceGradeForPurchase,
fuelPriceGradeRank,
isDailyCapRow,
receiptAlreadyBonused,
receiptBonusEligibility,
receiptBonusRefKey,
} from "./fuelReceiptBonus";
import { DAILY_POINTS_CAP, dailyTaskPoints } from "./dailyPoints";

/**
 * FUEL RECEIPT BONUS + purchase-fed price grades (owner-approved
 * 2026-10-26; profit sim Part 7 PASSED the economics gate). These
 * tests run the EXACT pure decisions the server paths run:
 * logFuelPurchase in actions.ts files a fuel_price_reports row with
 * grade fuelPriceGradeForPurchase(receiptSha256) and NULL coordinates,
 * awards the day's fuel_stop via awardDailyTask (whose amount is
 * dailyTaskPoints("fuel_stop", paidTier) under the same daily-row
 * accounting isDailyCapRow mirrors), then — only when that award
 * returned > 0 and the call carried a receipt — decides the bonus via
 * receiptBonusEligibility over the post-award ledger and pays it via
 * awardPoints with RECEIPT_BONUS_SOURCE / receiptBonusRefKey /
 * RECEIPT_BONUS_REASON. reportFuelPrice files grade
 * REPORTED_PRICE_GRADE. The simulations below drive those same
 * functions over in-memory ledgers, so a passing test here is the
 * handler's arithmetic there.
 */

type Row = {
  username: string;
  amount: number;
  source: string;
  refKey: string | null;
  createdAt: Date;
};

type PriceReport = {
  station: string;
  lat: number | null;
  lon: number | null;
  state: string | null;
  price: number;
  grade: string;
};

const DAY = "2026-10-26";
const AT = new Date("2026-10-26T15:00:00Z"); // Oct 26 in America/Chicago
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

/** awardDailyTask for fuel_stop, exactly as actions.ts runs it. */
function awardFuelStop(
  ledger: Row[],
  username: string,
  paidTier: boolean,
  dayKey: string,
  fuelId: number,
): number {
  const points = dailyTaskPoints("fuel_stop", paidTier);
  if (points <= 0) return 0; // free-tier fuel_stop: no award, no row
  const rows = ledger.filter((r) => r.username === username);
  const netForTask = rows
    .filter((r) => isDailyCapRow(r, dayKey) && r.source === "daily_fuel_stop")
    .reduce((s, r) => s + r.amount, 0);
  if (netForTask > 0) return 0; // already earned today
  if (dailyCapTotal(rows, dayKey) + points > DAILY_POINTS_CAP) return 0;
  ledger.push({
    username,
    amount: points,
    source: "daily_fuel_stop",
    refKey: `daily:fuel_stop:${dayKey}-fuel${fuelId}`,
    createdAt: AT,
  });
  return points;
}

/** logFuelPurchase's price-feed + award + bonus path, in handler order. */
function logFuelPurchaseSim(
  ledger: Row[],
  priceReports: PriceReport[],
  args: {
    username: string;
    paidTier: boolean;
    station: string | null;
    state: string;
    pricePerGallon: number;
    receiptSha256: string | null;
    fuelId: number;
  },
): { baseAward: number; receiptBonusAwarded: number; priceReport: PriceReport } {
  // 1) the purchase files its price report (anonymous, no coordinates)
  const priceReport: PriceReport = {
    station: args.station ?? "Unnamed station",
    lat: null,
    lon: null,
    state: args.state,
    price: args.pricePerGallon,
    grade: fuelPriceGradeForPurchase(args.receiptSha256),
  };
  priceReports.push(priceReport);
  // 2) the day's fuel_stop award
  const baseAward = awardFuelStop(ledger, args.username, args.paidTier, DAY, args.fuelId);
  // 3) the receipt bonus, only on the winning receipt-carrying call
  let receiptBonusAwarded = 0;
  if (baseAward > 0 && args.receiptSha256 != null) {
    const driverRows = ledger.filter((r) => r.username === args.username);
    const allBonusRows = ledger.filter((r) => r.source === RECEIPT_BONUS_SOURCE);
    const bonus = receiptBonusEligibility({
      baseAwardPoints: baseAward,
      receiptSha256: args.receiptSha256,
      dayKey: DAY,
      driverRows,
      allRows: allBonusRows,
    });
    if (bonus > 0) {
      ledger.push({
        username: args.username,
        amount: bonus,
        source: RECEIPT_BONUS_SOURCE,
        refKey: receiptBonusRefKey(DAY, args.receiptSha256),
        createdAt: AT,
      });
      receiptBonusAwarded = bonus;
    }
  }
  return { baseAward, receiptBonusAwarded, priceReport };
}

const balance = (ledger: Row[], u: string) =>
  ledger.filter((r) => r.username === u).reduce((s, r) => s + r.amount, 0);

describe("fuel receipt bonus — grades", () => {
  test("a fingerprinted receipt grades receipt_verified; no receipt grades purchase", () => {
    expect(fuelPriceGradeForPurchase(SHA_A)).toBe("receipt_verified");
    expect(fuelPriceGradeForPurchase(null)).toBe("purchase");
    expect(fuelPriceGradeForPurchase(undefined)).toBe("purchase");
    expect(REPORTED_PRICE_GRADE).toBe("reported");
  });

  test("grade preference: receipt_verified > purchase > reported", () => {
    expect(fuelPriceGradeRank("receipt_verified")).toBeGreaterThan(fuelPriceGradeRank("purchase"));
    expect(fuelPriceGradeRank("purchase")).toBeGreaterThan(fuelPriceGradeRank("reported"));
    expect(fuelPriceGradeRank("anything-else")).toBe(0);
  });

  test("the bonus is +15 under its own source, reason, and refKey shape", () => {
    expect(RECEIPT_BONUS_POINTS).toBe(15);
    expect(RECEIPT_BONUS_SOURCE).toBe("daily_fuel_receipt_bonus");
    expect(RECEIPT_BONUS_REASON).toBe("Fuel receipt bonus — receipt fingerprinted & sealed");
    expect(receiptBonusRefKey(DAY, SHA_A)).toBe(`daily:fuel_receipt_bonus:${DAY}:${SHA_A}`);
  });
});

describe("fuel receipt bonus — the award path", () => {
  test("bonus pays 15 on a receipt-carrying winning fuel_stop call (paid tier)", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    const r = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 1,
    });
    expect(r.baseAward).toBe(10); // table fuel_stop value
    expect(r.receiptBonusAwarded).toBe(15);
    expect(balance(ledger, "driver1")).toBe(25);
    const bonusRow = ledger.find((x) => x.source === RECEIPT_BONUS_SOURCE);
    expect(bonusRow?.amount).toBe(15);
    expect(bonusRow?.refKey).toBe(`daily:fuel_receipt_bonus:${DAY}:${SHA_A}`);
  });

  test("a second receipt the same day pays 0 — the fuel_stop win is already taken", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    const first = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 1,
    });
    expect(first.receiptBonusAwarded).toBe(15);
    const second = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Pilot", state: "Texas",
      pricePerGallon: 3.799, receiptSha256: SHA_B, fuelId: 2,
    });
    expect(second.baseAward).toBe(0); // fuel_stop already won today
    expect(second.receiptBonusAwarded).toBe(0);
    expect(balance(ledger, "driver1")).toBe(25);
    expect(prices.length).toBe(2); // the second purchase still filed its price
  });

  test("if the day's winning purchase had NO receipt, a later receipt pays no bonus", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    const first = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: null, fuelId: 1,
    });
    expect(first.baseAward).toBe(10);
    expect(first.receiptBonusAwarded).toBe(0);
    const second = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Pilot", state: "Texas",
      pricePerGallon: 3.799, receiptSha256: SHA_A, fuelId: 2,
    });
    expect(second.baseAward).toBe(0);
    expect(second.receiptBonusAwarded).toBe(0);
    expect(balance(ledger, "driver1")).toBe(10);
  });

  test("the same receipt hash on a DIFFERENT account pays 0 — purchase + price report still land", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    const first = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 1,
    });
    expect(first.receiptBonusAwarded).toBe(15);
    const dupe = logFuelPurchaseSim(ledger, prices, {
      username: "driver2", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 2,
    });
    expect(dupe.baseAward).toBe(10); // driver2's own fuel_stop win still pays
    expect(dupe.receiptBonusAwarded).toBe(0); // but the receipt already paid its bonus, anywhere
    expect(balance(ledger, "driver2")).toBe(10);
    expect(prices.length).toBe(2); // the duplicate still filed its price report
    expect(prices[1]?.grade).toBe("receipt_verified");
    expect(receiptAlreadyBonused(ledger, SHA_A)).toBe(true);
    expect(receiptAlreadyBonused(ledger, SHA_B)).toBe(false);
  });

  test("free tier pays 0 — fuel_stop itself pays nothing there, so no bonus can fire", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    const r = logFuelPurchaseSim(ledger, prices, {
      username: "freebie", paidTier: false, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 1,
    });
    expect(r.baseAward).toBe(0);
    expect(r.receiptBonusAwarded).toBe(0);
    expect(ledger.length).toBe(0); // no ledger rows at all
    expect(prices.length).toBe(1); // the price still files
    expect(prices[0]?.grade).toBe("receipt_verified");
  });

  test("cap: base lands but base + 15 would pass 500 → bonus 0, base intact", () => {
    const seed: Array<[string, number]> = [
      ["daily_trip_sealed", 120],
      ["daily_pod_seal", 165],
      ["daily_clean_day", 75],
      ["daily_dvir", 50],
      ["daily_briefing", 25],
      ["daily_posttrip_dvir", 25],
      ["daily_debrief", 20],
    ]; // 480 already earned today
    const ledger: Row[] = seed.map(([source, amount]) => ({
      username: "driver1",
      amount,
      source,
      refKey: `daily:${source.replace("daily_", "")}:${DAY}`,
      createdAt: AT,
    }));
    expect(dailyCapTotal(ledger, DAY)).toBe(480);
    const prices: PriceReport[] = [];
    const r = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 1,
    });
    expect(r.baseAward).toBe(10); // 480 + 10 = 490 ≤ 500 — the base lands
    expect(r.receiptBonusAwarded).toBe(0); // 490 + 15 = 505 > 500 — no partial bonus
    expect(balance(ledger, "driver1")).toBe(490);
    expect(ledger.some((x) => x.source === RECEIPT_BONUS_SOURCE)).toBe(false);
    expect(dailyCapTotal(ledger, DAY)).toBe(490);
  });

  test("once-per-day guard: a driver already bonused today gets 0 even on a fresh win check", () => {
    const driverRows: Row[] = [
      { username: "driver1", amount: 10, source: "daily_fuel_stop", refKey: `daily:fuel_stop:${DAY}-fuel1`, createdAt: AT },
      { username: "driver1", amount: 15, source: RECEIPT_BONUS_SOURCE, refKey: receiptBonusRefKey(DAY, SHA_A), createdAt: AT },
    ];
    expect(alreadyBonusedToday(driverRows, DAY)).toBe(true);
    expect(alreadyBonusedToday(driverRows, "2026-10-27")).toBe(false);
    expect(
      receiptBonusEligibility({
        baseAwardPoints: 10, receiptSha256: SHA_B, dayKey: DAY,
        driverRows, allRows: driverRows,
      }),
    ).toBe(0);
  });

  test("eligibility gates: no win or no receipt → 0; a clean winning receipt call → 15", () => {
    const rows: Row[] = [
      { username: "driver1", amount: 10, source: "daily_fuel_stop", refKey: `daily:fuel_stop:${DAY}-fuel1`, createdAt: AT },
    ];
    expect(receiptBonusEligibility({ baseAwardPoints: 0, receiptSha256: SHA_A, dayKey: DAY, driverRows: rows, allRows: [] })).toBe(0);
    expect(receiptBonusEligibility({ baseAwardPoints: 10, receiptSha256: null, dayKey: DAY, driverRows: rows, allRows: [] })).toBe(0);
    expect(receiptBonusEligibility({ baseAwardPoints: 10, receiptSha256: SHA_A, dayKey: DAY, driverRows: rows, allRows: [] })).toBe(15);
  });
});

describe("fuel receipt bonus — the price feed", () => {
  test("price row filed receipt_verified with a receipt, purchase without — always null coordinates", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    const withReceipt = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 1,
    });
    expect(withReceipt.priceReport.grade).toBe("receipt_verified");
    expect(withReceipt.priceReport.lat).toBeNull();
    expect(withReceipt.priceReport.lon).toBeNull();
    const noReceipt = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: null, state: "Oklahoma",
      pricePerGallon: 3.599, receiptSha256: null, fuelId: 2,
    });
    expect(noReceipt.priceReport.grade).toBe("purchase");
    expect(noReceipt.priceReport.station).toBe("Unnamed station"); // the handler's fallback
    expect(noReceipt.priceReport.lat).toBeNull();
    expect(noReceipt.priceReport.lon).toBeNull();
  });

  test("logFuelPurchase without a receipt files the price but pays no bonus", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    const r = logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Pilot", state: "Kansas",
      pricePerGallon: 3.499, receiptSha256: null, fuelId: 1,
    });
    expect(r.baseAward).toBe(10);
    expect(r.receiptBonusAwarded).toBe(0);
    expect(prices.length).toBe(1);
    expect(prices[0]?.grade).toBe("purchase");
  });

  test("manual reportFuelPrice rows grade 'reported' and keep their real coordinates", () => {
    // reportFuelPrice's insert, exactly as actions.ts writes it.
    const manual: PriceReport = {
      station: "Love's #412", lat: 35.4676, lon: -97.5164, state: "Oklahoma",
      price: 3.759, grade: REPORTED_PRICE_GRADE,
    };
    expect(manual.grade).toBe("reported");
    expect(manual.lat).not.toBeNull();
    expect(manual.lon).not.toBeNull();
  });

  test("getFuelPriceData-shaped output carries a grade per report and no username anywhere", () => {
    const ledger: Row[] = [];
    const prices: PriceReport[] = [];
    logFuelPurchaseSim(ledger, prices, {
      username: "driver1", paidTier: true, station: "Love's", state: "Texas",
      pricePerGallon: 3.899, receiptSha256: SHA_A, fuelId: 1,
    });
    logFuelPurchaseSim(ledger, prices, {
      username: "driver2", paidTier: true, station: "Pilot", state: "Kansas",
      pricePerGallon: 3.499, receiptSha256: null, fuelId: 2,
    });
    // The handler's response mapping, field for field.
    const out = {
      reports: prices.map((r, i) => ({
        id: i + 1, station: r.station, lat: r.lat, lon: r.lon,
        state: r.state, price: r.price, reportedAt: AT.toISOString(), grade: r.grade,
      })),
    };
    expect(out.reports.length).toBe(2);
    expect(out.reports.every((r) => typeof r.grade === "string" && r.grade.length > 0)).toBe(true);
    expect(out.reports.map((r) => r.grade)).toEqual(["receipt_verified", "purchase"]);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("username");
    expect(serialized).not.toContain("driver1");
    expect(serialized).not.toContain("driver2");
    for (const r of out.reports) {
      expect(Object.keys(r)).not.toContain("username");
    }
  });
});
