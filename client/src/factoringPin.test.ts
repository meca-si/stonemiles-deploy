// factoringPin.test.ts — source pins for instant pay /
// factoring + broker credit (Wave 2 item 7) in the client: the
// factoring panel lives inside the invoice detail, the AR
// rollup mounts in the Money hub, and both load boards render
// the broker payment-record line. Same substring-pin style as
// brokerIdentityPin.test.ts — these pin the SURFACES so a
// future refactor can't silently drop them, plus the honesty
// lines that must stay attached to the lane.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(import.meta.dir, rel), "utf8");

const panel = read("FactoringPanel.tsx");
const money = read("MoneyFlow.tsx");
const openBoard = read("OpenBoard.tsx");
const loadBoard = read("LoadBoard.tsx");

describe("Money tab — factoring panel + receivables", () => {
  test("the factoring panel is defined and mounted inside the invoice detail", () => {
    expect(panel).toContain("export function InvoiceFactoringPanel(");
    expect(panel).toContain("api.getInvoiceFactoring(");
    expect(panel).toContain("api.submitInvoiceForFactoring(");
    expect(panel).toContain("api.recordFactorAdvance(");
    expect(panel).toContain("api.recordFactorSettlement(");
    expect(money).toContain("<InvoiceFactoringPanel invoiceId={d.id} setBanner={setBanner} />");
    expect(money).toContain('from "./FactoringPanel"');
  });

  test("the honest lane lines stay attached: no partner, no send, no fee talk", () => {
    expect(panel).toContain("No factoring partner is connected yet");
    expect(panel).toContain("nothing is sent and no money moves");
    expect(panel).not.toContain("factoring fee");
    expect(panel).not.toContain("fee of");
  });

  test("the receivables rollup is defined and mounted in the Money hub", () => {
    expect(panel).toContain("export function ReceivablesPanel(");
    expect(panel).toContain("api.getAccountsReceivable(");
    expect(money).toContain("<ReceivablesPanel />");
    expect(money).toContain('id="receivables"');
  });

  test("the invoice list carries the factoring state", () => {
    expect(money).toContain("inv.factorStatus");
  });
});

describe("Boards — the broker payment record", () => {
  test("both boards render brokerCredit beside the trust line", () => {
    for (const src of [loadBoard, openBoard]) {
      expect(src).toContain("r.brokerCredit");
      expect(src).toContain("Payment record:");
      expect(src).toContain("r.brokerCredit.label");
    }
  });
});
