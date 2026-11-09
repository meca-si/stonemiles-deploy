import { describe, expect, test } from "bun:test";
import {
  brokerDeskAccess,
  brokerQueueNote,
  deskTotals,
  ownerDeskAccess,
  ownerDeskScopeLabel,
  ownerRosterSnapshot,
} from "./desks";

/**
 * BROKER DESK + OWNER DESK pure rules (round 5, x 2026-11-02):
 * who each desk opens for, the exclusivity interaction with My
 * Desk, the queue notes, the totals, and the roster snapshot.
 * These run the EXACT functions getBrokerDesk / getOwnerDesk /
 * getLoadBoard rely on.
 */

describe("broker desk eligibility — the poster door", () => {
  test("a poster holder with no dispatcher standing gets the desk", () => {
    expect(brokerDeskAccess({ hasPosterAccount: true, dispatcherMode: "none" })).toEqual({
      eligible: true,
      reason: "poster",
    });
  });

  test("no poster account and no dispatcher standing — the plain explainer", () => {
    expect(brokerDeskAccess({ hasPosterAccount: false, dispatcherMode: "none" })).toEqual({
      eligible: false,
      reason: "no_poster",
    });
  });
});

describe("broker desk exclusivity — dispatcher posters live on My Desk", () => {
  test("a solo dispatcher poster does NOT get a Broker Desk", () => {
    expect(brokerDeskAccess({ hasPosterAccount: true, dispatcherMode: "solo" })).toEqual({
      eligible: false,
      reason: "dispatcher",
    });
  });

  test("a dispatch-company poster does NOT get a Broker Desk", () => {
    expect(brokerDeskAccess({ hasPosterAccount: true, dispatcherMode: "company" })).toEqual({
      eligible: false,
      reason: "dispatcher",
    });
  });

  test("dispatcher standing routes to My Desk even with no poster account", () => {
    expect(brokerDeskAccess({ hasPosterAccount: false, dispatcherMode: "solo" }).reason).toBe("dispatcher");
    expect(brokerDeskAccess({ hasPosterAccount: false, dispatcherMode: "company" }).reason).toBe("dispatcher");
  });
});

describe("broker queue notes — whose queue and why", () => {
  test("a sent load names the desk whose queue it sits in", () => {
    expect(
      brokerQueueNote({ posterStatus: "sent", reviewNote: null, reviewedBy: null, queueCompanyName: "RUGGS LOGISTICS" }),
    ).toContain("RUGGS LOGISTICS's review queue");
  });

  test("a sent load with no queue company reads as the platform queue", () => {
    expect(brokerQueueNote({ posterStatus: "sent", reviewNote: null, reviewedBy: null, queueCompanyName: null })).toContain(
      "platform review queue",
    );
  });

  test("a returned load carries the desk's note", () => {
    expect(
      brokerQueueNote({ posterStatus: "returned", reviewNote: "Rate con is blurry", reviewedBy: "desk", queueCompanyName: "X" }),
    ).toContain("Rate con is blurry");
  });

  test("a released load names who released it; a draft has no queue note", () => {
    expect(
      brokerQueueNote({ posterStatus: "released", reviewNote: null, reviewedBy: "driver", queueCompanyName: "X" }),
    ).toContain("Released to the Open Board by driver");
    expect(brokerQueueNote({ posterStatus: "draft", reviewNote: null, reviewedBy: null, queueCompanyName: "X" })).toBeNull();
  });
});

describe("desk totals — posted / sealed / gross moved", () => {
  test("gross counts ONLY sealed loads", () => {
    expect(
      deskTotals([
        { state: "delivered", gross: 3000 },
        { state: "delivered", gross: 1250.5 },
        { state: "live", gross: 9000 },
        { state: "draft", gross: null },
      ]),
    ).toEqual({ posted: 4, sealed: 2, grossMoved: 4250.5 });
  });

  test("an empty pipeline totals to zero", () => {
    expect(deskTotals([])).toEqual({ posted: 0, sealed: 0, grossMoved: 0 });
  });

  test("a sealed load with no rate counts as sealed, adds no gross", () => {
    expect(deskTotals([{ state: "delivered", gross: null }])).toEqual({ posted: 1, sealed: 1, grossMoved: 0 });
  });
});

describe("owner desk eligibility — fleet owners only", () => {
  test("an owner seat in a fleet company opens the desk", () => {
    expect(ownerDeskAccess({ seats: [{ companyKind: "fleet", role: "owner" }], ownedKinds: [] })).toBe(true);
  });

  test("owning a fleet company outright opens the desk", () => {
    expect(ownerDeskAccess({ seats: [], ownedKinds: ["fleet"] })).toBe(true);
  });

  test("a dispatch company's owner is NOT an Owner Desk door — their roof is the Dispatch Desk", () => {
    expect(ownerDeskAccess({ seats: [{ companyKind: "dispatch", role: "owner" }], ownedKinds: ["dispatch"] })).toBe(false);
  });

  test("a dispatch seat or driver seat in a fleet company is not ownership", () => {
    expect(ownerDeskAccess({ seats: [{ companyKind: "fleet", role: "dispatch" }], ownedKinds: [] })).toBe(false);
    expect(ownerDeskAccess({ seats: [{ companyKind: "fleet", role: "driver" }], ownedKinds: [] })).toBe(false);
  });

  test("a fleet owner who also owns a dispatch company still gets the Owner Desk (coexistence)", () => {
    expect(
      ownerDeskAccess({
        seats: [
          { companyKind: "dispatch", role: "owner" },
          { companyKind: "fleet", role: "owner" },
        ],
        ownedKinds: ["dispatch", "fleet"],
      }),
    ).toBe(true);
  });

  test("no company standing at all — no desk", () => {
    expect(ownerDeskAccess({ seats: [], ownedKinds: [] })).toBe(false);
  });
});

describe("owner desk scope labels", () => {
  test("open rows read Open Board; everything else is the company board", () => {
    expect(ownerDeskScopeLabel("open")).toBe("Open Board");
    expect(ownerDeskScopeLabel("fleet")).toBe("Company board");
    expect(ownerDeskScopeLabel(null)).toBe("Company board");
  });
});

describe("owner roster snapshot — seats against the locked allowances", () => {
  test("counts roles and seats the way the billing basis does (owner counts as a driver seat)", () => {
    const snap = ownerRosterSnapshot([
      { role: "owner" },
      { role: "driver" },
      { role: "driver" },
      { role: "dispatch" },
    ]);
    expect(snap.members).toBe(4);
    expect(snap.drivers).toBe(2);
    expect(snap.dispatchSeats).toBe(1);
    expect(snap.driverSeatsUsed).toBe(3);
    expect(snap.includedDriverSeats).toBe(3);
    expect(snap.driverSeatsAvailable).toBe(0);
    expect(snap.dispatchSeatsUsed).toBe(1);
    expect(snap.includedDispatchSeats).toBe(1);
    expect(snap.dispatchSeatsAvailable).toBe(0);
  });

  test("available never goes negative past the allowance", () => {
    const snap = ownerRosterSnapshot([
      { role: "owner" },
      { role: "driver" },
      { role: "driver" },
      { role: "driver" },
      { role: "driver" },
      { role: "dispatch" },
      { role: "dispatch" },
    ]);
    expect(snap.driverSeatsUsed).toBe(5);
    expect(snap.driverSeatsAvailable).toBe(0);
    expect(snap.dispatchSeatsAvailable).toBe(0);
  });

  test("an owner alone has room to grow", () => {
    const snap = ownerRosterSnapshot([{ role: "owner" }]);
    expect(snap.driverSeatsAvailable).toBe(2);
    expect(snap.dispatchSeatsAvailable).toBe(1);
  });
});
