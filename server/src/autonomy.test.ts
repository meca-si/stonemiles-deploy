// autonomy.test.ts — PURE-RULE tests for the autonomy core
// (Research Wave 2 item 1): milestone derivation from sealed chain
// facts, the confidence model, every exception kind, the ranking,
// and the guardrails — (a) no outward status without a sealed
// source, (b) freshness never upgraded, (c) no rate/money field in
// any outward shape, (d) sub-threshold confidence is an exception
// and never a milestone, (e) corrections supersede. The database
// half is covered by autonomyFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  chainStatusFromFacts,
  confidenceForSignal,
  deriveExceptions,
  deriveMilestones,
  detentionVisitsFromFacts,
  exceptionNotification,
  formatWaitMinutes,
  outwardTimeline,
  rankExceptions,
  statusSummary,
  CONFIDENCE_THRESHOLD,
  type ChainFact,
  type ExceptionInputs,
} from "./autonomy";

let seq = 0;
function fact(event: string, payload: Record<string, unknown> = {}, at = "2026-11-15T08:00:00.000Z"): ChainFact {
  seq += 1;
  return { id: seq, event, hash: `hash-${seq}`, at, payload };
}

const NOW = new Date("2026-11-15T12:00:00.000Z");

function exceptionInputs(over: Partial<ExceptionInputs> = {}): ExceptionInputs {
  return {
    loadId: 42,
    rowStatus: "booked",
    snapshotStatus: null,
    chain: chainStatusFromFacts([fact("load_saved")]),
    hasTrackShare: false,
    positionAt: null,
    dockApptAt: "2026-11-16T14:00:00.000Z",
    suppliedApptAt: null,
    detentionApptAt: null,
    appointmentCheckable: true,
    openDetention: null,
    paperwork: null,
    now: NOW,
    ...over,
  };
}

// ---- chain status -----------------------------------------------------------

describe("chainStatusFromFacts — the sealed record decides", () => {
  test("walks booked → picked_up → in_transit → delivered", () => {
    const facts = [
      fact("load_saved"),
      fact("pickup_sealed"),
      fact("load_status", { status: "in_transit" }),
      fact("pod_seal"),
    ];
    const s = chainStatusFromFacts(facts);
    expect(s.status).toBe("delivered");
    expect(s.delivered).toBe(true);
    expect(s.hasLoadSaved).toBe(true);
    expect(s.deleted).toBe(false);
  });

  test("a backward load_status never drags the derived status down", () => {
    const facts = [fact("load_saved"), fact("pickup_sealed"), fact("load_status", { status: "booked" })];
    expect(chainStatusFromFacts(facts).status).toBe("picked_up");
  });

  test("a load_status sealed after delivery flags the regression", () => {
    const facts = [fact("load_saved"), fact("delivery_confirmed"), fact("load_status", { status: "in_transit" })];
    const s = chainStatusFromFacts(facts);
    expect(s.delivered).toBe(true);
    expect(s.statusAfterDelivery).toBe(true);
  });

  test("empty chain = no status at all", () => {
    const s = chainStatusFromFacts([]);
    expect(s.status).toBeNull();
    expect(s.hasLoadSaved).toBe(false);
  });
});

// ---- milestones -------------------------------------------------------------

describe("deriveMilestones — sealed facts only (guardrails a + d)", () => {
  test("one milestone per status kind, from the first event that seals it", () => {
    const facts = [
      fact("load_saved", {}, "2026-11-15T08:00:00.000Z"),
      fact("pickup_sealed", {}, "2026-11-15T09:00:00.000Z"),
      fact("load_status", { status: "in_transit" }, "2026-11-15T09:30:00.000Z"),
      fact("load_status", { status: "in_transit" }, "2026-11-15T09:45:00.000Z"),
      fact("load_status", { status: "arriving" }, "2026-11-15T11:00:00.000Z"),
      fact("delivery_confirmed", {}, "2026-11-15T11:20:00.000Z"),
    ];
    const ms = deriveMilestones(facts);
    expect(ms.map((m) => m.kind)).toEqual(["booked", "picked_up", "in_transit", "arriving", "delivered"]);
    expect(ms.every((m) => m.confidence >= CONFIDENCE_THRESHOLD)).toBe(true);
    expect(ms[0]!.at).toBe("2026-11-15T08:00:00.000Z");
    expect(ms[0]!.evidence[0]!.kind).toBe("chain");
  });

  test("a detention departure becomes a time-only milestone — no money anywhere", () => {
    const facts = [
      fact("load_saved"),
      fact("detention_departure", { detentionId: 7, place: "Mobile, AL", waitMinutes: 205, billableMinutes: 85 }),
    ];
    const ms = deriveMilestones(facts);
    const det = ms.find((m) => m.kind === "detention");
    expect(det).toBeDefined();
    expect(det!.label).toContain("Mobile, AL");
    expect(det!.label).toContain("3 h 25 min");
    expect(det!.dedupeKey).toBe("detention:7");
    expect(JSON.stringify(ms)).not.toContain("85");
  });

  test("no chain facts → no milestones (nothing is invented)", () => {
    expect(deriveMilestones([])).toEqual([]);
  });

  test("the confidence model: chain = 1, row/snapshot claims = 0.5 (below the bar)", () => {
    expect(confidenceForSignal("chain")).toBe(1);
    expect(confidenceForSignal("row")).toBeLessThan(CONFIDENCE_THRESHOLD);
    expect(confidenceForSignal("snapshot")).toBeLessThan(CONFIDENCE_THRESHOLD);
  });
});

// ---- detention pairing --------------------------------------------------------

describe("detentionVisitsFromFacts", () => {
  test("arrival without departure is the open visit; the appointment rides along", () => {
    const facts = [
      fact("detention_arrival", { detentionId: 3, site: "delivery", place: "Dock 4", apptAt: "2026-11-15T10:00:00.000Z", graceMinutes: 120, at: "2026-11-15T09:00:00.000Z" }),
      fact("detention_arrival", { detentionId: 4, site: "pickup", place: "Yard", apptAt: null, graceMinutes: 60, at: "2026-11-14T09:00:00.000Z" }),
      fact("detention_departure", { detentionId: 4, at: "2026-11-14T10:00:00.000Z" }),
    ];
    const visits = detentionVisitsFromFacts(facts);
    const open = visits.filter((v) => v.open);
    expect(open.length).toBe(1);
    expect(open[0]!.detentionId).toBe(3);
    expect(open[0]!.apptAt).toBe("2026-11-15T10:00:00.000Z");
  });
});

// ---- exceptions ---------------------------------------------------------------

describe("deriveExceptions — every kind, from its own evidence", () => {
  test("missing_evidence: a live share with no sealed booking behind it", () => {
    const ex = deriveExceptions(exceptionInputs({ hasTrackShare: true, chain: chainStatusFromFacts([]), rowStatus: null }));
    expect(ex.map((e) => e.kind)).toContain("missing_evidence");
    expect(ex.find((e) => e.kind === "missing_evidence")!.severity).toBe(3);
  });

  test("conflicting_records: the sealed record is ahead of the load row", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("pickup_sealed")]);
    const ex = deriveExceptions(exceptionInputs({ chain, rowStatus: "booked", positionAt: "2026-11-15T11:55:00.000Z" }));
    expect(ex.map((e) => e.kind)).toEqual(["conflicting_records"]);
  });

  test("conflicting_records: a status sealed after delivery", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("delivery_confirmed"), fact("load_status", { status: "in_transit" })]);
    const ex = deriveExceptions(exceptionInputs({ chain, rowStatus: "picked_up" }));
    expect(ex.map((e) => e.kind)).toContain("conflicting_records");
  });

  test("low_confidence: the row claims ahead of the sealed record — and no milestone exists for it", () => {
    const chain = chainStatusFromFacts([fact("load_saved")]);
    const ex = deriveExceptions(exceptionInputs({ chain, rowStatus: "picked_up" }));
    expect(ex.map((e) => e.kind)).toEqual(["low_confidence"]);
    // Guardrail (d): the claimed status produced NO milestone.
    expect(deriveMilestones([fact("load_saved")]).map((m) => m.kind)).toEqual(["booked"]);
  });

  test("low_confidence: the driver's snapshot claims ahead of the sealed record", () => {
    const chain = chainStatusFromFacts([fact("load_saved")]);
    const ex = deriveExceptions(exceptionInputs({ chain, rowStatus: "booked", snapshotStatus: "picked_up" }));
    expect(ex.map((e) => e.kind)).toEqual(["low_confidence"]);
  });

  test("stale_location: on the road with a 2-hour-old fix — the age is printed, never upgraded", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("pickup_sealed")]);
    const ex = deriveExceptions(
      exceptionInputs({ chain, rowStatus: "picked_up", positionAt: "2026-11-15T10:00:00.000Z" }),
    );
    const stale = ex.find((e) => e.kind === "stale_location");
    expect(stale).toBeDefined();
    expect(stale!.detail).toContain("120 minutes old");
    expect(stale!.evidence[0]!.at).toBe("2026-11-15T10:00:00.000Z");
  });

  test("stale_location: no position at all while on the road", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("pickup_sealed")]);
    const ex = deriveExceptions(exceptionInputs({ chain, rowStatus: "picked_up", positionAt: null }));
    expect(ex.map((e) => e.kind)).toContain("stale_location");
  });

  test("a fresh position clears stale_location", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("pickup_sealed")]);
    const ex = deriveExceptions(
      exceptionInputs({ chain, rowStatus: "picked_up", positionAt: "2026-11-15T11:50:00.000Z" }),
    );
    expect(ex).toEqual([]);
  });

  test("detention_overdue: an open visit past its free time", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("pickup_sealed")]);
    const ex = deriveExceptions(
      exceptionInputs({
        chain,
        rowStatus: "picked_up",
        positionAt: "2026-11-15T11:55:00.000Z",
        openDetention: {
          detentionId: 9,
          site: "delivery",
          place: "Dock 4",
          arrivedAt: "2026-11-15T08:00:00.000Z",
          graceMinutes: 60,
          apptAt: "2026-11-15T08:00:00.000Z",
          open: true,
        },
      }),
    );
    expect(ex.map((e) => e.kind)).toEqual(["detention_overdue"]);
  });

  test("detention within its free time is not an exception", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("pickup_sealed")]);
    const ex = deriveExceptions(
      exceptionInputs({
        chain,
        rowStatus: "picked_up",
        positionAt: "2026-11-15T11:55:00.000Z",
        openDetention: {
          detentionId: 9,
          site: "delivery",
          place: "Dock 4",
          arrivedAt: "2026-11-15T11:30:00.000Z",
          graceMinutes: 120,
          apptAt: null,
          open: true,
        },
      }),
    );
    expect(ex).toEqual([]);
  });

  test("missing_appointment: nothing anywhere names one", () => {
    const ex = deriveExceptions(exceptionInputs({ dockApptAt: null }));
    expect(ex.map((e) => e.kind)).toEqual(["missing_appointment"]);
    expect(ex[0]!.severity).toBe(1);
  });

  test("an appointment from ANY source clears missing_appointment", () => {
    expect(deriveExceptions(exceptionInputs({ dockApptAt: null, suppliedApptAt: "2026-11-16T09:00:00.000Z" }))).toEqual([]);
    expect(deriveExceptions(exceptionInputs({ dockApptAt: null, detentionApptAt: "2026-11-16T09:00:00.000Z" }))).toEqual([]);
  });

  test("an uncheckable appointment never raises the exception (desk contexts)", () => {
    expect(deriveExceptions(exceptionInputs({ dockApptAt: null, appointmentCheckable: false }))).toEqual([]);
  });

  test("a delivered load raises nothing", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("pod_seal")]);
    const ex = deriveExceptions(exceptionInputs({ chain, rowStatus: "picked_up", dockApptAt: null, positionAt: null }));
    expect(ex).toEqual([]);
  });

  test("a deleted load raises nothing", () => {
    const chain = chainStatusFromFacts([fact("load_saved"), fact("load_deleted")]);
    const ex = deriveExceptions(exceptionInputs({ chain, hasTrackShare: true, dockApptAt: null }));
    expect(ex).toEqual([]);
  });
});

// ---- ranking / summaries / timeline -------------------------------------------

describe("rankExceptions — severity first, then the longest waiting", () => {
  test("orders 3s before 1s, oldest first within a severity", () => {
    const rows = [
      { id: 5, severity: 1, createdAt: "2026-11-15T08:00:00.000Z" },
      { id: 2, severity: 3, createdAt: "2026-11-15T09:00:00.000Z" },
      { id: 9, severity: 3, createdAt: "2026-11-15T07:00:00.000Z" },
      { id: 1, severity: 2, createdAt: "2026-11-15T06:00:00.000Z" },
    ];
    expect(rankExceptions(rows).map((r) => r.id)).toEqual([9, 2, 1, 5]);
  });
});

describe("outward shapes — the rate law (guardrail c)", () => {
  test("statusSummary joins label + lane and nothing else", () => {
    expect(statusSummary({ lane: "Mobile, AL → Fort Worth, TX", label: "Picked up — on the road" })).toBe(
      "Picked up — on the road — Mobile, AL → Fort Worth, TX",
    );
    expect(statusSummary({ lane: null, label: "Delivered" })).toBe("Delivered");
  });

  test("exception notification copy carries no money markers", () => {
    const n = exceptionNotification({ kind: "stale_location", lane: "Mobile, AL → Fort Worth, TX", loadId: 42 });
    expect(n.title).toContain("Load #42");
    expect(JSON.stringify(n)).not.toContain("$");
    expect(JSON.stringify(n)).not.toMatch(/rate/i);
  });
});

describe("outwardTimeline — corrections supersede (guardrail e)", () => {
  test("a superseded row never renders; its correction renders in its place, marked", () => {
    const rows = [
      { id: 1, kind: "booked", label: "Booked — waiting for pickup", summary: "s1", createdAt: "2026-11-15T08:00:00.000Z", supersededById: null, supersedesId: null },
      { id: 2, kind: "picked_up", label: "Picked up — on the road", summary: "s2", createdAt: "2026-11-15T09:00:00.000Z", supersededById: 3, supersedesId: null },
      { id: 3, kind: "correction", label: "Correction — an earlier update was withdrawn", summary: "s3", createdAt: "2026-11-15T10:00:00.000Z", supersededById: null, supersedesId: 2 },
    ];
    const tl = outwardTimeline(rows);
    expect(tl.map((t) => t.id)).toEqual([1, 3]);
    expect(tl[1]!.corrected).toBe(true);
    expect(tl[0]!.corrected).toBe(false);
  });
});

describe("formatWaitMinutes", () => {
  test("matches the detention proof format", () => {
    expect(formatWaitMinutes(45)).toBe("45 min");
    expect(formatWaitMinutes(120)).toBe("2 h");
    expect(formatWaitMinutes(205)).toBe("3 h 25 min");
  });
});
