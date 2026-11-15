// Pins invoicing + P&L's homes and the RATE LAW on the client
// (TMS queue item 3):
//
//   (a) the Invoices and Profit & Loss panels live in the Money tab
//       hub (MoneyFlowHub), and the Business profile editor lives in
//       Settings (App.tsx) — mounted, not just defined
//   (b) THE RATE LAW: the invoice is the one document that prints
//       the load's rate. No share, board, broker, shipper, or other
//       outward-facing surface may reference the invoice actions or
//       the invoice document ref — the rate never rides those
//       surfaces. (The Library resolves invoice refs generically as
//       the owner's own document door, like every other statement.)
//
// Run: bun test client/src/invoicingPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const moneySource = readFileSync(`${import.meta.dir}/MoneyFlow.tsx`, "utf8");
const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const i18nSource = readFileSync(`${import.meta.dir}/i18n.ts`, "utf8");

describe("invoicing + P&L — panel homes", () => {
  test("the Money hub mounts the Invoices and Profit & Loss panels", () => {
    const hub = moneySource.slice(moneySource.indexOf("export function MoneyFlowHub"));
    expect(hub).toContain("<InvoicesPanel");
    expect(hub).toContain("<ProfitLossPanel");
    expect(moneySource).toContain("export function InvoicesPanel");
    expect(moneySource).toContain("export function ProfitLossPanel");
    expect(moneySource).toContain('tt(lang, "money.invoicesTitle")');
    expect(moneySource).toContain('tt(lang, "money.plTitle")');
  });

  test("Settings mounts the Business profile editor", () => {
    expect(appSource).toContain("<BusinessProfilePanel />");
    expect(moneySource).toContain("export function BusinessProfilePanel");
    expect(moneySource).toContain("api.saveBusinessProfile");
    expect(moneySource).toContain("api.getBusinessProfile");
  });

  test("both panel titles are translated", () => {
    expect(i18nSource).toContain('"money.invoicesTitle"');
    expect(i18nSource).toContain('"money.plTitle"');
  });

  test("the panels use the invoicing actions and Library document doors", () => {
    expect(moneySource).toContain("api.createInvoice");
    expect(moneySource).toContain("api.issueInvoice");
    expect(moneySource).toContain("api.markInvoicePaid");
    expect(moneySource).toContain("api.getProfitLoss");
    expect(moneySource).toContain("invoice:${d.id}");
    expect(moneySource).toContain("pl:${kind}:${year}:${index}");
  });
});

describe("the rate law — no invoice surface outside Money/Library", () => {
  const outwardFiles = ["Board.tsx", "OpenBoard.tsx", "LoadBoard.tsx", "Broker.tsx", "BrokerPortal.tsx", "ShipperPortal.tsx", "TeamPortal.tsx", "DispatchDesk.tsx", "OwnerDesk.tsx"];
  for (const f of outwardFiles) {
    test(`${f} never references invoicing`, () => {
      const src = readFileSync(`${import.meta.dir}/${f}`, "utf8");
      expect(src).not.toContain("createInvoice");
      expect(src).not.toContain("listInvoices");
      expect(src).not.toContain("getInvoice");
      expect(src).not.toContain("markInvoicePaid");
      expect(src).not.toContain("loadInvoices");
      expect(src).not.toContain("invoice:");
    });
  }
});
