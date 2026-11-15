// FactoringPanel.tsx — instant pay / factoring + accounts
// receivable (Wave 2 item 7).
//
// Two surfaces over the server rules (factoring.ts — the panels
// render states, they never compute them):
//
//   InvoiceFactoringPanel — inside one invoice's detail in the
//     Money tab: the eligibility checks (delivered + sealed, POD
//     paperwork CONFIRMED, invoice issued), the submission ladder
//     (packaged → submitted → advanced → settled), and the
//     honest state of the lane. Money rails stay OFF: with no
//     factoring partner connected the package assembles and
//     stops there — the panel says so, the send stays disabled,
//     and nothing is ever called "submitted" that wasn't. No
//     fee figure appears anywhere: no partner terms exist to
//     price one from, and an invented fee would be a fabricated
//     number on a money surface.
//
//   ReceivablesPanel — the Money tab's accounts-receivable
//     rollup: the driver's own invoices aged by days past due,
//     what's with a factor, what's packaged, what's been paid.
//     Their own billed amounts on their own records — the one
//     surface where those numbers belong.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { Section, money } from "./NextLevel";

type Banner = (s: string | null) => void;
type FactoringData = ApiResponse<typeof api, "getInvoiceFactoring">;

const BTN = "rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold disabled:opacity-50";
const BTN_GOLD = "btn-gold !px-3 !py-1.5 text-xs disabled:opacity-50";

function downloadPdf(filename: string, dataBase64: string) {
  const bin = atob(dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const LADDER: { key: string; label: string }[] = [
  { key: "packaged", label: "Packaged" },
  { key: "submitted", label: "Submitted" },
  { key: "advanced", label: "Advanced" },
  { key: "settled", label: "Settled" },
];

function ladderIndex(status: string): number {
  return LADDER.findIndex((r) => r.key === status);
}

export function InvoiceFactoringPanel({ invoiceId, setBanner }: { invoiceId: number; setBanner: Banner }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["invoice-factoring", invoiceId], queryFn: () => api.getInvoiceFactoring({ id: invoiceId }) });
  const [busy, setBusy] = useState("");
  const f: FactoringData | undefined = q.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoice-factoring", invoiceId] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["invoice"] });
    void queryClient.invalidateQueries({ queryKey: ["accounts-receivable"] });
    void queryClient.invalidateQueries({ queryKey: ["owed-board"] });
    void queryClient.invalidateQueries({ queryKey: ["library"] });
  };
  async function act(label: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(label);
    try {
      const out = (await fn()) as { message?: string } | null;
      refresh();
      setBanner(out?.message ?? okMsg);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  if (q.isLoading || !f) {
    return (
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">⚡ Instant pay — factoring</p>
        <p className="mt-1 text-xs text-[var(--dim)]">Loading…</p>
      </div>
    );
  }

  const idx = ladderIndex(f.status);
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">⚡ Instant pay — factoring</p>
      <p className="mt-1 text-xs text-[var(--dim)]">
        Factoring turns an issued invoice into fast pay: a factor buys the bill and collects from the broker. The package is this
        invoice plus its confirmed POD, assembled from your sealed records.
      </p>

      <div className="mt-2 space-y-1">
        {f.checks.map((c) => (
          <p key={c.key} className="text-xs">
            <span className={c.ok ? "text-emerald-300" : "text-red-300"}>{c.ok ? "✓" : "✗"}</span>{" "}
            <span className="text-[var(--text)]">{c.label}</span>
          </p>
        ))}
      </div>

      {idx >= 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={`Factoring status: ${f.statusLabel}`}>
          {LADDER.map((rung, i) => (
            <span key={rung.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[var(--dim)]">→</span>}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                  i < idx
                    ? "bg-emerald-500/15 text-emerald-300"
                    : i === idx
                      ? "bg-sky-500/15 text-sky-300"
                      : "bg-[var(--surface)] text-[var(--dim)]"
                }`}
              >
                {rung.label}
              </span>
            </span>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-xs text-[var(--dim)]">
        Status: <span className="font-bold text-[var(--text)]">{f.statusLabel}</span>
        {f.partnerRef ? ` · partner ref ${f.partnerRef}` : ""}
        {f.settledAt ? ` · settled ${f.settledAt.slice(0, 10)}` : f.advancedAt ? ` · advanced ${f.advancedAt.slice(0, 10)}` : f.submittedAt ? ` · submitted ${f.submittedAt.slice(0, 10)}` : f.packagedAt ? ` · packaged ${f.packagedAt.slice(0, 10)}` : ""}
      </p>

      {!f.partnerConnected && (
        <p className="mt-1.5 rounded-xl bg-[var(--surface)] px-3 py-2 text-xs text-[var(--dim)]">
          No factoring partner is connected yet. You can assemble the package now — invoice + confirmed POD — and it sends as-is
          the day a partner connects. Until then nothing is sent and no money moves.
        </p>
      )}
      {f.partnerConnected && f.partnerName && (
        <p className="mt-1.5 text-xs text-[var(--dim)]">
          Factoring partner: <span className="font-bold text-[var(--text)]">{f.partnerName}</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {f.status === "none" && (
          <button
            type="button"
            className={BTN_GOLD}
            disabled={busy !== "" || !f.eligible}
            onClick={() => void act("package", () => api.submitInvoiceForFactoring({ id: invoiceId }), "Factoring package assembled.")}
          >
            Assemble factoring package
          </button>
        )}
        {f.status === "packaged" && f.partnerConnected && (
          <button
            type="button"
            className={BTN_GOLD}
            disabled={busy !== ""}
            onClick={() => void act("send", () => api.submitInvoiceForFactoring({ id: invoiceId }), "Package sent to the factor.")}
          >
            Send package to {f.partnerName ?? "the factor"}
          </button>
        )}
        {f.status === "packaged" && !f.partnerConnected && (
          <button type="button" className={BTN} disabled title="No factoring partner is connected yet">
            Send to a factor — not connected yet
          </button>
        )}
        {f.status === "submitted" && (
          <button
            type="button"
            className={BTN_GOLD}
            disabled={busy !== ""}
            onClick={() => void act("advance", () => api.recordFactorAdvance({ id: invoiceId }), "Advance recorded.")}
          >
            Record advance received
          </button>
        )}
        {(f.status === "submitted" || f.status === "advanced") && (
          <button
            type="button"
            className={BTN}
            disabled={busy !== ""}
            onClick={() => void act("settle", () => api.recordFactorSettlement({ id: invoiceId }), "Settlement recorded — the invoice is closed as paid.")}
          >
            Record settlement
          </button>
        )}
        {f.packageInvoiceRef && (
          <button
            type="button"
            className={BTN}
            disabled={busy !== ""}
            onClick={() =>
              void act("pkgpdf", async () => {
                const doc = await api.getLibraryDocument({ ref: `factor-package:${invoiceId}` });
                if (!doc.dataBase64 || !doc.filename) throw new Error(doc.error ?? "That document couldn't be built.");
                downloadPdf(doc.filename, doc.dataBase64);
              }, "Package sheet downloaded.")
            }
          >
            Package sheet PDF
          </button>
        )}
      </div>
      {f.status === "none" && !f.eligible && (
        <p className="mt-1.5 text-xs text-[var(--dim)]">Complete the checks above and the package can be assembled.</p>
      )}
      {f.packageInvoiceRef && (
        <p className="mt-1.5 text-[11px] text-[var(--dim)]">
          Package contents: invoice document ({f.packageInvoiceRef}) + signed POD ({f.packagePodRef}) — both from your Library.
        </p>
      )}
    </div>
  );
}

export function ReceivablesPanel() {
  const q = useQuery({ queryKey: ["accounts-receivable"], queryFn: () => api.getAccountsReceivable({}) });
  const d = q.data;
  const empty =
    d != null && d.outstandingCount === 0 && d.factoredCount === 0 && d.paidCount === 0 && d.draftCount === 0;
  return (
    <Section title="Accounts receivable" ariaLabel="Accounts receivable — who owes, how old, what's paid">
      <p className="text-xs text-[var(--dim)]">
        Every invoice you've cut, aged by how long it's been owed: what's still out, how far past due it is, what's with a
        factor, and what's already been paid. From your own invoice records only.
      </p>
      {q.isLoading || !d ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
      ) : empty ? (
        <p className="mt-3 text-sm text-[var(--dim)]">No invoices yet — receivables build from the invoices above.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {d.buckets
            .filter((b) => b.count > 0)
            .map((b) => (
              <div key={b.key} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                <span>
                  {b.label} <span className="text-xs text-[var(--dim)]">· {b.count} invoice{b.count === 1 ? "" : "s"}</span>
                </span>
                <span className="font-condensed text-base font-bold">{money(b.total)}</span>
              </div>
            ))}
          <div className="flex items-center justify-between gap-2 px-3 py-1 text-sm">
            <span className="font-bold">Outstanding</span>
            <span className="font-condensed text-base font-bold">{money(d.outstandingTotal)}</span>
          </div>
          {d.factoredCount > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
              <span>
                With a factor <span className="text-xs text-[var(--dim)]">· {d.factoredCount} invoice{d.factoredCount === 1 ? "" : "s"} submitted / advanced</span>
              </span>
              <span className="font-condensed text-base font-bold">{money(d.factoredTotal)}</span>
            </div>
          )}
          {d.packagedCount > 0 && (
            <p className="px-3 text-xs text-[var(--dim)]">
              {d.packagedCount} invoice{d.packagedCount === 1 ? " is" : "s are"} packaged for factoring — still counted in the
              aging above until a partner takes {d.packagedCount === 1 ? "it" : "them"}.
            </p>
          )}
          <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <span>
              Paid <span className="text-xs text-[var(--dim)]">· {d.paidCount} invoice{d.paidCount === 1 ? "" : "s"}</span>
              {d.settledFactoredCount > 0 && (
                <span className="text-xs text-[var(--dim)]"> · {d.settledFactoredCount} settled through factoring</span>
              )}
            </span>
            <span className="font-condensed text-base font-bold">{money(d.paidTotal)}</span>
          </div>
          {d.draftCount > 0 && (
            <p className="px-3 text-xs text-[var(--dim)]">
              {d.draftCount} draft invoice{d.draftCount === 1 ? "" : "s"} not issued yet — drafts aren't receivables until they're
              issued.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
