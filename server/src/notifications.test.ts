// Notification center rules (TMS queue item 9) — the pure half:
// dedupe policy per kind, the title/body builders (a load offer can
// never carry a rate — the builder is never handed one), preview
// truncation, and the honest device-push state machine (no sender
// exists in this build, so nothing may ever resolve to "sent").
//
// Run: bun test server/src/notifications.test.ts
import { describe, expect, test } from "bun:test";
import {
  credentialNotification,
  dedupePolicyFor,
  dmNotification,
  hosNotification,
  loadOfferNotification,
  previewText,
  pushSenderFromEnv,
  pushStateFor,
  pushStatusLine,
} from "./notifications";

describe("dedupe policy", () => {
  test("messages and HOS warnings collapse until read", () => {
    expect(dedupePolicyFor("dm")).toBe("until_read");
    expect(dedupePolicyFor("hos")).toBe("until_read");
  });
  test("a credential threshold notifies once per card", () => {
    expect(dedupePolicyFor("credential")).toBe("ever");
  });
  test("load offers and system notes are always their own row", () => {
    expect(dedupePolicyFor("load_offer")).toBe("unique");
    expect(dedupePolicyFor("system")).toBe("unique");
  });
});

describe("previewText", () => {
  test("collapses whitespace and truncates at a word boundary", () => {
    expect(previewText("hello   world\nagain")).toBe("hello world again");
    const long = "word ".repeat(60).trim();
    const out = previewText(long);
    expect(out.length).toBeLessThanOrEqual(141);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });
  test("short text passes through untouched", () => {
    expect(previewText("At the gate, door 12")).toBe("At the gate, door 12");
  });
});

describe("dmNotification", () => {
  test("a DM titles the sender and previews the body", () => {
    const n = dmNotification({ senderName: "Dispatch Dana", groupLabel: null, body: "Load is ready at door 12", kind: "text" });
    expect(n.title).toBe("Dispatch Dana");
    expect(n.body).toBe("Load is ready at door 12");
  });
  test("a group message titles the group and leads with the sender", () => {
    const n = dmNotification({ senderName: "Dispatch Dana", groupLabel: "RUGGS LOGISTICS", body: "Rolling at 6", kind: "text" });
    expect(n.title).toBe("RUGGS LOGISTICS");
    expect(n.body).toBe("Dispatch Dana: Rolling at 6");
  });
  test("non-text kinds describe the share instead of dumping payload", () => {
    expect(dmNotification({ senderName: "A", groupLabel: null, body: "{}", kind: "load" }).body).toBe("Shared a load");
    expect(dmNotification({ senderName: "A", groupLabel: null, body: "{}", kind: "route" }).body).toBe("Shared a route");
    expect(dmNotification({ senderName: "A", groupLabel: null, body: "{}", kind: "location" }).body).toBe("Shared a location");
  });
});

describe("loadOfferNotification — the rate law", () => {
  test("carries the sender and the lane, and no money figure of any kind", () => {
    const n = loadOfferNotification({
      brokerName: "Pat Broker",
      brokerCompany: "Acme Freight",
      pickupLabel: "Mobile, AL",
      deliveryLabel: "Pensacola, FL",
      viaDoor: true,
    });
    expect(n.title).toContain("load offer");
    expect(n.body).toContain("Pat Broker");
    expect(n.body).toContain("Acme Freight");
    expect(n.body).toContain("Mobile, AL → Pensacola, FL");
    expect(n.body).not.toMatch(/\$\s?\d/);
    expect(n.body).not.toMatch(/\d+\s?(usd|dollars)/i);
  });
  test("an anonymous door submission still reads plainly", () => {
    const n = loadOfferNotification({ brokerName: null, brokerCompany: null, pickupLabel: null, deliveryLabel: null, viaDoor: true });
    expect(n.body).toContain("A broker / shipper");
  });
});

describe("credentialNotification", () => {
  test("the expired state says expired, with the date", () => {
    const n = credentialNotification({ label: "CDL", threshold: 0, daysLeft: -2, expiresOn: "2026-11-01" });
    expect(n.title).toBe("CDL expired");
    expect(n.body).toContain("2026-11-01");
  });
  test("a threshold names the days left", () => {
    const n = credentialNotification({ label: "Medical card", threshold: 30, daysLeft: 30, expiresOn: "2026-12-15" });
    expect(n.title).toBe("Medical card expires in 30 days");
    const one = credentialNotification({ label: "TWIC", threshold: 7, daysLeft: 1, expiresOn: "2026-11-16" });
    expect(one.title).toBe("TWIC expires in 1 day");
  });
});

describe("hosNotification", () => {
  test("mirrors the Drive screen's warning words", () => {
    const n = hosNotification({ clock: "drive", thresholdMin: 30 });
    expect(n.body).toBe("30 minutes left before your drive clock.");
    const at = hosNotification({ clock: "window", thresholdMin: 0 });
    expect(at.title).toContain("at your limit");
    expect(at.body).toContain("shift window");
  });
});

describe("device push — honest states only", () => {
  test("no sender exists in this build, even with a credential in the env", () => {
    expect(pushSenderFromEnv({})).toBeNull();
    expect(pushSenderFromEnv({ FCM_SERVICE_ACCOUNT_JSON: "{\"project_id\":\"x\"}" })).toBeNull();
  });
  test("state resolution never claims a send that cannot happen", () => {
    expect(pushStateFor({ enabledDeviceCount: 0, senderConfigured: false })).toBe("no_devices");
    expect(pushStateFor({ enabledDeviceCount: 2, senderConfigured: false })).toBe("not_configured");
    expect(pushStateFor({ enabledDeviceCount: 2, senderConfigured: true, sendOk: null })).toBe("not_configured");
    expect(pushStateFor({ enabledDeviceCount: 2, senderConfigured: true, sendOk: true })).toBe("sent");
    expect(pushStateFor({ enabledDeviceCount: 2, senderConfigured: true, sendOk: false })).toBe("failed");
  });
  test("the status line says push arrives with the Android app — and that nothing is emailed", () => {
    const line = pushStatusLine({ enabledDeviceCount: 0, senderConfigured: false });
    expect(line).toContain("Android app");
    expect(line).toContain("nothing is emailed");
  });
});
