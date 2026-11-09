import { describe, expect, test } from "bun:test";
import {
categoryForChainEntry,
classifyProofReference,
clockDifferences,
summarizeSettlementChecks,
verifyChainEntries,
type ChainEntryLike,
} from "./verifyAudit";

// The same SHA-256 the chain itself uses (appendChain in actions.ts:
// hash = sha256(`${prevHash}|${event}|${payload}`), genesis "GENESIS").
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Seed = { refKind: string; refId: number | null; event: string; payload: Record<string, unknown> };

/** Build a genuinely valid chain the way appendChain writes it. */
async function buildChain(seeds: Seed[]): Promise<ChainEntryLike[]> {
  const out: ChainEntryLike[] = [];
  let prev = "GENESIS";
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]!;
    const payload = JSON.stringify(s.payload);
    const hash = await sha256(`${prev}|${s.event}|${payload}`);
    out.push({
      id: i + 1,
      refKind: s.refKind,
      refId: s.refId,
      event: s.event,
      payload,
      prevHash: prev,
      hash,
      createdAt: new Date(Date.UTC(2026, 9, 20, 12, i)).toISOString(),
    });
    prev = hash;
  }
  return out;
}

const SEEDS: Seed[] = [
  { refKind: "trip", refId: 7, event: "trip_start", payload: { at: "x" } },
  { refKind: "trip", refId: 7, event: "trip_complete", payload: { miles: 412 } },
  { refKind: "load", refId: 9, event: "load_saved", payload: { rate: 2500 } },
  { refKind: "load", refId: 9, event: "pod_seal", payload: { sealGrade: "release_grade" } },
  { refKind: "load", refId: 9, event: "payment_packet_created", payload: { fingerprint: "f".repeat(64) } },
  { refKind: "driver", refId: null, event: "duty_change", payload: { state: "driving" } },
];

describe("verifyChainEntries", () => {
  test("a valid chain verifies intact, every record passes, categories attribute seals + packets", async () => {
    const entries = await buildChain(SEEDS);
    const v = await verifyChainEntries(entries, sha256);
    expect(v.intact).toBe(true);
    expect(v.checked).toBe(6);
    expect(v.brokenAtId).toBeNull();
    expect(v.brokenReason).toBeNull();
    expect(v.headHash).toBe(entries[entries.length - 1]!.hash);
    const byCat = Object.fromEntries(v.records.map((r) => [`${r.refKind}:${r.refId}:${r.category}`, r]));
    expect(byCat["trip:7:trips"]?.status).toBe("pass");
    expect(byCat["trip:7:trips"]?.entries).toBe(2);
    expect(byCat["load:9:loads"]?.status).toBe("pass");
    expect(byCat["load:9:podSeals"]?.status).toBe("pass");
    expect(byCat["load:9:paymentPackets"]?.status).toBe("pass");
    expect(v.categories.trips.records).toBe(1);
    expect(v.categories.podSeals.entries).toBe(1);
    expect(v.categories.paymentPackets.entries).toBe(1);
    expect(v.categories.other.records).toBe(1);
  });

  test("empty chain: intact, zero checked, genesis head — an honest empty state, not a failure", async () => {
    const v = await verifyChainEntries([], sha256);
    expect(v.intact).toBe(true);
    expect(v.checked).toBe(0);
    expect(v.records).toEqual([]);
    expect(v.headHash).toBe("GENESIS");
  });

  test("a tampered payload breaks the chain at that entry (hash_mismatch) and fails its record + everything after", async () => {
    const entries = await buildChain(SEEDS);
    const tampered = entries.map((e) =>
      e.id === 3 ? { ...e, payload: JSON.stringify({ rate: 9999 }) } : e,
    );
    const v = await verifyChainEntries(tampered, sha256);
    expect(v.intact).toBe(false);
    expect(v.brokenAtId).toBe(3);
    expect(v.brokenReason).toBe("hash_mismatch");
    // Head stops at the last entry that verified (entry 2).
    expect(v.headHash).toBe(entries[1]!.hash);
    const load = v.records.find((r) => r.refKind === "load" && r.category === "loads");
    expect(load?.status).toBe("fail");
    // The trip sealed BEFORE the break still passes on its own entries.
    const trip = v.records.find((r) => r.refKind === "trip");
    expect(trip?.status).toBe("pass");
    // The POD seal sealed AFTER the break cannot be proven — it fails too.
    const seal = v.records.find((r) => r.category === "podSeals");
    expect(seal?.status).toBe("fail");
    expect(seal?.failedEntries).toBe(1);
  });

  test("a removed entry breaks the chain at the next entry (prev_mismatch)", async () => {
    const entries = await buildChain(SEEDS);
    const removed = entries.filter((e) => e.id !== 2);
    const v = await verifyChainEntries(removed, sha256);
    expect(v.intact).toBe(false);
    expect(v.brokenAtId).toBe(3);
    expect(v.brokenReason).toBe("prev_mismatch");
    // The removal is caught at the chain level by entry 3's broken
    // link — the record HOLDING entry 3 fails. The shortened trip
    // record itself only shows the entries that remain (1 of its 2),
    // which is exactly why the chain verdict, not any single record,
    // is the integrity answer.
    const load = v.records.find((r) => r.refKind === "load" && r.category === "loads");
    expect(load?.status).toBe("fail");
    const trip = v.records.find((r) => r.refKind === "trip");
    expect(trip?.entries).toBe(1);
  });

  test("a forged stored hash is caught even when the payload is untouched", async () => {
    const entries = await buildChain(SEEDS);
    const forged = entries.map((e) => (e.id === 5 ? { ...e, hash: "0".repeat(64) } : e));
    const v = await verifyChainEntries(forged, sha256);
    expect(v.intact).toBe(false);
    expect(v.brokenAtId).toBe(5);
    expect(v.brokenReason).toBe("hash_mismatch");
  });
});

describe("categoryForChainEntry", () => {
  test("seal + packet events win over the load ref kind; ref kind decides the rest", () => {
    expect(categoryForChainEntry({ refKind: "load", event: "pod_seal" })).toBe("podSeals");
    expect(categoryForChainEntry({ refKind: "load", event: "pod_seal_grade" })).toBe("podSeals");
    expect(categoryForChainEntry({ refKind: "load", event: "payment_packet_created" })).toBe("paymentPackets");
    expect(categoryForChainEntry({ refKind: "load", event: "dispatch_fee_invoiced" })).toBe("paymentPackets");
    expect(categoryForChainEntry({ refKind: "load", event: "load_saved" })).toBe("loads");
    expect(categoryForChainEntry({ refKind: "trip", event: "trip_complete" })).toBe("trips");
    expect(categoryForChainEntry({ refKind: "driver", event: "duty_change" })).toBe("other");
  });
});

describe("classifyProofReference", () => {
  test("packet refs and full fingerprints classify; everything else is unknown (never a match)", () => {
    expect(classifyProofReference("PKT-1042-9f3ac21b")).toEqual({ kind: "packet_ref", value: "PKT-1042-9F3AC21B" });
    expect(classifyProofReference(" pkt-7-abcdef01 ")).toEqual({ kind: "packet_ref", value: "PKT-7-ABCDEF01" });
    const fp = "a".repeat(64);
    expect(classifyProofReference(fp)).toEqual({ kind: "fingerprint", value: fp });
    expect(classifyProofReference("A".repeat(64)).kind).toBe("fingerprint");
    expect(classifyProofReference("PKT-1042")).toEqual({ kind: "unknown", value: "PKT-1042" });
    expect(classifyProofReference("a".repeat(63)).kind).toBe("unknown");
    expect(classifyProofReference("a".repeat(65)).kind).toBe("unknown");
    expect(classifyProofReference("hello")).toEqual({ kind: "unknown", value: "hello" });
    expect(classifyProofReference("")).toEqual({ kind: "unknown", value: "" });
  });
});

describe("summarizeSettlementChecks", () => {
  test("totals come only from saved checks; shortfall counts shortfall kinds at positive amounts", () => {
    const s = summarizeSettlementChecks([
      { hasCheck: false, flags: [] },
      {
        hasCheck: true,
        flags: [
          { kind: "underpaid", amount: 250 },
          { kind: "missing_load", amount: 1800 },
          { kind: "overpaid", amount: -75 },
          { kind: "net_mismatch", amount: 40 },
        ],
      },
      {
        hasCheck: true,
        flags: [
          { kind: "detention_short", amount: 50.5 },
          { kind: "missing_detention", amount: 100 },
        ],
      },
    ]);
    expect(s.imported).toBe(3);
    expect(s.audited).toBe(2);
    expect(s.discrepancies).toBe(6);
    // 250 + 1800 + 50.50 + 100 — the overpayment and the document's
    // own net mismatch are discrepancies, NOT shortfall.
    expect(s.shortfall).toBe(2200.5);
  });

  test("no settlements: all zeros", () => {
    expect(summarizeSettlementChecks([])).toEqual({ imported: 0, audited: 0, discrepancies: 0, shortfall: 0 });
  });

  test("a checked settlement with no flags audits clean", () => {
    const s = summarizeSettlementChecks([{ hasCheck: true, flags: [] }]);
    expect(s).toEqual({ imported: 1, audited: 1, discrepancies: 0, shortfall: 0 });
  });
});

describe("clockDifferences", () => {
  test("every clock compared, difference = app − ELD, nothing resolved", () => {
    const d = clockDifferences(
      { driveRemainH: 6.5, windowRemainH: 9, cycleRemainH: 40, breakRemainH: 3 },
      { driveRemainH: 6.25, windowRemainH: 9, cycleRemainH: 41.5, breakRemainH: 2.75 },
    );
    expect(d).toHaveLength(4);
    expect(d[0]).toMatchObject({ key: "drive", appH: 6.5, eldH: 6.25, differenceH: 0.25 });
    expect(d[1]?.differenceH).toBe(0);
    expect(d[2]?.differenceH).toBe(-1.5);
    expect(d[3]?.differenceH).toBe(0.25);
  });
});
