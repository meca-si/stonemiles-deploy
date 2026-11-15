// dashcam.ts — dashcam video coaching + exoneration vault
// (Research Wave 2 item 11, Part A). Pure logic + the partner
// seam; the actions in actions.ts wire these to the DB and the
// chain.
//
// THE SHAPE: a dashcam partner (Samsara / Motive / Netradyne
// class) pushes safety events to our webhook intake. We store
// the EVENT and the partner's clip REFERENCE — the partner hosts
// the video; STONEMILES never copies or hosts video bytes. The
// intake is authenticated per connection: every dashcam
// connection carries its own shared secret, generated in the app
// and pasted into the partner's webhook config by the fleet.
// The seam below is env-gated in the house style
// (parkingPartnerFromEnv / brokerIdentityVerifierFromEnv): with
// no DASHCAM_PARTNER_API_KEY configured, the intake refuses
// plainly and stores NOTHING — a webhook nobody has agreed to
// feed us is not a data source.
//
// NO FABRICATED EVENTS: the only other way an event lands is the
// test path, and its rows are stamped simulated in the data
// itself (same honesty rule as the ELD test sync) and labelled
// simulated on every surface that shows them.

export const DASHCAM_EVENT_KINDS = [
  "harsh_braking",
  "speeding",
  "following_distance",
  "collision",
  "camera_obstruction",
] as const;

export type DashcamEventKind = (typeof DASHCAM_EVENT_KINDS)[number];

export const DASHCAM_KIND_LABELS: Record<DashcamEventKind, string> = {
  harsh_braking: "Harsh braking",
  speeding: "Speeding",
  following_distance: "Following too close",
  collision: "Collision",
  camera_obstruction: "Camera obstructed",
};

export const DASHCAM_SEVERITIES = ["low", "moderate", "high", "critical"] as const;
export type DashcamSeverity = (typeof DASHCAM_SEVERITIES)[number] | "unspecified";

// ---------------------------------------------------------------------
// Partner seam
// ---------------------------------------------------------------------

export interface DashcamPartner {
  name: string;
}

/** The slice of fetch the partner transport uses (injectable for tests). */
export type DashcamFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The dashcam partner, when one is configured. The partner PUSHES
 * events (the webhook intake in actions.ts is the receiving
 * door), so this seam is the configuration marker the intake and
 * the panel read: it returns null unless DASHCAM_PARTNER_API_KEY
 * is set. DASHCAM_PARTNER_NAME only dresses the label. The
 * transport parameter exists for house-style symmetry with the
 * other seams (and future partner API calls); nothing calls the
 * partner today.
 */
export function dashcamPartnerFromEnv(
  env: Record<string, string | undefined>,
  _transport?: DashcamFetch,
): DashcamPartner | null {
  const apiKey = env.DASHCAM_PARTNER_API_KEY?.trim();
  if (!apiKey) return null;
  const name = env.DASHCAM_PARTNER_NAME?.trim() || "Dashcam partner";
  return { name };
}

// ---------------------------------------------------------------------
// Webhook payload validation
// ---------------------------------------------------------------------

export interface DashcamEventPayload {
  /** The partner's own id for this event — the idempotency key. */
  partnerEventId: string;
  kind: DashcamEventKind;
  severity: DashcamSeverity;
  /** ISO timestamp of when the event happened. */
  occurredAt: string;
  /** The partner's reference for the clip (their id or URL). */
  clipRef: string;
  clipUrl: string | null;
  /** Which driver — the STONEMILES username the partner was
   *  configured with for this driver. Null when the connection
   *  itself names the driver. */
  driverRef: string | null;
  /** The partner's reference for the load/trip, when it sends
   *  one. Informational only — the app ties events to loads by
   *  its own load id (set at pin/link time), never by trusting a
   *  partner reference to name a sealed record. */
  loadRef: string | null;
}

export type DashcamPayloadValidation =
  | { ok: true; event: DashcamEventPayload }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strField(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Validate one partner webhook payload. Strict on the fields the
 *  record stands on (id, kind, time, clip reference); lenient on
 *  dressing (severity defaults to "unspecified", never invented). */
export function validateDashcamEventPayload(payload: unknown): DashcamPayloadValidation {
  if (!isRecord(payload)) return { ok: false, errors: ["payload must be a JSON object"] };
  const errors: string[] = [];
  const partnerEventId = strField(payload, "partnerEventId") ?? strField(payload, "eventId") ?? strField(payload, "id");
  if (!partnerEventId) errors.push("partnerEventId is required");
  const kindRaw = strField(payload, "kind") ?? strField(payload, "eventType");
  const kind = (DASHCAM_EVENT_KINDS as readonly string[]).includes(kindRaw ?? "")
    ? (kindRaw as DashcamEventKind)
    : null;
  if (!kind) errors.push(`kind must be one of ${DASHCAM_EVENT_KINDS.join(", ")}`);
  const occurredAt = strField(payload, "occurredAt") ?? strField(payload, "timestamp");
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    errors.push("occurredAt must be an ISO timestamp");
  }
  const clipRef = strField(payload, "clipRef") ?? strField(payload, "clipId") ?? strField(payload, "videoRef");
  if (!clipRef) errors.push("clipRef is required (the partner's reference for the clip)");
  const sevRaw = strField(payload, "severity");
  const severity: DashcamSeverity = (DASHCAM_SEVERITIES as readonly string[]).includes(sevRaw ?? "")
    ? (sevRaw as DashcamSeverity)
    : "unspecified";
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    event: {
      partnerEventId: partnerEventId!,
      kind: kind!,
      severity,
      occurredAt: new Date(occurredAt!).toISOString(),
      clipRef: clipRef!,
      clipUrl: strField(payload, "clipUrl"),
      driverRef: strField(payload, "driverRef") ?? strField(payload, "driverId"),
      loadRef: strField(payload, "loadRef"),
    },
  };
}

// ---------------------------------------------------------------------
// Pattern flags — facts only
// ---------------------------------------------------------------------

export interface DashcamPatternFlag {
  kind: DashcamEventKind;
  label: string;
  count: number;
  windowDays: number;
  firstAtIso: string;
  lastAtIso: string;
  line: string;
}

/** Repeat events of the same kind inside the window surface as a
 *  pattern: counts and dates, nothing else. No scores, no
 *  verdicts — a pattern flag says "this happened N times", and a
 *  human decides what it means. */
export function dashcamPatternFlags(
  events: readonly { kind: string; occurredAtMs: number }[],
  opts: { nowMs: number; windowDays?: number; threshold?: number },
): DashcamPatternFlag[] {
  const windowDays = opts.windowDays ?? 30;
  const threshold = opts.threshold ?? 3;
  const since = opts.nowMs - windowDays * 24 * 60 * 60 * 1000;
  const byKind = new Map<string, number[]>();
  for (const e of events) {
    if (e.occurredAtMs < since || e.occurredAtMs > opts.nowMs) continue;
    if (!(DASHCAM_EVENT_KINDS as readonly string[]).includes(e.kind)) continue;
    const list = byKind.get(e.kind) ?? [];
    list.push(e.occurredAtMs);
    byKind.set(e.kind, list);
  }
  const flags: DashcamPatternFlag[] = [];
  for (const [kind, times] of byKind) {
    if (times.length < threshold) continue;
    times.sort((a, b) => a - b);
    const label = DASHCAM_KIND_LABELS[kind as DashcamEventKind];
    flags.push({
      kind: kind as DashcamEventKind,
      label,
      count: times.length,
      windowDays,
      firstAtIso: new Date(times[0]!).toISOString(),
      lastAtIso: new Date(times[times.length - 1]!).toISOString(),
      line: `${label}: ${times.length} events in the last ${windowDays} days.`,
    });
  }
  return flags.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------
// Simulated test event
// ---------------------------------------------------------------------

/** The test path's event payload. Stamped simulated by the
 *  caller in the stored row itself — this generator only picks
 *  plausible facts; the honesty marker is structural, in the
 *  actions layer, exactly like the ELD test sync. */
export function simulatedDashcamEvent(now: Date, kind: DashcamEventKind): DashcamEventPayload {
  return {
    partnerEventId: `sim-${now.getTime()}`,
    kind,
    severity: kind === "collision" ? "high" : "moderate",
    occurredAt: now.toISOString(),
    clipRef: "simulated-clip-reference",
    clipUrl: null,
    driverRef: null,
    loadRef: null,
  };
}
