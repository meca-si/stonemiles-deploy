// AccountingPanel.tsx — QuickBooks Online + Xero two-way sync
// (Wave 2 item 10, Part A), in the Money tab.
//
// The panel renders the server's states and never invents one:
//  - a provider whose OAuth app credentials aren't on the server
//    says "Accounting sync isn't connected yet" — no connect
//    button pretends otherwise;
//  - a connected provider shows "Connected as <the books' own
//    name>" — the only identity the client ever sees. Tokens
//    live server-side only and no action returns them;
//  - the review list shows conflicts with BOTH versions (this
//    app's and the provider's) and unmatched inbound payments;
//    the user picks the winner or links the payment — nothing
//    auto-merges a money record.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { Section } from "./NextLevel";

type SyncData = ApiResponse<typeof api, "getAccountingSync">;
type ProviderState = SyncData["providers"][number];
type ReviewItem = SyncData["review"][number];

const BTN = "rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold disabled:opacity-50";
const BTN_GOLD = "btn-gold !px-3 !py-1.5 text-xs disabled:opacity-50";
const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-sm text-[var(--text)]";

function Lines({ lines }: { lines: { label: string; value: string }[] }) {
  return (
    <div className="space-y-0.5">
      {lines.map((l, i) => (
        <p key={i} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-[var(--dim)]">{l.label}</span>
          <span className="text-right font-semibold">{l.value}</span>
        </p>
      ))}
    </div>
  );
}

function ReviewCard({ item, refresh }: { item: ReviewItem; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [linkInvoiceId, setLinkInvoiceId] = useState<number | null>(null);
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const openInvoices = (invoices.data?.invoices ?? []).filter((i) => i.status !== "paid");

  async function act(label: string, fn: () => Promise<{ note?: string }>, okMsg: string) {
    setBusy(label);
    setMsg(null);
    try {
      const out = await fn();
      refresh();
      setMsg(out?.note ?? okMsg);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  const chip =
    item.state === "conflict"
      ? "bg-amber-500/15 text-amber-300"
      : item.state === "review"
        ? "bg-sky-500/15 text-sky-300"
        : "bg-red-500/15 text-red-300";
  const chipLabel =
    item.state === "conflict" ? "Needs your call" : item.state === "review" ? "Unmatched payment" : "Sync error";

  return (
    <div className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">{item.label}</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${chip}`}>{chipLabel}</span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">In {item.providerName}</p>

      {item.state === "error" && (
        <p className="mt-2 text-xs text-red-300">
          {item.error ?? "The last sync attempt for this record didn't complete."} Run a sync to try again.
        </p>
      )}

      {item.state === "conflict" && (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] px-2.5 py-2">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">This app</p>
              <Lines lines={item.localLines} />
            </div>
            <div className="rounded-lg border border-[var(--border)] px-2.5 py-2">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">{item.providerName}</p>
              <Lines lines={item.providerLines} />
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--dim)]">
            Both sides changed since the last sync. Nothing merges on its own — pick the version that stands.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={BTN_GOLD}
              disabled={busy !== ""}
              onClick={() =>
                void act("local", () => api.resolveAccountingConflict({ syncRecordId: item.syncRecordId, winner: "local" }), "Your version stands.")
              }
            >
              {busy === "local" ? "Sending…" : "Keep this app's version"}
            </button>
            <button
              type="button"
              className={BTN}
              disabled={busy !== ""}
              onClick={() =>
                void act("provider", () => api.resolveAccountingConflict({ syncRecordId: item.syncRecordId, winner: "provider" }), "Theirs stands.")
              }
            >
              {busy === "provider" ? "Adopting…" : `Use ${item.providerName}'s version`}
            </button>
          </div>
        </>
      )}

      {item.state === "review" && (
        <>
          <div className="mt-2 rounded-lg border border-[var(--border)] px-2.5 py-2">
            <Lines lines={item.providerLines} />
          </div>
          <p className="mt-2 text-xs text-[var(--dim)]">
            This payment was recorded in {item.providerName} but doesn't name one of your invoices here. Link it to the
            invoice it pays — it lands through the same sealed payment path as any paid invoice — or dismiss it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs"
              value={linkInvoiceId ?? ""}
              onChange={(e) => setLinkInvoiceId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Invoice this payment pays"
            >
              <option value="">Pick the invoice…</option>
              {openInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} — {i.billToName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BTN_GOLD}
              disabled={busy !== "" || linkInvoiceId == null}
              onClick={() =>
                void act(
                  "link",
                  () => api.resolveAccountingReview({ syncRecordId: item.syncRecordId, invoiceId: linkInvoiceId }),
                  "Linked.",
                )
              }
            >
              {busy === "link" ? "Linking…" : "Link payment"}
            </button>
            <button
              type="button"
              className={BTN}
              disabled={busy !== ""}
              onClick={() =>
                void act("dismiss", () => api.resolveAccountingReview({ syncRecordId: item.syncRecordId, dismiss: true }), "Dismissed.")
              }
            >
              Dismiss
            </button>
          </div>
        </>
      )}
      {msg && <p className="mt-2 text-xs font-semibold text-emerald-300">{msg}</p>}
    </div>
  );
}

function ProviderCard({ p, refresh }: { p: ProviderState; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ state: string } | null>(null);
  const [code, setCode] = useState("");
  const [realmId, setRealmId] = useState("");

  async function connect() {
    setBusy("connect");
    setMsg(null);
    try {
      const out = await api.startAccountingConnect({ provider: p.kind as "quickbooks" | "xero" });
      setMsg(out.note);
      if (out.ok && out.authorizeUrl && out.state) {
        setPending({ state: out.state });
        window.open(out.authorizeUrl, "_blank", "noopener");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  async function complete() {
    if (!pending) return;
    setBusy("complete");
    setMsg(null);
    try {
      const out = await api.completeAccountingConnect({
        provider: p.kind as "quickbooks" | "xero",
        code: code.trim(),
        state: pending.state,
        realmId: realmId.trim() ? realmId.trim() : null,
      });
      setPending(null);
      setCode("");
      refresh();
      setMsg(out.connectedAs ? `Connected as ${out.connectedAs}.` : "Connected.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  async function sync() {
    setBusy("sync");
    setMsg(null);
    try {
      const out = await api.runAccountingSync({ provider: p.kind as "quickbooks" | "xero" });
      refresh();
      setMsg(
        out.note ??
          `Sync done — ${out.pushed} sent, ${out.pulled} payment${out.pulled === 1 ? "" : "s"} pulled in, ${out.conflicts} conflict${out.conflicts === 1 ? "" : "s"}, ${out.review} to review, ${out.errors} error${out.errors === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setMsg(null);
    try {
      await api.disconnectAccounting({ provider: p.kind as "quickbooks" | "xero" });
      refresh();
      setMsg(`Disconnected from ${p.name}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">{p.name}</p>
        {p.connected ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-300">
            Connected
          </span>
        ) : (
          <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--dim)]">
            Not connected
          </span>
        )}
      </div>

      {!p.configured ? (
        <p className="mt-1.5 text-xs text-[var(--dim)]">
          Accounting sync isn't connected yet — the {p.name} app credentials aren't set up on the server, so nothing can
          connect or sync here yet.
        </p>
      ) : p.connected ? (
        <>
          <p className="mt-1.5 text-xs text-[var(--dim)]">
            Connected as <span className="font-semibold text-[var(--text)]">{p.connectedAs ?? "your books"}</span> ·{" "}
            {p.counts.synced} synced
            {p.counts.conflict > 0 ? ` · ${p.counts.conflict} conflict${p.counts.conflict === 1 ? "" : "s"}` : ""}
            {p.counts.review > 0 ? ` · ${p.counts.review} to review` : ""}
            {p.counts.error > 0 ? ` · ${p.counts.error} error${p.counts.error === 1 ? "" : "s"}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={BTN_GOLD} disabled={busy !== ""} onClick={() => void sync()}>
              {busy === "sync" ? "Syncing…" : "Run sync"}
            </button>
            <button type="button" className={BTN} disabled={busy !== ""} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-xs text-[var(--dim)]">
            Connect your books and your issued invoices, recorded payments, and settlements stay in step both ways.
          </p>
          <div className="mt-2">
            <button type="button" className={BTN_GOLD} disabled={busy !== ""} onClick={() => void connect()}>
              {busy === "connect" ? "Opening…" : `Connect ${p.name}`}
            </button>
          </div>
          {pending && (
            <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] px-2.5 py-2">
              <p className="text-xs text-[var(--dim)]">
                After you approve access, {p.name} sends you back with a code. Paste it here to finish connecting.
              </p>
              <input className={INPUT} placeholder="Code from the provider" value={code} onChange={(e) => setCode(e.target.value)} />
              {p.kind === "quickbooks" && (
                <input
                  className={INPUT}
                  placeholder="Company ID (realmId) from the return link"
                  value={realmId}
                  onChange={(e) => setRealmId(e.target.value)}
                />
              )}
              <button type="button" className={BTN_GOLD} disabled={busy !== "" || !code.trim()} onClick={() => void complete()}>
                {busy === "complete" ? "Connecting…" : "Finish connecting"}
              </button>
            </div>
          )}
        </>
      )}
      {msg && <p className="mt-2 text-xs font-semibold text-emerald-300">{msg}</p>}
    </div>
  );
}

export function AccountingPanel() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["accounting-sync"], queryFn: () => api.getAccountingSync({}) });
  const d = q.data;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["accounting-sync"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["accounts-receivable"] });
    void queryClient.invalidateQueries({ queryKey: ["owed-board"] });
  };
  return (
    <Section title="Accounting sync" ariaLabel="Accounting sync — QuickBooks Online and Xero, two-way">
      <p className="text-xs text-[var(--dim)]">
        Your books, kept in step both ways: issued invoices, recorded payments, and settlements flow out to QuickBooks
        Online or Xero; payments recorded there flow back and mark invoices paid through the same sealed path as any
        payment here. When both sides change the same record, it waits below for your call — nothing auto-merges a money
        record.
      </p>
      {q.isLoading || !d ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p>
      ) : (
        <div className="mt-3 space-y-2">
          {d.providers.map((p) => (
            <ProviderCard key={p.kind} p={p} refresh={refresh} />
          ))}
          {d.review.length > 0 && (
            <>
              <p className="pt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                Needs a look — {d.review.length}
              </p>
              {d.review.map((item) => (
                <ReviewCard key={item.syncRecordId} item={item} refresh={refresh} />
              ))}
            </>
          )}
        </div>
      )}
    </Section>
  );
}
