// parking.test.ts — unit pins for reservable HOS-aware parking
// (Research Wave 2 item 4): the partner seam's env gating and
// transport behavior, and the arrival-window fit math. The flow
// behavior (refusals write nothing, configured holds seal) lives
// in parkingFlow.test.ts.
//
// Run: bun test server/src/parking.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PARKING_TIGHT_MARGIN_MIN,
  parkingArrivalPlan,
  parkingPartnerFromEnv,
  type ParkingFetch,
} from "./parking";

const NOW = new Date("2026-11-15T12:00:00.000Z");

describe("parkingArrivalPlan — the HOS fit verdict", () => {
  test("fits: arrival well inside the binding clock", () => {
    // 100 mi at 50 mph = 2 h; 8 h of clock → 6 h of margin.
    const p = parkingArrivalPlan({ now: NOW, alongMi: 100, paceMph: 50, bindingRemainH: 8 });
    expect(p.fit).toBe("fits");
    expect(p.marginMinutes).toBe(360);
    expect(p.etaAt.toISOString()).toBe("2026-11-15T14:00:00.000Z");
    expect(p.latestArrivalAt.toISOString()).toBe("2026-11-15T20:00:00.000Z");
  });

  test("tight: arrival inside the tight margin", () => {
    // 100 mi at 50 mph = 2 h; 2.5 h of clock → 30 min of margin.
    const p = parkingArrivalPlan({ now: NOW, alongMi: 100, paceMph: 50, bindingRemainH: 2.5 });
    expect(p.fit).toBe("tight");
    expect(p.marginMinutes).toBe(30);
  });

  test("wont_make_it: the clock runs out first", () => {
    // 300 mi at 50 mph = 6 h; 4 h of clock → 2 h short.
    const p = parkingArrivalPlan({ now: NOW, alongMi: 300, paceMph: 50, bindingRemainH: 4 });
    expect(p.fit).toBe("wont_make_it");
    expect(p.marginMinutes).toBe(-120);
  });

  test("unknown clocks read unknown — never guessed", () => {
    const p = parkingArrivalPlan({ now: NOW, alongMi: 100, paceMph: 50, bindingRemainH: null });
    expect(p.fit).toBe("unknown");
  });

  test("the tight margin matches the client mirror constant", () => {
    const clientSrc = readFileSync(`${import.meta.dir}/../../client/src/parkingFit.ts`, "utf8");
    const m = clientSrc.match(/PARKING_TIGHT_MARGIN_MIN = (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(PARKING_TIGHT_MARGIN_MIN);
  });
});

describe("parkingPartnerFromEnv — the partner seam", () => {
  test("unconfigured without both key and base URL", () => {
    expect(parkingPartnerFromEnv({})).toBeNull();
    expect(parkingPartnerFromEnv({ PARKING_PARTNER_API_KEY: "k" })).toBeNull();
    expect(parkingPartnerFromEnv({ PARKING_PARTNER_BASE_URL: "https://partner.example" })).toBeNull();
    expect(parkingPartnerFromEnv({ PARKING_PARTNER_API_KEY: "  ", PARKING_PARTNER_BASE_URL: "https://partner.example" })).toBeNull();
  });

  test("configured: reserve posts the window and returns the partner ref; cancel deletes it", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const transport: ParkingFetch = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      return { ok: true, status: 200, json: async () => ({ id: "TPC-42", status: "confirmed" }) };
    };
    const partner = parkingPartnerFromEnv(
      { PARKING_PARTNER_API_KEY: "k", PARKING_PARTNER_BASE_URL: "https://partner.example/", PARKING_PARTNER_NAME: "Test Club" },
      transport,
    );
    expect(partner).not.toBeNull();
    expect(partner!.name).toBe("Test Club");
    const placed = await partner!.reserve({
      stopName: "Rest area",
      stopLat: 32.7,
      stopLon: -96.8,
      etaAt: "2026-11-15T14:00:00.000Z",
      latestArrivalAt: "2026-11-15T20:00:00.000Z",
      driverRef: "alice",
    });
    expect(placed).toEqual({ partnerRef: "TPC-42", status: "confirmed" });
    expect(calls[0]!.url).toBe("https://partner.example/reservations");
    expect(calls[0]!.method).toBe("POST");
    await partner!.cancel("TPC-42");
    expect(calls[1]!.url).toBe("https://partner.example/reservations/TPC-42");
    expect(calls[1]!.method).toBe("DELETE");
  });

  test("a partner answer without a reference is an error, not a hold", async () => {
    const transport: ParkingFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const partner = parkingPartnerFromEnv(
      { PARKING_PARTNER_API_KEY: "k", PARKING_PARTNER_BASE_URL: "https://partner.example" },
      transport,
    );
    await expect(
      partner!.reserve({ stopName: "X", stopLat: 1, stopLon: 2, etaAt: "a", latestArrivalAt: "b", driverRef: "alice" }),
    ).rejects.toThrow("no reservation reference");
  });

  test("a partner failure propagates as an error", async () => {
    const transport: ParkingFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const partner = parkingPartnerFromEnv(
      { PARKING_PARTNER_API_KEY: "k", PARKING_PARTNER_BASE_URL: "https://partner.example" },
      transport,
    );
    await expect(
      partner!.reserve({ stopName: "X", stopLat: 1, stopLon: 2, etaAt: "a", latestArrivalAt: "b", driverRef: "alice" }),
    ).rejects.toThrow("503");
  });
});
