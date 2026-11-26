import { describe, expect, test } from "bun:test";
import { computeRateIndex, MIN_INDEX_LOADS, NATIONAL_RPM_BENCHMARKS, RATE_WATCH_BENCHMARKS, type RateWatchLoadLike } from "./rateWatch";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const DAY = 86_400_000;

function load(partial: Partial<RateWatchLoadLike>): RateWatchLoadLike {
  return { sealedAtMs: NOW - DAY, revenue: 2000, loadedMiles: 1000, equipmentType: "dry_van", ...partial };
}

describe("computeRateIndex", () => {
  test("shows the overall figure once 5 counted loads stand behind it", () => {
    const r = computeRateIndex([load({}), load({}), load({}), load({}), load({ revenue: 3000, loadedMiles: 1000 })], NOW);
    expect(r.hasIndex).toBe(true);
    expect(r.overall?.loadCount).toBe(5);
    expect(r.overall?.rpm).toBe(2.2); // 11000 / 5000 loaded mi
    expect(r.sealedLoadCount).toBe(5);
    expect(r.countedLoadCount).toBe(5);
    expect(r.windowDays).toBe(90);
    expect(r.minLoads).toBe(MIN_INDEX_LOADS);
  });

  test("below the threshold the index is building: count shows, no rate", () => {
    const r = computeRateIndex([load({}), load({}), load({})], NOW);
    expect(r.hasIndex).toBe(false);
    expect(r.overall).toBe(null);
    expect(r.byEquipment).toEqual([]);
    expect(r.sealedLoadCount).toBe(3);
    expect(r.countedLoadCount).toBe(3);
  });

  test("empty input reads as building with a zero count", () => {
    const r = computeRateIndex([], NOW);
    expect(r.hasIndex).toBe(false);
    expect(r.overall).toBe(null);
    expect(r.sealedLoadCount).toBe(0);
    expect(r.countedLoadCount).toBe(0);
  });

  test("loads sealed outside the 90-day window are not counted at all", () => {
    const r = computeRateIndex(
      [load({ sealedAtMs: NOW - 91 * DAY }), load({ sealedAtMs: NOW - 89 * DAY })],
      NOW,
    );
    expect(r.sealedLoadCount).toBe(1);
    expect(r.countedLoadCount).toBe(1);
  });

  test("a load with no rate or no miles is sealed-counted but never in the math", () => {
    const r = computeRateIndex(
      [load({ revenue: null }), load({ loadedMiles: null }), load({ loadedMiles: 0 }), load({})],
      NOW,
    );
    expect(r.sealedLoadCount).toBe(4);
    expect(r.countedLoadCount).toBe(1);
    expect(r.hasIndex).toBe(false);
  });

  test("equipment buckets group by the recorded type and each clears its own gate", () => {
    const loads: RateWatchLoadLike[] = [];
    for (let i = 0; i < 5; i++) loads.push(load({ equipmentType: "flatbed", revenue: 3000, loadedMiles: 1000 }));
    for (let i = 0; i < 4; i++) loads.push(load({ equipmentType: "reefer", revenue: 2600, loadedMiles: 1000 }));
    const r = computeRateIndex(loads, NOW);
    expect(r.hasIndex).toBe(true);
    expect(r.countedLoadCount).toBe(9);
    // Flatbed clears the gate at 5; reefer at 4 stays hidden.
    expect(r.byEquipment).toEqual([{ equipment: "flatbed", label: "Flatbed", loadCount: 5, rpm: 3 }]);
  });

  test("grouping is generic: RGN and oversized buckets appear on their own, no hardcoded lane list", () => {
    const loads: RateWatchLoadLike[] = [];
    for (let i = 0; i < 5; i++) loads.push(load({ equipmentType: "rgn", revenue: 6000, loadedMiles: 1000 }));
    for (let i = 0; i < 5; i++) loads.push(load({ equipmentType: "oversized", revenue: 5500, loadedMiles: 1000 }));
    // A value the labels map doesn't know yet still buckets under its
    // own name — the grouping never consults a fixed lane list.
    for (let i = 0; i < 5; i++) loads.push(load({ equipmentType: "step_deck", revenue: 2800, loadedMiles: 1000 }));
    const r = computeRateIndex(loads, NOW);
    expect(r.hasIndex).toBe(true);
    expect(r.byEquipment).toEqual([
      { equipment: "oversized", label: "Oversized", loadCount: 5, rpm: 5.5 },
      { equipment: "rgn", label: "RGN", loadCount: 5, rpm: 6 },
      { equipment: "step_deck", label: "step_deck", loadCount: 5, rpm: 2.8 },
    ]);
  });

  test("loads with no equipment type feed the overall figure but no bucket", () => {
    const loads: RateWatchLoadLike[] = [];
    for (let i = 0; i < 5; i++) loads.push(load({ equipmentType: null }));
    const r = computeRateIndex(loads, NOW);
    expect(r.hasIndex).toBe(true);
    expect(r.overall?.rpm).toBe(2);
    expect(r.byEquipment).toEqual([]);
  });

  test("the math divides by loaded miles only — no deadhead input exists to mix in", () => {
    // RateWatchLoadLike carries loadedMiles and nothing else: five
    // loads at $2,500 over 1,000 loaded miles read $2.50/mi exactly,
    // whatever empty miles the trucks ran between loads.
    const loads: RateWatchLoadLike[] = [];
    for (let i = 0; i < 5; i++) loads.push(load({ revenue: 2500, loadedMiles: 1000 }));
    const r = computeRateIndex(loads, NOW);
    expect(r.overall?.rpm).toBe(2.5);
  });
});

describe("RATE_WATCH_BENCHMARKS", () => {
  test("carries exactly the published Week 45 figures, nothing invented", () => {
    const b = RATE_WATCH_BENCHMARKS;
    expect(b.weekLabel).toBe("Week 45");
    expect(b.weekEndingLabel).toContain("Nov 13, 2026");
    expect(b.source).toContain("Truckstop.com / FTR");
    expect(b.totalSpotPerMile).toBe(3.16);
    const byLabel = new Map(b.rows.map((r) => [r.label, r]));
    // Dry van: no clean national absolute was published — null, with
    // the change and the year-over-year only.
    expect(byLabel.get("Dry van")?.ratePerMile).toBe(null);
    expect(byLabel.get("Dry van")?.weeklyChange).toBe("eased <1¢");
    expect(byLabel.get("Dry van")?.loadsChangePct).toBe(-2.2);
    expect(byLabel.get("Dry van")?.vsLastYearPct).toBe(48);
    expect(byLabel.get("Reefer")?.weeklyChange).toBe("+3¢");
    expect(byLabel.get("Reefer")?.loadsChangePct).toBe(-1.8);
    expect(byLabel.get("Reefer")?.vsLastYearPct).toBe(41);
    expect(byLabel.get("Flatbed")?.weeklyChange).toBe("−7.6¢");
    expect(byLabel.get("Flatbed")?.loadsChangePct).toBe(-7.3);
    expect(byLabel.get("Flatbed")?.vsLastYearPct).toBe(39);
    expect(byLabel.get("Flatbed")?.note).toContain("since August");
  });
});

describe("NATIONAL_RPM_BENCHMARKS", () => {
  test("carries exactly DAT's published Nov 14–20, 2026 all-in averages, nothing derived", () => {
    const n = NATIONAL_RPM_BENCHMARKS;
    expect(n.weekLabel).toBe("Nov 14–20, 2026");
    expect(n.source).toContain("DAT Freight & Analytics");
    expect(n.source).toContain("linehaul + fuel surcharge");
    const byEquipment = new Map(n.rows.map((r) => [r.equipment, r]));
    // DAT's release (Nov 24, 2026): van $3.11, reefer $3.73, flatbed $3.58.
    expect(byEquipment.get("dry_van")?.ratePerMile).toBe(3.11);
    expect(byEquipment.get("reefer")?.ratePerMile).toBe(3.73);
    expect(byEquipment.get("flatbed")?.ratePerMile).toBe(3.58);
    // Only lanes with a published all-in absolute get a row.
    expect(byEquipment.has("open_deck")).toBe(false);
    expect(byEquipment.has("rgn")).toBe(false);
    expect(byEquipment.has("container")).toBe(false);
    for (const r of n.rows) expect(r.ratePerMile).toBeGreaterThan(0);
  });
});
