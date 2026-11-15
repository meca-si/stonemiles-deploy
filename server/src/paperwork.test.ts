// paperwork.test.ts — PURE-RULE tests for paperwork-to-pay
// (Research Wave 2 item 2): the extraction seam's honesty (no
// key → no provider; a read proposes candidates, never facts),
// candidate mapping (money fields are NOT carried over),
// low-confidence flags (disagreement with the load record is
// marked, absence is not), and the pipeline stage ladder.
// Integration coverage lives in paperworkFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  candidatesFromDocFields,
  flagCandidateFields,
  paperworkExtractorFromEnv,
  paperworkNotification,
  paperworkStage,
  podCopyOutboundText,
  EMPTY_PAPERWORK_CANDIDATES,
  type PaperworkDocReader,
} from "./paperwork";
import { EMPTY_DOC_FIELDS, type DocSideFields } from "./docVerify";

const docFields = (over: Partial<DocSideFields> = {}): DocSideFields => ({ ...EMPTY_DOC_FIELDS, ...over });

describe("paperworkExtractorFromEnv — the seam is honest", () => {
  const reader: PaperworkDocReader = async () => ({
    found: true,
    fields: docFields({
      pickupCity: "Mobile",
      pickupState: "Alabama",
      deliveryCity: "Dallas",
      deliveryState: "Texas",
      loadNumber: "LD-9",
      weightLbs: 42000,
      pieces: 12,
      deliveryWindow: "Nov 16, 08:00",
      rate: 4321,
    }),
  });

  test("no INFERENCE_API_KEY → no provider at all", () => {
    expect(paperworkExtractorFromEnv({}, reader)).toBeNull();
    expect(paperworkExtractorFromEnv({ INFERENCE_API_KEY: "" }, reader)).toBeNull();
  });

  test("configured → candidates come back mapped, money never carried over", async () => {
    const ex = paperworkExtractorFromEnv({ INFERENCE_API_KEY: "k" }, reader);
    expect(ex).not.toBeNull();
    const res = await ex!.extract({ dataBase64: "AAAA", mimeType: "image/jpeg", docKind: "pod" });
    expect(res?.found).toBe(true);
    expect(res?.fields.lane).toBe("Mobile, Alabama → Dallas, Texas");
    expect(res?.fields.reference).toBe("LD-9");
    expect(res?.fields.weightLbs).toBe(42000);
    expect(res?.fields.pieces).toBe(12);
    expect(res?.fields.deliveryText).toBe("Nov 16, 08:00");
    // Guardrail (d): the reader saw a rate; the candidates do not hold it.
    expect(JSON.stringify(res)).not.toContain("4321");
    expect(res?.fields).not.toHaveProperty("rate");
  });

  test("a PDF scan cannot be read by the image reader — null, never a guess", async () => {
    const ex = paperworkExtractorFromEnv({ INFERENCE_API_KEY: "k" }, reader);
    const res = await ex!.extract({ dataBase64: "AAAA", mimeType: "application/pdf", docKind: "pod" });
    expect(res).toBeNull();
  });

  test("found:false passes through as found:false with empty candidates", async () => {
    const blankReader: PaperworkDocReader = async () => ({ found: false, fields: docFields() });
    const ex = paperworkExtractorFromEnv({ INFERENCE_API_KEY: "k" }, blankReader);
    const res = await ex!.extract({ dataBase64: "AAAA", mimeType: "image/png", docKind: "bol" });
    expect(res?.found).toBe(false);
    expect(res?.fields).toEqual(EMPTY_PAPERWORK_CANDIDATES);
  });

  test("a reader failure reads as null (failed read → manual confirm)", async () => {
    const ex = paperworkExtractorFromEnv({ INFERENCE_API_KEY: "k" }, async () => null);
    expect(await ex!.extract({ dataBase64: "AAAA", mimeType: "image/jpeg", docKind: "pod" })).toBeNull();
  });
});

describe("candidatesFromDocFields", () => {
  test("reference precedence: load number, then PO, then PRO", () => {
    expect(candidatesFromDocFields(docFields({ loadNumber: "L1", poNumber: "P1", proNumber: "R1" })).reference).toBe("L1");
    expect(candidatesFromDocFields(docFields({ poNumber: "P1", proNumber: "R1" })).reference).toBe("P1");
    expect(candidatesFromDocFields(docFields({ proNumber: "R1" })).reference).toBe("R1");
    expect(candidatesFromDocFields(docFields()).reference).toBeNull();
  });

  test("a one-sided lane reads as null, not a half-lane", () => {
    expect(candidatesFromDocFields(docFields({ pickupCity: "Mobile" })).lane).toBeNull();
  });
});

describe("flagCandidateFields — disagreement is marked, absence is not", () => {
  const load = { lane: "Mobile, AL → Dallas, TX", referenceNumber: "REF-1", weightLbs: 40000 };

  test("agreeing candidates are unflagged", () => {
    const flags = flagCandidateFields(
      { lane: "Mobile, AL → Dallas, TX", reference: "REF-1", weightLbs: 40000, pieces: 9, deliveryText: "x" },
      load,
    );
    expect(flags).toEqual({ lane: false, reference: false, weightLbs: false, pieces: false, deliveryText: false });
  });

  test("a reference or weight that disagrees with the record is flagged", () => {
    const flags = flagCandidateFields(
      { lane: null, reference: "REF-2", weightLbs: 41000, pieces: null, deliveryText: null },
      load,
    );
    expect(flags.reference).toBe(true);
    expect(flags.weightLbs).toBe(true);
    expect(flags.lane).toBe(false); // not read → blank to fill, not a conflict
  });

  test("pieces and delivery text are never auto-flagged (the record can't check them)", () => {
    const flags = flagCandidateFields(
      { lane: null, reference: null, weightLbs: null, pieces: 3, deliveryText: "whenever" },
      load,
    );
    expect(flags.pieces).toBe(false);
    expect(flags.deliveryText).toBe(false);
  });
});

describe("paperworkStage — the self-serve ladder", () => {
  test("climbs received → confirmed → sent → invoiced → paid", () => {
    expect(paperworkStage({ filed: false, confirmed: false, sendStatus: null, invoiceStatus: null })).toBe("none");
    expect(paperworkStage({ filed: true, confirmed: false, sendStatus: "not_ready", invoiceStatus: null })).toBe("received");
    expect(paperworkStage({ filed: true, confirmed: true, sendStatus: "not_ready", invoiceStatus: null })).toBe("confirmed");
    expect(paperworkStage({ filed: true, confirmed: true, sendStatus: "sent", invoiceStatus: null })).toBe("sent");
    expect(paperworkStage({ filed: true, confirmed: true, sendStatus: "sent", invoiceStatus: "issued" })).toBe("invoiced");
    expect(paperworkStage({ filed: true, confirmed: true, sendStatus: "sent", invoiceStatus: "paid" })).toBe("paid");
  });

  test("a queued send never overclaims 'sent'; a draft invoice never overclaims 'invoiced'", () => {
    expect(paperworkStage({ filed: true, confirmed: true, sendStatus: "queued", invoiceStatus: null })).toBe("confirmed");
    expect(paperworkStage({ filed: true, confirmed: true, sendStatus: "sent", invoiceStatus: "draft" })).toBe("sent");
  });
});

describe("outward copy carries no money", () => {
  test("the POD copy email and the notifications hold no rate, amount, or percent", () => {
    const text = podCopyOutboundText({ loadId: 7, lane: "Mobile, AL → Dallas, TX", reference: "REF-1", sha256: "abc", hasAttachment: true });
    expect(text).not.toContain("$");
    expect(text).not.toContain("%");
    for (const kind of ["pod_sent", "pod_queued", "no_recipient", "invoice_cut"] as const) {
      const n = paperworkNotification(kind, { loadId: 7, lane: "Mobile, AL → Dallas, TX" });
      expect(n.title + n.body).not.toContain("$");
      expect(n.title + n.body).not.toContain("%");
    }
  });
});
