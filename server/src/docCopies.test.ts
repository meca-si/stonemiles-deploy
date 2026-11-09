import { describe, expect, test } from "bun:test";
import {
deliveryDedupeKey,
docKindLabel,
filedCopyDedupeKey,
filedKindForScanKind,
isValidEmail,
normalizeEmail,
payStubEmailDedupeKey,
payStubKindLabel,
planDeliveryStatus,
planPayStubDeliveryStatus,
resolveDocRecipients,
} from "./docCopies";

describe("Document copies — email address checks", () => {
  test("accepts plain addresses, rejects junk", () => {
    expect(isValidEmail("driver@example.com")).toBe(true);
    expect(isValidEmail("  desk@ruggs.example  ")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
  test("normalize trims and never passes an invalid address through", () => {
    expect(normalizeEmail("  owner@example.com ")).toBe("owner@example.com");
    expect(normalizeEmail("bogus")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("Document copies — recipient resolution", () => {
  const base = {
    driverUsername: "driverone",
    driverEmail: "driver@example.com",
    dispatchEmail: "dispatch@example.com",
    ownerEmailSetting: null,
    companyContactEmail: "office@example.com",
    ownerUsername: "boss",
    dispatchUsernames: ["desk"],
    inCompany: true,
  };
  test("driver and dispatch come from settings; owner falls back to the company contact email", () => {
    const r = resolveDocRecipients(base);
    expect(r.map((x) => x.role)).toEqual(["driver", "dispatch", "owner"]);
    expect(r[0]?.email).toBe("driver@example.com");
    expect(r[1]?.email).toBe("dispatch@example.com");
    expect(r[1]?.username).toBe("desk");
    expect(r[2]?.email).toBe("office@example.com");
    expect(r[2]?.emailSource).toContain("Company setup");
    expect(r[2]?.username).toBe("boss");
  });
  test("the settings owner email beats the company contact email", () => {
    const r = resolveDocRecipients({ ...base, ownerEmailSetting: "owner@example.com" });
    expect(r[2]?.email).toBe("owner@example.com");
    expect(r[2]?.emailSource).toContain("settings");
  });
  test("missing addresses stay null — never invented", () => {
    const r = resolveDocRecipients({ ...base, driverEmail: null, dispatchEmail: null, companyContactEmail: null });
    expect(r[0]?.email).toBeNull();
    expect(r[1]?.email).toBeNull();
    expect(r[2]?.email).toBeNull();
  });
  test("an invalid stored address reads as no address", () => {
    const r = resolveDocRecipients({ ...base, driverEmail: "not an email" });
    expect(r[0]?.email).toBeNull();
  });
  test("solo: the owner seat is the driver; dispatch has no roster name", () => {
    const r = resolveDocRecipients({
      ...base,
      inCompany: false,
      ownerUsername: null,
      dispatchUsernames: [],
      companyContactEmail: null,
    });
    expect(r[2]?.username).toBe("driverone");
    expect(r[1]?.username).toBeNull();
  });
});

describe("Document copies — delivery status plan", () => {
  test("copies off wins over everything", () => {
    expect(planDeliveryStatus({ enabled: false, email: "a@example.com", providerConfigured: true }).status).toBe("off");
  });
  test("no address is its own honest status", () => {
    expect(planDeliveryStatus({ enabled: true, email: null, providerConfigured: true }).status).toBe("no_address");
  });
  test("no provider connected queues — it never claims sent", () => {
    const p = planDeliveryStatus({ enabled: true, email: "a@example.com", providerConfigured: false });
    expect(p.status).toBe("queued");
    expect(p.detail).toContain("isn't connected yet");
  });
  test("address + provider means attempt the send", () => {
    expect(planDeliveryStatus({ enabled: true, email: "a@example.com", providerConfigured: true }).status).toBe("send");
  });
});

describe("Pay-stub email copies — both optional (x, 2026-10-30)", () => {
  test("the pay-stub toggle is its own switch: off wins even with an address and a provider", () => {
    const p = planPayStubDeliveryStatus({ enabled: false, email: "a@example.com", providerConfigured: true });
    expect(p.status).toBe("off");
    expect(p.detail).toContain("Pay-stub email copies are turned off");
    expect(p.detail).toContain("Pay Book only");
  });
  test("on + no address is its own honest status", () => {
    expect(planPayStubDeliveryStatus({ enabled: true, email: null, providerConfigured: true }).status).toBe("no_address");
  });
  test("on + address + no provider queues — it never claims sent", () => {
    const p = planPayStubDeliveryStatus({ enabled: true, email: "a@example.com", providerConfigured: false });
    expect(p.status).toBe("queued");
    expect(p.detail).toContain("isn't connected yet");
  });
  test("on + address + provider means attempt the send", () => {
    expect(planPayStubDeliveryStatus({ enabled: true, email: "a@example.com", providerConfigured: true }).status).toBe("send");
  });
  test("dedupe keys are per pay entry and seat — the two piles never share a key space with loads", () => {
    expect(payStubEmailDedupeKey(41, "driver")).toBe("payentry:41:driver");
    expect(payStubEmailDedupeKey(41, "owner")).toBe("payentry:41:owner");
    expect(payStubEmailDedupeKey(42, "driver")).not.toBe(payStubEmailDedupeKey(41, "driver"));
  });
  test("labels name one pile only", () => {
    expect(payStubKindLabel("w2", false)).toBe("W-2 pay stub");
    expect(payStubKindLabel("1099", false)).toBe("1099 pay stub");
    expect(payStubKindLabel("w2", true)).toBe("W-2 year-end form");
    expect(payStubKindLabel("1099", true)).toBe("1099 year-end form");
  });
});

describe("Document copies — kinds and dedupe", () => {
  test("labels", () => {
    expect(docKindLabel("rate_con")).toContain("Rate confirmation");
    expect(docKindLabel("bol")).toContain("BOL");
    expect(docKindLabel("pod")).toContain("POD");
    expect(docKindLabel("whatever")).toBe("Load document");
  });
  test("scan kinds map conservatively", () => {
    expect(filedKindForScanKind("rate_con")).toBe("rate_con");
    expect(filedKindForScanKind("bol")).toBe("bol");
    expect(filedKindForScanKind("other")).toBe("load_document");
    expect(filedKindForScanKind(null)).toBe("load_document");
  });
  test("dedupe keys are per load, kind, fingerprint, and seat", () => {
    const k = filedCopyDedupeKey(7, "bol", "abc123");
    expect(k).toBe("load:7:bol:abc123");
    expect(deliveryDedupeKey(k, "owner")).toBe("load:7:bol:abc123:owner");
    expect(filedCopyDedupeKey(7, "bol", "different")).not.toBe(k);
  });
});
