import { describe, expect, test } from "bun:test";
import {
acceptGate,
deliveryToPayEntry,
eligibleRecipients,
flagGate,
senderGate,
shouldAutoEmailPayStub,
validateStubRecipient,
withdrawGate,
type RosterMember,
} from "./payStub";
import { summarizePayBook } from "./payBook";

const roster: RosterMember[] = [
  { username: "boss", role: "owner" },
  { username: "desk", role: "dispatch" },
  { username: "driverone", role: "driver" },
  { username: "drivertwo", role: "driver" },
];

describe("Pay-stub delivery — sender role gates", () => {
  test("owner and dispatch can send", () => {
    expect(senderGate({ hasCompany: true, role: "owner" }).allowed).toBe(true);
    expect(senderGate({ hasCompany: true, role: "dispatch" }).allowed).toBe(true);
  });
  test("a driver cannot send", () => {
    const g = senderGate({ hasCompany: true, role: "driver" });
    expect(g.allowed).toBe(false);
    expect(g.error).toContain("owner or dispatch");
  });
  test("a solo account gets the fleet path, not a dead end", () => {
    const g = senderGate({ hasCompany: false, role: null });
    expect(g.allowed).toBe(false);
    expect(g.error).toContain("Create a fleet");
  });
});

describe("Pay-stub delivery — roster scoping", () => {
  test("eligible recipients are the company's drivers only, sorted", () => {
    expect(eligibleRecipients(roster)).toEqual(["driverone", "drivertwo"]);
  });
  test("own driver passes", () => {
    expect(validateStubRecipient(roster, "driverone").ok).toBe(true);
  });
  test("cross-company send is refused by name", () => {
    const v = validateStubRecipient(roster, "outsidedriver");
    expect(v.ok).toBe(false);
    expect(v.error).toContain("@outsidedriver is not a driver in your company");
  });
  test("owner and dispatch named as recipient are refused by name", () => {
    expect(validateStubRecipient(roster, "boss").error).toContain("@boss is the owner");
    expect(validateStubRecipient(roster, "desk").error).toContain("@desk is the dispatch");
  });
});

describe("Pay-stub delivery — accept files exactly once", () => {
  test("accept is allowed only from sent", () => {
    expect(acceptGate("sent").allowed).toBe(true);
    expect(acceptGate("flagged").allowed).toBe(false);
    expect(acceptGate("withdrawn").allowed).toBe(false);
  });
  test("a second accept is refused and says it won't double-count", () => {
    const g = acceptGate("accepted");
    expect(g.allowed).toBe(false);
    expect(g.error).toContain("won't be counted twice");
  });
});

describe("Pay-stub delivery — flag path creates no entry", () => {
  test("flag is allowed only from sent", () => {
    expect(flagGate("sent").allowed).toBe(true);
    expect(flagGate("accepted").allowed).toBe(false);
    expect(flagGate("withdrawn").allowed).toBe(false);
  });
});

describe("Pay-stub delivery — withdraw rules", () => {
  test("sender can withdraw while still sent", () => {
    expect(withdrawGate({ status: "sent", isSender: true }).allowed).toBe(true);
  });
  test("withdraw after accept or flag is refused", () => {
    expect(withdrawGate({ status: "accepted", isSender: true }).allowed).toBe(false);
    expect(withdrawGate({ status: "flagged", isSender: true }).allowed).toBe(false);
  });
  test("anyone but the sender is refused", () => {
    const g = withdrawGate({ status: "sent", isSender: false });
    expect(g.allowed).toBe(false);
    expect(g.error).toContain("Only the person who sent");
  });
});

describe("Pay-stub delivery — mapping onto the Pay Book entry", () => {
  const base = {
    paidAtMs: new Date(2026, 9, 23).getTime(),
    taxYear: null,
    gross: 2400,
    federalWithheld: 260,
    stateWithheld: 95,
    otherDeductions: 40,
    notes: "Week of Oct 19",
  };
  test("a stub delivery files as a paycheck entry with its own numbers", () => {
    const e = deliveryToPayEntry({ ...base, kind: "w2", deliveryType: "stub" });
    expect(e.isForm).toBe(false);
    expect(e.kind).toBe("w2");
    expect(e.gross).toBe(2400);
    expect(e.federalWithheld).toBe(260);
    expect(e.taxYear).toBeNull();
  });
  test("a form delivery files as a form entry, tax year defaulted from its date", () => {
    const e = deliveryToPayEntry({ ...base, kind: "1099", deliveryType: "form", gross: 31000 });
    expect(e.isForm).toBe(true);
    expect(e.taxYear).toBe(2026);
  });
  test("an accepted FORM delivery is excluded from the pay totals", () => {
    const form = deliveryToPayEntry({ ...base, kind: "w2", deliveryType: "form", gross: 52000 });
    const s = summarizePayBook(
      [{
        kind: form.kind,
        isForm: form.isForm,
        payer: "ACME HAULING",
        taxYear: form.taxYear,
        gross: form.gross,
        federalWithheld: form.federalWithheld,
        stateWithheld: form.stateWithheld,
        otherDeductions: form.otherDeductions,
      }],
      [],
      0,
    );
    expect(s.w2.gross).toBe(0);
    expect(s.w2.count).toBe(0);
    expect(s.combinedGross).toBe(0);
    expect(s.forms.w2Gross).toBe(52000);
  });
  test("an accepted STUB delivery counts by its pay date pile", () => {
    const stub = deliveryToPayEntry({ ...base, kind: "1099", deliveryType: "stub", gross: 1800, federalWithheld: 0, stateWithheld: 0, otherDeductions: 0 });
    const s = summarizePayBook(
      [{
        kind: stub.kind,
        isForm: stub.isForm,
        payer: "ACME HAULING",
        taxYear: stub.taxYear,
        gross: stub.gross,
        federalWithheld: stub.federalWithheld,
        stateWithheld: stub.stateWithheld,
        otherDeductions: stub.otherDeductions,
      }],
      [],
      0,
    );
    expect(s.ten99.gross).toBe(1800);
    expect(s.combinedGross).toBe(1800);
  });
});

describe("Pay-stub delivery — itemized 1099 deductions file intact, exactly once", () => {
  const lines = [
    { label: "Fuel", amount: 412.35 },
    { label: "Truck payment", amount: 650 },
    { label: "Insurance", amount: 188.5 },
    { label: "Escrow", amount: 100 },
  ];
  const stubBase = {
    paidAtMs: new Date(2026, 9, 23).getTime(),
    taxYear: null,
    gross: 4000,
    federalWithheld: 0,
    stateWithheld: 0,
    otherDeductions: 0,
    deductionLines: lines,
    notes: "Settlement week 42",
  };
  test("a 1099 stub's lines land on the filed entry and their sum IS its deductions total", () => {
    const e = deliveryToPayEntry({ ...stubBase, kind: "1099", deliveryType: "stub" });
    expect(e.deductionLines).toEqual(lines);
    expect(e.otherDeductions).toBe(1350.85);
    const s = summarizePayBook(
      [{
        kind: e.kind, isForm: e.isForm, payer: "ACME HAULING", taxYear: e.taxYear,
        gross: e.gross, federalWithheld: e.federalWithheld, stateWithheld: e.stateWithheld,
        otherDeductions: e.otherDeductions, deductionLines: e.deductionLines,
      }],
      [{ category: "maintenance", amount: 300 }],
      0,
    );
    expect(s.ten99.gross).toBe(4000);
    expect(s.ten99.otherDeductions).toBe(1350.85);
    expect(s.ten99.deductionLines).toHaveLength(4);
    expect(s.net1099).toBe(4000 - 1350.85 - 300); // deductions once, expense once
    expect(s.ten99.totalReceived).toBe(4000 - 1350.85);
  });
  test("a 1099 stub never files tax withholding, even if the delivery row carries some", () => {
    const e = deliveryToPayEntry({ ...stubBase, kind: "1099", deliveryType: "stub", federalWithheld: 300, stateWithheld: 90 });
    expect(e.federalWithheld).toBe(0);
    expect(e.stateWithheld).toBe(0);
  });
  test("a W-2 stub keeps its lump deductions and carries no lines; a form ignores lines", () => {
    const w2 = deliveryToPayEntry({ ...stubBase, kind: "w2", deliveryType: "stub", otherDeductions: 40, federalWithheld: 260, stateWithheld: 95 });
    expect(w2.otherDeductions).toBe(40);
    expect(w2.deductionLines).toEqual([]);
    expect(w2.federalWithheld).toBe(260);
    const form = deliveryToPayEntry({ ...stubBase, kind: "1099", deliveryType: "form", gross: 31000 });
    expect(form.isForm).toBe(true);
    expect(form.deductionLines).toEqual([]);
  });
});

describe("Pay-stub delivery — per diem rides intact, exactly once", () => {
  // Synthetic per-mile stub: 2,000 mi × $0.55 = $1,100 + $50 extras −
  // $280 per diem = $870 taxable gross printed on the stub.
  const pdBase = {
    paidAtMs: new Date(2026, 9, 23).getTime(),
    taxYear: null,
    gross: 870,
    federalWithheld: 87,
    stateWithheld: 26.1,
    otherDeductions: 14.9,
    perDiem: 280,
    notes: "Per-mile week",
  };
  test("a stub delivery's per diem lands on the filed entry unchanged", () => {
    const e = deliveryToPayEntry({ ...pdBase, kind: "w2", deliveryType: "stub" });
    expect(e.perDiem).toBe(280);
    expect(e.gross).toBe(870); // taxable gross — per diem NOT folded in
    const s = summarizePayBook(
      [{
        kind: e.kind, isForm: e.isForm, payer: "ACME HAULING", taxYear: e.taxYear,
        gross: e.gross, federalWithheld: e.federalWithheld, stateWithheld: e.stateWithheld,
        otherDeductions: e.otherDeductions, perDiem: e.perDiem,
      }],
      [],
      0,
    );
    expect(s.w2.gross).toBe(870);
    expect(s.w2.perDiemTotal).toBe(280);
    expect(s.w2.totalReceived).toBe(1022); // (870 − 87 − 26.10 − 14.90) + 280
  });
  test("a FORM delivery's per diem is ignored — the filed form carries 0", () => {
    const e = deliveryToPayEntry({ ...pdBase, kind: "w2", deliveryType: "form", gross: 52000 });
    expect(e.isForm).toBe(true);
    expect(e.perDiem).toBe(0);
    const s = summarizePayBook(
      [{
        kind: e.kind, isForm: e.isForm, payer: "ACME HAULING", taxYear: e.taxYear,
        gross: e.gross, federalWithheld: e.federalWithheld, stateWithheld: e.stateWithheld,
        otherDeductions: e.otherDeductions, perDiem: e.perDiem,
      }],
      [],
      0,
    );
    expect(s.w2.perDiemTotal).toBe(0);
    expect(s.combinedPerDiem).toBe(0);
  });
  test("accept-once discipline keeps the per diem counted exactly once", () => {
    // First accept files the entry; the gate refuses any second
    // accept, so no second entry (and no second per diem) can land.
    expect(acceptGate("sent").allowed).toBe(true);
    const second = acceptGate("accepted");
    expect(second.allowed).toBe(false);
    const filed = deliveryToPayEntry({ ...pdBase, kind: "w2", deliveryType: "stub" });
    const s = summarizePayBook(
      [{
        kind: filed.kind, isForm: filed.isForm, payer: "ACME HAULING", taxYear: filed.taxYear,
        gross: filed.gross, federalWithheld: filed.federalWithheld, stateWithheld: filed.stateWithheld,
        otherDeductions: filed.otherDeductions, perDiem: filed.perDiem,
      }],
      [],
      0,
    );
    expect(s.w2.count).toBe(1);
    expect(s.w2.perDiemTotal).toBe(280); // once — never 560
  });
});

describe("Pay-stub email copies — opt-in gate (x, 2026-10-30: both optional also)", () => {
  test("default (toggle off) never auto-emails, even with a stub file", () => {
    expect(shouldAutoEmailPayStub({ payStubEmailEnabled: false, hasStubFile: true })).toBe(false);
  });
  test("opted in + a confirmed stub file attempts the copy", () => {
    expect(shouldAutoEmailPayStub({ payStubEmailEnabled: true, hasStubFile: true })).toBe(true);
  });
  test("opted in but no file (hand-typed entry) is not a confirmed upload — no copy", () => {
    expect(shouldAutoEmailPayStub({ payStubEmailEnabled: true, hasStubFile: false })).toBe(false);
  });
});
