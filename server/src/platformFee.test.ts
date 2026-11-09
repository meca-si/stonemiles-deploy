import { describe, expect, test } from "bun:test";
import {
  PLATFORM_FEE_LABEL,
  PLATFORM_FEE_PCT,
  platformFeeApplies,
  platformFeeForGross,
} from "./platformFee";
import { resolveDispatcherStanding, type DispatcherStanding } from "./myDesk";

/**
 * PLATFORM FEE pure rules (x, 2026-11-02 correction): 2% of gross,
 * dispatch-only posters only, recorded at sealed delivery. These
 * tests run the EXACT decision + math ensurePlatformFeeEntry runs.
 */

describe("platform fee math", () => {
  test("the rate is 2% and the label is the plain invoiced-at-seal label", () => {
    expect(PLATFORM_FEE_PCT).toBe(2);
    expect(PLATFORM_FEE_LABEL).toBe("Platform fee 2% — invoiced at sealed delivery");
  });

  test("2% of gross, at cent precision", () => {
    expect(platformFeeForGross(1000)).toBe(20);
    expect(platformFeeForGross(2750)).toBe(55);
    expect(platformFeeForGross(0)).toBe(0);
    expect(platformFeeForGross(1234.56)).toBe(24.69);
    expect(platformFeeForGross(99.99)).toBe(2);
  });
});

describe("platform fee applicability", () => {
  test("a dispatch-only company's poster load accrues it", () => {
    expect(
      platformFeeApplies({ originKind: "broker_poster", posterCompanyKind: "dispatch", posterCompanyActivated: false }),
    ).toBe(true);
  });

  test("a CONVERTED dispatch company never accrues it", () => {
    expect(
      platformFeeApplies({ originKind: "broker_poster", posterCompanyKind: "dispatch", posterCompanyActivated: true }),
    ).toBe(false);
  });

  test("fleet posters and shipper/desk posters never accrue it", () => {
    expect(
      platformFeeApplies({ originKind: "broker_poster", posterCompanyKind: "fleet", posterCompanyActivated: false }),
    ).toBe(false);
    expect(
      platformFeeApplies({ originKind: "broker_poster", posterCompanyKind: null, posterCompanyActivated: false }),
    ).toBe(false);
  });

  test("fleet overflow and company-board origins never accrue it", () => {
    expect(
      platformFeeApplies({ originKind: "fleet_overflow", posterCompanyKind: "dispatch", posterCompanyActivated: false }),
    ).toBe(false);
    expect(
      platformFeeApplies({ originKind: null, posterCompanyKind: "dispatch", posterCompanyActivated: false }),
    ).toBe(false);
  });
});

describe("platform fee applicability — round 3 solo dispatcher posters", () => {
  test("a SOLO dispatcher poster (opened My Desk, no company) accrues it", () => {
    expect(
      platformFeeApplies({
        originKind: "broker_poster",
        posterCompanyKind: null,
        posterCompanyActivated: false,
        posterIsSoloDispatcher: true,
      }),
    ).toBe(true);
  });

  test("a poster under a fleet roof who opened My Desk accrues as a solo dispatcher — the flag is the opt-in", () => {
    expect(
      platformFeeApplies({
        originKind: "broker_poster",
        posterCompanyKind: "fleet",
        posterCompanyActivated: false,
        posterIsSoloDispatcher: true,
      }),
    ).toBe(true);
    // Without the flag, the round-2 rule stands: fleet posters never accrue.
    expect(
      platformFeeApplies({
        originKind: "broker_poster",
        posterCompanyKind: "fleet",
        posterCompanyActivated: false,
        posterIsSoloDispatcher: false,
      }),
    ).toBe(false);
  });

  test("a shipper/broker direct poster who never opened a dispatcher desk does NOT accrue", () => {
    expect(
      platformFeeApplies({
        originKind: "broker_poster",
        posterCompanyKind: null,
        posterCompanyActivated: false,
        posterIsSoloDispatcher: false,
      }),
    ).toBe(false);
    // The flag defaults off when the caller doesn't resolve one.
    expect(
      platformFeeApplies({ originKind: "broker_poster", posterCompanyKind: null, posterCompanyActivated: false }),
    ).toBe(false);
  });

  test("the solo flag never rescues a non-poster origin", () => {
    expect(
      platformFeeApplies({
        originKind: "fleet_overflow",
        posterCompanyKind: null,
        posterCompanyActivated: false,
        posterIsSoloDispatcher: true,
      }),
    ).toBe(false);
    expect(
      platformFeeApplies({
        originKind: null,
        posterCompanyKind: null,
        posterCompanyActivated: false,
        posterIsSoloDispatcher: true,
      }),
    ).toBe(false);
  });

  test("dispatch-company posters are judged by their company alone — the flag changes nothing there", () => {
    // A dispatch-only company poster accrues by the company rule, flag or not.
    expect(
      platformFeeApplies({
        originKind: "broker_poster",
        posterCompanyKind: "dispatch",
        posterCompanyActivated: false,
        posterIsSoloDispatcher: false,
      }),
    ).toBe(true);
    // A converted company never accrues, flag or not.
    expect(
      platformFeeApplies({
        originKind: "broker_poster",
        posterCompanyKind: "dispatch",
        posterCompanyActivated: true,
        posterIsSoloDispatcher: true,
      }),
    ).toBe(false);
  });
});

describe("platform fee — round 4 reconciliation (company standing wins)", () => {
  // ensurePlatformFeeEntry's exact composition: the poster standing
  // is resolved first (resolveDispatcherStanding), and only its
  // EFFECTIVE solo value feeds posterIsSoloDispatcher. These cases
  // run a poster under a FLEET roof (the membership company the
  // accrual resolves) whose own flag/standing varies.
  const accrues = (standing: DispatcherStanding) =>
    platformFeeApplies({
      originKind: "broker_poster",
      posterCompanyKind: "fleet",
      posterCompanyActivated: false,
      posterIsSoloDispatcher: standing.soloEffective,
    });
  const poster = (over: Partial<Parameters<typeof resolveDispatcherStanding>[0]>) =>
    resolveDispatcherStanding({ seats: [], ownedDispatchCompanies: [], soloDispatcher: true, ...over });

  test("stored BOTH (flag open + a dispatch seat anywhere): NO solo accrual while the seat stands", () => {
    const both = poster({
      seats: [{ companyId: 9, companyName: "Other Co", companyKind: "dispatch", role: "dispatch" }],
    });
    expect(both.soloSuppressed).toBe(true);
    expect(accrues(both)).toBe(false);
  });

  test("stored BOTH via dispatch-company ownership: the flag accrues nothing either", () => {
    const both = poster({
      ownedDispatchCompanies: [{ companyId: 7, companyName: "Acme Dispatch" }],
    });
    expect(both.mode).toBe("company");
    expect(accrues(both)).toBe(false);
  });

  test("the seat goes, the flag stands alone again — accrual resumes on the same account", () => {
    const seatGone = poster({ seats: [] });
    expect(seatGone.mode).toBe("solo");
    expect(accrues(seatGone)).toBe(true);
  });

  test("closing the solo desk stops NEW accruals — the decision never reaches back into recorded entries", () => {
    // After closeMyDesk the flag is false: the same poster resolves
    // to no standing and the gate closes. The decision function
    // takes no entry history as input — an accrual already recorded
    // is a row nothing in this path can rewrite or delete, which is
    // exactly what "history preserved after close" means here.
    const closed = poster({ soloDispatcher: false });
    expect(closed.mode).toBe("none");
    expect(accrues(closed)).toBe(false);
  });
});
