// Unit tests for trailerTelemetry.ts (Wave 2 item 11, Part C):
// the seam gate (key AND base URL), reading validation,
// freshness (age always printed, never upgraded to live), the
// reefer range + verdict, and the simulated readings.
//
// Run: bun test server/src/trailerTelemetry.test.ts
import { describe, expect, test } from "bun:test";
import {
  reeferRangeForLoad,
  reeferTempVerdict,
  simulatedTrailerReadings,
  trailerFreshness,
  trailerPartnerFromEnv,
  validateTrailerReading,
  type TrailerFetch,
} from "./trailerTelemetry";

describe("trailerPartnerFromEnv — the seam gate", () => {
  test("key without a base URL is not a partner; neither alone configures", () => {
    expect(trailerPartnerFromEnv({})).toBeNull();
    expect(trailerPartnerFromEnv({ TRAILER_PARTNER_API_KEY: "k" })).toBeNull();
    expect(trailerPartnerFromEnv({ TRAILER_PARTNER_BASE_URL: "https://t.example" })).toBeNull();
  });

  test("key + base URL configure the partner; fetchReadings hits the device door", async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const transport: TrailerFetch = async (url, init) => {
      seen.push({ url, auth: init.headers.authorization });
      return {
        ok: true,
        status: 200,
        json: async () => ({ readings: [{ kind: "position", lat: 30.6, lon: -88.0, recordedAt: "2026-11-15T10:00:00Z" }] }),
      };
    };
    const p = trailerPartnerFromEnv(
      { TRAILER_PARTNER_API_KEY: "sekret", TRAILER_PARTNER_BASE_URL: "https://t.example/" },
      transport,
    );
    expect(p).not.toBeNull();
    const rows = await p!.fetchReadings({ deviceRef: "puck-1", sinceIso: "2026-11-14T00:00:00Z" });
    expect(rows.length).toBe(1);
    expect(seen[0]!.url).toContain("https://t.example/readings?device=puck-1");
    expect(seen[0]!.auth).toBe("Bearer sekret");
  });

  test("a partner error surfaces as an error, never as empty data", async () => {
    const transport: TrailerFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const p = trailerPartnerFromEnv(
      { TRAILER_PARTNER_API_KEY: "k", TRAILER_PARTNER_BASE_URL: "https://t.example" },
      transport,
    );
    await expect(p!.fetchReadings({ deviceRef: "d", sinceIso: "2026-11-14T00:00:00Z" })).rejects.toThrow("503");
  });
});

describe("validateTrailerReading", () => {
  test("a position reading needs a valid pair; a reefer reading a plausible temp", () => {
    expect(
      validateTrailerReading({ kind: "position", lat: 30.69, lon: -88.04, recordedAt: "2026-11-15T10:00:00Z" }).ok,
    ).toBe(true);
    expect(
      validateTrailerReading({ kind: "position", lat: 999, lon: 0, recordedAt: "2026-11-15T10:00:00Z" }).ok,
    ).toBe(false);
    expect(
      validateTrailerReading({ kind: "reefer_temp", tempF: 34.5, recordedAt: "2026-11-15T10:00:00Z" }).ok,
    ).toBe(true);
    expect(
      validateTrailerReading({ kind: "reefer_temp", tempF: 900, recordedAt: "2026-11-15T10:00:00Z" }).ok,
    ).toBe(false);
    expect(validateTrailerReading({ kind: "reefer_temp", tempF: 34.5, recordedAt: "whenever" }).ok).toBe(false);
    expect(validateTrailerReading({ kind: "speed", recordedAt: "2026-11-15T10:00:00Z" }).ok).toBe(false);
  });
});

describe("trailerFreshness — age always printed", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");

  test("fresh / recent / stale bands, and the line never claims live", () => {
    const fresh = trailerFreshness(now - 5 * 60000, now);
    expect(fresh.freshness).toBe("fresh");
    expect(fresh.line).toContain("not a live position");
    expect(trailerFreshness(now - 60 * 60000, now).freshness).toBe("recent");
    expect(trailerFreshness(now - 300 * 60000, now).freshness).toBe("stale");
    expect(trailerFreshness(now - 300 * 60000, now).line).toContain("5 h 0 min ago");
  });
});

describe("reefer range + verdict", () => {
  test("no setpoint → no range → no judgement", () => {
    expect(reeferRangeForLoad({ reeferSetpointF: null, reeferBandF: null })).toBeNull();
  });

  test("setpoint with the default band of 5°F", () => {
    const range = reeferRangeForLoad({ reeferSetpointF: 36, reeferBandF: null })!;
    expect(range.minF).toBe(31);
    expect(range.maxF).toBe(41);
    expect(reeferTempVerdict(34.5, range)).toBe("in_range");
    expect(reeferTempVerdict(41, range)).toBe("in_range");
    expect(reeferTempVerdict(41.1, range)).toBe("out_of_range");
    expect(reeferTempVerdict(30.9, range)).toBe("out_of_range");
  });

  test("an explicit band replaces the default", () => {
    const range = reeferRangeForLoad({ reeferSetpointF: 0, reeferBandF: 5 })!;
    expect(range.minF).toBe(-5);
    expect(range.maxF).toBe(5);
    expect(reeferTempVerdict(34.5, range)).toBe("out_of_range");
  });
});

describe("simulatedTrailerReadings", () => {
  test("position + reefer pair, minutes old, deterministic", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const rows = simulatedTrailerReadings(now);
    expect(rows.length).toBe(2);
    expect(rows[0]!.kind).toBe("position");
    expect(rows[1]!.kind).toBe("reefer_temp");
    expect(rows[1]!.tempF).toBe(34.5);
    for (const r of rows) expect(validateTrailerReading(r).ok).toBe(true);
    expect(simulatedTrailerReadings(now)).toEqual(rows);
  });
});
