import { describe, expect, test } from "bun:test";
import {
COLLECTION_WINDOW_DAYS,
REVOKE_DAYS,
dispatchFeeFor,
feeEligibility,
freightAmountFor,
gateFor,
ladderFor,
planFeeSync,
type GateInvoice,
} from "./dispatchFee";

const DAY = 86_400_000;
const SEAL = Date.parse("2026-10-26T12:00:00.000Z"); // delivery / POD seal

describe("dispatch fee math (from the packet amount)", () => {
  test("fee is exactly 10% of the packet's final freight amount", () => {
    expect(freightAmountFor(2500, 0)).toBe(2500);
    expect(dispatchFeeFor(2500)).toBe(250);
    // Rate + additional charges is the packet amount.
    expect(freightAmountFor(2400, 100)).toBe(2500);
    expect(dispatchFeeFor(freightAmountFor(2400, 100)!)).toBe(250);
  });

  test("fee rounds to cents like the invoice does", () => {
    expect(dispatchFeeFor(1234.56)).toBe(123.46);
    expect(dispatchFeeFor(999.99)).toBe(100);
    expect(freightAmountFor(100.1, 0.02)).toBe(100.12);
  });

  test("no rate on the load → no freight amount → no fee yet", () => {
    expect(freightAmountFor(null, 50)).toBeNull();
  });
});

describe("idempotency under packet refresh", () => {
  test("first assembly creates the invoice", () => {
    expect(planFeeSync(null, 2500)).toEqual({ action: "create", feeAmount: 250 });
  });

  test("a re-seal / packet refresh with the same amount never double-bills", () => {
    const existing = { freightAmount: 2500, feeAmount: 250 };
    expect(planFeeSync(existing, 2500)).toEqual({ action: "none", feeAmount: 250 });
    // Refresh after refresh stays a no-op.
    expect(planFeeSync(existing, 2500).action).toBe("none");
  });

  test("a corrected packet amount moves the fee to the final amount", () => {
    const existing = { freightAmount: 2500, feeAmount: 250 };
    expect(planFeeSync(existing, 3000)).toEqual({
      action: "update_amount",
      feeAmount: 300,
      previousFeeAmount: 250,
      previousFreightAmount: 2500,
    });
    // And a correction downward follows too.
    expect(planFeeSync(existing, 2000).feeAmount).toBe(200);
  });
});

describe("ladder — day 7 warning and day 10 revocation boundaries", () => {
  const base = { deliveredAtMs: SEAL, feeAmount: 250, paidAmount: 0, paidAtMs: null };

  test("days 0–6 unpaid = collection window", () => {
    for (const d of [0, 1, 6]) {
      const l = ladderFor({ ...base, nowMs: SEAL + d * DAY });
      expect(l.status).toBe("window");
      expect(l.daysOutstanding).toBe(d);
      expect(l.everWarned).toBe(false);
      expect(l.everRevoked).toBe(false);
    }
    // One millisecond before day 7 is still the window.
    expect(ladderFor({ ...base, nowMs: SEAL + 7 * DAY - 1 }).status).toBe("window");
  });

  test("exactly day 7 unpaid = WARNING", () => {
    const l = ladderFor({ ...base, nowMs: SEAL + COLLECTION_WINDOW_DAYS * DAY });
    expect(l.status).toBe("warning");
    expect(l.everWarned).toBe(true);
    expect(l.everRevoked).toBe(false);
    expect(ladderFor({ ...base, nowMs: SEAL + 9 * DAY }).status).toBe("warning");
    expect(ladderFor({ ...base, nowMs: SEAL + 10 * DAY - 1 }).status).toBe("warning");
  });

  test("exactly day 10 unpaid = REVOKED", () => {
    const l = ladderFor({ ...base, nowMs: SEAL + REVOKE_DAYS * DAY });
    expect(l.status).toBe("revoked");
    expect(l.everWarned).toBe(true);
    expect(l.everRevoked).toBe(true);
    expect(ladderFor({ ...base, nowMs: SEAL + 30 * DAY }).status).toBe("revoked");
  });

  test("payment in full restores standing — warning/late history remains", () => {
    // Paid on day 3: clean record.
    const early = ladderFor({ ...base, paidAmount: 250, paidAtMs: SEAL + 3 * DAY, nowMs: SEAL + 40 * DAY });
    expect(early.status).toBe("paid");
    expect(early.everWarned).toBe(false);
    expect(early.everRevoked).toBe(false);
    // Paid on day 8: standing restored, warning stays on the record.
    const warned = ladderFor({ ...base, paidAmount: 250, paidAtMs: SEAL + 8 * DAY, nowMs: SEAL + 40 * DAY });
    expect(warned.status).toBe("paid");
    expect(warned.everWarned).toBe(true);
    expect(warned.everRevoked).toBe(false);
    // Paid on day 12: standing restored, revocation history stays.
    const revoked = ladderFor({ ...base, paidAmount: 250, paidAtMs: SEAL + 12 * DAY, nowMs: SEAL + 40 * DAY });
    expect(revoked.status).toBe("paid");
    expect(revoked.everWarned).toBe(true);
    expect(revoked.everRevoked).toBe(true);
  });

  test("a partial payment records but does not change the ladder or clear the balance", () => {
    const l = ladderFor({ ...base, paidAmount: 100, nowMs: SEAL + 8 * DAY });
    expect(l.status).toBe("warning");
    expect(l.balanceDue).toBe(150);
  });
});

describe("settle-to-claim gate", () => {
  const inv = (over: Partial<GateInvoice>): GateInvoice => ({
    loadId: 1,
    boardLoadId: 1,
    status: "window",
    balanceDue: 250,
    feeAmount: 250,
    daysOutstanding: 2,
    ...over,
  });

  test("no invoices / all paid → gate open", () => {
    expect(gateFor([]).blocked).toBe(false);
    const paid = gateFor([inv({ status: "paid", balanceDue: 0 })]);
    expect(paid.blocked).toBe(false);
    expect(paid.revoked).toBe(false);
  });

  test("an unpaid fee blocks, naming the oldest load and the amount", () => {
    const g = gateFor([
      inv({ loadId: 7, daysOutstanding: 1, balanceDue: 100 }),
      inv({ loadId: 5, daysOutstanding: 4, balanceDue: 250 }),
    ]);
    expect(g.blocked).toBe(true);
    expect(g.blocking?.loadId).toBe(5);
    expect(g.totalDue).toBe(350);
    expect(g.revoked).toBe(false);
  });

  test("a partially paid fee still blocks (paid in full is what clears it)", () => {
    const g = gateFor([inv({ balanceDue: 1 })]);
    expect(g.blocked).toBe(true);
    expect(g.totalDue).toBe(1);
  });

  test("a day-10 unpaid fee is a permission-level revocation, distinct from the window block", () => {
    const g = gateFor([inv({ status: "revoked", daysOutstanding: 11 })]);
    expect(g.blocked).toBe(true);
    expect(g.revoked).toBe(true);
    expect(g.warned).toBe(true);
  });

  test("paying in full unblocks — the same invoice list with the fee settled opens the gate", () => {
    const before = gateFor([inv({ status: "revoked", daysOutstanding: 11 })]);
    expect(before.blocked).toBe(true);
    const after = gateFor([inv({ status: "paid", balanceDue: 0, daysOutstanding: 11 })]);
    expect(after.blocked).toBe(false);
    expect(after.revoked).toBe(false);
  });
});

describe("Granted-lane double-charge guard", () => {
  test("a load with no board row (Granted-lane / manual / solo) is excluded", () => {
    const g = feeEligibility({ boardRow: null });
    expect(g.eligible).toBe(false);
  });

  test("a board row that was never claimed is excluded", () => {
    expect(feeEligibility({ boardRow: { status: "open", claimedBy: null } }).eligible).toBe(false);
  });

  test("only a taken board row claimed by a carrier is eligible", () => {
    expect(feeEligibility({ boardRow: { status: "taken", claimedBy: "carrier1" } }).eligible).toBe(true);
  });
});
