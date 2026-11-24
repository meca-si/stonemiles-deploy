// motive.test.ts — unit tests for the Motive provider fetch layer's
// pure parts: the wrapped-list unwrap, the status/vehicle mappers, the
// availability (clocks) mapping, the duty-log → feed mappers, and the
// REST flow against an INJECTED fetch (no network is ever touched).
// Mirrors geotab.test.ts.

import { describe, expect, test } from "bun:test";
import {
  MotiveApiError,
  fetchMotiveBatch,
  findMotiveVehicleByVin,
  mapMotiveAvailableTime,
  mapMotiveDvirs,
  mapMotiveHosLogs,
  mapMotiveHosStatus,
  mapMotiveIdentity,
  mapMotiveIfta,
  mapMotiveVehicle,
  mapMotiveVehicleStats,
  motiveAvailabilityRows,
  unwrapMotiveList,
  type MotiveFetchFn,
} from "./motive";

const VIN = "1XKYDP9X8PJ238669";

describe("unwrapMotiveList", () => {
  test("unwraps the singular-key items; direct items pass through", () => {
    expect(unwrapMotiveList({ vehicles: [{ vehicle: { id: 1 } }, { vehicle: { id: 2 } }] }, "vehicles", "vehicle")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(unwrapMotiveList({ vehicles: [{ id: 3 }] }, "vehicles", "vehicle")).toEqual([{ id: 3 }]);
    expect(unwrapMotiveList({}, "vehicles", "vehicle")).toEqual([]);
    expect(unwrapMotiveList(null, "vehicles", "vehicle")).toEqual([]);
  });
});

describe("mapMotiveHosStatus", () => {
  test("maps the Motive vocabulary onto the contract states", () => {
    expect(mapMotiveHosStatus("driving")).toBe("driving");
    expect(mapMotiveHosStatus("on_duty")).toBe("on_duty");
    expect(mapMotiveHosStatus("off_duty")).toBe("off_duty");
    expect(mapMotiveHosStatus("sleeper_berth")).toBe("sleeper");
    expect(mapMotiveHosStatus("sleeper")).toBe("sleeper");
    expect(mapMotiveHosStatus("yard_move")).toBe("on_duty");
    expect(mapMotiveHosStatus("personal_conveyance")).toBe("off_duty");
    expect(mapMotiveHosStatus("??")).toBeNull();
  });
});

describe("findMotiveVehicleByVin", () => {
  const vehicles = [
    mapMotiveVehicle({ id: 41, number: "1111", vin: "1XKOTHER000000000" })!,
    mapMotiveVehicle({ id: 42, number: "8669", vin: VIN, license_plate_number: "P1357517", make: "Kenworth", model: "T680", year: 2023, current_driver: { id: 7 } })!,
  ];
  test("exact, case-insensitive match; current driver carried; no match → null", () => {
    expect(findMotiveVehicleByVin(vehicles, VIN)?.id).toBe("42");
    expect(findMotiveVehicleByVin(vehicles, VIN.toLowerCase())?.currentDriverId).toBe("7");
    expect(findMotiveVehicleByVin(vehicles, "1XKNOTTHERE000000")).toBeNull();
  });
});

describe("mapMotiveHosLogs", () => {
  test("keeps only our vehicle's intervals as change-points, sorted, with locations", () => {
    const out = mapMotiveHosLogs(
      [
        { vehicle_id: 42, duty_status: "driving", start_time: "2026-11-24T14:00:00.000Z", end_time: "2026-11-24T15:00:00.000Z" },
        { vehicle_id: 42, duty_status: "off_duty", start_time: "2026-11-24T03:00:00.000Z", end_time: "2026-11-24T13:00:00.000Z", location: "Jacksonville, FL" },
        { vehicle_id: 99, duty_status: "driving", start_time: "2026-11-24T10:00:00.000Z" },
        { vehicle_id: 42, duty_status: "??", start_time: "2026-11-24T11:00:00.000Z" },
        { vehicle_id: 42, duty_status: "on_duty", start_time: "not-a-date" },
      ],
      "42",
    );
    expect(out.logs.map((l) => l.state)).toEqual(["off_duty", "driving"]);
    expect(out.logs[0]!.location).toBe("Jacksonville, FL");
    expect(out.logs[1]!.location).toBeUndefined();
  });
});

describe("motiveAvailabilityRows + mapMotiveAvailableTime", () => {
  test("availability beside the { user } wrapper is found; seconds → hours", () => {
    const rows = motiveAvailabilityRows({
      users: [
        { user: { id: 8, first_name: "Other" }, available_time: { drive: 39600, shift: 50400, cycle: 252000, break: 28800 } },
        { user: { id: 7, first_name: "Eric" }, available_time: { drive: 36000, shift: 43200, cycle: 244800, break: 25200 } },
      ],
    });
    expect(mapMotiveAvailableTime(rows, "7")).toEqual({ driveRemainH: 10, windowRemainH: 12, cycleRemainH: 68, breakRemainH: 7 });
    expect(mapMotiveAvailableTime(rows, "404")).toBeNull();
  });
  test("availability nested inside the user record works too; missing → null", () => {
    const rows = motiveAvailabilityRows({ users: [{ user: { id: 7, available_time: { drive: 3600, shift: 7200, cycle: 10800, break: 1800 } } }] });
    expect(mapMotiveAvailableTime(rows, "7")).toEqual({ driveRemainH: 1, windowRemainH: 2, cycleRemainH: 3, breakRemainH: 0.5 });
    expect(mapMotiveAvailableTime([], "7")).toBeNull();
  });
});

describe("mapMotiveVehicleStats", () => {
  test("GPS + odometer variants carried; foreign vehicle ignored", () => {
    expect(
      mapMotiveVehicleStats(
        [
          { vehicle_id: 99, current_location: { lat: 1, lon: 2 } },
          { vehicle_id: 42, current_location: { lat: 30.33, lon: -81.65, located_at: "2026-11-24T15:00:00.000Z" }, odometer: 455404.9 },
        ],
        "42",
      ),
    ).toEqual({ lat: 30.33, lon: -81.65, odometerMi: 455404.9 });
  });
  test("no usable reading → null (never zero-filled)", () => {
    expect(mapMotiveVehicleStats([{ vehicle_id: 42, current_location: { lat: 0, lon: 0 } }], "42")).toBeNull();
    expect(mapMotiveVehicleStats([], "42")).toBeNull();
  });
});

describe("mapMotiveDvirs", () => {
  test("defects map to the contract vocabulary; unit-number match when no id", () => {
    const out = mapMotiveDvirs(
      [
        { id: 5, vehicle_id: 42, inspection_type: "pre_trip", created_at: "2026-11-24T12:00:00.000Z", status: "satisfactory", defects: [] },
        {
          id: 6,
          vehicle_id: 42,
          inspection_type: "post_trip",
          created_at: "2026-11-24T13:00:00.000Z",
          status: "defects_found",
          defects: [{ id: 1, area: "Brakes", description: "pedal soft" }],
        },
        { id: 7, vehicle_number: "8669", created_at: "2026-11-24T14:00:00.000Z", status: "satisfactory", defects: [] },
        { id: 8, vehicle_id: 99, created_at: "2026-11-24T14:00:00.000Z", status: "defects_found", defects: [{ area: "Tires" }] },
      ],
      "42",
      "8669",
    );
    expect(out.dvirs).toHaveLength(3);
    expect(out.dvirs[0]!.status).toBe("no_defects");
    expect(out.dvirs[1]!.status).toBe("defects_found");
    expect(out.dvirs[1]!.defects).toEqual([{ item: "Brakes", note: "pedal soft" }]);
    expect(out.dvirs[2]!.vehicle).toBe("8669");
  });
});

describe("mapMotiveIfta", () => {
  test("trip jurisdiction segments group by state; foreign vehicles skipped", () => {
    const out = mapMotiveIfta(
      [
        { vehicle_id: 42, jurisdictions: [{ jurisdiction: "FL", miles: 120.5 }, { jurisdiction: "GA", miles: 55 }] },
        { vehicle_id: 42, jurisdictions: [{ jurisdiction: "FL", distance_miles: 100 }] },
        { vehicle_id: 99, jurisdictions: [{ jurisdiction: "FL", miles: 999 }] },
      ],
      [],
      "42",
    );
    expect(out).toEqual({
      states: [
        { state: "FL", miles: 220.5 },
        { state: "GA", miles: 55 },
      ],
    });
  });
  test("summary rows are the fallback; unrecognizable → null", () => {
    const out = mapMotiveIfta([], [{ vehicle_id: 42, state: "AL", total_miles: 367.4 }], "42");
    expect(out).toEqual({ states: [{ state: "AL", miles: 367.4 }] });
    expect(mapMotiveIfta([{ note: "nothing usable" }], [], "42")).toBeNull();
    expect(mapMotiveIfta([], [], "42")).toBeNull();
  });
});

describe("mapMotiveIdentity", () => {
  test("carries only fields Motive actually has", () => {
    const vehicle = mapMotiveVehicle({ id: 42, number: "8669", vin: VIN, license_plate_number: "P1357517", make: "Kenworth", model: "T680", year: 2023 })!;
    const out = mapMotiveIdentity(vehicle, { id: 7, first_name: "Eric", last_name: "Ruggs", license_number: "R200-XXX", license_state: "al" }, 455404.9);
    expect(out.driver).toEqual({ name: "Eric Ruggs", driverId: "7", cdlNumber: "R200-XXX", cdlState: "AL" });
    expect(out.truck).toEqual({ unitNumber: "8669", vin: VIN, plate: "P1357517", make: "Kenworth", model: "T680", year: 2023, odometerMi: 455404.9 });
  });
});

// --- REST flow against an injected fetch -------------------------------

type SeenCall = { url: string; method: string; apiKey: string | undefined };

function fakeMotiveFetch(calls: SeenCall[], opts: { failAll?: boolean; noAvailability?: boolean } = {}): MotiveFetchFn {
  return async (url, init) => {
    calls.push({ url, method: init.method, apiKey: init.headers["X-Api-Key"] });
    const respond = (status: number, payload: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
    if (opts.failAll) return respond(401, { error_message: "Invalid API key" });
    const path = new URL(url).pathname;
    if (path === "/v1/vehicles") {
      return respond(200, {
        vehicles: [
          { vehicle: { id: 41, number: "1111", vin: "1XKOTHER000000000" } },
          { vehicle: { id: 42, number: "8669", vin: VIN, license_plate_number: "P1357517", make: "Kenworth", model: "T680", year: 2023, current_driver: { id: 7 } } },
        ],
      });
    }
    if (path === "/v1/users") {
      return respond(200, { users: [{ user: { id: 7, first_name: "Eric", last_name: "Ruggs", license_number: "R200", license_state: "AL" } }] });
    }
    if (path === "/v1/logs") {
      return respond(200, {
        logs: [
          { log: { id: 1, user_id: 7, vehicle_id: 42, duty_status: "off_duty", start_time: "2026-11-24T03:00:00.000Z", end_time: "2026-11-24T13:00:00.000Z", location: "Jacksonville, FL" } },
          { log: { id: 2, user_id: 7, vehicle_id: 42, duty_status: "on_duty", start_time: "2026-11-24T13:00:00.000Z", end_time: "2026-11-24T14:00:00.000Z" } },
          { log: { id: 3, user_id: 7, vehicle_id: 42, duty_status: "driving", start_time: "2026-11-24T14:00:00.000Z", end_time: "2026-11-24T15:00:00.000Z" } },
        ],
      });
    }
    if (path === "/v1/available_time") {
      if (opts.noAvailability) return respond(200, { users: [] });
      return respond(200, { users: [{ user: { id: 7 }, available_time: { drive: 36000, shift: 43200, cycle: 244800, break: 25200 } }] });
    }
    if (path === "/v1/vehicle_locations") {
      return respond(200, {
        vehicle_locations: [
          { vehicle_location: { vehicle_id: 42, current_location: { lat: 30.33, lon: -81.65, located_at: "2026-11-24T15:00:00.000Z" }, odometer: 455404.9 } },
        ],
      });
    }
    if (path === "/v1/inspection_reports") {
      return respond(200, {
        inspection_reports: [
          { inspection_report: { id: 5, vehicle_id: 42, inspection_type: "pre_trip", created_at: "2026-11-24T12:30:00.000Z", status: "satisfactory", defects: [] } },
        ],
      });
    }
    if (path === "/v1/ifta/trips") {
      return respond(200, { trips: [{ trip: { id: 1, vehicle_id: 42, jurisdictions: [{ jurisdiction: "FL", miles: 200.1 }] } }] });
    }
    if (path === "/v1/ifta/summary") return respond(200, { summaries: [] });
    return respond(200, {});
  };
}

describe("fetchMotiveBatch (injected fetch)", () => {
  const now = new Date("2026-11-24T15:00:00.000Z");

  test("batch maps every feed for the VIN-matched vehicle only, GET-only with the API key header", async () => {
    const calls: SeenCall[] = [];
    const r = await fetchMotiveBatch(fakeMotiveFetch(calls), "key-secret-123", { vin: VIN, now });
    expect(r.batch.map((b) => b.feed).sort()).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    expect(r.deviceName).toBe("8669");
    expect(r.skipped).toEqual([]);
    const clocks = r.batch.find((b) => b.feed === "hos_clocks")!.payload as { driveRemainH: number };
    expect(clocks.driveRemainH).toBe(10); // Motive's own availability, not a computation
    const stats = r.batch.find((b) => b.feed === "vehicle_stats")!.payload as { odometerMi: number };
    expect(stats.odometerMi).toBe(455404.9);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.apiKey).toBe("key-secret-123");
    }
    // The key never rides inside a batch payload.
    expect(JSON.stringify(r.batch)).not.toContain("key-secret-123");
  });

  test("with no availability row, clocks are computed from the driver's logs", async () => {
    const r = await fetchMotiveBatch(fakeMotiveFetch([], { noAvailability: true }), "key-secret-123", { vin: VIN, now });
    const clocks = r.batch.find((b) => b.feed === "hos_clocks")!.payload as { driveRemainH: number; windowRemainH: number; cycleRemainH: number; breakRemainH: number };
    // 10h off (reset), then 1h on-duty + 1h driving before `now`.
    expect(clocks.driveRemainH).toBe(10);
    expect(clocks.windowRemainH).toBe(12);
    expect(clocks.cycleRemainH).toBe(68);
    expect(clocks.breakRemainH).toBe(7);
  });

  test("a VIN that matches no vehicle fails plainly and stores nothing", async () => {
    await expect(fetchMotiveBatch(fakeMotiveFetch([]), "key-secret-123", { vin: "1XKNOTTHERE000000", now })).rejects.toThrow("No Motive vehicle carries VIN");
  });

  test("a refused key surfaces Motive's refusal", async () => {
    const err = await fetchMotiveBatch(fakeMotiveFetch([], { failAll: true }), "bad-key", { vin: VIN, now }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MotiveApiError);
    expect((err as MotiveApiError).status).toBe(401);
    expect((err as Error).message).toContain("Invalid API key");
  });
});
