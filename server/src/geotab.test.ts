// geotab.test.ts — unit tests for the Geotab provider fetch layer's
// pure parts: credential/account parsing, the duty-log → feed
// mappers, the HOS clocks computation, and the MyGeotab RPC flow
// against an INJECTED fetch (no network is ever touched).

import { describe, expect, test } from "bun:test";
import {
  computeGeotabHosClocks,
  fetchGeotabBatch,
  geotabAuthenticate,
  mapGeotabDutyLogs,
  mapGeotabDvirs,
  mapGeotabIdentity,
  mapGeotabIfta,
  mapGeotabVehicleStats,
  normalizeGeotabServer,
  parseGeotabAccount,
  type GeotabCredentials,
} from "./geotab";

describe("normalizeGeotabServer / parseGeotabAccount", () => {
  test("defaults and strips scheme", () => {
    expect(normalizeGeotabServer("")).toBe("my.geotab.com");
    expect(normalizeGeotabServer("https://my123.geotab.com/")).toBe("my123.geotab.com");
    expect(normalizeGeotabServer(null)).toBe("my.geotab.com");
  });

  test("parses a stored account bundle, rejects junk", () => {
    expect(parseGeotabAccount(JSON.stringify({ server: "my.geotab.com", database: "gast", username: "eric" }))).toEqual({
      server: "my.geotab.com",
      database: "gast",
      username: "eric",
    });
    expect(parseGeotabAccount(JSON.stringify({ database: "gast" }))).toBeNull();
    expect(parseGeotabAccount("not json")).toBeNull();
    expect(parseGeotabAccount(null)).toBeNull();
  });
});

describe("mapGeotabDutyLogs", () => {
  test("maps statuses, sorts, drops unreadable rows", () => {
    const out = mapGeotabDutyLogs([
      { status: "D", dateTime: "2026-11-24T14:00:00.000Z" },
      { status: "OFF", dateTime: "2026-11-24T04:00:00.000Z", location: { latitude: 30.33, longitude: -81.65 } },
      { status: "??", dateTime: "2026-11-24T05:00:00.000Z" },
      { status: "ON", dateTime: "not-a-date" },
      { status: "SB", dateTime: "2026-11-24T06:00:00.000Z" },
    ]);
    expect(out.logs.map((l) => l.state)).toEqual(["off_duty", "sleeper", "driving"]);
    expect(out.logs[0]!.location).toBe("30.33000, -81.65000");
    expect(out.logs[2]!.location).toBeUndefined();
  });
});

describe("computeGeotabHosClocks", () => {
  const now = new Date("2026-11-24T20:00:00.000Z");
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  test("null with no logs — never zero-filled", () => {
    expect(computeGeotabHosClocks([], now)).toBeNull();
  });

  test("fresh driver after a 10h reset: full clocks minus time worked", () => {
    // 12h off, then 2h on-duty + 3h driving, still driving at `now`.
    const clocks = computeGeotabHosClocks(
      [
        { state: "off_duty", at: at(17) },
        { state: "on_duty", at: at(5) },
        { state: "driving", at: at(3) },
      ],
      now,
    );
    expect(clocks).not.toBeNull();
    expect(clocks!.driveRemainH).toBe(8); // 11 − 3
    expect(clocks!.windowRemainH).toBe(9); // 14 − 5
    expect(clocks!.breakRemainH).toBe(5); // 8 − 3 driving since break
    expect(clocks!.cycleRemainH).toBe(65); // 70 − 5 on-duty in 8 days
  });

  test("a 34h restart restores the cycle", () => {
    const clocks = computeGeotabHosClocks(
      [
        { state: "on_duty", at: at(60) },
        { state: "off_duty", at: at(50) }, // 40h off — a restart
        { state: "driving", at: at(10) },
        { state: "on_duty", at: at(2) },
      ],
      now,
    );
    expect(clocks).not.toBeNull();
    // Only the 10h since the restart counts toward the cycle.
    expect(clocks!.cycleRemainH).toBe(60);
  });
});

describe("mapGeotabVehicleStats", () => {
  test("meters → miles, GPS carried, zero-GPS dropped", () => {
    expect(mapGeotabVehicleStats({ odometer: 160934.4, latitude: 30.3, longitude: -81.6 }, 1200)).toEqual({
      odometerMi: 100,
      lat: 30.3,
      lon: -81.6,
      engineHours: 1200,
    });
    expect(mapGeotabVehicleStats({ odometer: 0, latitude: 0, longitude: 0 }, null)).toBeNull();
    expect(mapGeotabVehicleStats(null, null)).toBeNull();
  });
});

describe("mapGeotabDvirs", () => {
  test("defects and unsafe flag map to the contract vocabulary", () => {
    const out = mapGeotabDvirs(
      [
        { id: "b1", dateTime: "2026-11-24T12:00:00.000Z", isSafeToOperate: true, defects: [] },
        {
          id: "b2",
          dateTime: "2026-11-24T13:00:00.000Z",
          isSafeToOperate: false,
          defects: [{ defect: { name: "Brakes" }, comment: "pedal soft" }],
        },
      ],
      "Unit 8669",
    );
    expect(out.dvirs[0]!.status).toBe("no_defects");
    expect(out.dvirs[1]!.status).toBe("defects_found");
    expect(out.dvirs[1]!.defects).toEqual([{ item: "Brakes", note: "pedal soft", critical: true }]);
    expect(out.dvirs[1]!.vehicle).toBe("Unit 8669");
  });
});

describe("mapGeotabIfta", () => {
  test("groups jurisdiction miles from km distances and odometer pairs", () => {
    const out = mapGeotabIfta([
      { stateProvince: "FL", distanceKm: 160.9344 },
      { stateProvince: "FL", distanceKm: 160.9344 },
      { state: "GA", odometerStart: 0, odometerStop: 160934.4 },
      { note: "no jurisdiction here", distanceKm: 50 },
    ]);
    expect(out).toEqual({
      states: [
        { state: "FL", miles: 200 },
        { state: "GA", miles: 100 },
      ],
    });
    expect(mapGeotabIfta([{ note: "nothing usable" }])).toBeNull();
  });
});

describe("mapGeotabIdentity", () => {
  test("carries only fields Geotab actually has", () => {
    const out = mapGeotabIdentity(
      { id: "b7", firstName: "Eric", lastName: "Ruggs", licenseNumber: "R200-XXX", licenseProvince: "AL" },
      { name: "8669", vehicleIdentificationNumber: "1XKYDP9X8PJ238669", licensePlate: "AL-123" },
      455404.9,
    );
    expect(out.driver).toEqual({ name: "Eric Ruggs", driverId: "b7", cdlNumber: "R200-XXX", cdlState: "AL" });
    expect(out.truck).toEqual({ unitNumber: "8669", vin: "1XKYDP9X8PJ238669", plate: "AL-123", odometerMi: 455404.9 });
  });
});

// --- RPC flow against an injected fetch -------------------------------

type RpcCall = { method: string; params: Record<string, unknown> };

function fakeGeotabFetch(calls: RpcCall[], opts: { failAuth?: boolean } = {}) {
  return async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as RpcCall;
    calls.push(body);
    const respond = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
    if (body.method === "Authenticate") {
      if (opts.failAuth) {
        return respond({ error: { name: "InvalidUserException", message: "Incorrect user name or password." } });
      }
      return respond({
        result: {
          credentials: { database: "gastdb", sessionId: "sess-1", userName: "eric" },
          path: "my123.geotab.com/",
        },
      });
    }
    const typeName = body.params.typeName as string;
    if (typeName === "Device") {
      return respond({
        result: [
          { id: "dev-other", name: "1111", vehicleIdentificationNumber: "1XKOTHER00000000" },
          { id: "dev-8669", name: "8669", vehicleIdentificationNumber: "1XKYDP9X8PJ238669", licensePlate: "AL-9" },
        ],
      });
    }
    if (typeName === "DutyStatusLog") {
      return respond({
        result: [
          { status: "OFF", dateTime: "2026-11-24T02:00:00.000Z", driver: { id: "u1" } },
          { status: "ON", dateTime: "2026-11-24T13:00:00.000Z", driver: { id: "u1" } },
          { status: "D", dateTime: "2026-11-24T14:00:00.000Z", driver: { id: "u1" } },
        ],
      });
    }
    if (typeName === "DeviceStatusInfo") {
      return respond({ result: [{ odometer: 732_000_000, latitude: 30.33, longitude: -81.65 }] });
    }
    if (typeName === "DVIRLog") {
      return respond({ result: [{ id: "dv1", dateTime: "2026-11-24T12:30:00.000Z", isSafeToOperate: true, defects: [] }] });
    }
    if (typeName === "FuelTaxDetail") {
      return respond({ result: [{ stateProvince: "FL", distanceKm: 322 }] });
    }
    if (typeName === "StatusData") return respond({ result: [{ data: 6291 }] });
    if (typeName === "User") return respond({ result: [{ id: "u1", name: "Eric Ruggs", licenseNumber: "R200", licenseProvince: "AL" }] });
    return respond({ result: [] });
  };
}

const CREDS: GeotabCredentials = { server: "my.geotab.com", database: "gastdb", username: "eric", password: "secret-password" };

describe("geotabAuthenticate + fetchGeotabBatch (injected fetch)", () => {
  test("auth follows the session path and surfaces Geotab's refusal", async () => {
    const calls: RpcCall[] = [];
    const session = await geotabAuthenticate(fakeGeotabFetch(calls) as never, CREDS);
    expect(session.server).toBe("my123.geotab.com");
    expect(session.credentials.sessionId).toBe("sess-1");
    await expect(geotabAuthenticate(fakeGeotabFetch([], { failAuth: true }) as never, CREDS)).rejects.toThrow("InvalidUserException");
  });

  test("batch maps every feed for the VIN-matched device only", async () => {
    const calls: RpcCall[] = [];
    const now = new Date("2026-11-24T15:00:00.000Z");
    const r = await fetchGeotabBatch(fakeGeotabFetch(calls) as never, CREDS, { vin: "1XKYDP9X8PJ238669", now });
    const feeds = r.batch.map((b) => b.feed).sort();
    expect(feeds).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    expect(r.deviceName).toBe("8669");
    const stats = r.batch.find((b) => b.feed === "vehicle_stats")!.payload as { odometerMi: number; engineHours: number };
    expect(stats.odometerMi).toBeGreaterThan(454000);
    expect(stats.engineHours).toBe(6291);
    // Every Get after Authenticate carried the session credentials.
    const gets = calls.filter((c) => c.method === "Get");
    expect(gets.length).toBeGreaterThan(0);
    for (const g of gets) {
      expect((g.params.credentials as { sessionId: string }).sessionId).toBe("sess-1");
    }
  });

  test("a VIN that matches no device fails plainly and stores nothing", async () => {
    await expect(
      fetchGeotabBatch(fakeGeotabFetch([]) as never, CREDS, { vin: "1XKNOTTHERE000000", now: new Date() }),
    ).rejects.toThrow("no device in the");
  });
});
