/**
 * AUTONOMY CORE — pure rules module (Research Wave 2 item 1,
 * approved by x 2026-11-15).
 *
 * The back office that runs itself: load status milestones are
 * DERIVED from sealed records and published to the load's outward
 * tracking share with no driver taps; anything the system cannot
 * stand behind becomes an EXCEPTION in a per-role queue instead of
 * a guess on a public page.
 *
 * THE GUARDRAILS (written here, enforced here and in actions.ts,
 * pinned by autonomy.test.ts):
 * (a) NO outward status without a sealed source record. The only
 *     milestone sources are hash-chain events (load_saved,
 *     pickup_sealed, load_status, detention_departure,
 *     delivery_confirmed / pod_seal). A claim that exists only on
 *     an unsealed signal — the load row's status field, the
 *     driver's published fleet snapshot — NEVER becomes a
 *     milestone; it becomes a low-confidence exception.
 * (b) Location freshness is always printed, never upgraded. This
 *     module carries ages as measured; nothing rounds a stale fix
 *     into a live one (fleetVisibility.freshnessFor is the one
 *     labeler, reused everywhere).
 * (c) NO rate or money field exists in any shape below. The summary
 *     builder is never handed a rate, so one can never leak into
 *     the outbox, the track payload, or a notification.
 * (d) Confidence below CONFIDENCE_THRESHOLD → exception queue
 *     only, nothing goes outward. Chain-sealed facts score 1;
 *     unsealed signals score 0.5 (see confidenceForSignal).
 * (e) Every auto-action is reversible: a void writes a correction
 *     row that supersedes the original in the outbox, and the
 *     outward timeline renders the correction, never the voided
 *     row (outwardTimeline below).
 *
 * SYNDICATION HONESTY: the outbox (status_outbox) is the feed of
 * record — an IN-APP feed. No partner feed (MacroPoint, project44,
 * or any other) is connected: there is no partner deal and no
 * credential, so nothing is POSTed anywhere. The share-link page
 * reads the same outbox. A partner seam belongs with a partner
 * agreement, on x's word per deal.
 *
 * Pure functions only — the database half (evaluation, queue
 * reads, resolution) lives in actions.ts.
 */

export type MilestoneKind =
  | "booked"
  | "picked_up"
  | "in_transit"
  | "arriving"
  | "detention"
  | "delivered"
  | "correction";

export type ExceptionKind =
  | "stale_location"
  | "missing_appointment"
  | "conflicting_records"
  | "detention_overdue"
  | "missing_evidence"
  | "low_confidence"
  | "paperwork_no_recipient"
  | "tender_blocked"
  | "dq_blocked";

/** An auto-status is only published at or above this confidence. */
export const CONFIDENCE_THRESHOLD = 0.8;

/** A position older than this at a milestone moment is stale. */
export const STALE_LOCATION_MIN = 30;

/** Confidence by signal source — the whole model. A hash-chain
 * seal is a fact (1). The load row's status field and the driver's
 * published snapshot are claims a device made (0.5): useful for
 * spotting trouble, never enough to publish. */
export function confidenceForSignal(source: "chain" | "row" | "snapshot"): number {
  return source === "chain" ? 1 : 0.5;
}

// ---------------------------------------------------------------------------
// Evidence — every auto-action carries what it stands on.
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  kind: "chain" | "position" | "load" | "snapshot" | "detention";
  /** The record's own id: a chain hash, a detention id, a username. */
  ref: string;
  /** When the evidence was recorded (ISO), null when it has no time. */
  at: string | null;
  /** Plain note, e.g. "chain event pickup_sealed". */
  note: string;
}

/** One hash-chain entry, flattened for the derivations. */
export interface ChainFact {
  id: number;
  event: string;
  hash: string;
  /** ISO time the event was sealed. */
  at: string;
  payload: Record<string, unknown>;
}

function chainEvidence(fact: ChainFact): EvidenceRef {
  return { kind: "chain", ref: fact.hash, at: fact.at, note: `chain event ${fact.event}` };
}

// ---------------------------------------------------------------------------
// Chain-derived load status — mirrors the derivation the desks
// already trust (boardLinkedState in actions.ts): the chain is the
// shared, append-only record; the loads row is one device's claim.
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<string, number> = {
  booked: 0,
  picked_up: 1,
  in_transit: 2,
  arriving: 3,
  delivered: 4,
};

export function statusRank(status: string | null | undefined): number {
  if (status == null) return -1;
  return STATUS_RANK[status] ?? -1;
}

export interface ChainStatus {
  /** booked | picked_up | in_transit | arriving | delivered | null
   * (null = the chain holds nothing that establishes a status). */
  status: string | null;
  delivered: boolean;
  deleted: boolean;
  hasLoadSaved: boolean;
  /** True when a load_status event lands AFTER the first delivery
   * confirmation — the record moved backwards after delivery. */
  statusAfterDelivery: boolean;
}

export function chainStatusFromFacts(facts: readonly ChainFact[]): ChainStatus {
  let status: string | null = null;
  let delivered = false;
  let deleted = false;
  let hasLoadSaved = false;
  let statusAfterDelivery = false;
  let deliveredSeen = false;
  for (const f of facts) {
    if (f.event === "load_deleted") deleted = true;
    if (f.event === "load_saved") {
      hasLoadSaved = true;
      if (status == null) status = "booked";
    } else if (f.event === "pickup_sealed") {
      if (statusRank(status) < 1) status = "picked_up";
    } else if (f.event === "load_status") {
      const s = typeof f.payload.status === "string" ? f.payload.status : null;
      if (deliveredSeen && s) statusAfterDelivery = true;
      if (s && statusRank(s) > statusRank(status)) status = s;
    } else if (f.event === "delivery_confirmed" || f.event === "pod_seal") {
      delivered = true;
      deliveredSeen = true;
      status = "delivered";
    }
  }
  return { status, delivered, deleted, hasLoadSaved, statusAfterDelivery };
}

// ---------------------------------------------------------------------------
// Milestones — derived ONLY from chain facts (guardrail a + d).
// ---------------------------------------------------------------------------

export interface MilestoneCandidate {
  kind: Exclude<MilestoneKind, "correction">;
  /** Plain outward label. */
  label: string;
  /** When the milestone happened (the sealing event's time, ISO). */
  at: string;
  /** Idempotency key within the load: one row per status kind, one
   * per detention visit. */
  dedupeKey: string;
  evidence: EvidenceRef[];
  confidence: number;
}

export const MILESTONE_LABELS: Record<string, string> = {
  booked: "Booked — waiting for pickup",
  picked_up: "Picked up — on the road",
  in_transit: "On the road — in transit",
  arriving: "Arriving — at the delivery area",
  delivered: "Delivered",
  correction: "Correction — an earlier update was withdrawn",
};

/** "3 h 25 min" / "45 min" / "2 h" — the detention module's format,
 * kept local so the outward label reads the same everywhere. */
export function formatWaitMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function deriveMilestones(facts: readonly ChainFact[]): MilestoneCandidate[] {
  const out: MilestoneCandidate[] = [];
  const seenStatus = new Set<string>();
  const pushStatus = (kind: MilestoneCandidate["kind"], fact: ChainFact) => {
    if (seenStatus.has(kind)) return;
    seenStatus.add(kind);
    out.push({
      kind,
      label: MILESTONE_LABELS[kind]!,
      at: fact.at,
      dedupeKey: kind,
      evidence: [chainEvidence(fact)],
      confidence: confidenceForSignal("chain"),
    });
  };
  for (const f of facts) {
    if (f.event === "load_saved") {
      pushStatus("booked", f);
    } else if (f.event === "pickup_sealed") {
      pushStatus("picked_up", f);
    } else if (f.event === "load_status") {
      const s = typeof f.payload.status === "string" ? f.payload.status : null;
      if (s === "picked_up") pushStatus("picked_up", f);
      else if (s === "in_transit") pushStatus("in_transit", f);
      else if (s === "arriving") pushStatus("arriving", f);
    } else if (f.event === "detention_departure") {
      const detentionId = typeof f.payload.detentionId === "number" ? f.payload.detentionId : null;
      const place = typeof f.payload.place === "string" && f.payload.place ? f.payload.place : "the dock";
      const wait = typeof f.payload.waitMinutes === "number" ? f.payload.waitMinutes : null;
      out.push({
        kind: "detention",
        label: `Detention recorded at ${place}${wait != null ? ` — ${formatWaitMinutes(wait)} on the sealed clock` : ""}`,
        at: f.at,
        dedupeKey: `detention:${detentionId ?? f.id}`,
        evidence: [
          chainEvidence(f),
          ...(detentionId != null
            ? [{ kind: "detention" as const, ref: String(detentionId), at: f.at, note: "sealed detention visit" }]
            : []),
        ],
        confidence: confidenceForSignal("chain"),
      });
    } else if (f.event === "delivery_confirmed" || f.event === "pod_seal") {
      pushStatus("delivered", f);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detention visits from chain facts — arrival/departure pair by
// detention id (the same pairing Facility Memory reads).
// ---------------------------------------------------------------------------

export interface DetentionVisit {
  detentionId: number | null;
  site: string | null;
  place: string | null;
  arrivedAt: string;
  graceMinutes: number;
  apptAt: string | null;
  open: boolean;
}

export function detentionVisitsFromFacts(facts: readonly ChainFact[]): DetentionVisit[] {
  const byId = new Map<string, DetentionVisit>();
  for (const f of facts) {
    const id = typeof f.payload.detentionId === "number" ? f.payload.detentionId : null;
    const key = id != null ? `id:${id}` : `evt:${f.id}`;
    if (f.event === "detention_arrival") {
      byId.set(key, {
        detentionId: id,
        site: typeof f.payload.site === "string" ? f.payload.site : null,
        place: typeof f.payload.place === "string" ? f.payload.place : null,
        arrivedAt: typeof f.payload.at === "string" ? f.payload.at : f.at,
        graceMinutes: typeof f.payload.graceMinutes === "number" ? f.payload.graceMinutes : 120,
        apptAt: typeof f.payload.apptAt === "string" ? f.payload.apptAt : null,
        open: true,
      });
    } else if (f.event === "detention_departure") {
      const v = byId.get(key);
      if (v) v.open = false;
    }
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Exceptions — what the system could NOT do with confidence.
// ---------------------------------------------------------------------------

export interface ExceptionCandidate {
  kind: ExceptionKind;
  /** 3 = needs a human first, 1 = housekeeping. */
  severity: 1 | 2 | 3;
  /** Plain explanation for the queue. */
  detail: string;
  evidence: EvidenceRef[];
  /** Episode fingerprint: a dismissed exception stays dismissed
   * while the SAME episode continues (same fingerprint); a new
   * episode (different fingerprint) opens a fresh row. */
  fingerprint: string;
}

export interface ExceptionInputs {
  loadId: number;
  /** The loads row's status claim (null when the row is unreadable
   * from the evaluating context — desks read other drivers' loads
   * through shared tables only). */
  rowStatus: string | null;
  /** The driver's published snapshot status claim, if any. */
  snapshotStatus: string | null;
  chain: ChainStatus;
  /** A live outward tracking share exists for this load. */
  hasTrackShare: boolean;
  /** The driver's last position time (ISO), null = never reported. */
  positionAt: string | null;
  /** Appointment evidence: the load's dock stamp, an appointment a
   * resolution supplied into the chain, or one snapshotted on a
   * sealed detention arrival — any one clears the exception. */
  dockApptAt: string | null;
  suppliedApptAt: string | null;
  detentionApptAt: string | null;
  /** Whether the appointment could be checked at all in the
   * evaluating context. The loads row is profile-scoped: a fleet
   * desk evaluating a driver's load cannot read it, so it cannot
   * verify the appointment either way — and must not raise the
   * exception on a guess. False suppresses missing_appointment. */
  appointmentCheckable: boolean;
  /** The still-open detention visit, if one is running. */
  openDetention: DetentionVisit | null;
  /** Paperwork-to-pay state (Wave 2 item 2), when the evaluating
   * context could observe the load's paperwork row. Null = not
   * observable from here (the row lives with the load's driver) —
   * the exception is then neither raised nor cleared on a guess,
   * the same unverifiable-is-not-cleared rule the row-based kinds
   * follow. */
  paperwork: {
    podConfirmed: boolean;
    recipientOnFile: boolean;
    sendSettled: boolean;
  } | null;
  now: Date;
}

export function deriveExceptions(input: ExceptionInputs): ExceptionCandidate[] {
  const out: ExceptionCandidate[] = [];
  const { chain } = input;
  if (chain.deleted) return out;
  const chainStatus = chain.status;

  // Missing evidence: a live share with no sealed booking behind
  // it — the page would show a status nothing stands behind.
  if (input.hasTrackShare && !chain.hasLoadSaved) {
    out.push({
      kind: "missing_evidence",
      severity: 3,
      detail:
        "This load has a live tracking share, but the sealed record holds no booking entry for it — there is nothing the automatic updates can stand behind.",
      evidence: [{ kind: "load", ref: String(input.loadId), at: null, note: "no load_saved event in the sealed record" }],
      fingerprint: "share",
    });
  }

  // Conflicting records: the sealed record is AHEAD of the load
  // row (the row fell behind the record), or the status moved
  // backwards after delivery was sealed. A delivered chain is
  // never a conflict with the row: the row has no delivered value
  // (delivery is chain-derived everywhere in this app), so a row
  // resting at picked_up under a sealed delivery is the normal
  // state, not a disagreement.
  const chainAheadOfRow =
    !chain.delivered &&
    input.rowStatus != null &&
    chainStatus != null &&
    statusRank(chainStatus) > statusRank(input.rowStatus);
  if (chainAheadOfRow) {
    out.push({
      kind: "conflicting_records",
      severity: 3,
      detail: `The sealed record says "${chainStatus}" but the load record still says "${input.rowStatus}". The sealed record is what goes out — the load record needs to agree with it.`,
      evidence: [{ kind: "load", ref: String(input.loadId), at: null, note: `load record status "${input.rowStatus}" vs sealed "${chainStatus}"` }],
      fingerprint: `${input.rowStatus}->${chainStatus}`,
    });
  } else if (chain.statusAfterDelivery) {
    out.push({
      kind: "conflicting_records",
      severity: 3,
      detail:
        "A status change was sealed AFTER this load's delivery was sealed — the record moved backwards. The delivery stands; the later status needs a human look.",
      evidence: [{ kind: "load", ref: String(input.loadId), at: null, note: "load_status event after delivery confirmation" }],
      fingerprint: "post-delivery-status",
    });
  }

  // Low confidence: an unsealed signal (the load row, the driver's
  // snapshot) claims a status AHEAD of the sealed record. It is
  // never published (guardrail d) — it waits here for its seal.
  const claimedAhead =
    (input.rowStatus != null && statusRank(input.rowStatus) > statusRank(chainStatus)
      ? { claimed: input.rowStatus, source: "row" as const }
      : null) ??
    (input.snapshotStatus != null && statusRank(input.snapshotStatus) > statusRank(chainStatus)
      ? { claimed: input.snapshotStatus, source: "snapshot" as const }
      : null);
  if (claimedAhead && !chainAheadOfRow) {
    out.push({
      kind: "low_confidence",
      severity: 2,
      detail: `A newer status ("${claimedAhead.claimed}") is showing on an unsealed signal, ahead of the sealed record ("${chainStatus ?? "nothing sealed yet"}"). It stays off the tracking page until the seal lands.`,
      evidence: [
        {
          kind: claimedAhead.source === "row" ? "load" : "snapshot",
          ref: String(input.loadId),
          at: null,
          note: `unsealed claim "${claimedAhead.claimed}" (confidence ${confidenceForSignal(claimedAhead.source)} — below the ${CONFIDENCE_THRESHOLD} bar)`,
        },
      ],
      fingerprint: `${claimedAhead.source}:${claimedAhead.claimed}->${chainStatus ?? "none"}`,
    });
  }

  // Stale location: on the road per the sealed record, but the
  // last position is missing or older than the stale line. The
  // age is printed as measured — never upgraded (guardrail b).
  const onRoad = chainStatus === "picked_up" || chainStatus === "in_transit" || chainStatus === "arriving";
  if (onRoad && !chain.delivered) {
    const ageMin = input.positionAt ? Math.floor((input.now.getTime() - new Date(input.positionAt).getTime()) / 60000) : null;
    if (ageMin == null || ageMin > STALE_LOCATION_MIN) {
      out.push({
        kind: "stale_location",
        severity: 2,
        detail:
          ageMin == null
            ? "This load is on the road on the sealed record, but no location has ever been reported for the truck. The tracking page says so plainly instead of guessing."
            : `This load is on the road, but the truck's last location is ${ageMin} minutes old — past the ${STALE_LOCATION_MIN}-minute line. The tracking page keeps printing that age; it never poses as live.`,
        evidence: [
          {
            kind: "position",
            ref: String(input.loadId),
            at: input.positionAt,
            note: ageMin == null ? "no position on file" : `last position ${ageMin} min before evaluation`,
          },
        ],
        fingerprint: input.positionAt ?? "none",
      });
    }
  }

  // Detention overdue: a sealed arrival whose free time has run
  // out, with no departure sealed and no delivery standing.
  if (input.openDetention && !chain.delivered) {
    const arrivedMs = new Date(input.openDetention.arrivedAt).getTime();
    const overAt = arrivedMs + input.openDetention.graceMinutes * 60000;
    if (input.now.getTime() > overAt) {
      const overMin = Math.floor((input.now.getTime() - overAt) / 60000);
      out.push({
        kind: "detention_overdue",
        severity: 2,
        detail: `The detention clock${input.openDetention.place ? ` at ${input.openDetention.place}` : ""} ran past its free time ${formatWaitMinutes(overMin)} ago and the visit is still open — no departure is sealed yet.`,
        evidence: [
          {
            kind: "detention",
            ref: input.openDetention.detentionId != null ? String(input.openDetention.detentionId) : String(input.loadId),
            at: input.openDetention.arrivedAt,
            note: `arrival sealed; free time ${input.openDetention.graceMinutes} min`,
          },
        ],
        fingerprint: `det:${input.openDetention.detentionId ?? input.openDetention.arrivedAt}`,
      });
    }
  }

  // Missing appointment: nothing anywhere names an appointment,
  // so the automatic updates cannot promise an arrival time. Only
  // raised when the appointment was actually checkable (above).
  if (
    input.appointmentCheckable &&
    !chain.delivered &&
    input.dockApptAt == null &&
    input.suppliedApptAt == null &&
    input.detentionApptAt == null
  ) {
    out.push({
      kind: "missing_appointment",
      severity: 1,
      detail:
        "No delivery appointment is on file for this load, so the automatic updates can't promise an arrival time. Supply the appointment to clear this.",
      evidence: [{ kind: "load", ref: String(input.loadId), at: null, note: "no appointment on the load, in the chain, or on a detention visit" }],
      fingerprint: "none",
    });
  }

  // Paperwork held: the POD is confirmed, but no broker/factor
  // address is on file — the copy cannot go out on its own.
  // Raised only when the paperwork row was observable in this
  // context (input.paperwork non-null); the fix is a fact the
  // driver supplies (the address), never a fabricated send.
  if (input.paperwork && input.paperwork.podConfirmed && !input.paperwork.recipientOnFile && !input.paperwork.sendSettled) {
    out.push({
      kind: "paperwork_no_recipient",
      severity: 2,
      detail:
        "The proof of delivery is confirmed, but there is no broker or factor email on file for this load, so the copy can't go out on its own. Add the address in the load's paperwork section and it sends itself.",
      evidence: [{ kind: "load", ref: String(input.loadId), at: null, note: "POD paperwork confirmed; no recipient address on file" }],
      fingerprint: "pod-confirmed",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Ranking, summaries, notification copy, outward timeline.
// ---------------------------------------------------------------------------

/** Queue order: severity first (3 before 1), then the oldest
 * waiting exception first within a severity. */
export function rankExceptions<T extends { severity: number; createdAt: string; id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.severity !== b.severity) return b.severity - a.severity;
    const byAge = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (byAge !== 0) return byAge;
    return a.id - b.id;
  });
}

/** The outbox payload summary for one milestone: the label and the
 * lane, nothing else. This builder is never handed a rate or any
 * money figure (guardrail c) — there is no parameter for one. */
export function statusSummary(args: { lane: string | null; label: string }): string {
  return args.lane ? `${args.label} — ${args.lane}` : args.label;
}

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  stale_location: "Location gone stale",
  missing_appointment: "No appointment on file",
  conflicting_records: "Records disagree",
  detention_overdue: "Detention running over",
  missing_evidence: "No sealed record behind the share",
  low_confidence: "Status waiting on its seal",
  paperwork_no_recipient: "No paperwork address on file",
  // Broker tender held by the identity re-screen (Wave 2 item 3).
  // NOT derived by evaluateLoadAutonomy — the tender flow in
  // actions.ts opens/closes these rows itself (its loadId carries
  // the BROKER POSTER load id); the evaluator leaves them alone.
  tender_blocked: "Tender held — broker identity check",
  // Dispatch held by the DQF gate (Wave 2 item 6). NOT derived by
  // evaluateLoadAutonomy — the claim/assign/accept funnels in
  // actions.ts open/close these rows themselves (their loadId
  // carries the BOARD load id); the evaluator leaves them alone.
  dq_blocked: "Dispatch held — driver not qualified",
};

/** Notification-center copy for a newly opened exception. Lane and
 * kind only — never a rate, never a money figure. */
export function exceptionNotification(args: { kind: ExceptionKind; lane: string | null; loadId: number }): {
  title: string;
  body: string;
} {
  const label = EXCEPTION_LABELS[args.kind];
  return {
    title: `Load #${args.loadId} needs a look — ${label.toLowerCase()}`,
    body: `${args.lane ?? `Load #${args.loadId}`} — ${label}. It is in the exception queue with its evidence attached; nothing went out to the tracking page for it.`,
  };
}

export interface OutboxRowLike {
  id: number;
  kind: string;
  label: string;
  summary: string;
  createdAt: string;
  supersededById: number | null;
  supersedesId: number | null;
}

export interface TimelineEntry {
  id: number;
  kind: string;
  label: string;
  at: string;
  /** True for a correction row (it withdrew an earlier update). */
  corrected: boolean;
}

/** The outward timeline (guardrail e): superseded rows never
 * render; a correction row renders in their place, marked as a
 * correction. Order is the order updates were published. */
export function outwardTimeline(rows: readonly OutboxRowLike[]): TimelineEntry[] {
  return rows
    .filter((r) => r.supersededById == null)
    .map((r) => ({ id: r.id, kind: r.kind, label: r.label, at: r.createdAt, corrected: r.kind === "correction" }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id - b.id);
}
