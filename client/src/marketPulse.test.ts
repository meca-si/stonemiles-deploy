// Unit tests for the Market Pulse card view model
// (client/src/marketPulse.ts) — x-approved 2026-11-04; all-freight
// coverage added 2026-11-05. The fixture is the EXACT view
// getMarketPulse serves for the seeded Week 43 record
// (server/src/marketPulse.ts MARKET_PULSE_SEED), so these tests pin
// the card render contract end to end: flatbed-first ordering, the
// required labelling present verbatim, each lane's published $/mi
// (flatbed $3.31, dry van $2.85, reefer $3.45 from the week's full
// report), the no-index lanes carrying NO price, and the stale
// honesty note.
// Run: bun test client/src/marketPulse.test.ts

import { describe, expect, test } from "bun:test";
import {
  buildMarketPulseCardModel,
  orderEquipmentRows,
  type MarketPulseView,
} from "./marketPulse";

const WEEK_43_VIEW: MarketPulseView = {
  weekNumber: 43,
  weekEnding: "2026-10-30",
  weekLabel: "Week 43, ending Oct 30, 2026",
  totalRatePerMile: 3.23,
  totalChangeCents: -1.3,
  totalYoyPct: 41.5,
  totalLoadsChangePct: 8.5,
  mdiNote: "Market Demand Index at a four-week high",
  equipment: [
    { key: "flatbed", label: "Flatbed", ratePerMile: 3.31, changeCents: -1.6, yoyPct: 42, loadsChangePct: 11.2 },
    { key: "dryvan", label: "Dry van", ratePerMile: 2.85, changeCents: -2.5, yoyPct: 48, loadsChangePct: 6.3 },
    { key: "reefer", label: "Reefer", ratePerMile: 3.45, changeCents: -3.5, yoyPct: 41, loadsChangePct: 4.2 },
  ],
  noIndexLanes: [
    { key: "oversize", label: "Oversize / heavy haul", note: "No weekly index — every load prices on its own permits, escorts, and dimensions, so no honest average exists.", contextKey: "flatbed", contextLabel: "Flatbed" },
    { key: "stepdeck", label: "Step-deck", note: "No separate weekly index — step-deck runs inside the open-deck family; the flatbed rate above is the closest published context.", contextKey: "flatbed", contextLabel: "Flatbed" },
    { key: "tanker", label: "Tanker", note: "No weekly spot index is published for tanker — rates are set lane by lane, mostly on contract.", contextKey: null, contextLabel: null },
    { key: "poweronly", label: "Power only", note: "No weekly spot index is published for power only — priced per move off the trailer pool and lane.", contextKey: null, contextLabel: null },
    { key: "hotshot", label: "Hotshot", note: "No weekly spot index is published for hotshot — priced per load on urgency, weight, and distance.", contextKey: null, contextLabel: null },
    { key: "intermodal", label: "Intermodal / drayage", note: "No weekly per-mile spot index — container moves price per box, and drayage (the truck leg) prices per move, not per mile.", contextKey: null, contextLabel: null },
  ],
  alsoPublished: [
    { key: "specialized", label: "Specialized", ratePerMile: 3.42, weekLabel: "Week 39, ending Oct 2, 2026", moveNote: "+0.7% that week · +36.4% vs last year", note: "FTR tracks this fourth segment, but the Week 43 summary didn't publish its rate — this is the most recent week the source published for it." },
  ],
  label: "Broker-posted averages — market direction, not a quote for any load.",
  source: "Truckstop.com / FTR",
  sourceLine: "Source: Truckstop.com / FTR · Week 43, ending Oct 30",
  stale: false,
  ageDays: 5,
  staleNote: null,
};

describe("card render model — Week 43", () => {
  test("renders the heading, the plain week, and the total spot average", () => {
    const m = buildMarketPulseCardModel(WEEK_43_VIEW);
    expect(m.heading).toBe("Market Pulse");
    expect(m.weekLabel).toBe("Week 43, ending Oct 30, 2026");
    expect(m.totalRateLabel).toBe("$3.23/mi");
    expect(m.totalChangeLabel).toBe("−1.3¢ this week");
    expect(m.totalYoyLabel).toBe("+41.5% vs last year");
    expect(m.totalLoadsLabel).toBe("Loads +8.5%");
    expect(m.mdiNote).toBe("Market Demand Index at a four-week high");
  });

  test("equipment rows carry the seeded figures, formatted — price included", () => {
    const m = buildMarketPulseCardModel(WEEK_43_VIEW);
    expect(m.rows).toEqual([
      { key: "flatbed", label: "Flatbed", rateLabel: "$3.31/mi", changeLabel: "−1.6¢ this week", yoyLabel: "+42% vs last year", loadsLabel: "Loads +11.2%" },
      { key: "dryvan", label: "Dry van", rateLabel: "$2.85/mi", changeLabel: "−2.5¢ this week", yoyLabel: "+48% vs last year", loadsLabel: "Loads +6.3%" },
      { key: "reefer", label: "Reefer", rateLabel: "$3.45/mi", changeLabel: "−3.5¢ this week", yoyLabel: "+41% vs last year", loadsLabel: "Loads +4.2%" },
    ]);
  });

  test("a lane whose week published no rate renders direction only (null rate label)", () => {
    const m = buildMarketPulseCardModel({
      ...WEEK_43_VIEW,
      equipment: WEEK_43_VIEW.equipment.map((eq) => ({ ...eq, ratePerMile: null })),
    });
    for (const row of m.rows) expect(row.rateLabel).toBeNull();
  });
});

describe("all-freight coverage — the no-index lanes render priced-less", () => {
  test("oversize leads; every lane is named with its reason and NO price of its own", () => {
    const m = buildMarketPulseCardModel(WEEK_43_VIEW);
    expect(m.noIndexRows.map((r) => r.key)).toEqual([
      "oversize", "stepdeck", "tanker", "poweronly", "hotshot", "intermodal",
    ]);
    expect(m.noIndexRows[0]?.label).toBe("Oversize / heavy haul");
    for (const row of m.noIndexRows) {
      // No lane's own label or reason ever carries a price figure.
      expect(row.label).not.toContain("$");
      expect(row.note).not.toContain("$");
      expect(row.note.length).toBeGreaterThan(20);
    }
    // Lanes with no context pointer carry no $ figure anywhere.
    for (const row of m.noIndexRows.slice(2)) {
      expect(JSON.stringify(row)).not.toContain("$");
    }
    // The only $ figure allowed in a no-index row is the labelled
    // flatbed CONTEXT pointer on the open-deck family lanes.
    expect(m.noIndexRows[0]?.contextLabel).toBe("Closest published context: Flatbed $3.31/mi");
    expect(m.noIndexRows[1]?.contextLabel).toBe("Closest published context: Flatbed $3.31/mi");
    expect(m.noIndexRows[2]?.contextLabel).toBeNull();
    expect(m.noIndexRows[3]?.contextLabel).toBeNull();
    expect(m.noIndexRows[4]?.contextLabel).toBeNull();
    expect(m.noIndexRows[5]?.contextLabel).toBeNull();
  });

  test("the Specialized segment renders with its OWN week, never as a Week 43 price", () => {
    const m = buildMarketPulseCardModel(WEEK_43_VIEW);
    expect(m.alsoPublishedRows).toEqual([
      {
        key: "specialized",
        label: "Specialized",
        rateLabel: "$3.42/mi",
        weekLabel: "Week 39, ending Oct 2, 2026",
        moveNote: "+0.7% that week · +36.4% vs last year",
        note: "FTR tracks this fourth segment, but the Week 43 summary didn't publish its rate — this is the most recent week the source published for it.",
      },
    ]);
    // It never leaks into the current week's priced rows.
    expect(m.rows.map((r) => r.key)).toEqual(["flatbed", "dryvan", "reefer"]);
  });

  test("when the flatbed rate itself is unpublished, the context pointer disappears too", () => {
    const m = buildMarketPulseCardModel({
      ...WEEK_43_VIEW,
      equipment: WEEK_43_VIEW.equipment.map((eq) =>
        eq.key === "flatbed" ? { ...eq, ratePerMile: null } : eq,
      ),
    });
    expect(m.noIndexRows[0]?.contextLabel).toBeNull();
    expect(m.noIndexRows[1]?.contextLabel).toBeNull();
  });
});

describe("flatbed-first ordering", () => {
  test("flatbed leads even when the server rows arrive out of order", () => {
    const shuffled: MarketPulseView = {
      ...WEEK_43_VIEW,
      equipment: [WEEK_43_VIEW.equipment[2]!, WEEK_43_VIEW.equipment[0]!, WEEK_43_VIEW.equipment[1]!],
    };
    expect(orderEquipmentRows(shuffled.equipment).map((r) => r.key)).toEqual([
      "flatbed", "dryvan", "reefer",
    ]);
    expect(buildMarketPulseCardModel(shuffled).rows[0]?.key).toBe("flatbed");
  });
});

describe("labelling presence", () => {
  test("the required label and source line ride the model verbatim", () => {
    const m = buildMarketPulseCardModel(WEEK_43_VIEW);
    expect(m.label).toBe(
      "Broker-posted averages — market direction, not a quote for any load.",
    );
    expect(m.sourceLine).toBe("Source: Truckstop.com / FTR · Week 43, ending Oct 30");
  });

  test("a stale week surfaces its stale note; a fresh week has none", () => {
    const fresh = buildMarketPulseCardModel(WEEK_43_VIEW);
    expect(fresh.stale).toBe(false);
    expect(fresh.staleNote).toBeNull();
    const stale = buildMarketPulseCardModel({
      ...WEEK_43_VIEW,
      stale: true,
      ageDays: 21,
      staleNote:
        "This is the last week on file (Week 43, ending Oct 30, 2026, 21 days old) — a newer week's summary hasn't been entered yet.",
    });
    expect(stale.stale).toBe(true);
    expect(stale.staleNote).toContain("Week 43, ending Oct 30, 2026");
  });
});
