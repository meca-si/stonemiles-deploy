import { describe, expect, test } from "bun:test";
import {
  COMPANY_KIND_CHOICES,
  DISPATCHER_FEE_MAX_PCT,
  DISPATCHER_FEE_OVER_CAP_ERROR,
  DISPATCH_DRIVER_GATE_DRIVER_ERROR,
  DISPATCH_DRIVER_GATE_OWNER_ERROR,
  DISPATCH_PUBLIC_POST_REVIEW_QUEUE_ERROR,
  canOwnClientFleets,
  canWorkDispatchDesk,
  clientFleetStampForJoin,
  companyKindLabel,
  dispatchCreationGate,
  dispatchDriverGate,
  effectiveDispatcherFeePct,
  formatDispatcherFeePct,
  normalizeCompanyKind,
  platformQueueCompanyId,
  publicBoardPathFor,
  validateClientFleet,
  validateDispatcherFeePct,
} from "./dispatchCompany";

/**
 * DISPATCH-COMPANY ACCOUNT TYPE (2026-11-02, migration 0087). These
 * tests run the EXACT pure rules the actions layer runs: kind
 * normalization off the companies row, the client-fleet seat gates,
 * client-fleet validation, the join-code client stamp (the wall
 * check), and the public-board path split by kind.
 */

describe("company kind", () => {
  test("only the exact stored value 'dispatch' is a dispatch company", () => {
    expect(normalizeCompanyKind("dispatch")).toBe("dispatch");
    expect(normalizeCompanyKind("fleet")).toBe("fleet");
    expect(normalizeCompanyKind(null)).toBe("fleet");
    expect(normalizeCompanyKind(undefined)).toBe("fleet");
    expect(normalizeCompanyKind("")).toBe("fleet");
    expect(normalizeCompanyKind("DISPATCH")).toBe("fleet");
  });

  test("creation offers exactly the two plain choices", () => {
    expect(COMPANY_KIND_CHOICES.map((c) => c.kind)).toEqual(["fleet", "dispatch"]);
    expect(COMPANY_KIND_CHOICES.map((c) => c.title)).toEqual([
      "I run trucks",
      "I dispatch for others",
    ]);
  });

  test("kind labels are plain", () => {
    expect(companyKindLabel("dispatch")).toBe("Dispatch company");
    expect(companyKindLabel("fleet")).toBe("Fleet");
  });
});

describe("client fleet seat gates", () => {
  test("only the dispatch company's owner owns the client book", () => {
    expect(canOwnClientFleets("dispatch", "owner")).toBe(true);
    expect(canOwnClientFleets("dispatch", "dispatch")).toBe(false);
    expect(canOwnClientFleets("dispatch", "driver")).toBe(false);
    expect(canOwnClientFleets("fleet", "owner")).toBe(false);
    expect(canOwnClientFleets("dispatch", null)).toBe(false);
  });

  test("owner and dispatch seats work the desk; nobody else does", () => {
    expect(canWorkDispatchDesk("dispatch", "owner")).toBe(true);
    expect(canWorkDispatchDesk("dispatch", "dispatch")).toBe(true);
    expect(canWorkDispatchDesk("dispatch", "driver")).toBe(false);
    expect(canWorkDispatchDesk("fleet", "owner")).toBe(false);
    expect(canWorkDispatchDesk("fleet", "dispatch")).toBe(false);
    expect(canWorkDispatchDesk("dispatch", null)).toBe(false);
  });
});

describe("client fleet validation", () => {
  test("a name alone is a valid lightweight record", () => {
    const r = validateClientFleet({ name: "  Peacock Pavers  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.name).toBe("Peacock Pavers");
      expect(r.fields.contactName).toBeNull();
      expect(r.fields.contactEmail).toBeNull();
      expect(r.fields.mcNumber).toBeNull();
      expect(r.fields.usdotNumber).toBeNull();
    }
  });

  test("a blank name is refused", () => {
    const r = validateClientFleet({ name: "   " });
    expect(r.ok).toBe(false);
  });

  test("optional fields trim and keep values; blanks become null", () => {
    const r = validateClientFleet({
      name: "Granted Enterprise",
      contactName: " Carrie ",
      contactEmail: " grantedentllc@gmail.com ",
      contactPhone: " ",
      mcNumber: "MC 93982488",
      usdotNumber: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.contactName).toBe("Carrie");
      expect(r.fields.contactEmail).toBe("grantedentllc@gmail.com");
      expect(r.fields.contactPhone).toBeNull();
      expect(r.fields.mcNumber).toBe("MC 93982488");
      expect(r.fields.usdotNumber).toBeNull();
    }
  });

  test("a malformed contact email is refused, not stored", () => {
    const r = validateClientFleet({ name: "Client", contactEmail: "not-an-address" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("email");
  });
});

describe("join-code client stamping — the wall", () => {
  const base = { companyKind: "dispatch" as const, joiningCompanyId: 7 };

  test("a code naming its own company's client stamps the driver to it", () => {
    expect(
      clientFleetStampForJoin({ ...base, codeClientFleetId: 3, clientFleetCompanyId: 7 }),
    ).toBe(3);
  });

  test("a code naming ANOTHER company's client stamps nothing", () => {
    expect(
      clientFleetStampForJoin({ ...base, codeClientFleetId: 3, clientFleetCompanyId: 9 }),
    ).toBeNull();
  });

  test("a code with no client stamps nothing (company-direct join)", () => {
    expect(
      clientFleetStampForJoin({ ...base, codeClientFleetId: null, clientFleetCompanyId: null }),
    ).toBeNull();
  });

  test("a deleted client (no row) stamps nothing", () => {
    expect(
      clientFleetStampForJoin({ ...base, codeClientFleetId: 3, clientFleetCompanyId: null }),
    ).toBeNull();
  });

  test("fleet companies never stamp, even with ids present", () => {
    expect(
      clientFleetStampForJoin({
        companyKind: "fleet",
        codeClientFleetId: 3,
        clientFleetCompanyId: 7,
        joiningCompanyId: 7,
      }),
    ).toBeNull();
  });
});

describe("public board path by kind", () => {
  test("fleets push overflow directly; dispatch companies use the review queue", () => {
    expect(publicBoardPathFor("fleet")).toBe("fleet_overflow");
    expect(publicBoardPathFor("dispatch")).toBe("review_queue");
  });

  test("the dispatch refusal names the review-queue door", () => {
    expect(DISPATCH_PUBLIC_POST_REVIEW_QUEUE_ERROR).toContain("review queue");
    expect(DISPATCH_PUBLIC_POST_REVIEW_QUEUE_ERROR).toContain("Broker Portal");
  });
});

describe("dispatch creation — a plain profile (round 2)", () => {
  test("any solo account can create a dispatch company — no plan right involved", () => {
    // The gate takes no plan/standing input at all: creation is a
    // profile act, and the recorded plan never moves at creation.
    expect(dispatchCreationGate({ membershipRole: null })).toEqual({ allowed: true, error: null });
  });

  test("a member of any company can never create another", () => {
    for (const role of ["owner", "dispatch", "driver"]) {
      const g = dispatchCreationGate({ membershipRole: role });
      expect(g.allowed).toBe(false);
      expect(g.error).toContain("already belong to a company");
    }
  });
});

describe("dispatch driver gate — first own driver needs Fleet Owner active (round 2)", () => {
  test("a profile-level dispatch company refuses driver joins", () => {
    expect(dispatchDriverGate({ companyKind: "dispatch", activated: false })).toEqual({ allowed: false });
  });

  test("an activated dispatch company admits drivers", () => {
    expect(dispatchDriverGate({ companyKind: "dispatch", activated: true })).toEqual({ allowed: true });
  });

  test("fleets are never driver-gated (born on the plan)", () => {
    expect(dispatchDriverGate({ companyKind: "fleet", activated: false })).toEqual({ allowed: true });
    expect(dispatchDriverGate({ companyKind: "fleet", activated: true })).toEqual({ allowed: true });
  });

  test("the gate messages are plain and name the door", () => {
    expect(DISPATCH_DRIVER_GATE_OWNER_ERROR).toContain("Fleet Owner plan");
    expect(DISPATCH_DRIVER_GATE_OWNER_ERROR).toContain("plain profile");
    expect(DISPATCH_DRIVER_GATE_DRIVER_ERROR).toContain("has NOT been used");
    expect(DISPATCH_DRIVER_GATE_DRIVER_ERROR).toContain("Fleet Owner");
  });
});

describe("dispatcher fee — settable, capped at 20 (round 2, x's correction)", () => {
  test("the cap is 20", () => {
    expect(DISPATCHER_FEE_MAX_PCT).toBe(20);
  });

  test("valid percents pass — integers, decimals, the cap itself, zero", () => {
    expect(validateDispatcherFeePct(10)).toEqual({ ok: true, pct: 10 });
    expect(validateDispatcherFeePct(7.5)).toEqual({ ok: true, pct: 7.5 });
    expect(validateDispatcherFeePct(20)).toEqual({ ok: true, pct: 20 });
    expect(validateDispatcherFeePct(0)).toEqual({ ok: true, pct: 0 });
    expect(validateDispatcherFeePct("12.25")).toEqual({ ok: true, pct: 12.25 });
  });

  test("over the cap is refused with the plain cap message — 30 included", () => {
    for (const over of [20.01, 21, 25, 30, 45, 100, "50"]) {
      const r = validateDispatcherFeePct(over);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(DISPATCHER_FEE_OVER_CAP_ERROR);
    }
    expect(DISPATCHER_FEE_OVER_CAP_ERROR).toContain("20%");
  });

  test("blank / null clears the setting (unset = 0%)", () => {
    expect(validateDispatcherFeePct(null)).toEqual({ ok: true, pct: null });
    expect(validateDispatcherFeePct(undefined)).toEqual({ ok: true, pct: null });
    expect(validateDispatcherFeePct("")).toEqual({ ok: true, pct: null });
    expect(validateDispatcherFeePct("   ")).toEqual({ ok: true, pct: null });
  });

  test("negatives and non-numbers are refused plainly", () => {
    expect(validateDispatcherFeePct(-1).ok).toBe(false);
    expect(validateDispatcherFeePct("ten").ok).toBe(false);
    expect(validateDispatcherFeePct(Number.NaN).ok).toBe(false);
  });

  test("stored precision is 2 decimals", () => {
    expect(validateDispatcherFeePct(7.555)).toEqual({ ok: true, pct: 7.56 });
  });

  test("effective fee: the poster's own override wins, else the company's, else none", () => {
    expect(effectiveDispatcherFeePct({ posterFeePct: 12, companyFeePct: 10 })).toBe(12);
    expect(effectiveDispatcherFeePct({ posterFeePct: null, companyFeePct: 10 })).toBe(10);
    expect(effectiveDispatcherFeePct({ posterFeePct: undefined, companyFeePct: 10 })).toBe(10);
    expect(effectiveDispatcherFeePct({ posterFeePct: 0, companyFeePct: 10 })).toBe(0);
    expect(effectiveDispatcherFeePct({ posterFeePct: null, companyFeePct: null })).toBeNull();
  });

  test("fee display has no float noise", () => {
    expect(formatDispatcherFeePct(10)).toBe("10%");
    expect(formatDispatcherFeePct(7.5)).toBe("7.5%");
    expect(formatDispatcherFeePct(12.25)).toBe("12.25%");
    expect(formatDispatcherFeePct(0)).toBe("0%");
    expect(formatDispatcherFeePct(20)).toBe("20%");
  });
});

describe("platform review queue routing — no self-review (round 2 correction)", () => {
  const book = [
    { id: 1, kind: "fleet" }, // the platform operator's desk company
    { id: 2, kind: "dispatch" },
    { id: 3, kind: "dispatch" },
    { id: 4, kind: "fleet" },
  ];

  test("a dispatch company's queue is the platform's fleet company, never its own", () => {
    expect(platformQueueCompanyId({ companies: book, dispatchCompanyId: 2 })).toBe(1);
    expect(platformQueueCompanyId({ companies: book, dispatchCompanyId: 3 })).toBe(1);
  });

  test("the earliest fleet company wins when several exist", () => {
    expect(platformQueueCompanyId({ companies: [...book].reverse(), dispatchCompanyId: 2 })).toBe(1);
  });

  test("no fleet company in the book → null (caller falls back, sealed honestly)", () => {
    expect(
      platformQueueCompanyId({ companies: [{ id: 2, kind: "dispatch" }, { id: 3, kind: "dispatch" }], dispatchCompanyId: 2 }),
    ).toBeNull();
    expect(platformQueueCompanyId({ companies: [], dispatchCompanyId: 2 })).toBeNull();
  });

  test("legacy rows with no kind read as fleet (the pre-0087 default)", () => {
    expect(
      platformQueueCompanyId({ companies: [{ id: 5, kind: "" }, { id: 2, kind: "dispatch" }], dispatchCompanyId: 2 }),
    ).toBe(5);
  });
});
