import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
brokerIdentityFor,
matchedReceivableFacts,
normalizeBrokerText,
receivableCanonicalString,
RECEIVABLE_KEY_VERSION,
type ReceivableFacts,
} from "./receivableKey";

/** The key as actions.ts computes it: SHA-256 over the canonical string. */
function keyFor(facts: ReceivableFacts): string {
  return createHash("sha256").update(receivableCanonicalString(facts)).digest("hex");
}

const DOC = "a".repeat(64);

// One receivable as it appears on a load record: same rate-con
// document, same broker, same $2,500 invoice amount.
const receivable: ReceivableFacts = {
  rateConSha256: DOC,
  brokerName: "Jane Broker",
  brokerCompany: "Granted Enterprise LLC",
  brokerMc: "MC-123456",
  amount: 2500,
};

describe("receivable key", () => {
  test("same rate-con + broker + amount → identical key (the key has no load id in it)", () => {
    // Two DIFFERENT load records wrapping the same receivable: their
    // load-scoped invoice fingerprints differ (load id is an input),
    // but the receivable facts are the same, so the keys must match.
    const loadA: ReceivableFacts = { ...receivable };
    const loadB: ReceivableFacts = { ...receivable };
    expect(keyFor(loadA)).toBe(keyFor(loadB));
    expect(receivableCanonicalString(loadA)).not.toContain("load:");
  });

  test("canonical string is versioned stonemiles-receivable-v1", () => {
    expect(receivableCanonicalString(receivable).split("\n")[0]).toBe(RECEIVABLE_KEY_VERSION);
    expect(RECEIVABLE_KEY_VERSION).toBe("stonemiles-receivable-v1");
  });

  test("different amount → different key", () => {
    expect(keyFor({ ...receivable, amount: 2600 })).not.toBe(keyFor(receivable));
    expect(keyFor({ ...receivable, amount: null })).not.toBe(keyFor(receivable));
  });

  test("different broker → different key", () => {
    expect(keyFor({ ...receivable, brokerMc: "MC-999999" })).not.toBe(keyFor(receivable));
    expect(
      keyFor({ rateConSha256: DOC, brokerCompany: "Other Brokerage Inc", amount: 2500 }),
    ).not.toBe(keyFor({ rateConSha256: DOC, brokerCompany: "Granted Enterprise LLC", amount: 2500 }));
  });

  test("different rate-con document → different key", () => {
    expect(keyFor({ ...receivable, rateConSha256: "b".repeat(64) })).not.toBe(keyFor(receivable));
    expect(keyFor({ ...receivable, rateConSha256: null })).not.toBe(keyFor(receivable));
  });

  test("MC present is preferred over company and name", () => {
    const id = brokerIdentityFor(receivable);
    expect(id.source).toBe("mc");
    expect(id.identity).toBe("MC-123456");
    // Company/name changing under a stable MC does not move the key.
    expect(
      keyFor({ ...receivable, brokerCompany: "Granted Enterprise Renamed LLC", brokerName: "John" }),
    ).toBe(keyFor(receivable));
  });

  test("no MC → company wins; no company → name; none → empty identity", () => {
    expect(brokerIdentityFor({ brokerCompany: "Acme", brokerName: "Jane" })).toEqual({
      identity: "ACME",
      source: "company",
    });
    expect(brokerIdentityFor({ brokerName: "Jane" })).toEqual({ identity: "JANE", source: "name" });
    expect(brokerIdentityFor({})).toEqual({ identity: "", source: "none" });
    // A whitespace-only MC is not an MC — falls through to company.
    expect(brokerIdentityFor({ brokerMc: "   ", brokerCompany: "Acme" }).source).toBe("company");
  });

  test("normalization (case / whitespace) does not change the key", () => {
    expect(normalizeBrokerText("  granted   enterprise\tllc ")).toBe("GRANTED ENTERPRISE LLC");
    const messy: ReceivableFacts = {
      rateConSha256: DOC,
      brokerCompany: "  granted   enterprise llc",
      brokerName: "jane   broker",
      amount: 2500,
    };
    const clean: ReceivableFacts = {
      rateConSha256: DOC,
      brokerCompany: "Granted Enterprise LLC",
      brokerName: "Jane Broker",
      amount: 2500,
    };
    expect(keyFor(messy)).toBe(keyFor(clean));
    // Same for the MC path.
    expect(keyFor({ ...receivable, brokerMc: " mc-123456 " })).toBe(keyFor(receivable));
  });

  test("matchedReceivableFacts reports which facts two presentations share", () => {
    expect(matchedReceivableFacts(receivable, { ...receivable })).toEqual({
      rateCon: true,
      broker: true,
      amount: true,
    });
    expect(matchedReceivableFacts(receivable, { ...receivable, amount: 100 })).toEqual({
      rateCon: true,
      broker: true,
      amount: false,
    });
  });
});
