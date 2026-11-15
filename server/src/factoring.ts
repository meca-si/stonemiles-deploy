// factoring.ts — instant pay / factoring plumbing + accounts
// receivable (Research Wave 2 item 7). Pure logic + the partner
// seam; the actions in actions.ts wire these to the DB and the
// chain.
//
// MONEY RAILS STAY OFF (x's standing rule): this module moves NO
// money and makes NO payout. It builds the submission PACKAGE
// (the invoice + its confirmed POD, referenced through the
// Library document doors), tracks the submission's state on the
// invoice, and — only when a factoring partner is actually
// configured — hands the package to that partner through the
// seam. With no partner configured the state stops honestly at
// "packaged": nothing is sent, nothing is called "submitted",
// and the panel says why. No fee figure exists anywhere in this
// lane: no partner terms are on file, and inventing a fee would
// be a fabricated number on a money surface.
//
// AR: the aging rollup is a pure function of the driver's OWN
// invoice rows (issued / due / paid dates + amounts — their own
// records, shown on their own Money tab). Buckets are days PAST
// DUE, the standard aging ladder; drafts are not receivables and
// never enter the buckets.

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Factoring state on the invoice
// ---------------------------------------------------------------------------

export type FactorStatus = "none" | "packaged" | "submitted" | "advanced" | "settled";

export const FACTOR_STATUS_LABELS: Record<FactorStatus, string> = {
  none: "Not packaged",
  packaged: "Packaged — ready to send",
  submitted: "Submitted to the factor",
  advanced: "Advance received from the factor",
  settled: "Settled — the factor collected from the broker",
};

export function factorStatusLabel(status: string): string {
  return FACTOR_STATUS_LABELS[status as FactorStatus] ?? status;
}

/** The ladder the panel draws, in order. "none" is the absence of
 *  a package, not a rung. */
export const FACTOR_LADDER: FactorStatus[] = ["packaged", "submitted", "advanced", "settled"];

// ---------------------------------------------------------------------------
// Eligibility — what instant pay takes, checked from records
// ---------------------------------------------------------------------------

export interface FactoringCheck {
  key: "delivered" | "pod_confirmed" | "issued";
  label: string;
  ok: boolean;
}

/**
 * An invoice is factorable when the load is delivered and sealed,
 * the POD paperwork is CONFIRMED (the paperwork-to-pay
 * confirmation — an unconfirmed read is provisional and never
 * goes to a factor), and the invoice itself is ISSUED (a draft
 * isn't a bill yet; a paid invoice has nothing left to factor).
 * Every check is returned so the panel can show exactly which
 * one is missing instead of a bare no.
 */
export function factoringEligibility(input: {
  invoiceStatus: string; // draft | issued | paid
  podSealed: boolean;
  podConfirmed: boolean;
}): { eligible: boolean; checks: FactoringCheck[] } {
  const checks: FactoringCheck[] = [
    { key: "delivered", label: "Load delivered and POD sealed", ok: input.podSealed },
    { key: "pod_confirmed", label: "POD paperwork confirmed", ok: input.podConfirmed },
    {
      key: "issued",
      label:
        input.invoiceStatus === "paid"
          ? "Invoice issued (already paid — nothing left to factor)"
          : "Invoice issued",
      ok: input.invoiceStatus === "issued",
    },
  ];
  return { eligible: checks.every((c) => c.ok), checks };
}

// ---------------------------------------------------------------------------
// The submission package — assembled through the Library doors
// ---------------------------------------------------------------------------

export interface FactorPackage {
  /** Library ref of the branded invoice document (`invoice:<id>`). */
  invoiceRef: string;
  /** Library ref of the signed POD document (`pod:<loadId>`). */
  podRef: string;
  invoiceId: number;
  invoiceNumber: string;
  loadId: number;
  billToName: string;
  lane: string;
  /** The invoice's own amount — the factor is the one party who
   *  must see it: they are buying THIS bill. It never rides a
   *  board, share, or track payload (the rate law). */
  amount: number;
  issuedAt: string | null;
  dueAt: string | null;
  /** The paperwork confirmation the package stands on. */
  podConfirmedBy: string | null;
  podConfirmedAt: string | null;
  assembledAt: string;
}

// ---------------------------------------------------------------------------
// Accounts receivable — aging over the driver's own invoices
// ---------------------------------------------------------------------------

export interface ArInvoiceLike {
  amount: number;
  status: string; // draft | issued | paid
  dueAtMs: number | null;
  factorStatus: string; // none | packaged | submitted | advanced | settled
}

export type ArBucketKey = "current" | "d30" | "d60" | "d90" | "d90plus";

export interface ArBucket {
  key: ArBucketKey;
  label: string;
  count: number;
  total: number;
}

export interface ArSummary {
  buckets: ArBucket[];
  /** Issued and unpaid, not yet with a factor — the aging ladder. */
  outstandingCount: number;
  outstandingTotal: number;
  /** Issued, unpaid, and with the factor (submitted / advanced):
   *  the money story now runs through the factor, so these sit
   *  OUTSIDE the aging ladder rather than double-counting in it. */
  factoredCount: number;
  factoredTotal: number;
  /** Packaged for factoring but not yet sent — still the
   *  driver's receivable; counted in the ladder AND named here. */
  packagedCount: number;
  paidCount: number;
  paidTotal: number;
  /** Of the paid total, how much closed through factoring. */
  settledFactoredCount: number;
  draftCount: number;
}

const BUCKET_DEFS: { key: ArBucketKey; label: string }[] = [
  { key: "current", label: "Current — not yet due" },
  { key: "d30", label: "1–30 days past due" },
  { key: "d60", label: "31–60 days past due" },
  { key: "d90", label: "61–90 days past due" },
  { key: "d90plus", label: "90+ days past due" },
];

/** Days past due for one invoice at `nowMs` (0 when not yet due
 *  or no due date is on file — never negative, never guessed). */
export function arDaysPastDue(inv: { dueAtMs: number | null }, nowMs: number): number {
  if (inv.dueAtMs == null || !Number.isFinite(inv.dueAtMs)) return 0;
  const days = Math.floor((nowMs - inv.dueAtMs) / 86_400_000);
  return days > 0 ? days : 0;
}

export function arBucketKeyFor(daysPastDue: number): ArBucketKey {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d30";
  if (daysPastDue <= 60) return "d60";
  if (daysPastDue <= 90) return "d90";
  return "d90plus";
}

/** Roll the driver's own invoice rows up into the AR view.
 *  Totals are the driver's own billed amounts on their own
 *  records — the one surface where they belong. */
export function buildArSummary(invoices: readonly ArInvoiceLike[], nowMs: number): ArSummary {
  const byKey = new Map<ArBucketKey, { count: number; total: number }>(
    BUCKET_DEFS.map((b) => [b.key, { count: 0, total: 0 }]),
  );
  let outstandingCount = 0;
  let outstandingTotal = 0;
  let factoredCount = 0;
  let factoredTotal = 0;
  let packagedCount = 0;
  let paidCount = 0;
  let paidTotal = 0;
  let settledFactoredCount = 0;
  let draftCount = 0;
  for (const inv of invoices) {
    if (!Number.isFinite(inv.amount)) continue;
    if (inv.status === "draft") {
      draftCount++;
      continue;
    }
    if (inv.status === "paid") {
      paidCount++;
      paidTotal += inv.amount;
      if (inv.factorStatus === "settled") settledFactoredCount++;
      continue;
    }
    if (inv.status !== "issued") continue;
    if (inv.factorStatus === "submitted" || inv.factorStatus === "advanced") {
      factoredCount++;
      factoredTotal += inv.amount;
      continue;
    }
    if (inv.factorStatus === "packaged") packagedCount++;
    const bucket = byKey.get(arBucketKeyFor(arDaysPastDue(inv, nowMs)))!;
    bucket.count++;
    bucket.total += inv.amount;
    outstandingCount++;
    outstandingTotal += inv.amount;
  }
  return {
    buckets: BUCKET_DEFS.map((b) => ({
      key: b.key,
      label: b.label,
      count: byKey.get(b.key)!.count,
      total: round2(byKey.get(b.key)!.total),
    })),
    outstandingCount,
    outstandingTotal: round2(outstandingTotal),
    factoredCount,
    factoredTotal: round2(factoredTotal),
    packagedCount,
    paidCount,
    paidTotal: round2(paidTotal),
    settledFactoredCount,
    draftCount,
  };
}

// ---------------------------------------------------------------------------
// Partner seam — in the style of parkingPartnerFromEnv /
// paperworkExtractorFromEnv: env-gated, transport injected, and
// the actions pass no transport, so production is unconfigured
// until a real factor agreement + credentials exist.
// ---------------------------------------------------------------------------

export interface FactorPartner {
  name: string;
  /** Submit one assembled package. Resolves the partner's own
   *  reference for the submission. */
  submit(pkg: FactorPackage): Promise<{ partnerRef: string }>;
}

/** The slice of fetch the partner transport uses (injectable for tests). */
export type FactorFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The factoring partner, when one is configured. Needs BOTH
 * FACTOR_PARTNER_API_KEY and FACTOR_PARTNER_BASE_URL — a key
 * alone names no partner to call. Returns null when
 * unconfigured: the caller then stops the submission at
 * "packaged" and says so, plainly.
 */
export function factorPartnerFromEnv(
  env: Record<string, string | undefined>,
  transport?: FactorFetch,
): FactorPartner | null {
  const apiKey = env.FACTOR_PARTNER_API_KEY?.trim();
  const baseUrl = env.FACTOR_PARTNER_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  const name = env.FACTOR_PARTNER_NAME?.trim() || "Factoring partner";
  const fetchFn: FactorFetch =
    transport ??
    (async (url, init) => {
      const r = await fetch(url, init);
      return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> };
    });
  return {
    name,
    async submit(pkg) {
      const r = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/submissions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(pkg),
      });
      if (!r.ok) throw new Error(`factoring partner answered ${r.status}`);
      const out = (await r.json()) as { id?: unknown; reference?: unknown };
      const partnerRef =
        typeof out.id === "string" && out.id ? out.id : typeof out.reference === "string" ? out.reference : "";
      if (!partnerRef) throw new Error("factoring partner accepted the call but returned no submission reference");
      return { partnerRef };
    },
  };
}
