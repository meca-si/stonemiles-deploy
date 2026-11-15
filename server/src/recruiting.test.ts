// recruiting.test.ts — PURE tests for the recruiting ATS-lite
// rules (Wave 2 item 10, Part B): the pipeline's stage moves,
// the auto-response template (defaults, substitution, the
// no-promises shape), intake cleaning/validation, and the
// door's rate-limit verdicts. The flow tests
// (recruitingFlow.test.ts) cover the wired door + desk.

import { describe, expect, test } from "bun:test";
import {
  APPLY_DOOR_HOURLY_LIMIT,
  APPLY_EMAIL_DAILY_LIMIT,
  DEFAULT_RESPONSE_SUBJECT,
  DEFAULT_RESPONSE_TEMPLATE,
  applicationRateVerdict,
  applicationStageLabel,
  canMoveApplicationStage,
  cleanApplicationInput,
  renderResponseTemplate,
  responseTemplateFor,
} from "./recruiting";

describe("recruiting — stage moves", () => {
  test("forward along the ladder is allowed, skipping rungs included", () => {
    expect(canMoveApplicationStage("new", "contacted")).toBe(true);
    expect(canMoveApplicationStage("new", "interview")).toBe(true);
    expect(canMoveApplicationStage("contacted", "road_test")).toBe(true);
    expect(canMoveApplicationStage("interview", "hired")).toBe(true);
    expect(canMoveApplicationStage("new", "hired")).toBe(true);
  });

  test("declined is reachable from any open stage", () => {
    for (const from of ["new", "contacted", "interview", "road_test"]) {
      expect(canMoveApplicationStage(from, "declined")).toBe(true);
    }
  });

  test("backward, same-stage, and out of a terminal stage are refused", () => {
    expect(canMoveApplicationStage("interview", "contacted")).toBe(false);
    expect(canMoveApplicationStage("contacted", "contacted")).toBe(false);
    expect(canMoveApplicationStage("hired", "contacted")).toBe(false);
    expect(canMoveApplicationStage("hired", "declined")).toBe(false);
    expect(canMoveApplicationStage("declined", "new")).toBe(false);
    expect(canMoveApplicationStage("new", "bogus")).toBe(false);
    expect(canMoveApplicationStage("bogus", "contacted")).toBe(false);
  });

  test("labels read plainly", () => {
    expect(applicationStageLabel("road_test")).toBe("Road test");
    expect(applicationStageLabel("new")).toBe("New");
  });
});

describe("recruiting — the auto-response template", () => {
  test("the default promises nothing about hiring, pay, or a decision date", () => {
    const text = `${DEFAULT_RESPONSE_SUBJECT}\n${DEFAULT_RESPONSE_TEMPLATE}`.toLowerCase();
    expect(text).toContain("we review every application");
    for (const banned of ["you're hired", "you are hired", "guaranteed", "per mile", "salary", "signing bonus", "within 24 hours", "by friday"]) {
      expect(text).not.toContain(banned);
    }
  });

  test("{name} and {fleet} substitute; unknown tokens survive for the fleet to see", () => {
    expect(renderResponseTemplate("Hi {name} — {fleet} here. {bogus}", { name: "Jo", fleet: "Acme" })).toBe(
      "Hi Jo — Acme here. {bogus}",
    );
  });

  test("a fleet's saved wording wins; blank fields fall back to the default", () => {
    expect(responseTemplateFor({ subject: "Got it — {fleet}", body: "Body {name}" })).toEqual({
      subject: "Got it — {fleet}",
      body: "Body {name}",
    });
    expect(responseTemplateFor({ subject: "  ", body: null })).toEqual({
      subject: DEFAULT_RESPONSE_SUBJECT,
      body: DEFAULT_RESPONSE_TEMPLATE,
    });
    expect(responseTemplateFor(null).body).toBe(DEFAULT_RESPONSE_TEMPLATE);
  });
});

describe("recruiting — intake cleaning + validation", () => {
  const good = {
    name: "  Jo   Driver ",
    email: " Jo@Example.COM ",
    phone: " 555  0100 ",
    cdlClass: "a",
    experience: " 6 years OTR, reefer ",
    note: " Wants weekends home ",
  };

  test("a good submission is cleaned: trimmed, collapsed, email lowered, class uppered", () => {
    const out = cleanApplicationInput(good);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toEqual({
        name: "Jo Driver",
        email: "jo@example.com",
        phone: "555 0100",
        cdlClass: "A",
        experience: "6 years OTR, reefer",
        note: "Wants weekends home",
      });
    }
  });

  test("each missing/invalid required field refuses with a plain reason", () => {
    expect(cleanApplicationInput({ ...good, name: "J" }).ok).toBe(false);
    const badEmail = cleanApplicationInput({ ...good, email: "not-an-email" });
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.reason).toContain("email");
    expect(cleanApplicationInput({ ...good, cdlClass: "Z" }).ok).toBe(false);
    expect(cleanApplicationInput({ ...good, experience: " " }).ok).toBe(false);
  });

  test("'none' is a real CDL answer; phone and note are optional", () => {
    const out = cleanApplicationInput({ ...good, cdlClass: "none", phone: "", note: "" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.cdlClass).toBe("none");
      expect(out.value.phone).toBeNull();
      expect(out.value.note).toBeNull();
    }
  });
});

describe("recruiting — rate-limit verdicts", () => {
  test("under both limits passes; at either limit refuses with the right reason", () => {
    expect(applicationRateVerdict({ doorLastHour: 0, emailLastDay: 0 })).toEqual({ ok: true });
    expect(
      applicationRateVerdict({ doorLastHour: APPLY_DOOR_HOURLY_LIMIT - 1, emailLastDay: APPLY_EMAIL_DAILY_LIMIT - 1 }),
    ).toEqual({ ok: true });
    const door = applicationRateVerdict({ doorLastHour: APPLY_DOOR_HOURLY_LIMIT, emailLastDay: 0 });
    expect(door.ok).toBe(false);
    const email = applicationRateVerdict({ doorLastHour: 0, emailLastDay: APPLY_EMAIL_DAILY_LIMIT });
    expect(email.ok).toBe(false);
    if (!email.ok) expect(email.reason).toContain("already applied");
  });
});
