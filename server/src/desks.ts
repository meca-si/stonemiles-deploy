/**
 * BROKER DESK + OWNER DESK — the poster and fleet-owner home
 * screens (round 5, x 2026-11-02: "Build Broker Desk + Owner Desk
 * to match My Desk"). Pure rules only.
 *
 * Rounds 3–4 gave the DISPATCHER a true named desk (My Desk,
 * myDesk.ts). Round 5 brings the other two money roles to the same
 * pattern — pipeline, fees, totals on one home screen each — layered
 * OVER the surfaces that already work: the Broker Portal keeps its
 * posting flows (the Broker Desk is its front door), and the Owner
 * Console keeps its deep work (the Owner Desk is the command screen
 * on top of it, with shortcuts in rather than duplicated functions).
 *
 * BROKER DESK ELIGIBILITY: accounts holding a linked poster account
 * (broker_accounts.linked_username — the Broker Portal population)
 * who are NOT operating as dispatchers. Dispatcher posters live on
 * My Desk (round 3/4 exclusivity): a caller whose resolved
 * dispatcher standing is COMPANY mode (a dispatch seat anywhere, or
 * a dispatch company of their own) or SOLO mode (their solo desk is
 * effectively open) never gets a Broker Desk for the same poster
 * work — their explainer points at My Desk. A poster holder with no
 * dispatcher standing at all is a broker/shipper poster: the desk
 * is theirs.
 *
 * OWNER DESK ELIGIBILITY: the owner of a kind=fleet company — an
 * owner seat in one, or owning one outright (companies.
 * ownerUsername). Dispatch company owners keep their Dispatch Desk
 * as their company roof; a dispatch seat, a driver seat, and owning
 * a dispatch company are NOT doors into the Owner Desk.
 *
 * WALLS (same structural discipline as My Desk): broker queries
 * filter to the caller's own poster account (brokerId), owner
 * queries to the caller's own company (companyId / originCompanyId).
 * Another poster's or company's rows never match a query — they
 * answer as nonexistent.
 */

import {
  FLEET_INCLUDED_DISPATCH_SEATS,
  FLEET_INCLUDED_DRIVER_SEATS,
  countFleetRosterSeats,
} from "./fleetCreation";
import type { CompanyKind } from "./dispatchCompany";
import type { DispatcherMode } from "./myDesk";

// ---- Broker Desk access -------------------------------------------------------

export type BrokerDeskReason = "poster" | "dispatcher" | "no_poster";

export interface BrokerDeskAccess {
  eligible: boolean;
  reason: BrokerDeskReason;
}

/**
 * Who gets the Broker Desk, decided server-side from the caller's
 * linked poster account + resolved dispatcher standing — never from
 * client input. The dispatcher check runs FIRST in effect: any
 * dispatcher standing (company or solo) routes the poster work to
 * My Desk, poster account or not; only a poster holder with no
 * dispatcher standing is a Broker Desk poster.
 */
export function brokerDeskAccess(args: {
  hasPosterAccount: boolean;
  dispatcherMode: DispatcherMode;
}): BrokerDeskAccess {
  if (args.dispatcherMode !== "none") return { eligible: false, reason: "dispatcher" };
  if (args.hasPosterAccount) return { eligible: true, reason: "poster" };
  return { eligible: false, reason: "no_poster" };
}

/**
 * The review/queue note under one of MY poster loads — whose queue
 * the load sits in and why, in plain words. Poster review rules are
 * unchanged: a sent load waits in its account's review queue (the
 * company the account is attached to — for desk-invited brokers,
 * the inviting desk's company); a returned load is back in the
 * poster's hands with the desk's note; a released load is on the
 * Open Board.
 */
export function brokerQueueNote(args: {
  posterStatus: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  queueCompanyName: string | null;
}): string | null {
  if (args.posterStatus === "sent") {
    return args.queueCompanyName
      ? `Waiting in ${args.queueCompanyName}'s review queue — that desk releases, edits, or returns portal loads, and nothing is public until they release it.`
      : "Waiting in the platform review queue — nothing is public until the platform desk releases it.";
  }
  if (args.posterStatus === "returned") {
    return `Sent back by the reviewing desk${args.reviewNote ? `: ${args.reviewNote}` : "."} Edit it in the Broker Portal and send it again when it's ready.`;
  }
  if (args.posterStatus === "released") {
    return `Released to the Open Board${args.reviewedBy ? ` by ${args.reviewedBy}` : ""}.`;
  }
  return null;
}

// ---- Desk totals (both desks) --------------------------------------------------

export interface DeskTotals {
  /** Every load on the desk's pipeline. */
  posted: number;
  /** Loads whose delivery sealed. */
  sealed: number;
  /** Gross freight that moved through the sealed loads. */
  grossMoved: number;
}

/** Loads posted / loads sealed / gross moved — the totals line
 *  both desks carry. Gross counts ONLY sealed loads (freight that
 *  actually moved), off each row's own gross (the poster load's
 *  rate; a board row's rate + extra charges). */
export function deskTotals(rows: { state: string; gross: number | null }[]): DeskTotals {
  let sealed = 0;
  let gross = 0;
  for (const r of rows) {
    if (r.state !== "delivered") continue;
    sealed += 1;
    gross += r.gross ?? 0;
  }
  return { posted: rows.length, sealed, grossMoved: Math.round(gross * 100) / 100 };
}

// ---- Owner Desk access ----------------------------------------------------------

export interface OwnerDeskSeat {
  companyKind: CompanyKind;
  role: string;
}

/**
 * Who gets the Owner Desk: the owner of a kind=fleet company — an
 * owner seat in a fleet company, or a fleet company they own
 * outright (companies.ownerUsername). A dispatch company's owner
 * is NOT eligible through that company (their roof is the Dispatch
 * Desk), but a fleet company they also own opens this desk —
 * Owner Desk + My Desk (company mode) coexist for fleet owners who
 * dispatch under their own fleet, exactly as round 4 left them.
 */
export function ownerDeskAccess(args: {
  seats: OwnerDeskSeat[];
  ownedKinds: CompanyKind[];
}): boolean {
  if (args.seats.some((s) => s.role === "owner" && s.companyKind === "fleet")) return true;
  return args.ownedKinds.includes("fleet");
}

/** Which board a company pipeline row lives on, in plain words. */
export function ownerDeskScopeLabel(boardScope: string | null | undefined): string {
  return boardScope === "open" ? "Open Board" : "Company board";
}

// ---- Owner Desk roster snapshot ---------------------------------------------------

export interface OwnerRosterSnapshot {
  members: number;
  owners: number;
  drivers: number;
  dispatchSeats: number;
  /** Seats the plan counts as driver seats (owner + driver roles —
   *  the same count the fleet billing basis runs on). */
  driverSeatsUsed: number;
  includedDriverSeats: number;
  driverSeatsAvailable: number;
  dispatchSeatsUsed: number;
  includedDispatchSeats: number;
  dispatchSeatsAvailable: number;
}

/** The roster snapshot: who's on the company, and how the seats
 *  stand against the Fleet Owner plan's included allowances (3
 *  driver seats, the first dispatch seat — the locked seat math in
 *  fleetCreation.ts). "Available" never goes negative; seats past
 *  the allowance are the extra seats the billing basis prices. */
export function ownerRosterSnapshot(members: { role: string }[]): OwnerRosterSnapshot {
  const seats = countFleetRosterSeats(members);
  return {
    members: members.length,
    owners: members.filter((m) => m.role === "owner").length,
    drivers: members.filter((m) => m.role === "driver").length,
    dispatchSeats: members.filter((m) => m.role === "dispatch").length,
    driverSeatsUsed: seats.driverSeats,
    includedDriverSeats: FLEET_INCLUDED_DRIVER_SEATS,
    driverSeatsAvailable: Math.max(0, FLEET_INCLUDED_DRIVER_SEATS - seats.driverSeats),
    dispatchSeatsUsed: seats.dispatchSeats,
    includedDispatchSeats: FLEET_INCLUDED_DISPATCH_SEATS,
    dispatchSeatsAvailable: Math.max(0, FLEET_INCLUDED_DISPATCH_SEATS - seats.dispatchSeats),
  };
}
