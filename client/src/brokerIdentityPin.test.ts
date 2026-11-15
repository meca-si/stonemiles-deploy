// brokerIdentityPin.test.ts — source pins for broker-grade
// identity (Wave 2 item 3) in the client: the broker's identity
// card + record file live in the Broker Portal, the desk account
// form carries the identity fields, and both load boards render
// the carrier-facing trust line. Same substring-pin style as
// fleetVisibilityPin.test.ts — these pin the SURFACES so a future
// refactor can't silently drop them.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(import.meta.dir, rel), "utf8");

const portal = read("BrokerPortal.tsx");
const openBoard = read("OpenBoard.tsx");
const loadBoard = read("LoadBoard.tsx");

describe("Broker Portal — identity card + record file", () => {
  test("the identity card is defined and mounted for the broker", () => {
    expect(portal).toContain("function BrokerIdentityCard(");
    expect(portal).toContain("<BrokerIdentityCard account={broker}");
    expect(portal).toContain("api.getMyBrokerIdentity(");
    expect(portal).toContain(".updateMyBrokerIdentity(");
    expect(portal).toContain(".verifyBrokerIdentity(");
    expect(portal).toContain(".dismissBrokerBondAlert(");
  });

  test("the 371.3 record file is defined and mounted", () => {
    expect(portal).toContain("function BrokerRecordFile(");
    expect(portal).toContain("<BrokerRecordFile setBanner={setBanner} />");
    expect(portal).toContain("api.getBrokerRecordFile(");
    expect(portal).toContain("49 CFR 371.3");
  });

  test("the desk account form carries the identity fields through create/update", () => {
    expect(portal).toContain("legalName: clean(d.legalName)");
    expect(portal).toContain("bondCarrier: clean(d.bondCarrier)");
    expect(portal).toContain("bondExpiresOn: clean(d.bondExpiresOn)");
    expect(portal).toContain('htmlFor="broker-account-bond-expiry"');
    expect(portal).toContain('htmlFor="broker-identity-bond-expiry"');
  });
});

describe("load boards — the carrier-facing trust line", () => {
  test("the Open Board renders brokerTrust when present", () => {
    expect(openBoard).toContain("r.brokerTrust");
    expect(openBoard).toContain("Broker identity:");
    expect(openBoard).toContain("bondStatusLabel");
    expect(openBoard).toContain("verificationLabel");
  });

  test("the fleet Load Board renders brokerTrust when present", () => {
    expect(loadBoard).toContain("r.brokerTrust");
    expect(loadBoard).toContain("Broker identity:");
    expect(loadBoard).toContain("bondStatusLabel");
    expect(loadBoard).toContain("verificationLabel");
  });

  test("neither board ever renders a bond amount", () => {
    expect(openBoard).not.toContain("bondAmount");
    expect(loadBoard).not.toContain("bondAmount");
  });
});
