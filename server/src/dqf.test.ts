// dqf.test.ts — PURE-RULE tests for the driver qualification
// file manager (Research Wave 2 item 6, migration 0133). No
// database: the qualification evaluator, the as-of semantics, the
// medical electronic-verification status + seam honesty, and the
// fleet expiry alerts (thresholds + dismissals).
//
// The standing guardrails pinned here:
//   - everything stands on recorded facts: no entries, no
//     qualification — "No qualification file on record";
//   - a paper medical certificate alone never reads "verified" —
//     only a recorded source answer does, and an unconfigured
//     seam never produces one;
//   - the evaluator is date-pure: entries recorded after the
//     as-of date do not exist for that date; voided entries never
//     count; a newer clear Clearinghouse query supersedes an
//     older prohibited one (and the reverse);
//   - dismissal silences one threshold for one date only.

import { describe, expect, test } from "bun:test";
import {
  activeDqfAlerts,
  addMonthsYmd,
  buildDqfAlertStatuses,
  dqBlockSummary,
  evaluateDqf,
  medicalVerificationStatus,
  medicalVerifierFromEnv,
  type DqfEntryLike,
} from "./dqf";

const AS_OF = "2026-11-15";

let nextId = 1;
function entry(partial: Partial<DqfEntryLike> & { kind: string; entryDate: string }): DqfEntryLike {
  return {
    id: nextId++,
    expiresOn: null,
    payload: {},
    recordedBy: "owner",
    recordedAt: "2026-11-01T00:00:00.000Z",
    voided: false,
    hasDoc: false,
    ...partial,
  };
}

/** A complete, current file as of AS_OF. */
function completeFile(): DqfEntryLike[] {
  nextId = 1;
  return [
    entry({ kind: "application", entryDate: "2026-01-05" }),
    entry({ kind: "cdl", entryDate: "2024-03-01", expiresOn: "2028-03-01", payload: { state: "AL", licenseClass: "A" } }),
    entry({ kind: "medical", entryDate: "2026-02-01", expiresOn: "2028-02-01", payload: { examinerName: "Dr. A", registryNumber: "12345" } }),
    entry({ kind: "road_test", entryDate: "2026-01-06" }),
    entry({ kind: "mvr_review", entryDate: "2026-06-01", payload: { outcome: "acceptable" } }),
    entry({ kind: "clearinghouse_query", entryDate: "2026-01-04", payload: { queryType: "pre_employment", result: "clear" } }),
    entry({ kind: "employment_history", entryDate: "2026-01-05", payload: { employer: "Prior Carrier LLC" } }),
    entry({ kind: "violation_record", entryDate: "2026-01-06", payload: { description: "No violations in the past year" } }),
  ];
}

describe("evaluateDqf — the complete file", () => {
  test("a complete current file qualifies, fingerprint clean", () => {
    const ev = evaluateDqf(completeFile(), AS_OF);
    expect(ev.qualified).toBe(true);
    expect(ev.reasons).toEqual([]);
    expect(ev.fingerprint).toBe("clean");
    expect(ev.checks.every((c) => c.status === "ok")).toBe(true);
  });

  test("no entries at all reads as NO FILE, one plain reason", () => {
    const ev = evaluateDqf([], AS_OF);
    expect(ev.qualified).toBe(false);
    expect(ev.reasons).toEqual([{ code: "no_file", detail: "No qualification file on record for this driver." }]);
    expect(dqBlockSummary(ev)).toContain("No qualification file on record");
  });

  test("a partial file names each missing item", () => {
    const ev = evaluateDqf([entry({ kind: "application", entryDate: "2026-01-05" })], AS_OF);
    const codes = ev.reasons.map((r) => r.code);
    expect(codes).toContain("missing_cdl");
    expect(codes).toContain("missing_medical");
    expect(codes).toContain("missing_road_test");
    expect(codes).toContain("missing_mvr");
    expect(codes).toContain("missing_clearinghouse");
    expect(codes).not.toContain("no_file");
  });
});

describe("evaluateDqf — expiries and reviews", () => {
  test("an expired CDL blocks with its date", () => {
    const file = completeFile().map((e) => (e.kind === "cdl" ? { ...e, expiresOn: "2026-11-14" } : e));
    const ev = evaluateDqf(file, AS_OF);
    expect(ev.qualified).toBe(false);
    expect(ev.reasons.map((r) => r.code)).toContain("cdl_expired");
    expect(dqBlockSummary(ev)).toContain("CDL expired on 2026-11-14.");
  });

  test("a CDL expiring ON the as-of date is still valid that day", () => {
    const file = completeFile().map((e) => (e.kind === "cdl" ? { ...e, expiresOn: AS_OF } : e));
    expect(evaluateDqf(file, AS_OF).qualified).toBe(true);
  });

  test("an expired medical certificate blocks", () => {
    const file = completeFile().map((e) => (e.kind === "medical" ? { ...e, expiresOn: "2026-01-01" } : e));
    const ev = evaluateDqf(file, AS_OF);
    expect(ev.reasons.map((r) => r.code)).toContain("medical_expired");
  });

  test("a CDL record with no expiry date cannot show validity", () => {
    const file = completeFile().map((e) => (e.kind === "cdl" ? { ...e, expiresOn: null } : e));
    const ev = evaluateDqf(file, AS_OF);
    expect(ev.reasons.map((r) => r.code)).toContain("missing_cdl");
  });

  test("an MVR review older than 12 months is overdue; exactly 12 months is due, not overdue", () => {
    const overdue = completeFile().map((e) => (e.kind === "mvr_review" ? { ...e, entryDate: "2025-11-14" } : e));
    expect(evaluateDqf(overdue, AS_OF).reasons.map((r) => r.code)).toContain("mvr_overdue");
    const dueToday = completeFile().map((e) => (e.kind === "mvr_review" ? { ...e, entryDate: "2025-11-15" } : e));
    expect(evaluateDqf(dueToday, AS_OF).qualified).toBe(true);
  });

  test("a fresh MVR review supersedes an old one", () => {
    const file = [
      ...completeFile(),
      entry({ kind: "mvr_review", entryDate: "2024-01-01", payload: { outcome: "acceptable" } }),
    ];
    expect(evaluateDqf(file, AS_OF).qualified).toBe(true);
  });
});

describe("evaluateDqf — Clearinghouse", () => {
  test("the latest query PROHIBITED blocks", () => {
    const file = completeFile().map((e) =>
      e.kind === "clearinghouse_query" ? { ...e, payload: { queryType: "annual", result: "prohibited" } } : e,
    );
    const ev = evaluateDqf(file, AS_OF);
    expect(ev.qualified).toBe(false);
    expect(ev.reasons.map((r) => r.code)).toContain("clearinghouse_prohibited");
  });

  test("a newer CLEAR query supersedes an older prohibited one — and the reverse", () => {
    const cleared = [
      ...completeFile().filter((e) => e.kind !== "clearinghouse_query"),
      entry({ kind: "clearinghouse_query", entryDate: "2025-06-01", payload: { result: "prohibited" } }),
      entry({ kind: "clearinghouse_query", entryDate: "2026-06-01", payload: { result: "clear" } }),
    ];
    expect(evaluateDqf(cleared, AS_OF).qualified).toBe(true);
    const relapsed = [
      ...completeFile().filter((e) => e.kind !== "clearinghouse_query"),
      entry({ kind: "clearinghouse_query", entryDate: "2025-06-01", payload: { result: "clear" } }),
      entry({ kind: "clearinghouse_query", entryDate: "2026-06-01", payload: { result: "prohibited" } }),
    ];
    expect(evaluateDqf(relapsed, AS_OF).qualified).toBe(false);
  });

  test("a no-record query result is not prohibited", () => {
    const file = completeFile().map((e) =>
      e.kind === "clearinghouse_query" ? { ...e, payload: { queryType: "pre_employment", result: "no_record" } } : e,
    );
    expect(evaluateDqf(file, AS_OF).qualified).toBe(true);
  });
});

describe("evaluateDqf — as-of purity", () => {
  test("entries dated after the as-of date do not exist for that date", () => {
    const file = completeFile();
    // Before the earliest entry (the 2024 CDL) there is no file at all.
    expect(evaluateDqf(file, "2023-06-01").reasons.map((r) => r.code)).toContain("no_file");
    // Mid-2025: the 2024 CDL stands, the 2026 items do not exist yet.
    const ev = evaluateDqf(file, "2025-06-01");
    expect(ev.checks.find((c) => c.key === "cdl")!.status).toBe("ok");
    expect(ev.reasons.map((r) => r.code)).toContain("missing_application");
    expect(ev.qualified).toBe(false);
  });

  test("a driver qualified on a past date reads qualified then, expired now", () => {
    const file = completeFile().map((e) => {
      if (e.kind === "cdl") return { ...e, expiresOn: "2026-06-01" };
      if (e.kind === "mvr_review") return { ...e, entryDate: "2026-01-10" };
      return e;
    });
    expect(evaluateDqf(file, "2026-03-01").qualified).toBe(true);
    expect(evaluateDqf(file, AS_OF).qualified).toBe(false);
  });

  test("voided entries never count", () => {
    const file = completeFile().map((e) => (e.kind === "medical" ? { ...e, voided: true } : e));
    expect(evaluateDqf(file, AS_OF).reasons.map((r) => r.code)).toContain("missing_medical");
  });
});

describe("medicalVerificationStatus + the seam", () => {
  test("a paper certificate alone reads ON FILE — never verified", () => {
    const status = medicalVerificationStatus(completeFile(), AS_OF, { seamConfigured: false });
    expect(status.state).toBe("on_file");
    expect(status.label).toContain("electronic verification not connected");
  });

  test("a recorded source answer of verified reads verified, with its source", () => {
    const file = [
      ...completeFile(),
      entry({
        kind: "medical_verification",
        entryDate: "2026-03-01",
        payload: { outcome: "verified", source: "National Registry" },
      }),
    ];
    const status = medicalVerificationStatus(file, AS_OF, { seamConfigured: true });
    expect(status.state).toBe("verified");
    expect(status.label).toContain("National Registry");
  });

  test("a check against an OLD certificate does not verify the new one", () => {
    const file = [
      ...completeFile(),
      entry({ kind: "medical", entryDate: "2024-01-01", expiresOn: "2026-01-01" }),
      entry({
        kind: "medical_verification",
        entryDate: "2024-06-01",
        payload: { outcome: "verified", source: "National Registry" },
      }),
    ];
    // Latest medical is the 2026-02-01 cert from completeFile; the
    // 2024 check predates it, so the current cert is unchecked.
    const status = medicalVerificationStatus(file, AS_OF, { seamConfigured: true });
    expect(status.state).toBe("on_file");
  });

  test("not_found and mismatch surface as their own states", () => {
    for (const [outcome, state] of [["not_found", "not_found"], ["mismatch", "mismatch"]] as const) {
      const file = [
        ...completeFile(),
        entry({ kind: "medical_verification", entryDate: "2026-03-01", payload: { outcome, source: "Registry" } }),
      ];
      expect(medicalVerificationStatus(file, AS_OF, { seamConfigured: true }).state).toBe(state);
    }
  });

  test("the seam is unconfigured without BOTH an env key and a transport", () => {
    expect(medicalVerifierFromEnv({})).toBeNull();
    expect(medicalVerifierFromEnv({ MEDICAL_VERIFY_API_KEY: "k" })).toBeNull();
    const transport = async () => ({ outcome: "verified" as const, source: "Registry", checkedAt: "2026-11-15T00:00:00.000Z" });
    const verifier = medicalVerifierFromEnv({ MEDICAL_VERIFY_API_KEY: "k" }, transport);
    expect(verifier).not.toBeNull();
    expect(verifier!.source).toBe("medical-registry-provider");
  });
});

describe("fleet alerts — thresholds + dismissals", () => {
  const NOW_MS = new Date("2026-11-15T12:00:00Z").getTime();

  test("a CDL 20 days out sits in the 30-day threshold; the MVR due date rides the same math", () => {
    const file = completeFile().map((e) => {
      if (e.kind === "cdl") return { ...e, expiresOn: "2026-12-05" };
      if (e.kind === "mvr_review") return { ...e, entryDate: "2026-01-20" }; // due 2027-01-20 — outside the window
      return e;
    });
    const statuses = buildDqfAlertStatuses(file, [], NOW_MS);
    const cdl = statuses.find((s) => s.itemKey === "cdl")!;
    expect(cdl.threshold).toBe(30);
    expect(cdl.dismissed).toBe(false);
    expect(activeDqfAlerts(statuses).map((s) => s.itemKey)).toContain("cdl");
    const mvr = statuses.find((s) => s.itemKey === "mvr_review")!;
    expect(mvr.expiresOn).toBe("2027-01-20");
    expect(mvr.threshold).toBeNull();
  });

  test("a dismissal silences its threshold for its date only; a new date re-arms", () => {
    const file = completeFile().map((e) => (e.kind === "cdl" ? { ...e, expiresOn: "2026-12-05" } : e));
    const dismissed = buildDqfAlertStatuses(file, [{ itemKey: "cdl", threshold: 30, expiresOn: "2026-12-05" }], NOW_MS);
    expect(dismissed.find((s) => s.itemKey === "cdl")!.dismissed).toBe(true);
    expect(activeDqfAlerts(dismissed).some((s) => s.itemKey === "cdl")).toBe(false);
    // Renewed card (new date): the old dismissal matches nothing.
    const renewed = file.map((e) => (e.kind === "cdl" ? { ...e, expiresOn: "2027-01-04" } : e));
    const rearmed = buildDqfAlertStatuses(renewed, [{ itemKey: "cdl", threshold: 30, expiresOn: "2026-12-05" }], NOW_MS);
    expect(rearmed.find((s) => s.itemKey === "cdl")!.dismissed).toBe(false);
  });

  test("an expired medical sits at threshold 0", () => {
    const file = completeFile().map((e) => (e.kind === "medical" ? { ...e, expiresOn: "2026-11-01" } : e));
    const med = buildDqfAlertStatuses(file, [], NOW_MS).find((s) => s.itemKey === "medical")!;
    expect(med.threshold).toBe(0);
    expect(med.daysLeft).toBeLessThan(0);
  });
});

describe("evaluateDqf — audit A6/A7 requirements (2026-11-15)", () => {
  test("a Clearinghouse query older than 12 months reads OVERDUE, not ok (382.701)", () => {
    const file = completeFile().map((e) =>
      e.kind === "clearinghouse_query" ? { ...e, entryDate: "2024-06-01" } : e,
    );
    const ev = evaluateDqf(file, AS_OF);
    expect(ev.qualified).toBe(false);
    expect(ev.reasons.map((r) => r.code)).toContain("clearinghouse_overdue");
    expect(ev.checks.find((c) => c.key === "clearinghouse")!.status).toBe("overdue");
  });

  test("a prohibited query still blocks as prohibited even when also stale", () => {
    const file = completeFile().map((e) =>
      e.kind === "clearinghouse_query" ? { ...e, entryDate: "2024-06-01", payload: { result: "prohibited" } } : e,
    );
    const ev = evaluateDqf(file, AS_OF);
    expect(ev.reasons.map((r) => r.code)).toContain("clearinghouse_prohibited");
    expect(ev.reasons.map((r) => r.code)).not.toContain("clearinghouse_overdue");
  });

  test("no employment-history inquiries on file blocks (391.23(c))", () => {
    const file = completeFile().filter((e) => e.kind !== "employment_history");
    const ev = evaluateDqf(file, AS_OF);
    expect(ev.qualified).toBe(false);
    expect(ev.reasons.map((r) => r.code)).toContain("missing_employment_history");
    expect(dqBlockSummary(ev)).toContain("employment-history");
  });

  test("no annual violations list blocks (391.27); a stale one reads overdue", () => {
    const missing = evaluateDqf(completeFile().filter((e) => e.kind !== "violation_record"), AS_OF);
    expect(missing.reasons.map((r) => r.code)).toContain("missing_violations");
    const stale = evaluateDqf(
      completeFile().map((e) => (e.kind === "violation_record" ? { ...e, entryDate: "2024-06-01" } : e)),
      AS_OF,
    );
    expect(stale.reasons.map((r) => r.code)).toContain("violations_overdue");
    expect(stale.checks.find((c) => c.key === "violations")!.status).toBe("overdue");
  });

  test("the alert cadence covers the annual query + violations list due dates", () => {
    const NOW_MS = new Date("2026-11-15T12:00:00Z").getTime();
    const statuses = buildDqfAlertStatuses(completeFile(), [], NOW_MS);
    const ch = statuses.find((s) => s.itemKey === "clearinghouse")!;
    // Query 2026-01-04 → annual due 2027-01-04, outside the 60-day window at Nov 2026.
    expect(ch.expiresOn).toBe("2027-01-04");
    const viol = statuses.find((s) => s.itemKey === "violations")!;
    expect(viol.expiresOn).toBe("2027-01-06");
    const stale = buildDqfAlertStatuses(
      completeFile().map((e) => (e.kind === "clearinghouse_query" ? { ...e, entryDate: "2025-10-01" } : e)),
      [],
      NOW_MS,
    ).find((s) => s.itemKey === "clearinghouse")!;
    expect(stale.threshold).toBe(0); // due 2026-10-01 — past due at NOW_MS
  });
});

describe("addMonthsYmd", () => {
  test("adds months and clamps to the target month's last day", () => {
    expect(addMonthsYmd("2025-11-15", 12)).toBe("2026-11-15");
    expect(addMonthsYmd("2024-01-31", 12)).toBe("2025-01-31");
    expect(addMonthsYmd("2024-02-29", 12)).toBe("2025-02-28");
  });
});
