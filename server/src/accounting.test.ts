// accounting.test.ts — PURE tests for the QuickBooks / Xero
// two-way sync rules (Wave 2 item 10, Part A): the field-by-field
// mapping, the change stamps, the push/pull/conflict
// classification, inbound payment matching, and the review
// snapshot lines. The flow tests (accountingFlow.test.ts) cover
// the wired engine against a fake provider.

import { describe, expect, test } from "bun:test";
import {
  accountingConfiguredProviders,
  accountingPartnerFromEnv,
  accountingSnapshotLines,
  accountingStampFor,
  canonicalJson,
  classifySyncChange,
  mapInvoiceToProvider,
  mapPaymentToProvider,
  mapSettlementToProvider,
  matchProviderPayment,
  type ProviderPaymentSnapshot,
} from "./accounting";

const INV = {
  id: 7,
  number: "INV-2026-0007",
  status: "issued",
  billToName: "Sam Shipper",
  billToCompany: "Blue Ridge Logistics",
  referenceNumber: "BR-4471",
  lines: [
    { label: "Freight — Dallas, TX → Memphis, TN", amount: 2400 },
    { label: "Detention", amount: 150.5 },
  ],
  amount: 2550.5,
  issuedAtIso: "2026-11-10T15:00:00.000Z",
  dueAtIso: "2026-12-10T15:00:00.000Z",
};

describe("accounting — invoice mapping, field by field", () => {
  test("an issued invoice maps to the provider object exactly", () => {
    expect(mapInvoiceToProvider(INV)).toEqual({
      docNumber: "INV-2026-0007",
      customerName: "Blue Ridge Logistics", // the company on the bill wins over the contact name
      lines: [
        { description: "Freight — Dallas, TX → Memphis, TN", amount: 2400 },
        { description: "Detention", amount: 150.5 },
      ],
      amount: 2550.5,
      issueDate: "2026-11-10",
      dueDate: "2026-12-10",
      status: "issued",
      memo: "BR-4471",
    });
  });

  test("the contact name is the customer when the bill names no company", () => {
    expect(mapInvoiceToProvider({ ...INV, billToCompany: null }).customerName).toBe("Sam Shipper");
    expect(mapInvoiceToProvider({ ...INV, billToCompany: "  " }).customerName).toBe("Sam Shipper");
  });

  test("a paid invoice maps as paid; a draft never reaches the mapper as paid", () => {
    expect(mapInvoiceToProvider({ ...INV, status: "paid" }).status).toBe("paid");
    expect(mapInvoiceToProvider({ ...INV, status: "draft" }).status).toBe("issued");
  });

  test("no reference number → no memo; unissued → no dates", () => {
    const obj = mapInvoiceToProvider({ ...INV, referenceNumber: null, issuedAtIso: null, dueAtIso: null });
    expect(obj.memo).toBeNull();
    expect(obj.issueDate).toBeNull();
    expect(obj.dueDate).toBeNull();
  });
});

describe("accounting — payment + settlement mapping", () => {
  test("a recorded payment links to its invoice by provider id AND number", () => {
    expect(
      mapPaymentToProvider(
        { id: 3, amount: 2550.5, paidAtIso: "2026-11-20T09:30:00.000Z", note: "ACH" },
        { providerInvoiceId: "5000", invoiceDocNumber: "INV-2026-0007" },
      ),
    ).toEqual({
      amount: 2550.5,
      paidDate: "2026-11-20",
      invoiceDocNumber: "INV-2026-0007",
      providerInvoiceId: "5000",
      memo: "ACH",
    });
  });

  test("a settlement maps to a bill: carrier is the vendor, net is the total, doc number is stable", () => {
    expect(
      mapSettlementToProvider({
        id: 11,
        carrier: "Blue Ridge Logistics",
        periodLabel: "Nov 3–9",
        gross: 2600,
        net: 2400,
        linesJson: JSON.stringify([{ label: "Linehaul", amount: 2400 }]),
      }),
    ).toEqual({
      docNumber: "STL-11",
      vendorName: "Blue Ridge Logistics",
      lines: [{ description: "Linehaul", amount: 2400 }],
      amount: 2400,
      periodLabel: "Nov 3–9",
    });
  });

  test("a settlement with shapeless lines falls back to one net line, never drops", () => {
    const obj = mapSettlementToProvider({
      id: 12,
      carrier: null,
      periodLabel: null,
      gross: null,
      net: 900,
      linesJson: "not json",
    });
    expect(obj?.vendorName).toBe("Carrier");
    expect(obj?.lines).toEqual([{ description: "Settlement net", amount: 900 }]);
    expect(obj?.amount).toBe(900);
  });

  test("a settlement with no figure at all maps to nothing", () => {
    expect(
      mapSettlementToProvider({ id: 13, carrier: "X", periodLabel: null, gross: null, net: null, linesJson: "[]" }),
    ).toBeNull();
  });
});

describe("accounting — stamps + classification", () => {
  test("canonical JSON is key-order independent and the stamp is stable", () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 4 }, b: 1 }));
    const obj = mapInvoiceToProvider(INV);
    expect(accountingStampFor(obj)).toBe(accountingStampFor(mapInvoiceToProvider({ ...INV })));
    expect(accountingStampFor(obj)).not.toBe(accountingStampFor(mapInvoiceToProvider({ ...INV, amount: 1 })));
  });

  test("classification: local-only pushes, any provider drift conflicts, neither is none", () => {
    expect(classifySyncChange({ localChanged: false, providerChanged: false })).toBe("none");
    expect(classifySyncChange({ localChanged: true, providerChanged: false })).toBe("push");
    expect(classifySyncChange({ localChanged: true, providerChanged: true })).toBe("conflict");
    expect(classifySyncChange({ localChanged: false, providerChanged: true })).toBe("conflict");
  });
});

describe("accounting — inbound payment matching", () => {
  const candidates = [
    { invoiceId: 7, docNumber: "INV-2026-0007", providerObjectId: "5000" },
    { invoiceId: 8, docNumber: "INV-2026-0008", providerObjectId: "5001" },
  ];
  const pay = (over: Partial<ProviderPaymentSnapshot>): ProviderPaymentSnapshot => ({
    providerId: "9100",
    amount: 100,
    paidDate: "2026-11-20",
    invoiceDocNumber: null,
    providerInvoiceId: null,
    memo: null,
    stamp: "qb:0:x",
    ...over,
  });

  test("provider invoice id wins over the doc number", () => {
    expect(matchProviderPayment(pay({ providerInvoiceId: "5001", invoiceDocNumber: "INV-2026-0007" }), candidates)).toBe(8);
  });

  test("the doc number matches when no id link exists", () => {
    expect(matchProviderPayment(pay({ invoiceDocNumber: "INV-2026-0007" }), candidates)).toBe(7);
  });

  test("no match → null (the caller parks it in review, never force-applies)", () => {
    expect(matchProviderPayment(pay({ providerInvoiceId: "9999", invoiceDocNumber: "INV-1999-0001" }), candidates)).toBeNull();
    expect(matchProviderPayment(pay({}), candidates)).toBeNull();
  });
});

describe("accounting — snapshot lines for the review panel", () => {
  test("an invoice flattens to labelled lines with the amount formatted", () => {
    const lines = accountingSnapshotLines(mapInvoiceToProvider(INV));
    expect(lines[0]).toEqual({ label: "Invoice", value: "INV-2026-0007" });
    expect(lines.find((l) => l.label === "Amount")?.value).toBe("$2550.50");
    expect(lines.find((l) => l.label.startsWith("Line —"))?.value).toBe("$2400.00");
  });

  test("a missing copy reads as a dash, never a crash", () => {
    expect(accountingSnapshotLines(null)).toEqual([{ label: "Record", value: "—" }]);
  });
});

describe("accounting — the seam's configuration gate", () => {
  test("no credentials in the env → no partner, per provider", () => {
    expect(accountingPartnerFromEnv({}, "quickbooks")).toBeNull();
    expect(accountingPartnerFromEnv({}, "xero")).toBeNull();
    expect(accountingPartnerFromEnv({ QUICKBOOKS_CLIENT_ID: "id" }, "quickbooks")).toBeNull();
    expect(accountingConfiguredProviders({})).toEqual({ quickbooks: false, xero: false });
    expect(
      accountingConfiguredProviders({ QUICKBOOKS_CLIENT_ID: "i", QUICKBOOKS_CLIENT_SECRET: "s", XERO_CLIENT_ID: "i" }),
    ).toEqual({ quickbooks: true, xero: false });
  });

  test("with credentials, the authorize URL names the provider door + our redirect + state", () => {
    const qb = accountingPartnerFromEnv({ QUICKBOOKS_CLIENT_ID: "cid", QUICKBOOKS_CLIENT_SECRET: "sec" }, "quickbooks");
    const url = qb!.authorizeUrl({ redirectUri: "https://app.stonervision.io/accounting/callback", state: "st123" });
    expect(url).toContain("https://appcenter.intuit.com/connect/oauth2");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("state=st123");
    const xero = accountingPartnerFromEnv({ XERO_CLIENT_ID: "xid", XERO_CLIENT_SECRET: "xsec" }, "xero");
    expect(xero!.authorizeUrl({ redirectUri: "https://app.stonervision.io/accounting/callback", state: "st9" })).toContain(
      "https://login.xero.com/identity/connect/authorize",
    );
  });
});
