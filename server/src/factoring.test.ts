// factoring.test.ts — pure-rule tests for instant pay /
// factoring + accounts receivable (Wave 2 item 7): the
// eligibility checks, the AR aging ladder, and the partner
// seam's honest configuration behaviour. Flow coverage (package
// assembly, chain seals, the configured submit against a local
// partner double, settlement closing the invoice) lives in
// factoringFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  arBucketKeyFor,
  arDaysPastDue,
  buildArSummary,
  factorPartnerFromEnv,
  factorStatusLabel,
  factoringEligibility,
  type FactorFetch,
  type FactorPackage,
} from "./factoring";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-15T12:00:00.000Z");

describe("factoringEligibility — the three record checks", () => {
  test("all three green is eligible", () => {
    const e = factoringEligibility({ invoiceStatus: "issued", podSealed: true, podConfirmed: true });
    expect(e.eligible).toBe(true);
    expect(e.checks.every((c) => c.ok)).toBe(true);
  });

  test("an unconfirmed POD blocks it — a provisional read never goes to a factor", () => {
    const e = factoringEligibility({ invoiceStatus: "issued", podSealed: true, podConfirmed: false });
    expect(e.eligible).toBe(false);
    expect(e.checks.find((c) => c.key === "pod_confirmed")!.ok).toBe(false);
    expect(e.checks.find((c) => c.key === "delivered")!.ok).toBe(true);
  });

  test("an unsealed delivery blocks it", () => {
    const e = factoringEligibility({ invoiceStatus: "issued", podSealed: false, podConfirmed: true });
    expect(e.eligible).toBe(false);
    expect(e.checks.find((c) => c.key === "delivered")!.ok).toBe(false);
  });

  test("a draft isn't a bill yet; a paid invoice has nothing left to factor", () => {
    expect(factoringEligibility({ invoiceStatus: "draft", podSealed: true, podConfirmed: true }).eligible).toBe(false);
    const paid = factoringEligibility({ invoiceStatus: "paid", podSealed: true, podConfirmed: true });
    expect(paid.eligible).toBe(false);
    expect(paid.checks.find((c) => c.key === "issued")!.label).toContain("already paid");
  });
});

describe("AR aging — days past due over the driver's own invoices", () => {
  test("bucket boundaries", () => {
    expect(arBucketKeyFor(0)).toBe("current");
    expect(arBucketKeyFor(1)).toBe("d30");
    expect(arBucketKeyFor(30)).toBe("d30");
    expect(arBucketKeyFor(31)).toBe("d60");
    expect(arBucketKeyFor(60)).toBe("d60");
    expect(arBucketKeyFor(61)).toBe("d90");
    expect(arBucketKeyFor(90)).toBe("d90");
    expect(arBucketKeyFor(91)).toBe("d90plus");
  });

  test("days past due never goes negative and a missing due date is current", () => {
    expect(arDaysPastDue({ dueAtMs: NOW + 5 * DAY }, NOW)).toBe(0);
    expect(arDaysPastDue({ dueAtMs: null }, NOW)).toBe(0);
    expect(arDaysPastDue({ dueAtMs: NOW - 10 * DAY }, NOW)).toBe(10);
  });

  test("the rollup: ladder, factored split, packaged note, paid, drafts", () => {
    const s = buildArSummary(
      [
        { amount: 1000, status: "issued", dueAtMs: NOW + 5 * DAY, factorStatus: "none" }, // current
        { amount: 2000, status: "issued", dueAtMs: NOW - 10 * DAY, factorStatus: "none" }, // d30
        { amount: 500, status: "issued", dueAtMs: NOW - 45 * DAY, factorStatus: "packaged" }, // d60 + packaged
        { amount: 700, status: "issued", dueAtMs: NOW - 100 * DAY, factorStatus: "submitted" }, // factored, NOT in ladder
        { amount: 300, status: "issued", dueAtMs: NOW - 2 * DAY, factorStatus: "advanced" }, // factored
        { amount: 4000, status: "paid", dueAtMs: NOW - 20 * DAY, factorStatus: "none" }, // paid
        { amount: 1500, status: "paid", dueAtMs: NOW - 20 * DAY, factorStatus: "settled" }, // paid via factor
        { amount: 900, status: "draft", dueAtMs: null, factorStatus: "none" }, // draft — not a receivable
      ],
      NOW,
    );
    expect(s.buckets.find((b) => b.key === "current")).toMatchObject({ count: 1, total: 1000 });
    expect(s.buckets.find((b) => b.key === "d30")).toMatchObject({ count: 1, total: 2000 });
    expect(s.buckets.find((b) => b.key === "d60")).toMatchObject({ count: 1, total: 500 });
    expect(s.buckets.find((b) => b.key === "d90plus")).toMatchObject({ count: 0, total: 0 });
    expect(s.outstandingCount).toBe(3);
    expect(s.outstandingTotal).toBe(3500);
    expect(s.factoredCount).toBe(2);
    expect(s.factoredTotal).toBe(1000);
    expect(s.packagedCount).toBe(1);
    expect(s.paidCount).toBe(2);
    expect(s.paidTotal).toBe(5500);
    expect(s.settledFactoredCount).toBe(1);
    expect(s.draftCount).toBe(1);
  });

  test("an empty book reads as zeros, not errors", () => {
    const s = buildArSummary([], NOW);
    expect(s.outstandingTotal).toBe(0);
    expect(s.paidTotal).toBe(0);
    expect(s.buckets).toHaveLength(5);
  });
});

describe("factorStatusLabel", () => {
  test("every state has a plain label; packaged never claims sent", () => {
    expect(factorStatusLabel("packaged")).toContain("Packaged");
    expect(factorStatusLabel("packaged")).not.toContain("Submitted");
    expect(factorStatusLabel("settled")).toContain("Settled");
  });
});

const PKG: FactorPackage = {
  invoiceRef: "invoice:7",
  podRef: "pod:42",
  invoiceId: 7,
  invoiceNumber: "INV-2026-0007",
  loadId: 42,
  billToName: "Blue Ridge Logistics",
  lane: "Mobile, AL → Dallas, TX",
  amount: 2400,
  issuedAt: "2026-11-10T00:00:00.000Z",
  dueAt: "2026-12-10T00:00:00.000Z",
  podConfirmedBy: "driver1",
  podConfirmedAt: "2026-11-10T15:00:00.000Z",
  assembledAt: "2026-11-15T12:00:00.000Z",
};

describe("factorPartnerFromEnv — the partner seam", () => {
  test("unconfigured without both key and base URL", () => {
    expect(factorPartnerFromEnv({})).toBeNull();
    expect(factorPartnerFromEnv({ FACTOR_PARTNER_API_KEY: "k" })).toBeNull();
    expect(factorPartnerFromEnv({ FACTOR_PARTNER_BASE_URL: "https://factor.example" })).toBeNull();
    expect(factorPartnerFromEnv({ FACTOR_PARTNER_API_KEY: "  ", FACTOR_PARTNER_BASE_URL: "https://factor.example" })).toBeNull();
  });

  test("configured: submit posts the package and returns the partner ref", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const transport: FactorFetch = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      return { ok: true, status: 200, json: async () => ({ id: "SUB-99" }) };
    };
    const partner = factorPartnerFromEnv(
      { FACTOR_PARTNER_API_KEY: "k", FACTOR_PARTNER_BASE_URL: "https://factor.example/", FACTOR_PARTNER_NAME: "Fast Factor" },
      transport,
    );
    expect(partner).not.toBeNull();
    expect(partner!.name).toBe("Fast Factor");
    const out = await partner!.submit(PKG);
    expect(out.partnerRef).toBe("SUB-99");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://factor.example/submissions");
    expect(calls[0]!.method).toBe("POST");
    const sent = JSON.parse(calls[0]!.body!) as FactorPackage;
    expect(sent.invoiceRef).toBe("invoice:7");
    expect(sent.podRef).toBe("pod:42");
  });

  test("a partner error surfaces as an error — never a fake ref", async () => {
    const transport: FactorFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const partner = factorPartnerFromEnv({ FACTOR_PARTNER_API_KEY: "k", FACTOR_PARTNER_BASE_URL: "https://factor.example" }, transport);
    await expect(partner!.submit(PKG)).rejects.toThrow("503");
  });

  test("an acceptance with no reference is refused, not invented", async () => {
    const transport: FactorFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const partner = factorPartnerFromEnv({ FACTOR_PARTNER_API_KEY: "k", FACTOR_PARTNER_BASE_URL: "https://factor.example" }, transport);
    await expect(partner!.submit(PKG)).rejects.toThrow("no submission reference");
  });
});
