// receiverCopy.test.ts — the driver-device text handoff: the payload
// carries the view-only copy link and NEVER an action-capable token.

import { describe, expect, test } from "bun:test";
import { buildSmsHandoff, carriesActionToken, isPlausibleMobile, maskPhone } from "./receiverCopy";

describe("receiver copy text handoff", () => {
  const copyUrl = "https://app.stonervision.io/pod/cpy_0123456789abcdef0123456789abcdef";

  test("body + href carry the copy link, addressed to the typed number", () => {
    const h = buildSmsHandoff({ phone: "(251) 555-0142", fleetName: "RUGGS LOGISTICS", copyUrl });
    expect(h.digits).toBe("2515550142");
    expect(h.body).toBe(`Your signed delivery copy from RUGGS LOGISTICS: ${copyUrl}`);
    expect(h.href.startsWith("sms:2515550142?&body=")).toBe(true);
    expect(decodeURIComponent(h.href.split("body=")[1]!)).toBe(h.body);
  });

  test("the handoff NEVER carries an action-capable receive token", () => {
    const h = buildSmsHandoff({ phone: "2515550142", fleetName: "Fleet", copyUrl });
    expect(carriesActionToken(h.body)).toBe(false);
    expect(carriesActionToken(h.href)).toBe(false);
    expect(h.body).not.toContain("rcv_");
    // The guard itself fires on a real action link (so the test means something).
    expect(carriesActionToken("https://app.stonervision.io/receive/rcv_0123456789abcdef0123456789abcdef")).toBe(true);
  });

  test("masking shows only the last two digits", () => {
    expect(maskPhone("(251) 555-0142")).toBe("***-***-42");
    expect(isPlausibleMobile("2515550142")).toBe(true);
    expect(isPlausibleMobile("123")).toBe(false);
  });
});
