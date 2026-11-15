// recruiting.ts — driver recruiting, ATS-lite (Research Wave 2
// item 10, Part B). Pure pipeline + template + intake rules; the
// actions in actions.ts wire these to the DB, the chain, the
// desks, and the mail path.
//
// SHAPE: a fleet opens a public application door (the same
// no-account pattern as the broker send door — a token in a URL,
// nothing else public). An applicant submits name, contact, CDL
// class, experience, and a short note. The submission lands in
// the fleet's Owner/Dispatch desk inbox and the applicant gets
// an auto-response in the SAME request — in-flow confirmation
// plus an email through the existing document-email path — so
// the <5-minute response is structural, not a cron's promise.
//
// PRIVACY: applications are visible only inside the owning
// fleet's desk (owner + dispatch seats). Applicants never see
// other applicants. Desk notes are fleet-internal and never
// leave the desk — no action returns them to any public door.
// "Hired" mints a pending invite through the EXISTING driver
// code system; it creates no account and no new account path.

export const APPLICATION_STAGES = [
  "new",
  "contacted",
  "interview",
  "road_test",
  "hired",
  "declined",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

const STAGE_LABELS: Record<ApplicationStage, string> = {
  new: "New",
  contacted: "Contacted",
  interview: "Interview",
  road_test: "Road test",
  hired: "Hired",
  declined: "Declined",
};

export function applicationStageLabel(stage: string): string {
  return (STAGE_LABELS as Record<string, string>)[stage] ?? stage;
}

export function isApplicationStage(value: string): value is ApplicationStage {
  return (APPLICATION_STAGES as readonly string[]).includes(value);
}

const TERMINAL_STAGES: readonly ApplicationStage[] = ["hired", "declined"];
/** The hiring ladder, in order — forward moves only. */
const LADDER: readonly ApplicationStage[] = ["new", "contacted", "interview", "road_test", "hired"];

/** A stage move is allowed when it walks FORWARD along the
 *  ladder, or declines from any non-terminal stage. Terminal
 *  stages (hired, declined) never move again, and no stage moves
 *  backward — a wrong tap is corrected by the desk's own record,
 *  not by rewriting the pipeline. */
export function canMoveApplicationStage(from: string, to: string): boolean {
  if (!isApplicationStage(from) || !isApplicationStage(to)) return false;
  if (from === to) return false;
  if (TERMINAL_STAGES.includes(from)) return false;
  if (to === "declined") return true;
  const fromIdx = LADDER.indexOf(from as ApplicationStage);
  const toIdx = LADDER.indexOf(to as ApplicationStage);
  return fromIdx >= 0 && toIdx > fromIdx;
}

export const CDL_CLASSES = ["A", "B", "C", "none"] as const;
export type CdlClass = (typeof CDL_CLASSES)[number];

export function cdlClassLabel(cls: string): string {
  return cls === "none" ? "No CDL yet" : `Class ${cls}`;
}

// ---------------------------------------------------------------------------
// Auto-response template
// ---------------------------------------------------------------------------

/** The default acknowledgement. It says the application arrived,
 *  that the fleet reviews EVERY application, and how the fleet
 *  will reach out IF there's a fit — it promises nothing about
 *  hiring, pay, or a decision timeline. The fleet can edit its
 *  own copy in the desk; {name} and {fleet} substitute at send
 *  time. */
export const DEFAULT_RESPONSE_SUBJECT = "Application received — {fleet}";
export const DEFAULT_RESPONSE_TEMPLATE = [
  "Hi {name},",
  "",
  "Thanks for applying to drive with {fleet}. Your application is in — we review every application we receive.",
  "",
  "If your experience fits an open seat, we'll reach out at the email or phone number you gave us. No need to apply again.",
  "",
  "— {fleet}",
].join("\n");

/** Render a template for one applicant: {name} → the applicant's
 *  name, {fleet} → the fleet's name. Unknown tokens are left
 *  untouched so a fleet sees its own typo rather than a silent
 *  blank. */
export function renderResponseTemplate(
  template: string,
  values: { name: string; fleet: string },
): string {
  return template.replace(/\{name\}/g, values.name).replace(/\{fleet\}/g, values.fleet);
}

/** A fleet's saved template, or the defaults when it never set
 *  one (or blanked a field — a blank field falls back rather
 *  than sending an empty subject or body). */
export function responseTemplateFor(saved: { subject: string | null; body: string | null } | null): {
  subject: string;
  body: string;
} {
  return {
    subject: saved?.subject?.trim() ? saved.subject : DEFAULT_RESPONSE_SUBJECT,
    body: saved?.body?.trim() ? saved.body : DEFAULT_RESPONSE_TEMPLATE,
  };
}

// ---------------------------------------------------------------------------
// Intake cleaning + validation (the door's input discipline)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CleanApplicationInput {
  name: string;
  email: string;
  phone: string | null;
  cdlClass: CdlClass;
  experience: string;
  note: string | null;
}

const clip = (value: unknown, max: number): string =>
  (typeof value === "string" ? value : "").trim().replace(/\s+/g, " ").slice(0, max);

/** Clean + validate one raw submission. Returns the cleaned
 *  application, or a plain refusal reason the door can show.
 *  Email is the one hard requirement (the auto-response rides
 *  it); experience is required text — it is what the desk reads
 *  first. */
export function cleanApplicationInput(raw: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  cdlClass?: unknown;
  experience?: unknown;
  note?: unknown;
}): { ok: true; value: CleanApplicationInput } | { ok: false; reason: string } {
  const name = clip(raw.name, 120);
  if (name.length < 2) return { ok: false, reason: "Please give your name." };
  const email = (typeof raw.email === "string" ? raw.email : "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "Please give an email address we can reach you at." };
  const phone = clip(raw.phone, 40);
  const cdlRaw = typeof raw.cdlClass === "string" ? raw.cdlClass.trim().toUpperCase() : "";
  const cdlClass = (CDL_CLASSES as readonly string[]).includes(cdlRaw)
    ? (cdlRaw as CdlClass)
    : cdlRaw === "NONE"
      ? "none"
      : null;
  if (!cdlClass) return { ok: false, reason: "Please pick your CDL class." };
  const experience = clip(raw.experience, 500);
  if (experience.length < 2) return { ok: false, reason: "Tell us a little about your driving experience." };
  const note = clip(raw.note, 1000);
  return {
    ok: true,
    value: { name, email, phone: phone || null, cdlClass, experience, note: note || null },
  };
}

// ---------------------------------------------------------------------------
// Rate limiting — the door's anti-spam posture, decided purely
// over DB counts the action gathers (actions never see a client
// IP, so the limits key on the door and the applicant's email —
// the same spirit as the send door's per-link and per-email
// windows).
// ---------------------------------------------------------------------------

/** Max applications through one door in a rolling hour. */
export const APPLY_DOOR_HOURLY_LIMIT = 20;
/** Max applications from one email to one fleet in a day. */
export const APPLY_EMAIL_DAILY_LIMIT = 3;

export function applicationRateVerdict(input: {
  doorLastHour: number;
  emailLastDay: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.doorLastHour >= APPLY_DOOR_HOURLY_LIMIT) {
    return { ok: false, reason: "This application door is busy right now — please try again in a little while." };
  }
  if (input.emailLastDay >= APPLY_EMAIL_DAILY_LIMIT) {
    return { ok: false, reason: "You've already applied here — the fleet has your application." };
  }
  return { ok: true };
}
