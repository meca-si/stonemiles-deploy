import { describe, expect, test } from "bun:test";
import {
  assignmentPhaseFor,
  assignDecisionFor,
  canRespondToAssignment,
  cleanReferenceNumber,
  validateDeclineReason,
} from "./boardAssignment";

describe("assignmentPhaseFor", () => {
  test("assigned row is a pending offer", () => {
    expect(assignmentPhaseFor({ status: "assigned", claimMethod: "assign" })).toBe("pending");
  });
  test("taken-by-assign row is accepted", () => {
    expect(assignmentPhaseFor({ status: "taken", claimMethod: "assign" })).toBe("accepted");
  });
  test("taken-by-claim row has no assignment phase", () => {
    expect(assignmentPhaseFor({ status: "taken", claimMethod: "claim" })).toBe("none");
  });
  test("open and overflowed rows have no assignment phase", () => {
    expect(assignmentPhaseFor({ status: "open", claimMethod: null })).toBe("none");
    expect(assignmentPhaseFor({ status: "overflowed", claimMethod: null })).toBe("none");
  });
});

describe("canRespondToAssignment", () => {
  test("only the named driver, only while pending", () => {
    expect(canRespondToAssignment({ status: "assigned", claimedBy: "alice", username: "alice" })).toBe(true);
    expect(canRespondToAssignment({ status: "assigned", claimedBy: "alice", username: "bob" })).toBe(false);
    expect(canRespondToAssignment({ status: "taken", claimedBy: "alice", username: "alice" })).toBe(false);
    expect(canRespondToAssignment({ status: "open", claimedBy: null, username: "alice" })).toBe(false);
  });
  test("username match is case-insensitive", () => {
    expect(canRespondToAssignment({ status: "assigned", claimedBy: "Alice", username: "alice" })).toBe(true);
  });
});

describe("assignDecisionFor", () => {
  test("open row is a fresh offer", () => {
    expect(assignDecisionFor({ status: "open", claimedBy: null, targetUsername: "alice" })).toEqual({ kind: "assign" });
  });
  test("assigned row to a different driver is a reassign", () => {
    expect(assignDecisionFor({ status: "assigned", claimedBy: "alice", targetUsername: "bob" })).toEqual({
      kind: "reassign",
      from: "alice",
    });
  });
  test("assigned row to the same driver refuses", () => {
    const d = assignDecisionFor({ status: "assigned", claimedBy: "alice", targetUsername: "Alice" });
    expect(d.kind).toBe("refuse");
  });
  test("taken and overflowed rows refuse", () => {
    expect(assignDecisionFor({ status: "taken", claimedBy: "alice", targetUsername: "bob" }).kind).toBe("refuse");
    expect(assignDecisionFor({ status: "overflowed", claimedBy: null, targetUsername: "bob" }).kind).toBe("refuse");
  });
});

describe("validateDeclineReason", () => {
  test("a real reason passes, trimmed", () => {
    expect(validateDeclineReason("  HOS — out of hours Friday  ")).toEqual({ ok: true, reason: "HOS — out of hours Friday" });
  });
  test("blank refuses — a decline always carries words", () => {
    expect(validateDeclineReason("").ok).toBe(false);
    expect(validateDeclineReason("   ").ok).toBe(false);
    expect(validateDeclineReason(null).ok).toBe(false);
    expect(validateDeclineReason(undefined).ok).toBe(false);
  });
  test("overlong reasons are capped at 300", () => {
    const r = validateDeclineReason("x".repeat(400));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason.length).toBe(300);
  });
});

describe("cleanReferenceNumber", () => {
  test("trims and keeps a real reference", () => {
    expect(cleanReferenceNumber("  BOL-88412 ")).toBe("BOL-88412");
  });
  test("blank becomes null", () => {
    expect(cleanReferenceNumber("")).toBeNull();
    expect(cleanReferenceNumber(null)).toBeNull();
    expect(cleanReferenceNumber(undefined)).toBeNull();
  });
});
