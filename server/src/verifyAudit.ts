/**
 * Verify & Audit layer — pure logic (no I/O, unit-tested).
 *
 * STONEMILES' proof spine already exists: the append-only SHA-256 hash
 * chain (chain_log), POD seals, the payment-packet + invoice/receivable
 * registries, ELD reconciliation, and the Settlement Checker. This
 * module holds the pure computations the Verify & Audit hub runs on
 * top of that spine:
 *
 *   - verifyChainEntries: re-walk a set of chain entries in order,
 *     recomputing every hash exactly the way appendChain wrote it
 *     (sha256(prevHash | event | payload), genesis "GENESIS"), and
 *     report the whole-chain verdict PLUS per-record pass/fail detail
 *     grouped by category (trips / loads / POD seals / payment
 *     packets / other). The existing `verifyChain` action answers the
 *     same whole-chain question with the same semantics (first broken
 *     link wins); this walker additionally attributes the failure —
 *     and everything sealed after it — to the records it belongs to.
 *   - classifyProofReference: what a user-typed proof reference IS
 *     (a PKT-… packet reference or a 64-hex fingerprint) — anything
 *     else is not a proof reference and must never be "matched".
 *   - summarizeSettlementChecks: totals over SAVED Settlement Checker
 *     reports (the checker's own stored flags) — settlements audited,
 *     discrepancies found, and the total shortfall. Shortfall counts
 *     only the flag kinds that mean money the sealed records say is
 *     missing (underpaid / missing_load / missing_detention /
 *     detention_short) at their positive amounts; an overpayment or
 *     an internal document mismatch is a discrepancy, not a shortfall.
 *   - clockDifferences: app planning clocks vs the connected ELD's
 *     clocks, side by side. Differences are reported, never resolved.
 *
 * Honesty rules: an empty chain verifies as intact with 0 checked —
 * "nothing sealed yet" is a state, not a pass to brag about, and the
 * surfaces say so. Nothing here invents a match, a reading, or a
 * resolution.
 */

export type ChainEntryLike = {
  id: number;
  refKind: string;
  refId: number | null;
  event: string;
  payload: string;
  prevHash: string;
  hash: string;
  /** ISO timestamp the entry was sealed at. */
  createdAt: string;
};

export type ChainCategory = "trips" | "loads" | "podSeals" | "paymentPackets" | "other";

export const CHAIN_CATEGORIES: ChainCategory[] = ["trips", "loads", "podSeals", "paymentPackets", "other"];

/** Which audit category a chain entry belongs to. Seal and packet
 *  events ride on load refs, so the event decides first; the ref kind
 *  decides the rest. */
export function categoryForChainEntry(e: { refKind: string; event: string }): ChainCategory {
  if (e.event === "pod_seal" || e.event.startsWith("pod_seal_")) return "podSeals";
  if (
    e.event.startsWith("payment_packet") ||
    e.event === "invoice_fingerprint_duplicate" ||
    e.event === "packet_document_duplicate" ||
    e.event.startsWith("dispatch_fee_")
  ) {
    return "paymentPackets";
  }
  if (e.refKind === "trip") return "trips";
  if (e.refKind === "load") return "loads";
  return "other";
}

export type EntryVerdictReason = "ok" | "hash_mismatch" | "prev_mismatch" | "after_break";

export type RecordVerification = {
  /** Stable group key: "<refKind>:<refId ?? '-'>:<category>". */
  key: string;
  refKind: string;
  refId: number | null;
  category: ChainCategory;
  entries: number;
  failedEntries: number;
  /** pass only when EVERY entry of the record verified in place. */
  status: "pass" | "fail";
  firstSealedAt: string;
  lastSealedAt: string;
  /** Hash of the record's last entry in chain order. */
  headHash: string;
};

export type CategoryTotals = { records: number; entries: number; failedRecords: number };

export type ChainVerification = {
  intact: boolean;
  /** Total entries walked. */
  checked: number;
  /** Chain id of the first entry that failed, or null when intact. */
  brokenAtId: number | null;
  brokenReason: "hash_mismatch" | "prev_mismatch" | null;
  /** The last hash that verified — the running head at the break, or
   *  the chain head (genesis when the chain is empty). */
  headHash: string;
  records: RecordVerification[];
  categories: Record<ChainCategory, CategoryTotals>;
};

/**
 * Re-walk chain entries (already in chain order, ascending id) and
 * verify each link: the stored prevHash must equal the running head,
 * and sha256(prevHash | event | payload) must equal the stored hash —
 * the exact construction appendChain writes. The first failure ends
 * positive verification: that entry fails with its reason and every
 * later entry fails as "after_break" (its linkage can no longer be
 * proven either way), which fails every record those entries touch.
 */
export async function verifyChainEntries(
  entries: ChainEntryLike[],
  hashFn: (text: string) => Promise<string>,
  genesis = "GENESIS",
): Promise<ChainVerification> {
  let prev = genesis;
  let brokenAtId: number | null = null;
  let brokenReason: ChainVerification["brokenReason"] = null;
  const verdicts = new Map<number, EntryVerdictReason>();

  for (const e of entries) {
    if (brokenAtId != null) {
      verdicts.set(e.id, "after_break");
      continue;
    }
    if (e.prevHash !== prev) {
      brokenAtId = e.id;
      brokenReason = "prev_mismatch";
      verdicts.set(e.id, "prev_mismatch");
      continue;
    }
    const expected = await hashFn(`${e.prevHash}|${e.event}|${e.payload}`);
    if (expected !== e.hash) {
      brokenAtId = e.id;
      brokenReason = "hash_mismatch";
      verdicts.set(e.id, "hash_mismatch");
      continue;
    }
    verdicts.set(e.id, "ok");
    prev = e.hash;
  }

  const byKey = new Map<string, RecordVerification>();
  for (const e of entries) {
    const category = categoryForChainEntry(e);
    const key = `${e.refKind}:${e.refId ?? "-"}:${category}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = {
        key,
        refKind: e.refKind,
        refId: e.refId,
        category,
        entries: 0,
        failedEntries: 0,
        status: "pass",
        firstSealedAt: e.createdAt,
        lastSealedAt: e.createdAt,
        headHash: e.hash,
      };
      byKey.set(key, rec);
    }
    rec.entries += 1;
    if (verdicts.get(e.id) !== "ok") rec.failedEntries += 1;
    if (e.createdAt < rec.firstSealedAt) rec.firstSealedAt = e.createdAt;
    if (e.createdAt >= rec.lastSealedAt) {
      rec.lastSealedAt = e.createdAt;
      rec.headHash = e.hash;
    }
  }
  const records = [...byKey.values()];
  for (const r of records) r.status = r.failedEntries > 0 ? "fail" : "pass";

  const categories = Object.fromEntries(
    CHAIN_CATEGORIES.map((c) => [c, { records: 0, entries: 0, failedRecords: 0 }]),
  ) as Record<ChainCategory, CategoryTotals>;
  for (const r of records) {
    const t = categories[r.category];
    t.records += 1;
    t.entries += r.entries;
    if (r.status === "fail") t.failedRecords += 1;
  }

  return {
    intact: brokenAtId == null,
    checked: entries.length,
    brokenAtId,
    brokenReason,
    headHash: prev,
    records,
    categories,
  };
}

// ---- Proof reference classification ----------------------------------------

export type ProofReferenceKind = "packet_ref" | "fingerprint" | "unknown";

const PACKET_REF_RE = /^PKT-\d+-[0-9a-fA-F]{8}$/i;
const FINGERPRINT_RE = /^[0-9a-fA-F]{64}$/;

/** What a typed proof reference is. A packet reference is the human
 *  ref off a Payment Packet (PKT-<loadId>-<first 8 of its
 *  fingerprint>); a fingerprint is a full 64-char hex SHA-256 (a
 *  record hash, packet/invoice fingerprint, or receivable key).
 *  Anything else is "unknown" — the lookup must answer not-found,
 *  never stretch a near-miss into a match. */
export function classifyProofReference(raw: string): { kind: ProofReferenceKind; value: string } {
  const value = raw.trim();
  if (PACKET_REF_RE.test(value)) return { kind: "packet_ref", value: value.toUpperCase() };
  if (FINGERPRINT_RE.test(value)) return { kind: "fingerprint", value: value.toLowerCase() };
  return { kind: "unknown", value };
}

// ---- Settlement audit summary ----------------------------------------------

/** Flag kinds that mean money the driver's sealed records say is
 *  missing — the shortfall kinds. "overpaid" (a line ABOVE the sealed
 *  rate) and "net_mismatch" (the settlement document disagreeing with
 *  itself) are discrepancies, not shortfalls. */
export const SHORTFALL_FLAG_KINDS = ["underpaid", "missing_load", "missing_detention", "detention_short"] as const;

export type SettlementCheckLike = {
  /** True when a Settlement Checker report is saved for this row. */
  hasCheck: boolean;
  flags: { kind: string; amount: number | null }[];
};

export type SettlementAuditSummary = {
  imported: number;
  audited: number;
  discrepancies: number;
  shortfall: number;
};

/** Totals over the SAVED checker reports — pure aggregation of the
 *  checker's own stored flags; the checking logic itself is never
 *  re-run or re-implemented here. */
export function summarizeSettlementChecks(rows: SettlementCheckLike[]): SettlementAuditSummary {
  let audited = 0;
  let discrepancies = 0;
  let shortfall = 0;
  const shortfallKinds = new Set<string>(SHORTFALL_FLAG_KINDS);
  for (const r of rows) {
    if (!r.hasCheck) continue;
    audited += 1;
    discrepancies += r.flags.length;
    for (const f of r.flags) {
      if (shortfallKinds.has(f.kind) && f.amount != null && f.amount > 0) {
        shortfall += f.amount;
      }
    }
  }
  return {
    imported: rows.length,
    audited,
    discrepancies,
    shortfall: Math.round(shortfall * 100) / 100,
  };
}

// ---- HOS clock differences ---------------------------------------------------

export type ClockSet = {
  driveRemainH: number;
  windowRemainH: number;
  cycleRemainH: number;
  breakRemainH: number;
};

export type ClockDifference = {
  key: "drive" | "window" | "cycle" | "break";
  label: string;
  appH: number;
  eldH: number;
  /** app − ELD, hours, 2dp. Positive = the app shows MORE time left. */
  differenceH: number;
};

const CLOCK_LABELS: { key: ClockDifference["key"]; field: keyof ClockSet; label: string }[] = [
  { key: "drive", field: "driveRemainH", label: "Drive remaining (11h)" },
  { key: "window", field: "windowRemainH", label: "Shift remaining (14h)" },
  { key: "cycle", field: "cycleRemainH", label: "Cycle remaining (70h / 8-day)" },
  { key: "break", field: "breakRemainH", label: "Before 30-min break" },
];

/** App planning clocks beside the ELD's clocks — every clock, every
 *  difference, nothing resolved or hidden. */
export function clockDifferences(app: ClockSet, eld: ClockSet): ClockDifference[] {
  return CLOCK_LABELS.map(({ key, field, label }) => ({
    key,
    label,
    appH: app[field],
    eldH: eld[field],
    differenceH: Math.round((app[field] - eld[field]) * 100) / 100,
  }));
}
