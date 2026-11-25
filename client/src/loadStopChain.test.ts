// loadStopChain.test.ts — the load stop chain (2026-11-24
// follow-up): routing a load yields driver → pickup → the plan's
// stops → delivery, every surface reading the same chain.

import { describe, expect, test } from "bun:test";
import { buildLoadStopChain, chainViaPoints, orderViaPoints } from "./loadStopChain";
import type { AutoAddStop } from "./autoAddStops";

const fuel = (over: Partial<AutoAddStop> = {}): AutoAddStop => ({
  key: "loves-379",
  kinds: ["fuel"],
  name: "Love's #379",
  lat: 30.24,
  lon: -83.12,
  alongMi: 65,
  buyGal: 42,
  priceLabel: null,
  pricePerGal: 5.139,
  estSaving: null,
  combinedWithFuel: false,
  ...over,
});

const pickup = { label: "BRWY — Jacksonville, FL", lat: 30.46, lon: -81.67, alongMi: 4 };
const delivery = { label: "Montgomery, AL", lat: 32.37, lon: -86.3 };

describe("buildLoadStopChain", () => {
  test("booked load: pickup → fuel → delivery, via carries pickup + fuel in order", () => {
    const { stops, via } = buildLoadStopChain({ pickup, pickupDone: false, midStops: [fuel()], delivery });
    expect(stops.map((s) => s.kind)).toEqual(["pickup", "fuel", "delivery"]);
    expect(stops[0]!.label).toBe("Pickup — BRWY — Jacksonville, FL");
    expect(stops[1]!.label).toBe("Fuel — Love's #379");
    expect(stops[1]!.action).toBe("FILL");
    expect(stops[1]!.buyGal).toBe(42);
    expect(stops[2]!.label).toBe("Delivery — Montgomery, AL");
    expect(via).toEqual([
      { lat: 30.46, lon: -81.67 },
      { lat: 30.24, lon: -83.12 },
    ]);
  });

  test("picked-up load: pickup marked done and OUT of the via — route continues fuel → delivery", () => {
    const { stops, via } = buildLoadStopChain({ pickup, pickupDone: true, midStops: [fuel()], delivery });
    expect(stops[0]!.kind).toBe("pickup");
    expect(stops[0]!.done).toBe(true);
    expect(via).toEqual([{ lat: 30.24, lon: -83.12 }]);
  });

  test("no fuel stop in the plan: chain is pickup → delivery and via is just the pickup", () => {
    const { stops, via } = buildLoadStopChain({ pickup, pickupDone: false, midStops: [], delivery });
    expect(stops.map((s) => s.kind)).toEqual(["pickup", "delivery"]);
    expect(via).toEqual([{ lat: 30.46, lon: -81.67 }]);
  });

  test("mid stops sort along the route; break/rest kinds keep their labels", () => {
    const rest = fuel({ key: "rest-1", kinds: ["rest"], name: "Ozark Rest Area", lat: 31.1, lon: -85.4, alongMi: 210, buyGal: null });
    const brk = fuel({ key: "brk-1", kinds: ["break"], name: "Pilot #1446", lat: 30.9, lon: -84.3, alongMi: 140, buyGal: null });
    const { stops } = buildLoadStopChain({ pickup, pickupDone: false, midStops: [rest, brk, fuel()], delivery });
    expect(stops.map((s) => s.label)).toEqual([
      "Pickup — BRWY — Jacksonville, FL",
      "Fuel — Love's #379",
      "Break — Pilot #1446",
      "Rest — Ozark Rest Area",
      "Delivery — Montgomery, AL",
    ]);
  });

  test("a stop without coordinates lists but never becomes a via-point", () => {
    const { stops, via } = buildLoadStopChain({
      pickup: { label: "BRWY", lat: null, lon: null },
      pickupDone: false,
      midStops: [fuel()],
      delivery,
    });
    expect(stops.map((s) => s.kind)).toEqual(["pickup", "fuel", "delivery"]);
    expect(via).toEqual([{ lat: 30.24, lon: -83.12 }]);
    expect(chainViaPoints(stops)).toEqual(via);
  });
});

describe("orderViaPoints", () => {
  test("no pickup pending: the list passes through bare", () => {
    expect(orderViaPoints(null, [{ lat: 1, lon: 2, alongMi: 9 }])).toEqual([{ lat: 1, lon: 2 }]);
  });

  test("pickup first in the usual case (its miles are the smallest)", () => {
    const out = orderViaPoints({ lat: 30.46, lon: -81.67, alongMi: 4 }, [{ lat: 30.24, lon: -83.12, alongMi: 65 }]);
    expect(out).toEqual([
      { lat: 30.46, lon: -81.67 },
      { lat: 30.24, lon: -83.12 },
    ]);
  });

  test("a fuel stop on the deadhead leg (fewer miles than the pickup) stays before it", () => {
    const out = orderViaPoints({ lat: 30.46, lon: -81.67, alongMi: 40 }, [{ lat: 30.3, lon: -82.1, alongMi: 12 }]);
    expect(out).toEqual([
      { lat: 30.3, lon: -82.1 },
      { lat: 30.46, lon: -81.67 },
    ]);
  });

  test("pickup with unknown miles leads; unknown-mile stops keep their order after", () => {
    const out = orderViaPoints({ lat: 1, lon: 1, alongMi: null }, [
      { lat: 2, lon: 2, alongMi: null },
      { lat: 3, lon: 3, alongMi: 50 },
    ]);
    expect(out[0]).toEqual({ lat: 1, lon: 1 });
    expect(out).toContainEqual({ lat: 2, lon: 2 });
    expect(out).toContainEqual({ lat: 3, lon: 3 });
  });
});
