import { describe, expect, test } from "bun:test";
import {
  ALSO_PUBLISHED_SEGMENTS,
  MARKET_PULSE_LABEL,
  MARKET_PULSE_SEED,
  NO_INDEX_LANES,
  formatChangeCents,
  formatSignedPct,
  marketPulseAgeDays,
  marketPulseIsStale,
  marketPulseSourceLine,
  marketPulseStaleNote,
  marketPulseWeekLabel,
  orderedEquipment,
  validateMarketPulseRecord,
} from "./marketPulse";

/**
 * MARKET PULSE (2026-11-04, x-approved freeze exception). These tests
 * pin the EXACT pure rules the card and actions run on: the verified
 * Week 43 seed figures (the seed round-trip — the seed constant IS
 * what loadMarketPulseView bootstraps into market_pulse_weeks and
 * what getMarketPulse serves back), flatbed-first ordering, the
 * required labelling, the ~2-week staleness honesty rule, and the
 * all-freight coverage list (oversize first, no numbers). If a
 * figure here drifts, the card would be lying — these numbers come
 * from the Truckstop.com / FTR weekly report for Week 43, ending
 * Oct 30, 2026 (direction from the summary post x handed over;
 * per-lane $/mi from the same week's full report), and nowhere else.
 */

describe("the Week 43 seed — verified figures only", () => {
  test("totals match the source post exactly", () => {
    expect(MARKET_PULSE_SEED.weekNumber).toBe(43);
    expect(MARKET_PULSE_SEED.weekEnding).toBe("2026-10-30");
    expect(MARKET_PULSE_SEED.totalRatePerMile).toBe(3.23);
    expect(MARKET_PULSE_SEED.totalChangeCents).toBe(-1.3);
    expect(MARKET_PULSE_SEED.totalYoyPct).toBe(41.5);
    expect(MARKET_PULSE_SEED.totalLoadsChangePct).toBe(8.5);
    expect(MARKET_PULSE_SEED.mdiNote).toBe("Market Demand Index at a four-week high");
    expect(MARKET_PULSE_SEED.source).toBe("Truckstop.com / FTR");
  });

  test("per-equipment figures match the source post exactly", () => {
    expect(MARKET_PULSE_SEED.flatbed).toEqual({ ratePerMile: 3.31, changeCents: -1.6, yoyPct: 42, loadsChangePct: 11.2 });
    expect(MARKET_PULSE_SEED.dryvan).toEqual({ ratePerMile: 2.85, changeCents: -2.5, yoyPct: 48, loadsChangePct: 6.3 });
    expect(MARKET_PULSE_SEED.reefer).toEqual({ ratePerMile: 3.45, changeCents: -3.5, yoyPct: 41, loadsChangePct: 4.2 });
  });

  test("per-equipment absolute $/mi rates match the week's FULL published report exactly", () => {
    // Truckstop/FTR report of Nov 2, 2026 for Week 43 (full text
    // verified 2026-11-05): flatbed $3.31, dry van $2.85, reefer
    // $3.45 — each reconciles with its change (rate − change = the
    // prior week's rate the report describes).
    expect(MARKET_PULSE_SEED.flatbed.ratePerMile).toBe(3.31);
    expect(MARKET_PULSE_SEED.dryvan.ratePerMile).toBe(2.85);
    expect(MARKET_PULSE_SEED.reefer.ratePerMile).toBe(3.45);
    for (const eq of [MARKET_PULSE_SEED.flatbed, MARKET_PULSE_SEED.dryvan, MARKET_PULSE_SEED.reefer]) {
      expect(Object.keys(eq).sort()).toEqual(["changeCents", "loadsChangePct", "ratePerMile", "yoyPct"]);
    }
  });

  test("the seed passes the manual-entry validation (the round-trip gate)", () => {
    expect(validateMarketPulseRecord(MARKET_PULSE_SEED)).toBeNull();
  });
});

describe("flatbed-first ordering", () => {
  test("equipment renders flatbed, dry van, reefer — flatbed is x's lane", () => {
    const rows = orderedEquipment(MARKET_PULSE_SEED);
    expect(rows.map((r) => r.key)).toEqual(["flatbed", "dryvan", "reefer"]);
    expect(rows.map((r) => r.label)).toEqual(["Flatbed", "Dry van", "Reefer"]);
    expect(rows[0]).toEqual({
      key: "flatbed", label: "Flatbed", ratePerMile: 3.31, changeCents: -1.6, yoyPct: 42, loadsChangePct: 11.2,
    });
  });
});

describe("all-freight coverage — the no-index lanes (x, 2026-11-05)", () => {
  test("oversize leads the list; every lane a driver asked about is named", () => {
    expect(NO_INDEX_LANES.map((l) => l.key)).toEqual([
      "oversize", "stepdeck", "tanker", "poweronly", "hotshot", "intermodal",
    ]);
    expect(NO_INDEX_LANES[0]?.label).toBe("Oversize / heavy haul");
  });

  test("the Specialized segment carries ONLY its verified Week 39 figure, own week labelled", () => {
    // Truckstop/FTR release via AJOT (Oct 6, 2026): Specialized
    // rates rose 0.7% to $3.42/mi for Week 39, ending Oct 2, 2026,
    // +36.4% vs last year. The Week 43 summary published no
    // Specialized rate — none is claimed for it here.
    expect(ALSO_PUBLISHED_SEGMENTS).toEqual([
      {
        key: "specialized",
        label: "Specialized",
        ratePerMile: 3.42,
        weekLabel: "Week 39, ending Oct 2, 2026",
        moveNote: "+0.7% that week · +36.4% vs last year",
        note: "FTR tracks this fourth segment, but the Week 43 summary didn't publish its rate — this is the most recent week the source published for it.",
      },
    ]);
  });

  test("no no-index lane carries a number — the list is keys, labels, reasons only", () => {
    for (const lane of NO_INDEX_LANES) {
      expect(Object.keys(lane).sort()).toEqual(["contextKey", "key", "label", "note"]);
      expect(lane.note.length).toBeGreaterThan(20);
      expect(lane.note).not.toMatch(/\$\d/);
    }
  });

  test("context pointers name only indexed lanes (flatbed)", () => {
    for (const lane of NO_INDEX_LANES) {
      expect([null, "flatbed"]).toContain(lane.contextKey);
    }
    expect(NO_INDEX_LANES.find((l) => l.key === "oversize")?.contextKey).toBe("flatbed");
    expect(NO_INDEX_LANES.find((l) => l.key === "stepdeck")?.contextKey).toBe("flatbed");
  });
});

describe("labelling — the required lines, verbatim", () => {
  test("the context label is the exact approved wording", () => {
    expect(MARKET_PULSE_LABEL).toBe(
      "Broker-posted averages — market direction, not a quote for any load.",
    );
  });

  test("the source line is the exact approved form for Week 43", () => {
    expect(marketPulseSourceLine(MARKET_PULSE_SEED)).toBe(
      "Source: Truckstop.com / FTR · Week 43, ending Oct 30",
    );
  });

  test("the plain week label names the week and its ending date with the year", () => {
    expect(marketPulseWeekLabel("2026-10-30", 43)).toBe("Week 43, ending Oct 30, 2026");
    expect(marketPulseWeekLabel("2026-11-06", 44)).toBe("Week 44, ending Nov 6, 2026");
  });
});

describe("staleness — stale data never masquerades as live", () => {
  test("a fresh week is not stale; past ~2 weeks it is", () => {
    expect(marketPulseAgeDays("2026-10-30", new Date("2026-10-31T12:00:00Z"))).toBe(1);
    expect(marketPulseIsStale("2026-10-30", new Date("2026-11-13T12:00:00Z"))).toBe(false); // 14 days
    expect(marketPulseIsStale("2026-10-30", new Date("2026-11-14T12:00:00Z"))).toBe(true); // 15 days
  });

  test("the stale note names the week on file and its age; fresh weeks get none", () => {
    expect(marketPulseStaleNote(MARKET_PULSE_SEED, new Date("2026-11-04T12:00:00Z"))).toBeNull();
    const note = marketPulseStaleNote(MARKET_PULSE_SEED, new Date("2026-11-20T12:00:00Z"));
    expect(note).toContain("Week 43, ending Oct 30, 2026");
    expect(note).toContain("21 days old");
  });
});

describe("formatting", () => {
  test("cents changes are signed with one decimal", () => {
    expect(formatChangeCents(-1.6)).toBe("−1.6¢");
    expect(formatChangeCents(-1.3)).toBe("−1.3¢");
    expect(formatChangeCents(2)).toBe("+2.0¢");
    expect(formatChangeCents(0)).toBe("0.0¢");
  });

  test("percents are signed; whole numbers stay whole", () => {
    expect(formatSignedPct(42)).toBe("+42%");
    expect(formatSignedPct(41.5)).toBe("+41.5%");
    expect(formatSignedPct(11.2)).toBe("+11.2%");
    expect(formatSignedPct(-3.5)).toBe("−3.5%");
  });
});

describe("manual-entry validation", () => {
  test("rejects implausible or malformed entries — nothing bad gets stored", () => {
    expect(validateMarketPulseRecord({ ...MARKET_PULSE_SEED, weekNumber: 0 })).not.toBeNull();
    expect(validateMarketPulseRecord({ ...MARKET_PULSE_SEED, weekNumber: 54 })).not.toBeNull();
    expect(validateMarketPulseRecord({ ...MARKET_PULSE_SEED, weekEnding: "10/30/2026" })).not.toBeNull();
    expect(validateMarketPulseRecord({ ...MARKET_PULSE_SEED, weekEnding: "2026-02-30" })).not.toBeNull();
    expect(validateMarketPulseRecord({ ...MARKET_PULSE_SEED, totalRatePerMile: 0 })).not.toBeNull();
    expect(validateMarketPulseRecord({ ...MARKET_PULSE_SEED, totalRatePerMile: 99 })).not.toBeNull();
    expect(validateMarketPulseRecord({ ...MARKET_PULSE_SEED, source: "  " })).not.toBeNull();
    expect(
      validateMarketPulseRecord({
        ...MARKET_PULSE_SEED,
        flatbed: { ratePerMile: 3.31, changeCents: Number.NaN, yoyPct: 42, loadsChangePct: 11.2 },
      }),
    ).not.toBeNull();
    expect(
      validateMarketPulseRecord({
        ...MARKET_PULSE_SEED,
        flatbed: { ratePerMile: 99, changeCents: -1.6, yoyPct: 42, loadsChangePct: 11.2 },
      }),
    ).not.toBeNull();
    expect(
      validateMarketPulseRecord({
        ...MARKET_PULSE_SEED,
        reefer: { ratePerMile: 0, changeCents: -3.5, yoyPct: 41, loadsChangePct: 4.2 },
      }),
    ).not.toBeNull();
  });

  test("a week whose report publishes no lane rates (null) is storable — direction only", () => {
    expect(
      validateMarketPulseRecord({
        ...MARKET_PULSE_SEED,
        weekNumber: 44,
        weekEnding: "2026-11-06",
        flatbed: { ratePerMile: null, changeCents: -1.6, yoyPct: 42, loadsChangePct: 11.2 },
        dryvan: { ratePerMile: null, changeCents: -2.5, yoyPct: 48, loadsChangePct: 6.3 },
        reefer: { ratePerMile: null, changeCents: -3.5, yoyPct: 41, loadsChangePct: 4.2 },
      }),
    ).toBeNull();
  });

  test("accepts a plausible next week", () => {
    expect(
      validateMarketPulseRecord({
        ...MARKET_PULSE_SEED,
        weekNumber: 44,
        weekEnding: "2026-11-06",
        totalRatePerMile: 3.31,
        totalChangeCents: 8,
      }),
    ).toBeNull();
  });
});
