/**
 * MY DESK — the dispatcher's OWN desk (round 3, x 2026-11-02:
 * "Dispatcher should have their own desk."). Pure rules only.
 *
 * Rounds 1–2 built the Dispatch Desk as the dispatch COMPANY's roof
 * view (owner + dispatch seats see the whole company's work). My
 * Desk is the PERSON's window into their own slice of it — plus the
 * solo lane: a profile with no company at all can open My Desk and
 * become a dispatcher in the system by doing so.
 *
 * ELIGIBILITY (spec §1) — exactly three doors in:
 *  (a) a dispatch-seat holder in ANY company (fleet or dispatch);
 *  (b) a dispatch company's owner;
 *  (c) a SOLO dispatcher: any profile that has opened My Desk
 *      (social_users.dispatcher_poster, set by openMyDesk) — opening
 *      the desk is the opt-in to dispatcher economics.
 * Everyone else is ineligible and gets the plain explanation + the
 * three doors (join a company as dispatch · start a dispatch
 * company · open the desk solo). Note what is NOT a door: a fleet
 * company's owner seat and a driver seat anywhere — those profiles
 * reach the desk only by opting in solo, like anyone else.
 *
 * WALLS (spec §3): everything on My Desk is scoped to the person —
 * their pipeline is loads THEY posted, their fee view is their own
 * poster override over their company's default, their platform-fee
 * view is accruals on loads THEY posted (platform_fee_entries.
 * poster_username). The company Dispatch Desk is untouched.
 */

import { effectiveDispatcherFeePct } from "./dispatchCompany";
import type { CompanyKind } from "./dispatchCompany";

export type MyDeskVia = "dispatch_seat" | "dispatch_company_owner" | "solo";

export interface MyDeskAccess {
  eligible: boolean;
  via: MyDeskVia | null;
}

/**
 * Who gets My Desk, decided server-side from the caller's resolved
 * membership + solo flag — never from client input. A dispatch seat
 * outranks the solo flag (they work under a company roof); a
 * dispatch company's owner likewise; the solo flag is the fallback
 * door for profiles with neither.
 */
export function myDeskAccess(args: {
  membershipKind: CompanyKind | null;
  membershipRole: string | null;
  soloDispatcher: boolean;
}): MyDeskAccess {
  if (args.membershipRole === "dispatch" && args.membershipKind != null) {
    return { eligible: true, via: "dispatch_seat" };
  }
  if (args.membershipKind === "dispatch" && args.membershipRole === "owner") {
    return { eligible: true, via: "dispatch_company_owner" };
  }
  if (args.soloDispatcher) {
    return { eligible: true, via: "solo" };
  }
  return { eligible: false, via: null };
}

/** The one-line context a My Desk header carries: whose roof the
 *  dispatcher works under, or that the desk is their own. */
export function myDeskContextLabel(args: {
  via: MyDeskVia | null;
  companyName: string | null;
  companyKind: CompanyKind | null;
}): string | null {
  if (args.via === "dispatch_seat") {
    return args.companyName ? `Dispatch seat at ${args.companyName}` : "Dispatch seat";
  }
  if (args.via === "dispatch_company_owner") {
    return args.companyName ? `Owner of ${args.companyName} (dispatch company)` : "Dispatch company owner";
  }
  if (args.via === "solo") {
    return args.companyKind === "fleet" && args.companyName
      ? `Solo dispatcher — your own desk (you're also in ${args.companyName})`
      : "Solo dispatcher — your own desk";
  }
  return null;
}

// ---- Pipeline states ---------------------------------------------------------

export type MyDeskPipelineStateKey = "draft" | "review" | "live" | "claimed" | "delivered";

export const MY_DESK_PIPELINE_LABELS: Record<MyDeskPipelineStateKey, string> = {
  draft: "Draft",
  review: "In platform review",
  live: "Live on the board",
  claimed: "Claimed",
  delivered: "Delivered — sealed",
};

/**
 * The plain state of one of MY loads, from its records. Inputs are
 * the poster's own load status (broker_poster_loads: draft | sent |
 * returned | released — null for a load posted straight to a company
 * board), the board row's status (open | taken | overflowed — null
 * while no board row exists), and whether the delivery sealed.
 *
 * Mapping, in the spec's plain words:
 *  - sealed delivery outranks everything: Delivered — sealed.
 *  - a poster load not yet sent (or sent back by the desk) is a
 *    Draft — "returned" folds into Draft because the load is back in
 *    the poster's hands, editable; the desk's review note rides
 *    along separately so the approval state stays visible.
 *  - a poster load sent and waiting on the desk is In platform
 *    review.
 *  - a board row a carrier took is Claimed; a row still open — or
 *    pushed out to the Open Board (overflowed: the open copy carries
 *    the claim from there) — is Live on the board.
 *  - a released poster load whose board row can't be found (the row
 *    was withdrawn after release) still reads Live — it left the
 *    desk's hands; nothing truer can be said from the records.
 */
export function myDeskPipelineState(args: {
  posterStatus: string | null;
  boardStatus: string | null;
  sealed: boolean;
}): MyDeskPipelineStateKey {
  if (args.sealed) return "delivered";
  if (args.posterStatus === "draft" || args.posterStatus === "returned") return "draft";
  if (args.posterStatus === "sent") return "review";
  if (args.boardStatus === "taken") return "claimed";
  if (args.boardStatus === "open" || args.boardStatus === "overflowed") return "live";
  if (args.posterStatus === "released") return "live";
  return "draft";
}

// ---- My fee ------------------------------------------------------------------

export type MyDeskFeeSource = "poster" | "company" | "none";

/** Which value is actually in effect on my loads, and where it came
 *  from: my own poster override wins; else my company's default;
 *  else no fee anywhere (unset = 0%). Same precedence the release
 *  path snapshots (effectiveDispatcherFeePct) — this names the
 *  source so the desk can say it plainly. */
export function myDeskFee(args: {
  posterFeePct: number | null | undefined;
  companyFeePct: number | null | undefined;
}): { effectiveFeePct: number | null; source: MyDeskFeeSource } {
  const effectiveFeePct = effectiveDispatcherFeePct({
    posterFeePct: args.posterFeePct ?? null,
    companyFeePct: args.companyFeePct ?? null,
  });
  const source: MyDeskFeeSource =
    args.posterFeePct != null ? "poster" : args.companyFeePct != null ? "company" : "none";
  return { effectiveFeePct, source };
}

// ---- Solo poster account -----------------------------------------------------

/**
 * Validate the name + contact email a solo dispatcher links their
 * own poster account under. The poster account carries the name
 * loads post under and the email as contact of record — the same
 * light validation the client-fleet book runs: a name is required,
 * an email must look like an address.
 */
export function validateSoloPosterLink(input: {
  name: string;
  email: string;
}): { ok: true; name: string; email: string } | { ok: false; error: string } {
  const name = (input.name ?? "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Give your poster account a name first — it's the name your loads post under." };
  const email = (input.email ?? "").trim().slice(0, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Add a contact email that looks like an email address — your poster account carries it as the contact of record." };
  }
  return { ok: true, name, email };
}

// ---- Dispatcher exclusivity — one desk or the other (round 4) -----------------
//
// X's rule (2026-11-02): "a dispatcher can only do one or the other,
// never have both — to prevent double booking taking from company
// owners." A dispatcher runs in exactly ONE mode at a time:
//
//  - COMPANY mode: they hold an active dispatch seat in ANY company
//    (fleet or dispatch kind), or they own a dispatch company. Their
//    My Desk is the person-view under that company's roof (round 3,
//    unaffected by this rule).
//  - SOLO mode: their dispatcher-poster flag is open AND they hold
//    no company standing. The solo desk is their own channel.
//
// The doors refuse both ways: the solo door (openMyDesk, and linking
// a solo poster account — the same opt-in) refuses while company
// standing stands; the company doors (taking a dispatch seat,
// creating a dispatch company) refuse while the solo desk is
// EFFECTIVELY open. Switching solo → company runs through
// closeMyDesk, which refuses while LIVE loads sit on the board
// under the solo poster — freight never crosses the switch, and no
// one can hold both channels open at once.
//
// RECONCILIATION: if stored data ever says BOTH (flag open AND
// company standing — only reachable from data written before this
// rule), COMPANY standing wins: the flag is treated as closed for
// eligibility and for platform-fee accrual while the seat stands
// (soloEffective below is the only solo value any reader may use).
// Recorded accrual history is never rewritten by any of this.

export type DispatcherMode = "company" | "solo" | "none";

/** One company seat a profile holds, resolved server-side from
 *  their roster rows (ALL of them — standing is about ANY company). */
export interface DispatcherSeat {
  companyId: number;
  companyName: string;
  companyKind: CompanyKind;
  role: string;
}

export interface DispatcherStanding {
  mode: DispatcherMode;
  /** The My Desk door the standing opens (null when mode is none). */
  via: MyDeskVia | null;
  /** The company whose standing applies (company mode only) — the
   *  name the solo-door refusal speaks. */
  companyId: number | null;
  companyName: string | null;
  /** The raw stored solo flag, exactly as recorded. */
  soloFlagOpen: boolean;
  /** The solo flag as readers must treat it: open only when no
   *  company standing stands over it. THIS is the accrual and
   *  eligibility value — never the raw flag. */
  soloEffective: boolean;
  /** True when stored data says BOTH (flag open under company
   *  standing): the flag stands on file but reads as closed. */
  soloSuppressed: boolean;
}

/**
 * Resolve a dispatcher's one mode from every standing they hold.
 * A dispatch seat in any company outranks dispatch-company
 * ownership (the same ranking myDeskAccess uses); ownership comes
 * from an owner seat in a dispatch company OR from owning one
 * outright (companies.ownerUsername) — both are company standing.
 * A driver seat, and owning a FLEET company, are NOT dispatcher
 * company standing: those profiles run solo if their flag is open,
 * exactly as round 3 had them.
 */
export function resolveDispatcherStanding(args: {
  seats: DispatcherSeat[];
  ownedDispatchCompanies: { companyId: number; companyName: string }[];
  soloDispatcher: boolean;
}): DispatcherStanding {
  const seat = args.seats.find((s) => s.role === "dispatch");
  const ownerSeat = args.seats.find((s) => s.role === "owner" && s.companyKind === "dispatch");
  const owned = args.ownedDispatchCompanies[0] ?? null;
  let via: MyDeskVia | null = null;
  let companyId: number | null = null;
  let companyName: string | null = null;
  if (seat) {
    via = "dispatch_seat";
    companyId = seat.companyId;
    companyName = seat.companyName;
  } else if (ownerSeat) {
    via = "dispatch_company_owner";
    companyId = ownerSeat.companyId;
    companyName = ownerSeat.companyName;
  } else if (owned) {
    via = "dispatch_company_owner";
    companyId = owned.companyId;
    companyName = owned.companyName;
  }
  const companyStanding = via != null;
  const soloFlagOpen = args.soloDispatcher === true;
  const soloEffective = soloFlagOpen && !companyStanding;
  return {
    mode: companyStanding ? "company" : soloEffective ? "solo" : "none",
    via: companyStanding ? via : soloEffective ? "solo" : null,
    companyId,
    companyName,
    soloFlagOpen,
    soloEffective,
    soloSuppressed: soloFlagOpen && companyStanding,
  };
}

/** The solo door's refusal while company standing stands (x's
 *  words): names the company the dispatcher is running under. */
export function soloOpenCompanyRefusal(companyName: string): string {
  return `You're dispatching under ${companyName} — a dispatcher runs one desk or the other, never both. Leave the company's dispatch seat to run solo.`;
}

/** The company doors' refusal while the caller's OWN solo desk is
 *  open (x's words, first person — createCompany speaks to the
 *  person whose desk it is). */
export const SOLO_DESK_OPEN_REFUSAL =
  "Your solo desk is open — one desk or the other. Close the solo desk first (live loads must finish or be withdrawn first).";

/** The same refusal about ANOTHER dispatcher — an owner handing a
 *  dispatch seat (setCompanyRole, roster import) to a member whose
 *  solo desk is open reads it about that member, in the same words. */
export function soloDeskOpenRefusalFor(username: string): string {
  return `@${username}'s solo desk is open — one desk or the other. They have to close the solo desk first (live loads must finish or be withdrawn first).`;
}

/** May the solo door open for this standing? Refused exactly when
 *  company standing stands (mode "company") — including the
 *  suppressed BOTH state, where the desk already reads as the
 *  company's and there is nothing solo to open. */
export function soloOpenGate(standing: DispatcherStanding): { allowed: true } | { allowed: false; error: string } {
  if (standing.mode === "company") {
    return { allowed: false, error: soloOpenCompanyRefusal(standing.companyName ?? "a company") };
  }
  return { allowed: true };
}

/**
 * Is this poster load LIVE under a solo poster — the switching
 * guard's unit. Live means ON THE PUBLIC BOARD and still moving:
 * the poster load was released, its board row still stands (a
 * withdrawn row is deleted, so a missing row means withdrawn —
 * not live), the row is open or taken, and the delivery has not
 * sealed. Drafts, loads in platform review, and returned loads
 * were never on the board; sealed loads are done. Cancelled
 * carried loads surface as unsealed taken rows only until their
 * board row is withdrawn — the board row is the record of truth.
 */
export function soloPosterLoadIsLive(args: {
  posterStatus: string | null;
  boardStatus: string | null;
  boardRowExists: boolean;
  sealed: boolean;
}): boolean {
  if (args.sealed) return false;
  if (args.posterStatus !== "released") return false;
  if (!args.boardRowExists) return false;
  return args.boardStatus === "open" || args.boardStatus === "taken";
}

/** How many of a solo poster's loads are live right now. */
export function countSoloLiveLoads(
  rows: { posterStatus: string | null; boardStatus: string | null; boardRowExists: boolean; sealed: boolean }[],
): number {
  return rows.filter((r) => soloPosterLoadIsLive(r)).length;
}

/** The close-the-solo-desk refusal while live loads stand. */
export function soloCloseLiveLoadsRefusal(liveLoadCount: number): string {
  const noun = liveLoadCount === 1 ? "live load" : "live loads";
  const pron = liveLoadCount === 1 ? "it" : "them";
  return `You still have ${liveLoadCount} ${noun} on the board under your solo desk — one desk or the other, and freight can't cross the switch. Let ${pron} finish or withdraw ${pron} first, then close the desk.`;
}

/** May the solo desk close? Only with no live loads under the solo
 *  poster. Closing deletes NOTHING: pipeline history and recorded
 *  platform-fee accruals stand exactly as recorded. */
export function closeSoloDeskGate(args: {
  liveLoadCount: number;
}): { allowed: true } | { allowed: false; error: string } {
  if (args.liveLoadCount > 0) return { allowed: false, error: soloCloseLiveLoadsRefusal(args.liveLoadCount) };
  return { allowed: true };
}
