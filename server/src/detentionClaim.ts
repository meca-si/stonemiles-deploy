// detentionClaim.ts — the detention COLLECTION pack (Research
// Wave 2 item 5). Pure logic; the actions in actions.ts wire it
// to the DB, the chain, and the Library document doors.
//
// WHAT THIS IS: detention time is documented all over the app
// (the sealed detention clock, the time-only proof). What drivers
// lack is the COLLECTION step — one pack that turns a sealed
// visit into a claim they can send: facility, sealed arrival /
// departure, total wait, the facility's free time (grace), the
// time beyond it, GPS/site facts, and the load reference.
//
// AMOUNT HONESTY (the load-bearing rule): the pack prices its
// time ONLY from detention terms the DRIVER recorded on the load
// (loads.detention_rate_per_hour — a per-hour figure from their
// own agreement), and labels them "driver's recorded terms" on
// the document itself. No terms on file → the pack prints the
// time facts and leaves the amount line BLANK for the driver.
// Nothing here invents a rate, and the detention record itself
// stays money-free by design (see detention.ts).

import { detentionTimes, formatDurationMinutes } from "./detention";

export type DetentionClaimStatus =
  | "none"
  | "generated"
  | "sent"
  | "acknowledged"
  | "paid"
  | "disputed";

/** The legal claim transitions, in order. `paid` is terminal; a
 *  disputed claim can still be marked paid when the dispute
 *  settles. Everything else is refused by the action. */
export const DETENTION_CLAIM_NEXT: Record<DetentionClaimStatus, DetentionClaimStatus[]> = {
  none: ["generated"],
  generated: ["sent"],
  sent: ["acknowledged", "paid", "disputed"],
  acknowledged: ["paid", "disputed"],
  paid: [],
  disputed: ["paid"],
};

export function canDetentionClaimMove(from: DetentionClaimStatus, to: DetentionClaimStatus): boolean {
  return (DETENTION_CLAIM_NEXT[from] ?? []).includes(to);
}

export interface DetentionClaimFacts {
  totalMinutes: number;
  graceMinutes: number;
  billableMinutes: number;
}

export interface DetentionClaimInput {
  place: string;
  site: "pickup" | "delivery" | "stop";
  apptAtIso: string | null;
  arrivedAtIso: string;
  departedAtIso: string;
  graceMinutes: number;
  arriveLat: number | null;
  arriveLon: number | null;
  departLat: number | null;
  departLon: number | null;
  chainHash: string | null;
  /** The load this visit belongs to (null for an unlinked stop). */
  load: {
    reference: string | null;
    originLabel: string;
    destinationLabel: string;
    brokerName: string | null;
    brokerCompany: string | null;
    brokerMc: string | null;
  } | null;
  /** The driver's recorded detention terms ($/hour) — null when
   *  no terms are on file; the pack then prints no amount. */
  detentionRatePerHour: number | null;
  /** This facility's stats from the driver's sealed records,
   *  when it has enough visits to print (facts only — never a
   *  score; see facilityDetentionStats). */
  facility: FacilityDetentionStat | null;
}

export interface DetentionClaimPack {
  text: string;
  facts: DetentionClaimFacts;
  /** The computed claim, or null when no terms are on file. */
  amountCents: number | null;
  amountLabel: string | null;
}

const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const gps = (lat: number | null, lon: number | null): string =>
  lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : "not captured";

/** Same UTC rendering the detention proof uses. */
const fmtWhen = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

/**
 * Build the claim pack. Every fact on it comes from the sealed
 * detention record; the amount (when present) is pure arithmetic
 * on the driver's own recorded terms.
 */
export function detentionClaimPack(input: DetentionClaimInput): DetentionClaimPack {
  const { waitMinutes, billableMinutes } = detentionTimes(
    Date.parse(input.arrivedAtIso),
    Date.parse(input.departedAtIso),
    input.graceMinutes,
  );
  const facts: DetentionClaimFacts = {
    totalMinutes: waitMinutes ?? 0,
    graceMinutes: Math.max(0, Math.round(input.graceMinutes)),
    billableMinutes: billableMinutes ?? 0,
  };
  const amountCents =
    input.detentionRatePerHour != null && input.detentionRatePerHour > 0
      ? Math.round((facts.billableMinutes / 60) * input.detentionRatePerHour * 100)
      : null;
  const amountLabel =
    amountCents != null
      ? `${money(amountCents)} — ${formatDurationMinutes(facts.billableMinutes)} beyond free time × $${input.detentionRatePerHour!.toFixed(2)}/hr (driver's recorded terms)`
      : null;

  const lines: string[] = [
    "STONEMILES — DETENTION CLAIM",
    "",
    `Facility: ${input.place}`,
    `Visit: ${input.site === "pickup" ? "Pickup" : input.site === "delivery" ? "Delivery" : "Stop"}`,
    ...(input.load
      ? [
          `Load: ${input.load.originLabel} → ${input.load.destinationLabel}`,
          ...(input.load.reference ? [`Load reference: ${input.load.reference}`] : []),
          ...(input.load.brokerCompany || input.load.brokerName
            ? [`Broker: ${[input.load.brokerCompany, input.load.brokerName].filter(Boolean).join(" — ")}`]
            : []),
          ...(input.load.brokerMc ? [`Broker MC: ${input.load.brokerMc}`] : []),
        ]
      : ["Load: (not linked to a load)"]),
    "",
    `Appointment: ${input.apptAtIso ? fmtWhen(input.apptAtIso) : "not recorded"}`,
    `Arrived: ${fmtWhen(input.arrivedAtIso)}`,
    `Departed: ${fmtWhen(input.departedAtIso)}`,
    `Total time at facility: ${formatDurationMinutes(facts.totalMinutes)}`,
    `Free time allowed: ${formatDurationMinutes(facts.graceMinutes)}`,
    `Time beyond free time: ${formatDurationMinutes(facts.billableMinutes)}`,
    `Arrival GPS: ${gps(input.arriveLat, input.arriveLon)}`,
    `Departure GPS: ${gps(input.departLat, input.departLon)}`,
    "",
    ...(amountLabel != null
      ? [`Detention claimed: ${amountLabel}`]
      : [
          "Detention claimed: __________ (no detention terms recorded on this load — amount left for the driver to complete from their agreement)",
        ]),
    ...(input.facility && input.facility.visits >= 3
      ? [
          "",
          `This facility in your sealed records: ${input.facility.visits} visits, held past free time on ${input.facility.detainedCount} of them, average ${formatDurationMinutes(Math.round(input.facility.avgBillableMinutes))} beyond free time.`,
        ]
      : []),
    "",
    "Times are from this visit's sealed detention record in STONEMILES — the arrival",
    "and departure were stamped when they happened and sealed into the record chain.",
    ...(input.chainHash ? [`Record seal: ${input.chainHash}`] : []),
  ];
  return { text: lines.join("\n"), facts, amountCents, amountLabel };
}

// ---------------------------------------------------------------------
// Facility detention stats — sealed records only
// ---------------------------------------------------------------------

export interface FacilityDetentionVisit {
  placeKey: string;
  placeLabel: string;
  arrivedAtIso: string;
  departedAtIso: string;
  graceMinutes: number;
}

export interface FacilityDetentionStat {
  placeKey: string;
  placeLabel: string;
  visits: number;
  detainedCount: number;
  avgBillableMinutes: number;
  totalBillableMinutes: number;
  lastVisitAtIso: string;
  /** True at 3+ visits — below that the app shows facts only. */
  scoreEligible: boolean;
}

/** The facility key: the place label, normalized (case/space). */
export function facilityKeyOf(placeLabel: string): string {
  return placeLabel.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Aggregate per-facility detention stats from sealed (closed)
 * visits. Facts only — visits, how many ran past free time, the
 * average wait beyond it — with the sample size always attached.
 * Below 3 visits `scoreEligible` is false and callers show the
 * facts without any score line: no rating theatre on thin data.
 */
export function facilityDetentionStats(visits: FacilityDetentionVisit[]): FacilityDetentionStat[] {
  const byKey = new Map<string, FacilityDetentionVisit[]>();
  for (const v of visits) {
    if (!v.placeKey) continue;
    const list = byKey.get(v.placeKey) ?? [];
    list.push(v);
    byKey.set(v.placeKey, list);
  }
  const out: FacilityDetentionStat[] = [];
  for (const [placeKey, list] of byKey) {
    let detainedCount = 0;
    let totalBillable = 0;
    let last = "";
    for (const v of list) {
      const { billableMinutes } = detentionTimes(
        Date.parse(v.arrivedAtIso),
        Date.parse(v.departedAtIso),
        v.graceMinutes,
      );
      const billable = billableMinutes ?? 0;
      if (billable > 0) detainedCount += 1;
      totalBillable += billable;
      if (v.departedAtIso > last) last = v.departedAtIso;
    }
    out.push({
      placeKey,
      placeLabel: list[0]!.placeLabel,
      visits: list.length,
      detainedCount,
      avgBillableMinutes: list.length > 0 ? totalBillable / list.length : 0,
      totalBillableMinutes: totalBillable,
      lastVisitAtIso: last,
      scoreEligible: list.length >= 3,
    });
  }
  return out.sort((a, b) => b.visits - a.visits || a.placeLabel.localeCompare(b.placeLabel));
}
