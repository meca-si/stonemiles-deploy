import { describe, expect, test } from "bun:test";
import { MAX_SESSION_REPORTS, SessionReportGate, isNetworkFailure, reportFromError, reportKey, sanitizeClientText, stackHead } from "./appHealth";

describe("isNetworkFailure (connectivity noise is never reported)", () => {
  test("fetch failures are network failures; real errors are not", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure("NetworkError when attempting to fetch resource")).toBe(true);
    expect(isNetworkFailure(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});

describe("sanitizeClientText", () => {
  test("strips personal shapes before anything leaves the device", () => {
    const out = sanitizeClientText("err for bob@example.com 251-599-8668 123-45-6789 at 30.12345, -88.12345");
    expect(out).not.toContain("@example.com");
    expect(out).not.toContain("251-599-8668");
    expect(out).not.toContain("123-45-6789");
    expect(out).not.toContain("30.12345");
  });
});

describe("reportFromError", () => {
  test("builds a sanitized payload with a stack head", () => {
    const err = new Error("Boom at 30.12345, -88.12345");
    const p = reportFromError({ error: err, kind: "crash", screen: "Drive" });
    expect(p.kind).toBe("crash");
    expect(p.title).toContain("Boom");
    expect(p.title).not.toContain("30.12345");
    expect(p.manual).toBe(false);
    expect(p.detail).toBeTruthy();
  });
  test("string and unknown errors still produce a title", () => {
    expect(reportFromError({ error: "plain failure", kind: "error", screen: null }).title).toBe("plain failure");
    expect(reportFromError({ error: 42, kind: "error", screen: null }).title).toBe("Unknown error");
  });
  test("stackHead takes two lines max", () => {
    expect(stackHead("one\ntwo\nthree\nfour")).toBe("one · two");
    expect(stackHead(null)).toBeNull();
    expect(stackHead("")).toBeNull();
  });
});

describe("SessionReportGate", () => {
  const payload = (title: string) => ({ kind: "error" as const, title, detail: null, screen: "Drive", manual: false });
  test("same failure sends once per session; number variants dedupe", () => {
    const g = new SessionReportGate();
    expect(g.allow(payload("Timeout after 3000ms"))).toBe(true);
    expect(g.allow(payload("Timeout after 9000ms"))).toBe(false);
    expect(reportKey(payload("Timeout after 3000ms"))).toBe(reportKey(payload("Timeout after 9000ms")));
  });
  test("session cap stops a flood; manual reports always go", () => {
    const g = new SessionReportGate();
    for (let i = 0; i < MAX_SESSION_REPORTS; i++) expect(g.allow(payload(`Failure number ${String.fromCharCode(97 + i)}`))).toBe(true);
    expect(g.allow(payload("One failure too many"))).toBe(false);
    expect(g.allow({ ...payload("Manual note"), manual: true })).toBe(true);
  });
});
