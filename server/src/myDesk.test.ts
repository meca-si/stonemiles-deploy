import { describe, expect, test } from "bun:test";
import {
  MY_DESK_PIPELINE_LABELS,
  SOLO_DESK_OPEN_REFUSAL,
  closeSoloDeskGate,
  countSoloLiveLoads,
  myDeskAccess,
  myDeskContextLabel,
  myDeskFee,
  myDeskPipelineState,
  resolveDispatcherStanding,
  soloDeskOpenRefusalFor,
  soloOpenCompanyRefusal,
  soloOpenGate,
  soloPosterLoadIsLive,
  validateSoloPosterLink,
  type DispatcherSeat,
} from "./myDesk";

/**
 * MY DESK pure rules (round 3, x 2026-11-02): the three doors in,
 * the plain pipeline states, and the fee precedence the desk shows.
 * These run the EXACT functions getMyDesk / openMyDesk rely on.
 */

describe("my desk eligibility — the three doors", () => {
  test("a dispatch-seat holder in ANY company is eligible", () => {
    expect(myDeskAccess({ membershipKind: "fleet", membershipRole: "dispatch", soloDispatcher: false })).toEqual({
      eligible: true,
      via: "dispatch_seat",
    });
    expect(myDeskAccess({ membershipKind: "dispatch", membershipRole: "dispatch", soloDispatcher: false })).toEqual({
      eligible: true,
      via: "dispatch_seat",
    });
  });

  test("a dispatch company's owner is eligible", () => {
    expect(myDeskAccess({ membershipKind: "dispatch", membershipRole: "owner", soloDispatcher: false })).toEqual({
      eligible: true,
      via: "dispatch_company_owner",
    });
  });

  test("a solo dispatcher (opened the desk) is eligible with no company at all", () => {
    expect(myDeskAccess({ membershipKind: null, membershipRole: null, soloDispatcher: true })).toEqual({
      eligible: true,
      via: "solo",
    });
  });

  test("the seat door outranks the solo flag — a working dispatcher reads as a seat, not solo", () => {
    expect(myDeskAccess({ membershipKind: "fleet", membershipRole: "dispatch", soloDispatcher: true }).via).toBe(
      "dispatch_seat",
    );
    expect(myDeskAccess({ membershipKind: "dispatch", membershipRole: "owner", soloDispatcher: true }).via).toBe(
      "dispatch_company_owner",
    );
  });

  test("a fleet owner and a driver seat are NOT doors in on their own", () => {
    expect(myDeskAccess({ membershipKind: "fleet", membershipRole: "owner", soloDispatcher: false })).toEqual({
      eligible: false,
      via: null,
    });
    expect(myDeskAccess({ membershipKind: "dispatch", membershipRole: "driver", soloDispatcher: false })).toEqual({
      eligible: false,
      via: null,
    });
    expect(myDeskAccess({ membershipKind: null, membershipRole: null, soloDispatcher: false })).toEqual({
      eligible: false,
      via: null,
    });
  });

  test("a driver who opened the desk solo is in through the solo door", () => {
    expect(myDeskAccess({ membershipKind: "fleet", membershipRole: "driver", soloDispatcher: true })).toEqual({
      eligible: true,
      via: "solo",
    });
  });
});

describe("my desk context label", () => {
  test("names the roof the dispatcher works under", () => {
    expect(myDeskContextLabel({ via: "dispatch_seat", companyName: "RUGGS LOGISTICS", companyKind: "dispatch" })).toBe(
      "Dispatch seat at RUGGS LOGISTICS",
    );
    expect(
      myDeskContextLabel({ via: "dispatch_company_owner", companyName: "Acme Dispatch", companyKind: "dispatch" }),
    ).toBe("Owner of Acme Dispatch (dispatch company)");
    expect(myDeskContextLabel({ via: "solo", companyName: null, companyKind: null })).toBe(
      "Solo dispatcher — your own desk",
    );
    expect(myDeskContextLabel({ via: null, companyName: null, companyKind: null })).toBeNull();
  });
});

describe("my desk pipeline states — plain words, approval visible", () => {
  test("poster lifecycle: draft → in platform review → live → claimed → delivered", () => {
    expect(myDeskPipelineState({ posterStatus: "draft", boardStatus: null, sealed: false })).toBe("draft");
    expect(myDeskPipelineState({ posterStatus: "sent", boardStatus: null, sealed: false })).toBe("review");
    expect(myDeskPipelineState({ posterStatus: "released", boardStatus: "open", sealed: false })).toBe("live");
    expect(myDeskPipelineState({ posterStatus: "released", boardStatus: "taken", sealed: false })).toBe("claimed");
    expect(myDeskPipelineState({ posterStatus: "released", boardStatus: "taken", sealed: true })).toBe("delivered");
  });

  test("a load sent back by the desk is a draft again (back in the poster's hands)", () => {
    expect(myDeskPipelineState({ posterStatus: "returned", boardStatus: null, sealed: false })).toBe("draft");
  });

  test("company-board posts: open is live, taken is claimed, sealed outranks all", () => {
    expect(myDeskPipelineState({ posterStatus: null, boardStatus: "open", sealed: false })).toBe("live");
    expect(myDeskPipelineState({ posterStatus: null, boardStatus: "taken", sealed: false })).toBe("claimed");
    expect(myDeskPipelineState({ posterStatus: null, boardStatus: "taken", sealed: true })).toBe("delivered");
    expect(myDeskPipelineState({ posterStatus: "draft", boardStatus: "taken", sealed: true })).toBe("delivered");
  });

  test("an overflowed board row reads live — the open copy carries the claim", () => {
    expect(myDeskPipelineState({ posterStatus: null, boardStatus: "overflowed", sealed: false })).toBe("live");
  });

  test("the labels are the spec's plain states", () => {
    expect(MY_DESK_PIPELINE_LABELS).toEqual({
      draft: "Draft",
      review: "In platform review",
      live: "Live on the board",
      claimed: "Claimed",
      delivered: "Delivered — sealed",
    });
  });
});

describe("my fee — which value is in effect on my loads", () => {
  test("my poster override wins over the company default", () => {
    expect(myDeskFee({ posterFeePct: 12, companyFeePct: 8 })).toEqual({ effectiveFeePct: 12, source: "poster" });
  });

  test("the company default applies when I set no override", () => {
    expect(myDeskFee({ posterFeePct: null, companyFeePct: 8 })).toEqual({ effectiveFeePct: 8, source: "company" });
  });

  test("nothing set anywhere means no fee — unset is 0%", () => {
    expect(myDeskFee({ posterFeePct: null, companyFeePct: null })).toEqual({ effectiveFeePct: null, source: "none" });
  });

  test("a solo dispatcher's fee is their poster setting alone", () => {
    expect(myDeskFee({ posterFeePct: 15, companyFeePct: null })).toEqual({ effectiveFeePct: 15, source: "poster" });
    expect(myDeskFee({ posterFeePct: null, companyFeePct: null }).source).toBe("none");
  });
});

describe("solo poster link validation", () => {
  test("a name and a real-looking email pass, trimmed", () => {
    expect(validateSoloPosterLink({ name: "  Dee's Dispatch ", email: " dee@example.com " })).toEqual({
      ok: true,
      name: "Dee's Dispatch",
      email: "dee@example.com",
    });
  });

  test("no name, no link", () => {
    const r = validateSoloPosterLink({ name: "  ", email: "dee@example.com" });
    expect(r.ok).toBe(false);
  });

  test("a malformed email is refused plainly", () => {
    const r = validateSoloPosterLink({ name: "Dee's Dispatch", email: "not-an-email" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("contact email");
  });
});

// ---- Round 4: dispatcher exclusivity — one desk or the other -----------------

const seat = (over: Partial<DispatcherSeat>): DispatcherSeat => ({
  companyId: 1,
  companyName: "RUGGS LOGISTICS",
  companyKind: "fleet",
  role: "driver",
  ...over,
});

describe("dispatcher standing — the one mode (round 4)", () => {
  test("a dispatch seat in ANY company is company standing", () => {
    const s = resolveDispatcherStanding({
      seats: [seat({ role: "dispatch" })],
      ownedDispatchCompanies: [],
      soloDispatcher: false,
    });
    expect(s.mode).toBe("company");
    expect(s.via).toBe("dispatch_seat");
    expect(s.companyName).toBe("RUGGS LOGISTICS");
    expect(s.soloEffective).toBe(false);
    expect(s.soloSuppressed).toBe(false);
  });

  test("owning a dispatch company is company standing — by owner seat or by ownership alone", () => {
    const bySeat = resolveDispatcherStanding({
      seats: [seat({ companyId: 7, companyName: "Acme Dispatch", companyKind: "dispatch", role: "owner" })],
      ownedDispatchCompanies: [{ companyId: 7, companyName: "Acme Dispatch" }],
      soloDispatcher: false,
    });
    expect(bySeat.mode).toBe("company");
    expect(bySeat.via).toBe("dispatch_company_owner");
    const byOwnership = resolveDispatcherStanding({
      seats: [],
      ownedDispatchCompanies: [{ companyId: 7, companyName: "Acme Dispatch" }],
      soloDispatcher: false,
    });
    expect(byOwnership.mode).toBe("company");
    expect(byOwnership.via).toBe("dispatch_company_owner");
    expect(byOwnership.companyName).toBe("Acme Dispatch");
  });

  test("a dispatch seat outranks an owned dispatch company for the standing's name", () => {
    const s = resolveDispatcherStanding({
      seats: [seat({ companyId: 2, companyName: "Fleet Co", role: "dispatch" })],
      ownedDispatchCompanies: [{ companyId: 7, companyName: "Acme Dispatch" }],
      soloDispatcher: false,
    });
    expect(s.via).toBe("dispatch_seat");
    expect(s.companyName).toBe("Fleet Co");
  });

  test("stored BOTH: company standing wins — the flag stands on file but reads as closed", () => {
    const s = resolveDispatcherStanding({
      seats: [seat({ role: "dispatch" })],
      ownedDispatchCompanies: [],
      soloDispatcher: true,
    });
    expect(s.mode).toBe("company");
    expect(s.soloFlagOpen).toBe(true);
    expect(s.soloEffective).toBe(false);
    expect(s.soloSuppressed).toBe(true);
  });

  test("a driver seat and a fleet OWNER seat are not company standing — the flag runs solo over them", () => {
    for (const role of ["driver", "owner"] as const) {
      const s = resolveDispatcherStanding({
        seats: [seat({ role })],
        ownedDispatchCompanies: [],
        soloDispatcher: true,
      });
      expect(s.mode).toBe("solo");
      expect(s.via).toBe("solo");
      expect(s.soloEffective).toBe(true);
      expect(s.soloSuppressed).toBe(false);
    }
  });

  test("flag alone is solo; nothing at all is no mode", () => {
    expect(
      resolveDispatcherStanding({ seats: [], ownedDispatchCompanies: [], soloDispatcher: true }).mode,
    ).toBe("solo");
    const none = resolveDispatcherStanding({ seats: [], ownedDispatchCompanies: [], soloDispatcher: false });
    expect(none.mode).toBe("none");
    expect(none.via).toBeNull();
  });
});

describe("the solo door refuses under company standing (round 4)", () => {
  test("the refusal is x's sentence, naming the company", () => {
    const s = resolveDispatcherStanding({
      seats: [seat({ role: "dispatch" })],
      ownedDispatchCompanies: [],
      soloDispatcher: false,
    });
    const gate = soloOpenGate(s);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.error).toBe(
        "You're dispatching under RUGGS LOGISTICS — a dispatcher runs one desk or the other, never both. Leave the company's dispatch seat to run solo.",
      );
    }
    expect(soloOpenCompanyRefusal("Acme Dispatch")).toContain("You're dispatching under Acme Dispatch");
  });

  test("the door opens in solo mode and with no standing at all", () => {
    expect(
      soloOpenGate(resolveDispatcherStanding({ seats: [], ownedDispatchCompanies: [], soloDispatcher: true }))
        .allowed,
    ).toBe(true);
    expect(
      soloOpenGate(resolveDispatcherStanding({ seats: [], ownedDispatchCompanies: [], soloDispatcher: false }))
        .allowed,
    ).toBe(true);
  });

  test("seat removal, then solo opens: the seat must actually be gone first", () => {
    // Standing WITH the dispatch seat: the solo door refuses.
    const withSeat = resolveDispatcherStanding({
      seats: [seat({ role: "dispatch" })],
      ownedDispatchCompanies: [],
      soloDispatcher: false,
    });
    expect(soloOpenGate(withSeat).allowed).toBe(false);
    // The seat leaves the roster (leaveCompany / removeCompanyMember
    // delete the row): the same profile now resolves with NO company
    // standing, and the very same gate lets the solo door open.
    const seatGone = resolveDispatcherStanding({
      seats: [],
      ownedDispatchCompanies: [],
      soloDispatcher: false,
    });
    expect(seatGone.mode).toBe("none");
    expect(soloOpenGate(seatGone).allowed).toBe(true);
    // And a driver seat (never company standing) never blocked it.
    const driverSeat = resolveDispatcherStanding({
      seats: [seat({ role: "driver" })],
      ownedDispatchCompanies: [],
      soloDispatcher: false,
    });
    expect(soloOpenGate(driverSeat).allowed).toBe(true);
  });
});

describe("the company doors refuse while the solo desk is open (round 4)", () => {
  test("the refusal copy is x's sentences — first person for your own doors, named for an owner's", () => {
    expect(SOLO_DESK_OPEN_REFUSAL).toBe(
      "Your solo desk is open — one desk or the other. Close the solo desk first (live loads must finish or be withdrawn first).",
    );
    expect(soloDeskOpenRefusalFor("dee")).toBe(
      "@dee's solo desk is open — one desk or the other. They have to close the solo desk first (live loads must finish or be withdrawn first).",
    );
  });

  test("the refusal keys on the EFFECTIVE solo standing — a suppressed flag blocks nothing twice", () => {
    // Stored BOTH: company standing already governs; the company
    // doors are not the problem (the membership gates refuse on
    // their own). The exclusivity refusal fires only in solo mode.
    const both = resolveDispatcherStanding({
      seats: [seat({ role: "dispatch" })],
      ownedDispatchCompanies: [],
      soloDispatcher: true,
    });
    expect(both.soloEffective).toBe(false);
    const solo = resolveDispatcherStanding({ seats: [], ownedDispatchCompanies: [], soloDispatcher: true });
    expect(solo.soloEffective).toBe(true);
  });
});

describe("the switching guard — live loads under the solo poster (round 4)", () => {
  const row = (over: Partial<{ posterStatus: string | null; boardStatus: string | null; boardRowExists: boolean; sealed: boolean }>) => ({
    posterStatus: "released",
    boardStatus: "open",
    boardRowExists: true,
    sealed: false,
    ...over,
  });

  test("on the board and unsealed is live — open or taken", () => {
    expect(soloPosterLoadIsLive(row({}))).toBe(true);
    expect(soloPosterLoadIsLive(row({ boardStatus: "taken" }))).toBe(true);
  });

  test("sealed is done — never live, whatever the board row says", () => {
    expect(soloPosterLoadIsLive(row({ boardStatus: "taken", sealed: true }))).toBe(false);
    expect(soloPosterLoadIsLive(row({ sealed: true }))).toBe(false);
  });

  test("withdrawn is not live — the board row is gone", () => {
    expect(soloPosterLoadIsLive(row({ boardStatus: null, boardRowExists: false }))).toBe(false);
  });

  test("never on the board is not live — drafts, in review, returned", () => {
    expect(soloPosterLoadIsLive(row({ posterStatus: "draft", boardStatus: null, boardRowExists: false }))).toBe(false);
    expect(soloPosterLoadIsLive(row({ posterStatus: "sent", boardStatus: null, boardRowExists: false }))).toBe(false);
    expect(soloPosterLoadIsLive(row({ posterStatus: "returned", boardStatus: null, boardRowExists: false }))).toBe(false);
  });

  test("the count sees only the live ones in a mixed pipeline", () => {
    expect(
      countSoloLiveLoads([
        row({}),
        row({ boardStatus: "taken" }),
        row({ boardStatus: "taken", sealed: true }),
        row({ boardStatus: null, boardRowExists: false }),
        row({ posterStatus: "sent", boardStatus: null, boardRowExists: false }),
        row({ posterStatus: "draft", boardStatus: null, boardRowExists: false }),
      ]),
    ).toBe(2);
  });

  test("closing refuses with live loads standing, and the copy says why", () => {
    expect(closeSoloDeskGate({ liveLoadCount: 0 })).toEqual({ allowed: true });
    const one = closeSoloDeskGate({ liveLoadCount: 1 });
    expect(one.allowed).toBe(false);
    if (!one.allowed) {
      expect(one.error).toContain("1 live load");
      expect(one.error).toContain("freight can't cross the switch");
    }
    const three = closeSoloDeskGate({ liveLoadCount: 3 });
    expect(three.allowed).toBe(false);
    if (!three.allowed) expect(three.error).toContain("3 live loads");
  });

  test("the close is allowed after the live load seals — and after it is withdrawn", () => {
    // Same load, two later moments: sealed on delivery…
    const afterSeal = countSoloLiveLoads([row({ boardStatus: "taken", sealed: true })]);
    expect(afterSeal).toBe(0);
    expect(closeSoloDeskGate({ liveLoadCount: afterSeal })).toEqual({ allowed: true });
    // …or withdrawn from the board (row deleted).
    const afterWithdraw = countSoloLiveLoads([row({ boardStatus: null, boardRowExists: false })]);
    expect(afterWithdraw).toBe(0);
    expect(closeSoloDeskGate({ liveLoadCount: afterWithdraw })).toEqual({ allowed: true });
  });
});
