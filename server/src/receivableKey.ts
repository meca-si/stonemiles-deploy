/**
 * Receivable key (Instant Pay Phase 0 — double-financing guard, fix).
 *
 * The load-scoped invoice fingerprint (see `invoiceFingerprintFor` in
 * actions.ts) embeds `load:<id>` in its canonical string, so every
 * distinct load mints a distinct invoice fingerprint — BY DESIGN: it is
 * the packet's per-load invoice identity, and staging registrations
 * already exist against it. But that makes the registry's cross-load
 * duplicate flag structurally unreachable through normal load creation:
 * the same receivable presented under two load records produces two
 * different invoice fingerprints, and the registry can never see the
 * collision. That collision is the registry's entire Phase 2 purpose.
 *
 * The receivable key is the second fingerprint that closes the gap. It
 * is computed ONLY from the receivable's own facts — no load id, no
 * load-scoped data anywhere in it:
 *
 *   - the rate-con document fingerprint (loads.doc_sha256);
 *   - the broker identity: MC number preferred when present, else the
 *     normalized company, else the normalized name (normalization:
 *     trim, collapse internal whitespace, uppercase);
 *   - the invoice amount (rate + additional charges, the same
 *     computation the invoice fingerprint uses).
 *
 * Two loads presenting the same rate-con document, from the same
 * broker, for the same amount produce the SAME receivable key no
 * matter how many load records wrap them — so the registry can flag
 * the second presentation as a duplicate receivable (the same invoice
 * financed twice). Pure functions: no I/O, unit-tested. The key itself
 * is the SHA-256 of the canonical string, hashed by the caller with
 * the same sha256 helper the invoice fingerprint uses.
 */

export const RECEIVABLE_KEY_VERSION = "stonemiles-receivable-v1";

/** Which broker fact carried the identity in the key. */
export type BrokerIdentitySource = "mc" | "company" | "name" | "none";

/** Normalize a free-text broker fact: trim, collapse internal
 *  whitespace runs to a single space, uppercase. */
export function normalizeBrokerText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * The broker identity that goes into the receivable key. The MC number
 * is the strongest identity (a regulated, unique carrier/broker
 * authority number), so it wins whenever present; otherwise the
 * normalized company, otherwise the normalized contact name. An all
 * empty identity normalizes to "" with source "none" — the key still
 * computes (rate-con + amount carry it), it just leans on those facts.
 */
export function brokerIdentityFor(input: {
  brokerMc?: string | null;
  brokerCompany?: string | null;
  brokerName?: string | null;
}): { identity: string; source: BrokerIdentitySource } {
  const mc = normalizeBrokerText(input.brokerMc);
  if (mc) return { identity: mc, source: "mc" };
  const company = normalizeBrokerText(input.brokerCompany);
  if (company) return { identity: company, source: "company" };
  const name = normalizeBrokerText(input.brokerName);
  if (name) return { identity: name, source: "name" };
  return { identity: "", source: "none" };
}

/** The facts a receivable key is built from — and nothing else. */
export interface ReceivableFacts {
  /** Rate-con document fingerprint (loads.doc_sha256). */
  rateConSha256: string | null;
  brokerMc?: string | null;
  brokerCompany?: string | null;
  brokerName?: string | null;
  /** Invoice amount (rate + additional charges); null when no rate. */
  amount: number | null;
}

/**
 * The canonical string for a receivable — versioned, one fact per
 * line, exactly the format the key hashes. Kept separate from the hash
 * so tests (and audits) can see precisely which facts a key binds.
 */
export function receivableCanonicalString(facts: ReceivableFacts): string {
  const broker = brokerIdentityFor(facts);
  return [
    RECEIVABLE_KEY_VERSION,
    `ratecon:${facts.rateConSha256 ?? ""}`,
    `broker:${broker.source}:${broker.identity}`,
    `amount:${facts.amount != null ? facts.amount.toFixed(2) : ""}`,
  ].join("\n");
}

/** Which of the receivable's facts two presentations share — carried
 *  on the duplicate chain event so a reviewer sees WHY it flagged. */
export function matchedReceivableFacts(
  a: ReceivableFacts,
  b: ReceivableFacts,
): { rateCon: boolean; broker: boolean; amount: boolean } {
  return {
    rateCon: (a.rateConSha256 ?? "") === (b.rateConSha256 ?? ""),
    broker: brokerIdentityFor(a).identity === brokerIdentityFor(b).identity,
    amount:
      (a.amount != null ? a.amount.toFixed(2) : "") ===
      (b.amount != null ? b.amount.toFixed(2) : ""),
  };
}
