/**
 * DISPATCH-COMPANY ACCOUNT TYPE — pure rules (x, 2026-11-02;
 * migration 0087).
 *
 * Pure functions only: no I/O, unit-tested (dispatchCompany.test.ts).
 * actions.ts resolves the caller's facts server-side (company kind
 * from the companies row, role from myMembership) and runs every
 * dispatch-company decision through here. Kind is NEVER
 * client-supplied at read time — the client picks it once, at
 * company creation, from the two plain choices below.
 *
 * The model, in x's terms: a FLEET runs its own trucks. A DISPATCH
 * company owns no trucks — it dispatches drivers for other fleets
 * and shippers (RUGGS LOGISTICS is the archetype) and needs a house
 * of its own: an owner seat, dispatch seats under the SAME seat
 * model, its own client fleets, its own drivers (joined only by
 * single-use code), and its own walls.
 *
 * PLAN STATE (round 2, x 2026-11-02): a dispatch company starts as
 * a PLAIN PROFILE — creating one takes no plan right and moves no
 * recorded plan; there is no Fleet/Owner subscription state and no
 * owner badge at birth. Client book, desk, and posting all work at
 * profile level. The ONE gated thing is drivers of its own: the
 * first driver joining its roster hits the activation gate, and
 * the owner turns on the Fleet Owner plan (full price, the same
 * recorded transition + seat math a fleet creation runs) to let
 * drivers in. Dispatch SEAT holders are plain profile accounts —
 * the company's plan state governs the desk, never the person.
 *
 * The walls are absolute and live in the actions (every query is
 * scoped to the caller's own company); the rules here decide WHO
 * may manage WHAT inside those walls:
 *  - client fleets are owned by the dispatch company's OWNER seat
 *    (create / edit / delete); dispatch seats work the desk day to
 *    day (assign drivers to clients, post and assign loads);
 *  - a fleet company has no client fleets at all;
 *  - public (Open Board) posting splits by kind: a fleet pushes its
 *    own overflow out directly (existing moveBoardLoadToOpen), a
 *    dispatch company posts ONLY through the Owner Console review
 *    queue (Broker Portal rails) under its own name and logo.
 */

export type CompanyKind = "fleet" | "dispatch";

/** Normalize a stored kind: anything that isn't exactly "dispatch"
 *  is a fleet (every pre-0087 row, and the column default). */
export function normalizeCompanyKind(raw: string | null | undefined): CompanyKind {
  return raw === "dispatch" ? "dispatch" : "fleet";
}

/** The plain choice company creation offers, in x's words. Signup
 *  copy says what the account IS — nothing about billing being live
 *  (billing begins at app-store release, like every plan here). */
export const COMPANY_KIND_CHOICES: ReadonlyArray<{
  kind: CompanyKind;
  title: string;
  blurb: string;
}> = [
  {
    kind: "fleet",
    title: "I run trucks",
    blurb:
      "Your own fleet: your trucks, your drivers, your company board. Drivers join with codes you issue.",
  },
  {
    kind: "dispatch",
    title: "I dispatch for others",
    blurb:
      "A dispatch company: you run the desk for client fleets and their drivers — no trucks of your own. It starts as a plain profile, no plan change; the Fleet Owner plan turns on only when you add drivers of your own. Clients and drivers stay inside your walls, joined by codes you issue.",
  },
];

/** The short chip label a company header shows for its kind. */
export function companyKindLabel(kind: CompanyKind): string {
  return kind === "dispatch" ? "Dispatch company" : "Fleet";
}

/** Who can CREATE / EDIT / DELETE client fleets: the dispatch
 *  company's owner seat only. (Dispatch seats work the desk; the
 *  client book itself is the owner's.) */
export function canOwnClientFleets(kind: CompanyKind, role: string | null): boolean {
  return kind === "dispatch" && role === "owner";
}

/** Who can work the Dispatch Desk day to day (view clients and
 *  drivers, stamp drivers to clients, post and assign loads): the
 *  dispatch company's owner or dispatch seats. Driver seats and
 *  every fleet-company seat: no. */
export function canWorkDispatchDesk(kind: CompanyKind, role: string | null): boolean {
  return kind === "dispatch" && (role === "owner" || role === "dispatch");
}

// ---- Client fleet records ----------------------------------------------------

export interface ClientFleetFields {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  mcNumber: string | null;
  usdotNumber: string | null;
}

const cleanOpt = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Validate + clean a client-fleet save. The record is LIGHTWEIGHT by
 * design: a name is the only requirement; contact and MC/DOT are
 * optional because a desk often starts with just a name and a phone
 * number. A contact email, when given, must look like an address —
 * it is a business contact of record, never mailed by this feature.
 */
export function validateClientFleet(input: {
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  mcNumber?: string | null;
  usdotNumber?: string | null;
}): { ok: true; fields: ClientFleetFields } | { ok: false; error: string } {
  const name = (input.name ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the client fleet a name first." };
  const contactEmail = cleanOpt(input.contactEmail, 120);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: "That contact email doesn't look like an email address — fix it or leave it blank." };
  }
  return {
    ok: true,
    fields: {
      name,
      contactName: cleanOpt(input.contactName, 80),
      contactEmail,
      contactPhone: cleanOpt(input.contactPhone, 40),
      mcNumber: cleanOpt(input.mcNumber, 40),
      usdotNumber: cleanOpt(input.usdotNumber, 40),
    },
  };
}

// ---- Join-code stamping -------------------------------------------------------

/**
 * The client-fleet stamp a membership gets when a driver redeems a
 * code: the code's named client fleet, ONLY when that client fleet
 * belongs to the very company the code joins the driver to. Any
 * mismatch — a client fleet from another company, a deleted client,
 * a fleet-company code — stamps nothing: the driver joins the
 * company directly. A code can never pull a driver across a wall.
 */
export function clientFleetStampForJoin(args: {
  companyKind: CompanyKind;
  codeClientFleetId: number | null;
  clientFleetCompanyId: number | null;
  joiningCompanyId: number;
}): number | null {
  if (args.companyKind !== "dispatch") return null;
  if (args.codeClientFleetId == null) return null;
  if (args.clientFleetCompanyId == null) return null;
  return args.clientFleetCompanyId === args.joiningCompanyId ? args.codeClientFleetId : null;
}

// ---- Public posting path --------------------------------------------------------

export type PublicBoardPath = "fleet_overflow" | "review_queue";

/**
 * How a company reaches the PUBLIC board (the Open Board), by kind.
 * A fleet pushes its own overflow out directly (moveBoardLoadToOpen,
 * labelled with the fleet's name). A dispatch company posts ONLY
 * through the Owner Console review queue — the Broker Portal rails —
 * under its own name and logo: free to post, and the existing
 * per-load dispatch fee rule rides the claim exactly as it does for
 * every Open Board load. No kind gets a second, unreviewed door.
 */
export function publicBoardPathFor(kind: CompanyKind): PublicBoardPath {
  return kind === "dispatch" ? "review_queue" : "fleet_overflow";
}

/** The refusal a dispatch company gets when it tries the fleet
 *  overflow door — it names the one door it does have. */
export const DISPATCH_PUBLIC_POST_REVIEW_QUEUE_ERROR =
  "Dispatch companies post to the Open Board through the review queue, not the fleet overflow door — open Loads → Broker Portal, post under your company's name, and the load goes public when the desk releases it from the queue.";

// ---- Creation + plan state (round 2, x 2026-11-02) ---------------------------

/**
 * DISPATCH-COMPANY CREATION right: a dispatch company is a plain
 * PROFILE, so creation takes no plan right at all — any account
 * with no company membership can open one, on any plan, and the
 * recorded plan does NOT move (no Fleet/Owner state, no owner
 * badge). The fleet-creation gate (Gold/Diamond right) governs
 * FLEET creation only. The one refusal is the shared one: a member
 * of any company can't create another.
 */
export function dispatchCreationGate(args: {
  membershipRole: string | null;
}): { allowed: boolean; error: string | null } {
  if (args.membershipRole != null) {
    return { allowed: false, error: "You already belong to a company — leave it first." };
  }
  return { allowed: true, error: null };
}

/** The gate message the dispatch company's OWNER hits when they try
 *  to bring in a driver (issuing a driver code) before activating:
 *  plain, and it names the one door — activate Fleet Owner. */
export const DISPATCH_DRIVER_GATE_OWNER_ERROR =
  "Adding your own drivers needs the Fleet Owner plan — your dispatch company is still a plain profile. Activate Fleet Owner in the Dispatch Desk (Drivers section), then driver codes unlock. Nothing is charged today; billing starts at the app-store release.";

/** The gate message a DRIVER hits redeeming a code into a dispatch
 *  company that hasn't activated: plain, and the code is NOT
 *  consumed — it works the moment the desk activates. */
export const DISPATCH_DRIVER_GATE_DRIVER_ERROR =
  "This dispatch company hasn't turned on driver rosters yet — adding its own drivers runs on the Fleet Owner plan, and the desk hasn't activated it. Ask the desk to activate Fleet Owner (Dispatch Desk → Drivers), then redeem your code again — your code has NOT been used and still works.";

/**
 * The driver gate itself: the first (and every) driver joining a
 * dispatch company's own roster — by code redemption or any roster
 * add — requires the company's Fleet Owner plan to be ACTIVE.
 * Fleets are never gated here (a fleet is born on the plan);
 * dispatch seats and client records are never gated (they are not
 * drivers). `activated` is resolved by the actions layer from the
 * company's recorded activation (the sealed plan-transition record
 * anchored to the company) — never from client input.
 */
export function dispatchDriverGate(args: {
  companyKind: CompanyKind;
  activated: boolean;
}): { allowed: boolean } {
  if (args.companyKind !== "dispatch") return { allowed: true };
  return { allowed: args.activated };
}

// ---- Dispatcher fee (round 2, x 2026-11-02) -----------------------------------

/** The cap on a dispatcher's own fee, in percent (x's rule —
 *  corrected 2026-11-02: 20, not 30). */
export const DISPATCHER_FEE_MAX_PCT = 20;

/** The plain refusal for an over-cap fee. */
export const DISPATCHER_FEE_OVER_CAP_ERROR =
  "Dispatcher fee can't be over 20% — that's the cap. Set 20% or less.";

/**
 * Validate + clean a dispatcher fee % for storage. Accepts a number
 * or a numeric string (form input); null/blank CLEARS the setting
 * (back to unset = 0%). Range is 0–20 inclusive; anything above the
 * cap is refused with the plain cap message, negatives and
 * non-numbers with their own plain messages. Stored at 2-decimal
 * precision (7.5 and 12.25 are legitimate fees; 7.555 rounds to
 * 7.56 rather than storing float noise).
 */
export function validateDispatcherFeePct(
  input: number | string | null | undefined,
): { ok: true; pct: number | null } | { ok: false; error: string } {
  if (input == null) return { ok: true, pct: null };
  if (typeof input === "string" && input.trim() === "") return { ok: true, pct: null };
  const n = typeof input === "string" ? Number(input.trim()) : input;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return { ok: false, error: "That fee isn't a number — enter a percent like 10 or 7.5, or leave it blank for no fee." };
  }
  if (n < 0) {
    return { ok: false, error: "A dispatcher fee can't be negative — enter 0 to 30, or leave it blank for no fee." };
  }
  if (n > DISPATCHER_FEE_MAX_PCT) {
    return { ok: false, error: DISPATCHER_FEE_OVER_CAP_ERROR };
  }
  return { ok: true, pct: Math.round(n * 100) / 100 };
}

/**
 * The effective dispatcher fee for a poster at release time: the
 * poster account's own override when set, else the fee of the
 * dispatch company the poster belongs to when set, else null —
 * nothing set anywhere means NO fee line rides the load (unset =
 * 0%, stated by the absence of a charge, never a surprise number).
 */
export function effectiveDispatcherFeePct(args: {
  posterFeePct: number | null | undefined;
  companyFeePct: number | null | undefined;
}): number | null {
  if (args.posterFeePct != null) return args.posterFeePct;
  if (args.companyFeePct != null) return args.companyFeePct;
  return null;
}

// ---- Public-board queue routing (round 2 correction, x 2026-11-02) ----------

/** The gate message a dispatch-only company hits when it tries its
 *  own company board: the PRIVATE board is a Fleet Owner (converted)
 *  surface — dispatch-only accounts post publicly through the
 *  platform review queue instead. */
export const DISPATCH_PRIVATE_BOARD_GATE_ERROR =
  "Your company board is a Fleet Owner surface — dispatch-only accounts don't have a private board. Convert to Fleet Owner in the Dispatch Desk to post on your own board; to reach outside carriers now, post through Loads → Broker Portal — your loads land in the platform review queue and go public when the platform desk releases them.";

/**
 * PLATFORM REVIEW QUEUE routing (x, 2026-11-02 correction): a
 * dispatch company's poster account submits into the PLATFORM's
 * review queue — never its own desk's queue (no self-review). The
 * platform queue lives on the platform operator's company: the
 * earliest-created FLEET company in the book that is not the
 * dispatch company itself (the operator's desk company predates
 * every dispatch company; fleet kind is what the desk runs on).
 * Returns null when no such company exists yet — the caller then
 * falls back to the dispatch company's own id and seals that fact,
 * so the record never pretends a platform queue existed.
 */
export function platformQueueCompanyId(args: {
  companies: ReadonlyArray<{ id: number; kind: string }>;
  dispatchCompanyId: number;
}): number | null {
  const candidates = args.companies
    .filter((c) => c.id !== args.dispatchCompanyId && normalizeCompanyKind(c.kind) === "fleet")
    .sort((a, b) => a.id - b.id);
  return candidates[0]?.id ?? null;
}

/** Percent display with no float noise: 10 → "10%", 7.5 → "7.5%",
 *  12.25 → "12.25%", 0 → "0%". */
export function formatDispatcherFeePct(pct: number): string {
  const rounded = Math.round(pct * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded)}%`;
}
