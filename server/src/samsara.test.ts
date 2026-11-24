// samsara.test.ts — unit tests for the Samsara provider fetch layer's
// pure parts: the status/vehicle mappers, the native HOS clocks
// mapping, the duty-log → feed mappers, and the REST flow against an
// INJECTED fetch (no network is ever touched). Mirrors geotab.test.ts.

import { describe, expect, test } from "bun:test";
import {
  SamsaraApiError,
  fetchSamsaraBatch,
  findSamsaraVehicleByVin,
  mapSamsaraDvirs,
  mapSamsaraHosClocks,
  mapSamsaraHosLogs,
  mapSamsaraHosStatus,
  mapSamsaraIdentity,
  mapSamsaraIfta,
  mapSamsaraVehicle,
  mapSamsaraVehicleStats,
  type SamsaraFetchFn,
} from "./samsara";

const VIN = "1XKYDP9X8PJ238669";

describe("mapSamsaraHosStatus", () => {
  test("maps the Samsara vocabulary onto the contract states", () => {
    expect(mapSamsaraHosStatus("offDuty")).toBe("off_duty");
    expect(mapSamsaraHosStatus("sleeperBed")).toBe("sleeper");
    expect(mapSamsaraHosStatus("driving")).toBe("driving");
    expect(mapSamsaraHosStatus("onDuty")).toBe("on_duty");
    expect(mapSamsaraHosStatus("yardMove")).toBe("on_duty");
    expect(mapSamsaraHosStatus("personalConveyance")).toBe("off_duty");
    expect(mapSamsaraHosStatus("??")).toBeNull();
    expect(mapSamsaraHosStatus(undefined)).toBeNull();
  });
});

describe("findSamsaraVehicleByVin", () => {
  const vehicles = [
    mapSamsaraVehicle({ id: "v-other", name: "1111", vin: "1XKOTHER000000000" })!,
    mapSamsaraVehicle({ id: "v-8669", name: "8669", vin: VIN, licensePlate: "P1357517", make: "Kenworth", model: "T680", year: 2023 })!,
  ];
  test("exact, case-insensitive match; no match → null", () => {
    expect(findSamsaraVehicleByVin(vehicles, VIN)?.id).toBe("v-8669");
    expect(findSamsaraVehicleByVin(vehicles, VIN.toLowerCase())?.id).toBe("v-8669");
    expect(findSamsaraVehicleByVin(vehicles, "1XKNOTTHERE000000")).toBeNull();
    expect(findSamsaraVehicleByVin(vehicles, "")).toBeNull();
  });
});

describe("mapSamsaraHosLogs", () => {
  test("keeps only our vehicle's intervals, grouped by driver, as change-points", () => {
    const groups = mapSamsaraHosLogs(
      [
        {
          driver: { id: "d1", name: "Eric Ruggs" },
          hosLogs: [
            { hosStatusType: "driving", logStartTime: "2026-11-24T14:00:00.000Z", logEndTime: "2026-11-24T15:00:00.000Z", vehicle: { id: "v-8669" } },
            { hosStatusType: "offDuty", logStartTime: "2026-11-24T03:00:00.000Z", logEndTime: "2026-11-24T13:00:00.000Z", logRecordedLocation: { latitude: 30.332, longitude: -81.655 }, vehicle: { id: "v-8669" } },
            { hosStatusType: "onDuty", logStartTime: "2026-11-24T13:00:00.000Z", logEndTime: "2026-11-24T14:00:00.000Z", vehicle: { id: "v-other" } },
            { hosStatusType: "??", logStartTime: "2026-11-24T12:00:00.000Z", vehicle: { id: "v-8669" } },
          ],
        },
        {
          driver: { id: "d2", name: "Other Driver" },
          hosLogs: [
            { hosStatusType: "driving", logStartTime: "2026-11-24T10:00:00.000Z", vehicle: { id: "v-other" } },
          ],
        },
      ],
      "v-8669",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.driverId).toBe("d1");
    expect(groups[0]!.logs.map((l) => l.state)).toEqual(["off_duty", "driving"]);
    expect(groups[0]!.logs[0]!.at).toBe("2026-11-24T03:00:00.000Z");
    expect(groups[0]!.logs[0]!.location).toBe("30.33200, -81.65500");
  });
});

describe("mapSamsaraHosClocks", () => {
  const entries = [
    {
      driver: { id: "d-other" },
      clocks: {
        break: { timeUntilBreakDurationMs: 28_800_000 },
        cycle: { timeUntilBreakDurationMs: 252_000_000 },
        drive: { timeUntilBreakDurationMs: 39_600_000 },
        shift: { timeUntilBreakDurationMs: 50_400_000 },
      },
      currentVehicle: { id: "v-other" },
    },
    {
      driver: { id: "d1", name: "Eric Ruggs" },
      clocks: {
        break: { timeUntilBreakDurationMs: 25_200_000 },
        cycle: { timeUntilBreakDurationMs: 244_800_000 },
        drive: { timeUntilBreakDurationMs: 36_000_000 },
        shift: { timeUntilBreakDurationMs: 43_200_000 },
      },
      currentVehicle: { id: "v-8669" },
    },
  ];
  test("uses the provider's own clocks (ms → hours) for the matched driver", () => {
    expect(mapSamsaraHosClocks(entries, "d1", "v-8669")).toEqual({
      driveRemainH: 10,
      windowRemainH: 12,
      cycleRemainH: 68,
      breakRemainH: 7,
    });
  });
  test("falls back to the currentVehicle match; incomplete clocks → null", () => {
    expect(mapSamsaraHosClocks(entries, "", "v-8669")?.driveRemainH).toBe(10);
    expect(mapSamsaraHosClocks([{ driver: { id: "d1" }, clocks: { drive: { timeUntilBreakDurationMs: 1000 } } }], "d1", "v-8669")).toBeNull();
    expect(mapSamsaraHosClocks([], "d1", "v-8669")).toBeNull();
  });
});

describe("mapSamsaraVehicleStats", () => {
  test("meters → miles, engine seconds → hours, GPS carried", () => {
    expect(
      mapSamsaraVehicleStats({
        gps: { latitude: 30.33, longitude: -81.65, time: "2026-11-24T15:00:00.000Z" },
        obdOdometerMeters: { value: 160934.4 },
        obdEngineSeconds: { value: 22_647_600 },
      }),
    ).toEqual({ odometerMi: 100, lat: 30.33, lon: -81.65, engineHours: 6291 });
  });
  test("zero readings and empty rows → null (never zero-filled)", () => {
    expect(mapSamsaraVehicleStats({ gps: { latitude: 0, longitude: 0 }, obdOdometerMeters: { value: 0 } })).toBeNull();
    expect(mapSamsaraVehicleStats(null)).toBeNull();
    expect(mapSamsaraVehicleStats({})).toBeNull();
  });
});

describe("mapSamsaraDvirs", () => {
  test("unsafe + defects map to the contract vocabulary; foreign vehicles skipped", () => {
    const out = mapSamsaraDvirs(
      [
        { id: "dv1", type: "preTrip", safetyStatus: "safe", startTime: "2026-11-24T12:00:00.000Z", vehicle: { id: "v-8669", name: "8669" }, vehicleDefects: [] },
        {
          id: "dv2",
          type: "postTrip",
          safetyStatus: "unsafe",
          startTime: "2026-11-24T13:00:00.000Z",
          vehicle: { id: "v-8669", name: "8669" },
          vehicleDefects: [{ id: "x1", isResolved: false, defectType: "Brakes", comment: "pedal soft" }],
        },
        { id: "dv3", type: "preTrip", safetyStatus: "unsafe", startTime: "2026-11-24T13:00:00.000Z", vehicle: { id: "v-other" }, vehicleDefects: [{ defectType: "Tires" }] },
      ],
      "v-8669",
      "8669",
    );
    expect(out.dvirs).toHaveLength(2);
    expect(out.dvirs[0]!.status).toBe("no_defects");
    expect(out.dvirs[1]!.status).toBe("defects_found");
    expect(out.dvirs[1]!.defects).toEqual([{ item: "Brakes", note: "pedal soft", critical: true }]);
    expect(out.dvirs[1]!.vehicle).toBe("8669");
  });
});

describe("mapSamsaraIfta", () => {
  test("groups jurisdiction miles from miles and meters fields", () => {
    const out = mapSamsaraIfta([
      { jurisdiction: "FL", distanceMiles: 120.5 },
      { jurisdiction: "FL", distanceMeters: 160934.4 },
      { jurisdiction: "GA", totalMiles: 55 },
      { note: "no jurisdiction here", distanceMiles: 50 },
      { jurisdiction: "XX" },
    ]);
    expect(out).toEqual({
      states: [
        { state: "FL", miles: 220.5 },
        { state: "GA", miles: 55 },
      ],
    });
  });
  test("nested per-vehicle rows are walked; unrecognizable → null", () => {
    const out = mapSamsaraIfta([{ vehicle: { id: "v-8669" }, jurisdictions: [{ jurisdiction: "AL", miles: 367.4 }] }]);
    expect(out).toEqual({ states: [{ state: "AL", miles: 367.4 }] });
    expect(mapSamsaraIfta([{ note: "nothing usable" }])).toBeNull();
    expect(mapSamsaraIfta([])).toBeNull();
  });
});

describe("mapSamsaraIdentity", () => {
  test("carries only fields Samsara actually has", () => {
    const vehicle = mapSamsaraVehicle({ id: "v-8669", name: "8669", vin: VIN, licensePlate: "P1357517", make: "Kenworth", model: "T680", year: 2023 })!;
    const out = mapSamsaraIdentity(vehicle, { id: "d1", name: "Eric Ruggs", licenseNumber: "R200-XXX", licenseState: "al" }, "", 455404.9);
    expect(out.driver).toEqual({ name: "Eric Ruggs", driverId: "d1", cdlNumber: "R200-XXX", cdlState: "AL" });
    expect(out.truck).toEqual({ unitNumber: "8669", vin: VIN, plate: "P1357517", make: "Kenworth", model: "T680", year: 2023, odometerMi: 455404.9 });
  });
});

// --- REST flow against an injected fetch -------------------------------

type SeenCall = { url: string; method: string; auth: string | undefined };

function fakeSamsaraFetch(calls: SeenCall[], opts: { failAll?: boolean; noClocks?: boolean } = {}): SamsaraFetchFn {
  return async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    const respond = (status: number, payload: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
    if (opts.failAll) return respond(401, { message: "Invalid API token" });
    const path = new URL(url).pathname;
    if (path === "/fleet/vehicles") {
      return respond(200, {
        data: [
          { id: "v-other", name: "1111", vin: "1XKOTHER000000000" },
          { id: "v-8669", name: "8669", vin: VIN, licensePlate: "P1357517", make: "Kenworth", model: "T680", year: 2023 },
        ],
        pagination: { hasNextPage: false },
      });
    }
    if (path === "/fleet/hos/logs") {
      return respond(200, {
        data: [
          {
            driver: { id: "d1", name: "Eric Ruggs" },
            hosLogs: [
              { hosStatusType: "offDuty", logStartTime: "2026-11-24T03:00:00.000Z", logEndTime: "2026-11-24T13:00:00.000Z", vehicle: { id: "v-8669" } },
              { hosStatusType: "onDuty", logStartTime: "2026-11-24T13:00:00.000Z", logEndTime: "2026-11-24T14:00:00.000Z", vehicle: { id: "v-8669" } },
              { hosStatusType: "driving", logStartTime: "2026-11-24T14:00:00.000Z", logEndTime: "2026-11-24T15:00:00.000Z", vehicle: { id: "v-8669" } },
            ],
          },
        ],
        pagination: { hasNextPage: false },
      });
    }
    if (path === "/fleet/hos/clocks") {
      if (opts.noClocks) return respond(200, { data: [] });
      return respond(200, {
        data: [
          {
            driver: { id: "d1" },
            clocks: {
              break: { timeUntilBreakDurationMs: 25_200_000 },
              cycle: { timeUntilBreakDurationMs: 244_800_000 },
              drive: { timeUntilBreakDurationMs: 36_000_000 },
              shift: { timeUntilBreakDurationMs: 43_200_000 },
            },
            currentVehicle: { id: "v-8669" },
          },
        ],
      });
    }
    if (path === "/fleet/vehicles/stats") {
      return respond(200, {
        data: [{ id: "v-8669", gps: { latitude: 30.33, longitude: -81.65 }, obdOdometerMeters: { value: 732_646_000 }, obdEngineSeconds: { value: 22_647_600 } }],
      });
    }
    if (path === "/fleet/dvirs/history") {
      return respond(200, {
        data: [{ id: "dv1", type: "preTrip", safetyStatus: "safe", startTime: "2026-11-24T12:30:00.000Z", vehicle: { id: "v-8669", name: "8669" }, vehicleDefects: [] }],
        pagination: { hasNextPage: false },
      });
    }
    if (path === "/fleet/reports/ifta/jurisdiction") {
      return respond(200, { data: [{ jurisdiction: "FL", distanceMiles: 200.1 }] });
    }
    if (path === "/fleet/drivers") {
      return respond(200, {
        data: [{ id: "d1", name: "Eric Ruggs", licenseNumber: "R200", licenseState: "AL" }],
        pagination: { hasNextPage: false },
      });
    }
    return respond(200, { data: [] });
  };
}

describe("fetchSamsaraBatch (injected fetch)", () => {
  const now = new Date("2026-11-24T15:00:00.000Z");

  test("batch maps every feed for the VIN-matched vehicle only, GET-only with the bearer token", async () => {
    const calls: SeenCall[] = [];
    const r = await fetchSamsaraBatch(fakeSamsaraFetch(calls), "tok-secret-123", { vin: VIN, now });
    expect(r.batch.map((b) => b.feed).sort()).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    expect(r.deviceName).toBe("8669");
    expect(r.skipped).toEqual([]);
    const clocks = r.batch.find((b) => b.feed === "hos_clocks")!.payload as { driveRemainH: number };
    expect(clocks.driveRemainH).toBe(10); // the provider's own clocks, not a computation
    const stats = r.batch.find((b) => b.feed === "vehicle_stats")!.payload as { odometerMi: number; engineHours: number };
    expect(stats.odometerMi).toBeGreaterThan(454000);
    expect(stats.engineHours).toBe(6291);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.auth).toBe("Bearer tok-secret-123");
    }
    // The token never rides inside a batch payload.
    expect(JSON.stringify(r.batch)).not.toContain("tok-secret-123");
  });

  test("with no provider clocks, clocks are computed from the driver's logs", async () => {
    const r = await fetchSamsaraBatch(fakeSamsaraFetch([], { noClocks: true }), "tok-secret-123", { vin: VIN, now });
    const clocks = r.batch.find((b) => b.feed === "hos_clocks")!.payload as { driveRemainH: number; windowRemainH: number; cycleRemainH: number; breakRemainH: number };
    // 10h off (reset), then 1h on-duty + 1h driving before `now`.
    expect(clocks.driveRemainH).toBe(10);
    expect(clocks.windowRemainH).toBe(12);
    expect(clocks.cycleRemainH).toBe(68);
    expect(clocks.breakRemainH).toBe(7);
  });

  test("a VIN that matches no vehicle fails plainly and stores nothing", async () => {
    await expect(fetchSamsaraBatch(fakeSamsaraFetch([]), "tok-secret-123", { vin: "1XKNOTTHERE000000", now })).rejects.toThrow("No Samsara vehicle carries VIN");
  });

  test("a refused token surfaces Samsara's refusal", async () => {
    const err = await fetchSamsaraBatch(fakeSamsaraFetch([], { failAll: true }), "bad-token", { vin: VIN, now }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SamsaraApiError);
    expect((err as SamsaraApiError).status).toBe(401);
    expect((err as Error).message).toContain("Invalid API token");
  });
});
