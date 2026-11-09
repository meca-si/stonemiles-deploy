// MoneyFlow.tsx — the Money & Flow batch (owner green light
// 2026-11-06): document expiry wallet, "Who owes me" board, true
// rate per load, TONU + layover claim logger, maintenance countdown,
// and the breakdown downtime + cost log. The IFTA estimator half of
// the batch lives in NextLevel's IftaPanel (extended in the same
// pass: Q4 2026 published rates, "rate not loaded", planning label).
//
// Every number here comes from the driver's own records through
// server actions; the math lives in moneyMath.ts (unit-tested).
// Records only — nothing here moves money, sends an invoice,
// dispatches help, or files a tax return. Working driver tools on
// every plan, following the Trailer Package pattern; the document
// vault's own Gold gate on saving a document is unchanged (its
// message surfaces here when it applies).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { t as tt, type Lang } from "./i18n";
import { Section, XBar, money } from "./NextLevel";
import {
  AGING_LABEL,
  CLAIM_KINDS,
  DOC_TIER_LABEL,
  MAINTENANCE_ITEMS,
  WALLET_DOC_KINDS,
  avgLoggedFuelPrice,
  breakdownTotals,
  buildOwedBoard,
  claimKindLabel,
  currentOdometerFrom,
  docAlertTier,
  fuelBasisFor,
  maintenanceStatusFor,
  owedTotals,
  trueRateFor,
  type ClaimKind,
  type MaintenanceItemKey,
} from "./moneyMath";

type Banner = (s: string | null) => void;

const inputCls = "w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-[var(--text)]";
const labelCls = "block text-xs font-bold uppercase tracking-wide text-[var(--dim)] mb-1";
const smallBtn = "btn-press rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2 text-sm font-bold";

function laneOf(l: { pickupCity: string | null; pickupState: string | null; deliveryCity: string | null; deliveryState: string | null }): string {
  const a = [l.pickupCity, l.pickupState].filter(Boolean).join(", ");
  const b = [l.deliveryCity, l.deliveryState].filter(Boolean).join(", ");
  return a || b ? `${a || "?"} → ${b || "?"}` : "Lane not on file";
}

// ---------- 1) Document expiry wallet -----------------------------------------

export function ExpiryWalletPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["personal-docs"], queryFn: () => api.listPersonalDocs({}) });
  const docs = list.data?.docs ?? [];
  const [kind, setKind] = useState<string>("medical");
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);

  // For each wallet kind, the entry that matters is the one expiring
  // soonest (a renewed card filed beside the old one shouldn't hide
  // the old one's expiry — soonest wins, which is also the safest).
  const byKind = useMemo(() => {
    const map = new Map<string, (typeof docs)[number]>();
    for (const k of WALLET_DOC_KINDS) {
      const ofKind = docs.filter((d) => d.kind === k.key);
      if (ofKind.length === 0) continue;
      const withDate = ofKind.filter((d) => d.daysLeft != null).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
      map.set(k.key, (withDate[0] ?? ofKind[0])!);
    }
    return map;
  }, [docs]);

  const alerts = docs.filter((d) => {
    const t = docAlertTier(d.daysLeft);
    return t === "expired" || t === "due7" || t === "due14" || t === "due30";
  });

  const tierCls = (tier: string) =>
    tier === "expired"
      ? "bg-red-900/50 text-red-200"
      : tier === "due7"
        ? "bg-red-900/30 text-red-200"
        : tier === "due14"
          ? "bg-amber-900/40 text-amber-200"
          : tier === "due30"
            ? "bg-amber-900/25 text-amber-100"
            : "bg-[var(--surface2)] text-[var(--dim)]";

  return (
    <Section title={tt(lang, "money.expiryWallet")} ariaLabel="Document expiry wallet">
      <p className="text-sm text-[var(--dim)]">
        The five dates that can park your truck. Enter each expiry once and this wallet watches it for you — alerts at <strong className="text-[var(--text)]">30, 14, and 7 days out</strong>, and an expired state the day it lapses. Alerts are <strong className="text-[var(--text)]">in-app only</strong>: they show here, on the Driver tab, and in the Morning Briefing — the app doesn't send push notifications. The document files themselves live in the Document Vault just below; this wallet tracks the dates.
      </p>
      {alerts.map((d) => (
        <p key={d.id} className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${tierCls(docAlertTier(d.daysLeft))}`} role="alert">
          {docAlertTier(d.daysLeft) === "expired"
            ? `⛔ ${d.label} EXPIRED ${Math.abs(d.daysLeft ?? 0)} days ago — renew before you roll.`
            : d.daysLeft === 0
              ? `⏰ ${d.label} expires TODAY.`
              : `⏰ ${d.label} expires in ${d.daysLeft} days (${DOC_TIER_LABEL[docAlertTier(d.daysLeft)]}).`}
        </p>
      ))}
      <div className="mt-3 space-y-1.5">
        {WALLET_DOC_KINDS.map((k) => {
          const d = byKind.get(k.key);
          const tier = d ? docAlertTier(d.daysLeft) : "no_date";
          return (
            <div key={k.key} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
              <span className="min-w-0">
                <strong>{k.label}</strong>
                <span className="block truncate text-xs text-[var(--dim)]">
                  {d
                    ? `${d.label}${d.expiresAt ? ` · expires ${new Date(d.expiresAt).toLocaleDateString()}` : " · no expiry date entered"}`
                    : "Not in the wallet yet — add its expiry below."}
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${tierCls(tier)}`}>
                {d && d.daysLeft != null && tier !== "ok" ? `${DOC_TIER_LABEL[tier]}${d.daysLeft >= 0 ? ` · ${d.daysLeft}d` : ""}` : d ? DOC_TIER_LABEL[tier] : "Not added"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-3">
        <div>
          <label className={labelCls} htmlFor="wallet-kind">Document</label>
          <select id="wallet-kind" className={inputCls} value={kind} aria-label="Expiry wallet document kind" onChange={(e) => setKind(e.target.value)}>
            {WALLET_DOC_KINDS.map((k) => (
              <option key={k.key} value={k.key}>{k.label}</option>
            ))}
            <option value="ifta_licence">IFTA licence</option>
            <option value="other">Other document</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="wallet-label">Label</label>
          <input id="wallet-label" className={inputCls} value={label} aria-label="Expiry wallet document label" placeholder={WALLET_DOC_KINDS.find((k) => k.key === kind)?.label ?? "Document"} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls} htmlFor="wallet-expiry">Expiry date</label>
          <input id="wallet-expiry" type="date" className={inputCls} value={expiry} aria-label="Expiry wallet expiry date" onChange={(e) => setExpiry(e.target.value)} />
        </div>
      </div>
      <button
        type="button"
        disabled={busy || !expiry}
        className="btn-neon btn-press mt-2 rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
        aria-label="Save this expiry date to the wallet"
        onClick={() => {
          setBusy(true);
          const finalLabel = label.trim() || WALLET_DOC_KINDS.find((k) => k.key === kind)?.label || "Document";
          void api
            .savePersonalDoc({ kind: kind as "cdl" | "medical" | "insurance" | "registration" | "ifta_licence" | "dot_inspection" | "other", label: finalLabel, expiresAt: new Date(expiry + "T12:00:00").toISOString(), docNumberLast4: null, notes: null, dataBase64: null, mime: null })
            .then((r) => {
              if (r.error) {
                setBanner(r.error);
                return;
              }
              setBanner(`${finalLabel} expiry saved — the wallet now watches that date (30 / 14 / 7-day alerts + expired, in-app).`);
              setLabel("");
              setExpiry("");
              void queryClient.invalidateQueries({ queryKey: ["personal-docs"] });
              void queryClient.invalidateQueries({ queryKey: ["copilot-briefing"] });
            })
            .catch(() => setBanner("Couldn't save that expiry — try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Saving…" : "Save expiry date"}
      </button>
      <p className="mt-2 text-xs text-[var(--dim)]">To attach the document file itself, or fix a date, use the Document Vault below — same records, one wallet.</p>
    </Section>
  );
}

// ---------- 2) Who owes me ------------------------------------------------------

export function OwedBoardPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["owed-board"], queryFn: () => api.getOwedBoard({}) });
  const rows = useMemo(
    () =>
      buildOwedBoard(
        (q.data?.rows ?? []).map((r) => ({
          loadId: r.loadId,
          deliveredAtMs: Date.parse(r.deliveredAt),
          freight: r.freight,
          claimsTotal: r.claimsTotal,
          paidTotal: r.paidTotal,
        })),
        Date.now(),
      ),
    [q.data],
  );
  const totals = owedTotals(rows);
  const byId = new Map((q.data?.rows ?? []).map((r) => [r.loadId, r]));
  const [payFor, setPayFor] = useState<number | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payNote, setPayNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Section title={tt(lang, "money.owed")} ariaLabel="Who owes me board">
      <p className="text-sm text-[var(--dim)]">
        Every delivered (POD-sealed) load whose pay hasn't been recorded yet — freight plus any sealed claim events (TONU / layover / assist), minus the payments you've recorded. <strong className="text-[var(--text)]">Oldest first.</strong> Recording a payment is a record only: this board tracks what's owed — it doesn't send invoices or move money. A load leaves the board when its recorded payments cover what's owed.
      </p>
      {q.isLoading && <p className="mt-3 text-sm text-[var(--dim)]">Reading your delivered loads…</p>}
      {!q.isLoading && rows.length === 0 && (
        <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">Nothing outstanding — every delivered load on file has its pay recorded. When a delivery seals and the money hasn't landed, it shows up here.</p>
      )}
      {rows.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5">
            <div className="font-condensed text-xl font-bold">{money(totals.totalRemaining)}</div>
            <div className="text-[11px] text-[var(--dim)]">still owed{totals.loadsNoAmount > 0 ? ` (+${totals.loadsNoAmount} load${totals.loadsNoAmount === 1 ? "" : "s"} with no amount on file)` : ""}</div>
          </div>
          <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5">
            <div className="font-condensed text-xl font-bold">{totals.loadsOwing}</div>
            <div className="text-[11px] text-[var(--dim)]">loads waiting</div>
          </div>
          <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5">
            <div className="font-condensed text-xl font-bold">{totals.oldestDays}d</div>
            <div className="text-[11px] text-[var(--dim)]">oldest outstanding</div>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {rows.map((r) => {
          const src = byId.get(r.loadId);
          if (!src) return null;
          return (
            <div key={r.loadId} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold">Load #{r.loadId} · {laneOf(src)}</span>
                <span className="shrink-0 font-condensed text-lg font-bold">{r.remaining != null ? money(r.remaining) : "amount not on file"}</span>
              </div>
              <div className="text-xs text-[var(--dim)]">
                {src.shipper ?? "Shipper not listed"}{src.brokerCompany || src.brokerName ? ` · ${src.brokerCompany ?? src.brokerName}` : ""} · delivered {new Date(src.deliveredAt).toLocaleDateString()} ·{" "}
                <span className={r.aging === "late" || r.aging === "stale" ? "font-bold text-red-300" : r.aging === "watch" ? "font-bold text-amber-200" : ""}>
                  {r.daysOutstanding} days out ({AGING_LABEL[r.aging]})
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--dim)]">
                {r.freight != null ? `Freight ${money(r.freight)}` : "Freight: no rate on file — add the rate on the load to track the amount"}
                {r.claimsTotal > 0 ? ` · claims ${money(r.claimsTotal)}` : ""}
                {r.paidTotal > 0 ? ` · paid so far ${money(r.paidTotal)}` : " · nothing paid yet"}
              </div>
              {src.payments.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {src.payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-xs">
                      <span>Paid {money(p.amount)} · {new Date(p.paidAt).toLocaleDateString()}{p.note ? ` · ${p.note}` : ""}</span>
                      <button
                        type="button"
                        className="shrink-0 font-bold underline"
                        aria-label={`Remove the ${money(p.amount)} payment recorded on load ${r.loadId}`}
                        onClick={() =>
                          void api.deleteLoadPayment({ id: p.id }).then(() => {
                            void queryClient.invalidateQueries({ queryKey: ["owed-board"] });
                            setBanner("Payment record removed (the removal is sealed too). The load is back on the board for that amount.");
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {payFor === r.loadId ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls} htmlFor={`pay-amt-${r.loadId}`}>Amount received ($)</label>
                    <input id={`pay-amt-${r.loadId}`} type="number" inputMode="decimal" className={inputCls} value={payAmt} aria-label={`Payment amount received for load ${r.loadId}`} onChange={(e) => setPayAmt(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={`pay-note-${r.loadId}`}>How it came (optional)</label>
                    <input id={`pay-note-${r.loadId}`} className={inputCls} value={payNote} aria-label={`How the payment for load ${r.loadId} arrived`} placeholder="Check, ACH, factoring…" onChange={(e) => setPayNote(e.target.value)} />
                  </div>
                  <div className="col-span-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy || !(parseFloat(payAmt) > 0)}
                      className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
                      aria-label={`Save the payment received for load ${r.loadId}`}
                      onClick={() => {
                        setBusy(true);
                        void api
                          .recordLoadPayment({ loadId: r.loadId, amount: parseFloat(payAmt), paidAt: new Date().toISOString(), note: payNote.trim() || null })
                          .then(() => {
                            setBanner(`Payment recorded & sealed on Load #${r.loadId}.`);
                            setPayFor(null);
                            setPayAmt("");
                            setPayNote("");
                            void queryClient.invalidateQueries({ queryKey: ["owed-board"] });
                          })
                          .catch(() => setBanner("Couldn't record that payment — try again."))
                          .finally(() => setBusy(false));
                      }}
                    >
                      {busy ? "Saving…" : "Record payment"}
                    </button>
                    <button type="button" className={smallBtn} aria-label="Cancel recording a payment" onClick={() => setPayFor(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className={`${smallBtn} mt-2`} aria-label={`Record a payment received for load ${r.loadId}`} onClick={() => { setPayFor(r.loadId); setPayAmt(r.remaining != null ? String(r.remaining) : ""); setPayNote(""); }}>
                  💵 Record payment received
                </button>
              )}
            </div>
          );
        })}
      </div>
      <XBar label="Claims + payments export" filename="stonemiles-money-flow.txt" setBanner={setBanner} resolve={async () => (await api.exportMoneyFlow({})).text} />
    </Section>
  );
}

// ---------- 3) True rate per load ------------------------------------------------

export function TrueRatePanel({ setBanner, mpg, lang = "en" }: { setBanner: Banner; mpg: number; lang?: Lang }) {
  const queryClient = useQueryClient();
  const loadsQ = useQuery({ queryKey: ["loads"], queryFn: () => api.listLoads({ limit: 50 }) });
  const fuelQ = useQuery({ queryKey: ["fuel-purchases"], queryFn: () => api.listFuelPurchases({ limit: 200 }) });
  const expQ = useQuery({ queryKey: ["expenses-all"], queryFn: () => api.listExpenses({ limit: 300 }) });
  const [dhFor, setDhFor] = useState<number | null>(null);
  const [dhVal, setDhVal] = useState("");
  const [busy, setBusy] = useState(false);

  const avgPrice = useMemo(() => avgLoggedFuelPrice(fuelQ.data?.purchases ?? []), [fuelQ.data]);
  const linkedFuelByLoad = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of expQ.data?.expenses ?? []) {
      if (e.category === "fuel" && e.loadId != null) map.set(e.loadId, Math.round(((map.get(e.loadId) ?? 0) + e.amount) * 100) / 100);
    }
    return map;
  }, [expQ.data]);

  const loads = (loadsQ.data?.loads ?? []).filter((l) => l.rate != null || l.loadedMiles != null);
  return (
    <Section title={tt(lang, "money.trueRateTitle")} ariaLabel="True rate per load">
      <p className="text-sm text-[var(--dim)]">
        The honest number: <strong className="text-[var(--text)]">total pay ÷ every mile — loaded + deadhead</strong> — not just the loaded miles the rate con quotes. Net-after-fuel uses fuel you've <strong className="text-[var(--text)]">logged against the load</strong> (a fuel expense filed on it) where it exists; otherwise it's figured from your logged fuel purchases' average price and your truck's MPG and labelled an <strong className="text-[var(--text)]">estimate</strong>, plainly. No logged fuel price anywhere → no net figure is shown. Nothing is fabricated.
      </p>
      {loadsQ.isLoading && <p className="mt-3 text-sm text-[var(--dim)]">Reading your loads…</p>}
      {!loadsQ.isLoading && loads.length === 0 && <p className="mt-3 text-sm text-[var(--dim)]">No loads with a rate or miles on file yet — add a load and its true rate figures itself here.</p>}
      <div className="mt-3 space-y-2">
        {loads.map((l) => {
          const totalPay = l.rate != null ? Math.round((l.rate + l.extraCharges + l.claimsTotal) * 100) / 100 : null;
          const basis = fuelBasisFor({
            linkedFuelCost: linkedFuelByLoad.get(l.id) ?? null,
            totalMiles: l.loadedMiles != null ? l.loadedMiles + (l.deadheadMiles ?? 0) : null,
            mpg,
            avgLoggedPricePerGallon: avgPrice,
          });
          const tr = trueRateFor({ totalPay, loadedMiles: l.loadedMiles, deadheadMiles: l.deadheadMiles }, basis);
          return (
            <div key={l.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold">Load #{l.id} · {laneOf(l)}</span>
                <span className="shrink-0 text-xs font-bold text-[var(--dim)]">{l.podSealed ? "Delivered" : l.status === "picked_up" ? "Picked up" : "Booked"}</span>
              </div>
              {tr.grossPerMile != null ? (
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-condensed text-2xl font-bold text-[var(--ok)]">${tr.grossPerMile.toFixed(2)}/mi</span>
                  <span className="text-xs text-[var(--dim)]">true rate · {money(totalPay ?? 0)} ÷ {tr.totalMiles} mi ({l.loadedMiles} loaded + {l.deadheadMiles ?? 0} deadhead{l.deadheadMiles == null ? " — deadhead not recorded" : ""})</span>
                  {tr.netPerMile != null && (
                    <span className="font-condensed text-lg font-bold">
                      ${tr.netPerMile.toFixed(2)}/mi <span className="font-sans text-xs font-semibold text-[var(--dim)]">net after fuel ({money(basis.kind !== "none" ? basis.fuelCost : 0)} {basis.kind === "logged" ? "logged on this load" : "ESTIMATE — from your logged fuel prices + MPG, not logged for this load"})</span>
                    </span>
                  )}
                  {tr.netPerMile == null && <span className="text-xs text-[var(--dim)]">Net after fuel: not shown — no fuel logged for this load and no logged fuel price to estimate from.</span>}
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--dim)]">
                  True rate needs pay + loaded miles on file{l.rate == null ? " — this load has no rate yet" : " — this load has no loaded miles yet"}. Add them on the load and it figures itself.
                </p>
              )}
              {l.claimsTotal > 0 && <p className="mt-0.5 text-xs text-[var(--dim)]">Includes {money(l.claimsTotal)} of sealed claim events in the pay.</p>}
              {dhFor === l.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="min-w-[140px] flex-1">
                    <label className={labelCls} htmlFor={`dh-${l.id}`}>Deadhead miles to pickup</label>
                    <input id={`dh-${l.id}`} type="number" inputMode="decimal" className={inputCls} value={dhVal} aria-label={`Deadhead miles for load ${l.id}`} onChange={(e) => setDhVal(e.target.value)} />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
                    aria-label={`Save deadhead miles for load ${l.id}`}
                    onClick={() => {
                      setBusy(true);
                      void api
                        .saveLoad({
                          id: l.id,
                          shipper: l.shipper,
                          pickupCity: l.pickupCity,
                          pickupState: l.pickupState,
                          deliveryCity: l.deliveryCity,
                          deliveryState: l.deliveryState,
                          pickupText: l.pickupText,
                          deliveryText: l.deliveryText,
                          rate: l.rate,
                          weightLbs: l.weightLbs,
                          commodity: l.commodity,
                          hazmat: l.hazmat,
                          docDataBase64: null,
                          docMime: null,
                          deadheadMiles: dhVal.trim() === "" ? null : parseFloat(dhVal),
                        })
                        .then(() => {
                          setBanner(`Deadhead saved on Load #${l.id} — its true rate now counts every mile.`);
                          setDhFor(null);
                          void queryClient.invalidateQueries({ queryKey: ["loads"] });
                        })
                        .catch(() => setBanner("Couldn't save that deadhead — try again."))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {busy ? "Saving…" : "Save deadhead"}
                  </button>
                  <button type="button" className={smallBtn} aria-label="Cancel editing deadhead" onClick={() => setDhFor(null)}>Cancel</button>
                </div>
              ) : (
                <button type="button" className={`${smallBtn} mt-2`} aria-label={`${l.deadheadMiles != null ? "Edit" : "Add"} deadhead miles for load ${l.id}`} onClick={() => { setDhFor(l.id); setDhVal(l.deadheadMiles != null ? String(l.deadheadMiles) : ""); }}>
                  🚚 {l.deadheadMiles != null ? `Deadhead: ${l.deadheadMiles} mi — edit` : "Add deadhead miles"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-[var(--dim)]">Before you book, the same math runs in the Worth-It Advisor (Loads tab) from the rate, loaded miles, and deadhead you type there. To log fuel against a specific load, file it as a fuel expense on that load in Money Truth — then its net reads "logged", not "estimate".</p>
    </Section>
  );
}

// ---------- 4) TONU + layover logger ----------------------------------------------

export function ClaimsPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const loadsQ = useQuery({ queryKey: ["loads"], queryFn: () => api.listLoads({ limit: 50 }) });
  const claimsQ = useQuery({ queryKey: ["claim-events"], queryFn: () => api.listClaimEvents({ limit: 100 }) });
  const [kind, setKind] = useState<ClaimKind>("tonu");
  const [loadId, setLoadId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const loads = loadsQ.data?.loads ?? [];
  const events = claimsQ.data?.events ?? [];

  const log = (k: ClaimKind) => {
    if (!(parseFloat(amount) >= 0) || amount.trim() === "") {
      setBanner("Enter the claim amount first — you set the amount; the app never suggests one. Then tap the event.");
      return;
    }
    setBusy(true);
    void api
      .logClaimEvent({ loadId: loadId ? parseInt(loadId, 10) : null, kind: k, amount: parseFloat(amount), note: note.trim() || null, occurredAt: new Date().toISOString() })
      .then(() => {
        setBanner(`${claimKindLabel(k)} logged & sealed${loadId ? ` on Load #${loadId}` : ""} — it rides the load record, the Who-owes-me board, and the exports.`);
        setAmount("");
        setNote("");
        void queryClient.invalidateQueries({ queryKey: ["claim-events"] });
        void queryClient.invalidateQueries({ queryKey: ["loads"] });
        void queryClient.invalidateQueries({ queryKey: ["owed-board"] });
      })
      .catch(() => setBanner("Couldn't log that claim event — try again."))
      .finally(() => setBusy(false));
  };

  return (
    <Section title={tt(lang, "money.tonu")} ariaLabel="TONU and layover claim logger">
      <p className="text-sm text-[var(--dim)]">
        The money drivers eat because nobody wrote it down: a <strong className="text-[var(--text)]">TONU</strong> (truck ordered, not used), a <strong className="text-[var(--text)]">layover</strong>, a <strong className="text-[var(--text)]">driver assist</strong>. Enter the amount <em>you're</em> claiming, tap the event, and it's timestamped and sealed into the load's record — beside Detention Pay, not instead of it (detention keeps its own arrival/departure tracker on each load). Claims ride the load's exports and count on the Who-owes-me board until the load is paid.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls} htmlFor="claim-load">Load (optional)</label>
          <select id="claim-load" className={inputCls} value={loadId} aria-label="Load this claim belongs to" onChange={(e) => setLoadId(e.target.value)}>
            <option value="">No load — standalone claim</option>
            {loads.map((l) => (
              <option key={l.id} value={l.id}>#{l.id} · {laneOf(l)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="claim-amt">Amount you're claiming ($)</label>
          <input id="claim-amt" type="number" inputMode="decimal" className={inputCls} value={amount} aria-label="Claim amount in dollars" onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelCls} htmlFor="claim-note">Note (optional)</label>
          <input id="claim-note" className={inputCls} value={note} aria-label="Claim note" placeholder="e.g. Drove 84 mi to the shipper, load cancelled at the gate" onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {CLAIM_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            disabled={busy}
            className={`btn-press rounded-xl border px-2 py-3 text-sm font-bold disabled:opacity-50 ${kind === k.key ? "border-[var(--accent)] bg-[var(--surface2)]" : "border-[var(--border)] bg-[var(--surface2)]"}`}
            aria-label={`Log a ${k.label} claim event now`}
            onClick={() => {
              setKind(k.key);
              log(k.key);
            }}
          >
            {k.key === "tonu" ? "🚫 TONU" : k.key === "layover" ? "🌙 Layover" : "🤝 Driver assist"}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-[var(--dim)]">One tap logs it at this moment, sealed. The amount is yours to set — check your rate con's terms for what the load actually promises.</p>
      <div className="mt-3 space-y-1.5">
        {events.slice(0, 10).map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <span className="min-w-0">
              <strong>{claimKindLabel(e.kind)}</strong> · {money(e.amount)}
              <span className="block truncate text-xs text-[var(--dim)]">{new Date(e.occurredAt).toLocaleString()}{e.loadId != null ? ` · Load #${e.loadId}` : " · standalone"}{e.note ? ` · ${e.note}` : ""} · sealed ✓</span>
            </span>
            <button
              type="button"
              className="shrink-0 text-xs font-bold underline"
              aria-label={`Remove this ${claimKindLabel(e.kind)} claim of ${money(e.amount)}`}
              onClick={() =>
                void api.deleteClaimEvent({ id: e.id }).then(() => {
                  void queryClient.invalidateQueries({ queryKey: ["claim-events"] });
                  void queryClient.invalidateQueries({ queryKey: ["loads"] });
                  void queryClient.invalidateQueries({ queryKey: ["owed-board"] });
                  setBanner("Claim event removed (the removal is sealed too).");
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        {events.length === 0 && !claimsQ.isLoading && <p className="text-xs text-[var(--dim)]">No claim events logged yet.</p>}
      </div>
    </Section>
  );
}

// ---------- 5) Maintenance countdown ---------------------------------------------

export function MaintenancePanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["maintenance"], queryFn: () => api.getMaintenance({}) });
  const fuelQ = useQuery({ queryKey: ["fuel-purchases"], queryFn: () => api.listFuelPurchases({ limit: 200 }) });
  const [editFor, setEditFor] = useState<string | null>(null);
  const [interval, setIntervalVal] = useState("");
  const [lastOdo, setLastOdo] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualOdo, setManualOdo] = useState("");

  const saved = new Map((q.data?.services ?? []).map((s) => [s.item, s]));
  // Odometer cross-check from the client-visible fuel log too: the
  // server's figure (fuel + DVIR + daily logs) is the one shown; the
  // fuel-log max is only a fallback while the query loads.
  const fuelOdo = currentOdometerFrom((fuelQ.data?.purchases ?? []).map((p) => p.odometer));
  const currentOdo = q.data?.currentOdometer ?? fuelOdo;
  const shownOdo = manualOdo.trim() !== "" && parseFloat(manualOdo) > 0 ? parseFloat(manualOdo) : currentOdo;

  const stateCls = (st: string) =>
    st === "overdue" ? "bg-red-900/50 text-red-200" : st === "due" ? "bg-red-900/30 text-red-200" : st === "due_soon" ? "bg-amber-900/40 text-amber-200" : st === "ok" ? "bg-emerald-900/40 text-emerald-200" : "bg-[var(--surface)] text-[var(--dim)]";

  return (
    <Section title={tt(lang, "money.maintenanceTitle")} ariaLabel="Maintenance countdown">
      <p className="text-sm text-[var(--dim)]">
        Service tracked the way trucks actually wear: by miles. Set each interval and the odometer at the last service; the countdown runs off the newest odometer the app already records{q.data?.odometerSource ? ` (right now: ${q.data.odometerSource})` : ""}. The annual DOT inspection also counts down by its 12-month date when you run it date-based. Intervals are <strong className="text-[var(--text)]">yours to set</strong> — the starting numbers below are labelled defaults, not gospel.
      </p>
      <div className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
        <span className="text-[var(--dim)]">Current odometer (from your records): </span>
        <strong className="font-condensed text-lg">{currentOdo != null ? `${currentOdo.toLocaleString()} mi` : "no odometer reading recorded yet"}</strong>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[160px] flex-1">
            <label className={labelCls} htmlFor="maint-manual-odo">Check against a different odometer</label>
            <input id="maint-manual-odo" type="number" inputMode="decimal" className={inputCls} value={manualOdo} aria-label="Odometer reading to check the countdown against" placeholder="e.g. what's on the dash now" onChange={(e) => setManualOdo(e.target.value)} />
          </div>
          <span className="pb-2.5 text-xs text-[var(--dim)]">Display only — it doesn't rewrite any record. Log the dash reading with a fuel purchase or DVIR and it becomes the record.</span>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {MAINTENANCE_ITEMS.map((item) => {
          const s = saved.get(item.key);
          const intervalMi = s?.intervalMiles ?? item.defaultIntervalMi;
          const status = maintenanceStatusFor({
            key: item.key,
            intervalMi,
            lastDoneOdometer: s?.lastDoneOdometer ?? null,
            lastDoneAtMs: s?.lastDoneAt ? Date.parse(s.lastDoneAt) : null,
            currentOdometer: shownOdo,
            nowMs: Date.now(),
          });
          const statusText =
            status.state === "unknown"
              ? s
                ? "Countdown needs an odometer baseline — edit and add the odometer (or date) at the last service."
                : "Not set up yet — the default interval is shown; save your own baseline to start the countdown."
              : status.milesRemaining != null
                ? status.state === "overdue"
                  ? `OVERDUE by ${Math.abs(status.milesRemaining).toLocaleString()} mi`
                  : status.state === "due"
                    ? "DUE NOW"
                    : `${status.milesRemaining.toLocaleString()} mi left`
                : status.daysRemaining != null
                  ? status.state === "overdue"
                    ? `OVERDUE by ${Math.abs(status.daysRemaining)} days`
                    : status.state === "due"
                      ? "DUE TODAY"
                      : `${status.daysRemaining} days left (12-month rule)`
                  : "";
          return (
            <div key={item.key} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{item.label}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${stateCls(status.state)}`}>{statusText}</span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--dim)]">
                {s
                  ? `Every ${intervalMi > 0 ? `${intervalMi.toLocaleString()} mi` : "12 months (date-based)"}${s.lastDoneOdometer != null ? ` · last done at ${s.lastDoneOdometer.toLocaleString()} mi` : ""}${s.lastDoneAt ? ` · ${new Date(s.lastDoneAt).toLocaleDateString()}` : ""}${s.note ? ` · ${s.note}` : ""}`
                  : `Default interval: ${item.defaultIntervalMi > 0 ? `${item.defaultIntervalMi.toLocaleString()} mi (a common starting point — change it to your truck's spec)` : "12 months (the federal annual-inspection rule)"} · not saved yet`}
              </div>
              {editFor === item.key ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls} htmlFor={`mi-int-${item.key}`}>Interval (miles — 0 = date-based, DOT annual)</label>
                    <input id={`mi-int-${item.key}`} type="number" inputMode="decimal" className={inputCls} value={interval} aria-label={`Service interval in miles for ${item.label}`} onChange={(e) => setIntervalVal(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={`mi-odo-${item.key}`}>Odometer at last service</label>
                    <input id={`mi-odo-${item.key}`} type="number" inputMode="decimal" className={inputCls} value={lastOdo} aria-label={`Odometer at last service for ${item.label}`} onChange={(e) => setLastOdo(e.target.value)} />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className={labelCls} htmlFor={`mi-date-${item.key}`}>Date of last service</label>
                    <input id={`mi-date-${item.key}`} type="date" className={inputCls} value={lastDate} aria-label={`Date of last service for ${item.label}`} onChange={(e) => setLastDate(e.target.value)} />
                  </div>
                  <div className="col-span-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
                      aria-label={`Save the ${item.label} service setup`}
                      onClick={() => {
                        setBusy(true);
                        void api
                          .saveMaintenanceService({
                            item: item.key as MaintenanceItemKey,
                            intervalMiles: interval.trim() === "" ? item.defaultIntervalMi : parseFloat(interval),
                            lastDoneOdometer: lastOdo.trim() === "" ? null : parseFloat(lastOdo),
                            lastDoneAt: lastDate ? new Date(lastDate + "T12:00:00").toISOString() : null,
                            note: null,
                          })
                          .then(() => {
                            setBanner(`${item.label} saved — the countdown runs from your numbers now.`);
                            setEditFor(null);
                            void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
                          })
                          .catch(() => setBanner("Couldn't save that service — try again."))
                          .finally(() => setBusy(false));
                      }}
                    >
                      {busy ? "Saving…" : "Save service"}
                    </button>
                    <button type="button" className={smallBtn} aria-label="Cancel editing this service" onClick={() => setEditFor(null)}>Cancel</button>
                  </div>
                  <p className="col-span-2 text-xs text-[var(--dim)]">Just had it done? Set "odometer at last service" to today's dash reading and the date to today — the countdown restarts from there.</p>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${smallBtn} mt-2`}
                  aria-label={`${s ? "Edit" : "Set up"} the ${item.label} countdown`}
                  onClick={() => {
                    setEditFor(item.key);
                    setIntervalVal(String(intervalMi));
                    setLastOdo(s?.lastDoneOdometer != null ? String(s.lastDoneOdometer) : "");
                    setLastDate(s?.lastDoneAt ? s.lastDoneAt.slice(0, 10) : "");
                  }}
                >
                  {s ? "✏️ Edit interval / mark serviced" : "➕ Set up countdown"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------- 6) Breakdown downtime + cost log ----------------------------------------

export function BreakdownLogPanel({ setBanner, onOpenBreakdownHelp, onOpenParking, lang = "en" }: { setBanner: Banner; onOpenBreakdownHelp?: () => void; onOpenParking?: () => void; lang?: Lang }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["breakdown-logs"], queryFn: () => api.listBreakdownLogs({ limit: 50 }) });
  const logs = q.data?.logs ?? [];
  const open = logs.find((l) => l.endedAt == null) ?? null;
  const [loc, setLoc] = useState("");
  const [what, setWhat] = useState("");
  const [costLabel, setCostLabel] = useState("");
  const [costAmt, setCostAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const openTotals = open ? breakdownTotals({ startedAtMs: Date.parse(open.startedAt), endedAtMs: null, costs: open.costs, nowMs: Date.now() }) : null;

  return (
    <Section title={tt(lang, "money.breakdownTitle")} ariaLabel="Breakdown downtime and cost log">
      <p className="text-sm text-[var(--dim)]">
        When the truck goes down, two things matter later: <strong className="text-[var(--text)]">how long</strong> and <strong className="text-[var(--text)]">what it cost</strong> — warranty and claim paperwork runs on exactly that. For help right now, the Drive screen's Breakdown button finds the nearest repair shops, tow services, and safe parking from the same map data the app already uses, with your coordinates big enough to read to a dispatcher. This log <strong className="text-[var(--text)]">logs and locates — it does not dispatch or pay anyone</strong>.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onOpenBreakdownHelp && (
          <button type="button" className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold" aria-label="Open breakdown help — nearest repair, towing, and my coordinates" onClick={onOpenBreakdownHelp}>
            🔧 Breakdown help — repair, tow, my coordinates
          </button>
        )}
        {onOpenParking && (
          <button type="button" className={smallBtn} aria-label="Open the parking planner for safe parking" onClick={onOpenParking}>
            🅿️ Safe parking
          </button>
        )}
      </div>
      {!open && (
        <div className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 sm:col-span-1">
              <label className={labelCls} htmlFor="bd-loc">Where are you?</label>
              <input id="bd-loc" className={inputCls} value={loc} aria-label="Breakdown location" placeholder="I-10 mile 85, rest area, city…" onChange={(e) => setLoc(e.target.value)} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className={labelCls} htmlFor="bd-what">What happened?</label>
              <input id="bd-what" className={inputCls} value={what} aria-label="What happened in this breakdown" placeholder="Blown steer tire, air leak, won't start…" onChange={(e) => setWhat(e.target.value)} />
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            className="btn-press mt-2 rounded-xl bg-red-900/60 px-4 py-2.5 font-bold text-red-100 disabled:opacity-50"
            aria-label="Start a breakdown log — the truck is down now"
            onClick={() => {
              setBusy(true);
              void api
                .startBreakdownLog({ locationNote: loc.trim() || null, note: what.trim() || null, startedAt: new Date().toISOString() })
                .then((r) => {
                  setBanner(r.alreadyOpenId != null ? "A breakdown log is already open — the clock is running on that one." : "Breakdown log opened & sealed — the downtime clock is running. Add costs as they land.");
                  setLoc("");
                  setWhat("");
                  void queryClient.invalidateQueries({ queryKey: ["breakdown-logs"] });
                })
                .catch(() => setBanner("Couldn't open the breakdown log — try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Opening…" : "🚨 Truck is down — start the log"}
          </button>
        </div>
      )}
      {open && openTotals && (
        <div className="mt-3 rounded-xl border border-red-300/30 bg-red-900/20 px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <strong>⏱️ Truck down since {new Date(open.startedAt).toLocaleString()}</strong>
            <span className="font-condensed text-xl font-bold">{openTotals.downtimeHours.toFixed(1)}h · {money(openTotals.totalCost)}</span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--dim)]">{open.locationNote ?? ""}{open.locationNote && open.note ? " · " : ""}{open.note ?? ""}</p>
          {open.costs.length > 0 && (
            <div className="mt-1.5 space-y-0.5 text-sm">
              {open.costs.map((c, i) => (
                <div key={i} className="flex justify-between gap-2"><span>{c.label}</span><span>{money(c.amount)}</span></div>
              ))}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls} htmlFor="bd-cost-label">Cost — what for</label>
              <input id="bd-cost-label" className={inputCls} value={costLabel} aria-label="Breakdown cost description" placeholder="Tow, tire, repair, hotel…" onChange={(e) => setCostLabel(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="bd-cost-amt">Cost — amount ($)</label>
              <input id="bd-cost-amt" type="number" inputMode="decimal" className={inputCls} value={costAmt} aria-label="Breakdown cost amount in dollars" onChange={(e) => setCostAmt(e.target.value)} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !costLabel.trim() || !(parseFloat(costAmt) > 0)}
              className={`${smallBtn} disabled:opacity-50`}
              aria-label="Add this cost to the open breakdown log"
              onClick={() => {
                setBusy(true);
                void api
                  .addBreakdownCost({ id: open.id, label: costLabel.trim(), amount: parseFloat(costAmt) })
                  .then(() => {
                    setCostLabel("");
                    setCostAmt("");
                    void queryClient.invalidateQueries({ queryKey: ["breakdown-logs"] });
                  })
                  .catch(() => setBanner("Couldn't add that cost — try again."))
                  .finally(() => setBusy(false));
              }}
            >
              ➕ Add cost
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
              aria-label="Close the breakdown log — I'm rolling again"
              onClick={() => {
                setBusy(true);
                void api
                  .finishBreakdownLog({ id: open.id, endedAt: new Date().toISOString() })
                  .then((r) => {
                    setBanner(`Breakdown log closed & sealed — ${r.downtimeHours.toFixed(1)} hours down. The record exports below for warranty / claim paperwork.`);
                    void queryClient.invalidateQueries({ queryKey: ["breakdown-logs"] });
                  })
                  .catch(() => setBanner("Couldn't close the log — try again."))
                  .finally(() => setBusy(false));
              }}
            >
              ✓ I'm rolling again — close the log
            </button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {logs.filter((l) => l.endedAt != null).slice(0, 6).map((l) => {
          const t = breakdownTotals({ startedAtMs: Date.parse(l.startedAt), endedAtMs: l.endedAt ? Date.parse(l.endedAt) : null, costs: l.costs, nowMs: Date.now() });
          return (
            <div key={l.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <strong>{new Date(l.startedAt).toLocaleDateString()} · {l.note ?? "Breakdown"}</strong>
                <span className="shrink-0 font-condensed text-lg font-bold">{t.downtimeHours.toFixed(1)}h · {money(t.totalCost)}</span>
              </div>
              <p className="text-xs text-[var(--dim)]">{l.locationNote ?? ""} · {l.costs.length} cost {l.costs.length === 1 ? "entry" : "entries"} · sealed ✓</p>
              <XBar label={`Breakdown #${l.id} record`} filename={`stonemiles-breakdown-${l.id}.txt`} setBanner={setBanner} resolve={async () => (await api.exportBreakdownLog({ id: l.id })).text} />
            </div>
          );
        })}
        {logs.length === 0 && !q.isLoading && <p className="text-xs text-[var(--dim)]">No breakdowns logged — good. When one happens, the log you keep here is the paperwork.</p>}
      </div>
    </Section>
  );
}

// ---------- Hub -------------------------------------------------------------------

export function MoneyFlowHub({ setBanner, mpg, onOpenBreakdownHelp, onOpenParking, lang = "en" }: { setBanner: Banner; mpg: number; onOpenBreakdownHelp?: () => void; onOpenParking?: () => void; lang?: Lang }) {
  return (
    <>
      <div id="doc-expiry" className="scroll-mt-4">
        <ExpiryWalletPanel setBanner={setBanner} lang={lang} />
      </div>
      <div id="owed-board" className="scroll-mt-4">
        <OwedBoardPanel setBanner={setBanner} lang={lang} />
      </div>
      <div id="true-rate" className="scroll-mt-4">
        <TrueRatePanel setBanner={setBanner} mpg={mpg} lang={lang} />
      </div>
      <div id="claims-log" className="scroll-mt-4">
        <ClaimsPanel setBanner={setBanner} lang={lang} />
      </div>
      <div id="maintenance" className="scroll-mt-4">
        <MaintenancePanel setBanner={setBanner} lang={lang} />
      </div>
      <div id="breakdown-log" className="scroll-mt-4">
        <BreakdownLogPanel setBanner={setBanner} onOpenBreakdownHelp={onOpenBreakdownHelp} onOpenParking={onOpenParking} lang={lang} />
      </div>
    </>
  );
}
