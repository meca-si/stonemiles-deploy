// brokerCredit.ts — broker payment behaviour on load offers
// (Research Wave 2 item 7). Pure rules; actions.ts gathers the
// facts from the sealed chain and hands them here.
//
// THE HONESTY RULES (the whole item):
//   - The summary is derived ONLY from records inside the app:
//     invoices issued against this broker's loads and the dates
//     they were marked paid, both read off the sealed chain (the
//     invoice table itself is driver-profile-scoped — the chain
//     is the shared record, the same source the broker's own
//     371.3 file reads). No external credit data, ever.
//   - The payload carries payment-behaviour FACTS only — counts
//     and days. No amounts, no rates (the rate law), no letter
//     grades: a grade would hide the numbers it stands on.
//   - The sample size is ALWAYS part of the summary. Below
//     BROKER_CREDIT_MIN_SAMPLE paid loads the facts print
//     without a score label — "2 paid loads on record", never a
//     dressed-up rating built on two data points.
//   - A broker with no in-app payment history reads exactly
//     that: "No payment history in STONEMILES yet".

/** Paid loads needed before an average is presented as a score. */
export const BROKER_CREDIT_MIN_SAMPLE = 3;

export interface BrokerPaymentFact {
  /** The load was carried to delivery (POD sealed). */
  delivered: boolean;
  /** When the invoice against this load was issued (ms), or null. */
  issuedAtMs: number | null;
  /** When that invoice was marked paid (ms), or null. */
  paidAtMs: number | null;
}

export interface BrokerCreditSummary {
  /** Loads this broker posted that were carried to delivery. */
  loadsCarried: number;
  /** Of those, how many have a completed payment on record. */
  paidLoads: number;
  /** Mean days from invoice issued to paid, over paidLoads —
   *  null until at least one completed payment exists. */
  avgDaysToPay: number | null;
  /** The sample the average stands on — always printed. */
  sampleSize: number;
  /** True only at BROKER_CREDIT_MIN_SAMPLE+ paid loads. */
  hasScore: boolean;
  /** The one-line display: the facts, the sample, nothing else. */
  label: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function brokerCreditSummary(facts: readonly BrokerPaymentFact[]): BrokerCreditSummary {
  const loadsCarried = facts.filter((f) => f.delivered).length;
  const spans: number[] = [];
  for (const f of facts) {
    if (f.issuedAtMs == null || f.paidAtMs == null) continue;
    if (!Number.isFinite(f.issuedAtMs) || !Number.isFinite(f.paidAtMs)) continue;
    // A payment recorded before its invoice's issue date is a
    // backdated record, not negative speed — it counts as the
    // load it is (paid), at zero days.
    spans.push(Math.max(0, (f.paidAtMs - f.issuedAtMs) / 86_400_000));
  }
  const paidLoads = spans.length;
  const avgDaysToPay = paidLoads > 0 ? round1(spans.reduce((s, d) => s + d, 0) / paidLoads) : null;
  const hasScore = paidLoads >= BROKER_CREDIT_MIN_SAMPLE && avgDaysToPay != null;
  let label: string;
  if (paidLoads === 0) {
    label = "No payment history in STONEMILES yet";
  } else if (!hasScore) {
    label = `${paidLoads} paid load${paidLoads === 1 ? "" : "s"} on record`;
  } else {
    label = `Pays in about ${Math.round(avgDaysToPay!)} days on average · ${paidLoads} paid loads on record`;
  }
  return { loadsCarried, paidLoads, avgDaysToPay, sampleSize: paidLoads, hasScore, label };
}
