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

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { api } from "./api";
import { t as tt, type Lang } from "./i18n";
import { Section, XBar, downloadTextFile, money } from "./NextLevel";
import {
  AGING_LABEL,
  CLAIM_KINDS,
  DOC_TIER_LABEL,
  MAINTENANCE_ITEMS,
  MAINTENANCE_LOG_CATEGORIES,
  WALLET_DOC_KINDS,
  avgLoggedFuelPrice,
  breakdownTotals,
  buildOwedBoard,
  claimKindLabel,
  currentOdometerFrom,
  docAlertTier,
  fuelBasisFor,
  maintenanceLogCategoryLabel,
  maintenanceLogTotal,
  maintenanceStatusFor,
  owedTotals,
  trueRateFor,
  truckSummaryLine,
  type ClaimKind,
  type MaintenanceItemKey,
  type MaintenanceLogCategory,
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
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: () => api.getProfile({}) });
  // The driver's OWN saved fee percentages (Settings → My pay) — their
  // factoring company / their dispatcher, never platform fees. Only
  // ever what the driver saved; 0 = no deduction shown.
  const factoringPct = profileQ.data?.profile?.factoringPct ?? 0;
  const dispatcherPct = profileQ.data?.profile?.dispatcherPct ?? 0;
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
          const tr = trueRateFor({ totalPay, loadedMiles: l.loadedMiles, deadheadMiles: l.deadheadMiles, factoringPct, dispatcherPct }, basis);
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
                  {tr.netAfterFeesPerMile != null && (
                    <span className="font-condensed text-lg font-bold">
                      ${tr.netAfterFeesPerMile.toFixed(2)}/mi <span className="font-sans text-xs font-semibold text-[var(--dim)]">{tt(lang, "money.netAfterFees")} ({[tr.fees.factoringAmt > 0 ? `factoring ${tr.fees.factoringPct}% −${money(tr.fees.factoringAmt)}` : null, tr.fees.dispatcherAmt > 0 ? `dispatcher ${tr.fees.dispatcherPct}% −${money(tr.fees.dispatcherAmt)}` : null].filter(Boolean).join(" · ")})</span>
                    </span>
                  )}
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
      {factoringPct <= 0 && dispatcherPct <= 0 && (
        <p className="mt-2 text-xs text-[var(--dim)]">Pay a factoring company or a dispatcher out of each load? Set YOUR factoring / dispatcher % in Settings → My pay and this panel takes them out of every load's rate too — your own costs only, never platform fees.</p>
      )}
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
      <p className="mt-2 text-sm">
        <a href="#maintenance-log" className="font-bold underline">📓 Maintenance log — every repair, with receipts ↓</a>
        <span className="text-[var(--dim)]"> The countdown says when; the log below keeps what was actually done, what it cost, and the paperwork — all of it downloads as one truck record.</span>
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

// ---------- 5b) Maintenance log — the truck's full record -----------------------
// Beside the countdown above: the countdown says WHEN service comes
// due; this log is WHAT WAS DONE — every service and repair on the
// driver's own truck, with the receipt or paperwork attached (same
// blob store as the Document Vault) and the whole record — truck
// identity + specs + log — downloadable as one file.

type LogForm = {
  performedAt: string;
  odometer: string;
  category: MaintenanceLogCategory;
  description: string;
  shop: string;
  cost: string;
  nextDueMiles: string;
  nextDueAt: string;
  notes: string;
};

const EMPTY_LOG_FORM: LogForm = { performedAt: "", odometer: "", category: "oil", description: "", shop: "", cost: "", nextDueMiles: "", nextDueAt: "", notes: "" };

export function MaintenanceLogPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["maintenance-log"], queryFn: () => api.listMaintenanceLog({}) });
  const entries = q.data?.entries ?? [];
  const total = q.data ? maintenanceLogTotal(entries) : 0;
  const truckLine = q.data ? truckSummaryLine(q.data.truck) : "";
  const [form, setForm] = useState<LogForm>(EMPTY_LOG_FORM);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachFor, setAttachFor] = useState<number | null>(null);
  const [attachLabel, setAttachLabel] = useState("Receipt");
  const [attachFile, setAttachFile] = useState<{ base64: string; mime: string } | null>(null);
  const set = (patch: Partial<LogForm>) => setForm((f) => ({ ...f, ...patch }));
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["maintenance-log"] });

  const viewAttachment = (id: number) => {
    void api.getMaintenanceLogAttachmentFile({ id }).then((r) => {
      if (r.url) window.open(r.url, "_blank");
      else setBanner("That attachment has no file — it's a label-only note on the entry.");
    });
  };

  return (
    <Section title={tt(lang, "money.maintenanceLogTitle")} ariaLabel="Maintenance log">
      <p className="text-sm text-[var(--dim)]">
        Every service and repair on your truck, in one record — what was done, where, what it cost, and the receipt or paperwork filed on the entry. The countdown above says when the next service comes due; this log is the proof of the ones already done. Name your truck in <strong className="text-[var(--text)]">Settings → Truck → My Truck</strong> and this record — and its download — carries that truck's name.
      </p>
      {truckLine && <p className="mt-2 text-sm font-bold">🚛 {truckLine}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
          Total logged cost: <strong className="font-condensed text-lg">{money(total)}</strong> · {entries.length} entr{entries.length === 1 ? "y" : "ies"}
        </span>
        <button
          type="button"
          className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold"
          aria-label="Download truck record — truck identity, specs, and the full maintenance log as a spreadsheet"
          onClick={() => {
            void api.exportTruckRecord({})
              .then((r) => {
                downloadTextFile("stonemiles-truck-record.csv", r.csv, "text/csv");
                setBanner(`Truck record downloaded: stonemiles-truck-record.csv — your truck's identity and specs over the full maintenance log (${r.entryCount} entries, ${money(r.totalCost)} total).`);
              })
              .catch(() => setBanner("Couldn't build the truck record — try again."));
          }}
        >
          ⬇ Download truck record
        </button>
        <button
          type="button"
          className={smallBtn}
          aria-label="Download the printable text version of the truck record"
          onClick={() => {
            void api.exportTruckRecord({})
              .then((r) => {
                downloadTextFile("stonemiles-truck-record.txt", r.text);
                setBanner("Printable truck record downloaded: stonemiles-truck-record.txt.");
              })
              .catch(() => setBanner("Couldn't build the truck record — try again."));
          }}
        >
          Printable version
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{maintenanceLogCategoryLabel(e.category)} — {e.description}</span>
              <span className="shrink-0 font-condensed text-lg font-bold">{money(e.cost)}</span>
            </div>
            {e.status === "draft" && (
              <p className="mt-1 rounded-lg bg-amber-900/40 px-2 py-1 text-xs font-semibold text-amber-200" role="status">
                📝 Draft from DVIR{e.dvirId != null ? ` #${e.dvirId}` : ""} — check it, fill in the shop and cost, then Edit → Save to confirm it. It stays an open defect until you mark it Closed below.
              </p>
            )}
            {e.status === "closed" && (
              <p className="mt-1 text-xs font-semibold text-emerald-300">✅ Closed — work done{e.dvirId != null ? "; the DVIR defect is cleared" : ""}.</p>
            )}
            <div className="mt-0.5 text-xs text-[var(--dim)]">
              {new Date(e.performedAt).toLocaleDateString()}
              {e.odometer != null ? ` · ${e.odometer.toLocaleString()} mi` : ""}
              {e.shop ? ` · ${e.shop}` : ""}
              {e.nextDueMiles != null ? ` · next due ${e.nextDueMiles.toLocaleString()} mi` : ""}
              {e.nextDueAt ? ` · next due ${new Date(e.nextDueAt).toLocaleDateString()}` : ""}
            </div>
            {e.notes && <p className="mt-1 text-xs">{e.notes}</p>}
            {e.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {e.attachments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface)] px-2 py-1 text-xs font-semibold">
                    📎 {a.label}
                    {a.hasFile && (
                      <button type="button" className="underline" aria-label={`Download ${a.label}`} onClick={() => viewAttachment(a.id)}>Download</button>
                    )}
                    <button
                      type="button"
                      className="underline"
                      aria-label={`Remove attachment ${a.label}`}
                      onClick={() => void api.deleteMaintenanceLogAttachment({ id: a.id }).then(() => { setBanner("Attachment removed."); invalidate(); }).catch(() => setBanner("Couldn't remove that attachment — try again."))}
                    >
                      Remove
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={smallBtn}
                aria-label={`Edit log entry ${e.description}`}
                onClick={() => {
                  setEditId(e.id);
                  setForm({
                    performedAt: e.performedAt.slice(0, 10),
                    odometer: e.odometer != null ? String(e.odometer) : "",
                    category: (MAINTENANCE_LOG_CATEGORIES.some((c) => c.key === e.category) ? e.category : "other") as MaintenanceLogCategory,
                    description: e.description,
                    shop: e.shop ?? "",
                    cost: String(e.cost),
                    nextDueMiles: e.nextDueMiles != null ? String(e.nextDueMiles) : "",
                    nextDueAt: e.nextDueAt ? e.nextDueAt.slice(0, 10) : "",
                    notes: e.notes ?? "",
                  });
                }}
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                className={smallBtn}
                aria-label={`Attach a receipt or paperwork to ${e.description}`}
                onClick={() => { setAttachFor(attachFor === e.id ? null : e.id); setAttachLabel("Receipt"); setAttachFile(null); }}
              >
                📎 Attach receipt / paperwork
              </button>
              {e.status !== "closed" ? (
                <button
                  type="button"
                  className={smallBtn}
                  aria-label={`Mark log entry ${e.description} closed — work done`}
                  onClick={() => void api.setMaintenanceLogEntryStatus({ id: e.id, status: "closed" }).then(() => { setBanner(e.dvirId != null ? "Closed — the DVIR defect is cleared." : "Entry closed."); invalidate(); void queryClient.invalidateQueries({ queryKey: ["dvir-open-defects"] }); }).catch(() => setBanner("Couldn't close that entry — try again."))}
                >
                  ✅ Mark closed
                </button>
              ) : (
                <button
                  type="button"
                  className={smallBtn}
                  aria-label={`Reopen log entry ${e.description}`}
                  onClick={() => void api.setMaintenanceLogEntryStatus({ id: e.id, status: "logged" }).then(() => { setBanner("Entry reopened."); invalidate(); void queryClient.invalidateQueries({ queryKey: ["dvir-open-defects"] }); }).catch(() => setBanner("Couldn't reopen that entry — try again."))}
                >
                  ↩️ Reopen
                </button>
              )}
              <button
                type="button"
                className={smallBtn}
                aria-label={`Delete log entry ${e.description}`}
                onClick={() => void api.deleteMaintenanceLogEntry({ id: e.id }).then(() => { setBanner("Log entry deleted."); if (editId === e.id) { setEditId(null); setForm(EMPTY_LOG_FORM); } invalidate(); }).catch(() => setBanner("Couldn't delete that entry — try again."))}
              >
                Delete
              </button>
            </div>
            {attachFor === e.id && (
              <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-2">
                <div className="min-w-[140px] flex-1">
                  <label className={labelCls} htmlFor={`ml-att-label-${e.id}`}>Paperwork label</label>
                  <input id={`ml-att-label-${e.id}`} className={inputCls} value={attachLabel} aria-label="Attachment label" placeholder="Receipt, invoice, DOT form…" onChange={(ev) => setAttachLabel(ev.target.value)} />
                </div>
                <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
                  📎 Choose file
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    className="hidden"
                    aria-label="Attach the receipt or paperwork file"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      ev.target.value = "";
                      if (!f) return;
                      if (f.type === "image/jpeg" || f.type === "image/png" || f.type === "application/pdf") {
                        void fileToBase64(f).then((enc) => setAttachFile({ base64: enc.dataBase64, mime: f.type }));
                      } else setBanner("Attach a JPEG, PNG, or PDF.");
                    }}
                  />
                </label>
                {attachFile && <span className="pb-2.5 text-xs font-semibold text-emerald-300">File attached ✓</span>}
                <button
                  type="button"
                  disabled={busy || !attachLabel.trim()}
                  className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
                  aria-label="Save this attachment to the log entry"
                  onClick={() => {
                    setBusy(true);
                    void api.addMaintenanceLogAttachment({ entryId: e.id, label: attachLabel.trim(), dataBase64: attachFile?.base64 ?? null, mime: attachFile?.mime ?? null })
                      .then((r) => {
                        if (r.error) { setBanner(r.error); return; }
                        setBanner("Paperwork filed on the entry — it downloads from here any time.");
                        setAttachFor(null);
                        setAttachFile(null);
                        invalidate();
                      })
                      .catch(() => setBanner("Couldn't attach that file — try again."))
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? "Saving…" : "Save attachment"}
                </button>
              </div>
            )}
          </div>
        ))}
        {entries.length === 0 && !q.isLoading && <p className="text-xs text-[var(--dim)]">Nothing logged yet — add the first service or repair below and this becomes the truck's record.</p>}
      </div>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <p className="text-sm font-bold">{editId != null ? "Edit log entry" : "Add a log entry"}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="ml-date">Date</label>
            <input id="ml-date" type="date" className={inputCls} value={form.performedAt} aria-label="Date of service or repair" onChange={(e) => set({ performedAt: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ml-odo">Odometer (mi)</label>
            <input id="ml-odo" type="number" inputMode="decimal" className={inputCls} value={form.odometer} aria-label="Odometer at this service" placeholder="e.g. 512400" onChange={(e) => set({ odometer: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ml-cat">Category</label>
            <select id="ml-cat" className={inputCls} value={form.category} aria-label="Maintenance category" onChange={(e) => set({ category: e.target.value as MaintenanceLogCategory })}>
              {MAINTENANCE_LOG_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ml-cost">Cost ($)</label>
            <input id="ml-cost" type="number" inputMode="decimal" step="0.01" className={inputCls} value={form.cost} aria-label="Cost in dollars" placeholder="0.00" onChange={(e) => set({ cost: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className={labelCls} htmlFor="ml-desc">What was done</label>
            <input id="ml-desc" className={inputCls} value={form.description} aria-label="Description of the work" placeholder="e.g. Oil + both filters, Rotella 15W-40" onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ml-shop">Shop / vendor</label>
            <input id="ml-shop" className={inputCls} value={form.shop} aria-label="Shop or vendor" placeholder="e.g. Speedco, Mobile AL" onChange={(e) => set({ shop: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ml-notes">Notes</label>
            <input id="ml-notes" className={inputCls} value={form.notes} aria-label="Notes on this entry" placeholder="Optional" onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ml-due-mi">Next due (mi)</label>
            <input id="ml-due-mi" type="number" inputMode="decimal" className={inputCls} value={form.nextDueMiles} aria-label="Odometer when this is next due" placeholder="Optional" onChange={(e) => set({ nextDueMiles: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ml-due-date">Next due (date)</label>
            <input id="ml-due-date" type="date" className={inputCls} value={form.nextDueAt} aria-label="Date when this is next due" onChange={(e) => set({ nextDueAt: e.target.value })} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !form.description.trim()}
            className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
            aria-label={editId != null ? "Save the edited log entry" : "Add this entry to the maintenance log"}
            onClick={() => {
              setBusy(true);
              void api.saveMaintenanceLogEntry({
                id: editId,
                performedAt: form.performedAt ? new Date(form.performedAt + "T12:00:00").toISOString() : new Date().toISOString(),
                odometer: form.odometer.trim() === "" ? null : parseFloat(form.odometer),
                category: form.category,
                description: form.description.trim(),
                shop: form.shop.trim() || null,
                cost: form.cost.trim() === "" ? 0 : parseFloat(form.cost) || 0,
                nextDueMiles: form.nextDueMiles.trim() === "" ? null : parseFloat(form.nextDueMiles),
                nextDueAt: form.nextDueAt ? new Date(form.nextDueAt + "T12:00:00").toISOString() : null,
                notes: form.notes.trim() || null,
              })
                .then(() => {
                  setBanner(editId != null ? "Log entry updated & sealed." : "Logged & sealed — the truck's record grows.");
                  setEditId(null);
                  setForm(EMPTY_LOG_FORM);
                  invalidate();
                  void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
                })
                .catch(() => setBanner("Couldn't save that entry — try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Saving…" : editId != null ? "Save entry" : "Add to log"}
          </button>
          {editId != null && (
            <button type="button" className={smallBtn} aria-label="Cancel editing this log entry" onClick={() => { setEditId(null); setForm(EMPTY_LOG_FORM); }}>Cancel edit</button>
          )}
        </div>
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

/** Detention timer (migration 0122): the sealed dock clock. ARRIVE
 *  opens a record against a load (or standalone at a stop), DONE
 *  seals it. Everything renders as TIME — the proof a driver sends a
 *  broker shows appointment/arrival/departure and the wait, never a
 *  rate: the driver's own agreement prices the time. */
export function DetentionPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["detention"], queryFn: () => api.listDetention({ limit: 30 }) });
  const loadsQ = useQuery({ queryKey: ["loads"], queryFn: () => api.listLoads({ limit: 50 }) });
  const records = q.data?.records ?? [];
  const open = records.filter((r) => r.departedAt == null);
  const [site, setSite] = useState<"pickup" | "delivery" | "stop">("delivery");
  const [loadSel, setLoadSel] = useState("");
  const [place, setPlace] = useState("");
  const [grace, setGrace] = useState("120");
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (open.length === 0) return;
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [open.length]);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["detention"] });
  const fmtDur = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  };
  const gps = (): Promise<{ lat: number | null; lon: number | null }> =>
    new Promise((resolve) => {
      if (!("geolocation" in navigator)) { resolve({ lat: null, lon: null }); return; }
      const timer = setTimeout(() => resolve({ lat: null, lon: null }), 2000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
        () => { clearTimeout(timer); resolve({ lat: null, lon: null }); },
        { timeout: 2000, maximumAge: 60000 },
      );
    });
  const start = () => {
    setBusy(true);
    void gps().then(({ lat, lon }) =>
      api.startDetention({
        loadId: loadSel ? parseInt(loadSel, 10) : null,
        site,
        placeLabel: place.trim() || null,
        graceMinutes: Math.min(720, Math.max(0, parseInt(grace, 10) || 120)),
        apptAt: null,
        lat,
        lon,
      }),
    ).then((r) => {
      setBanner(r.alreadyOpen
        ? "That clock is already running — the first ARRIVE tap stands."
        : `Detention clock running — arrived ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Free time: ${fmtDur(r.graceMinutes)}${r.apptAt ? ` · appointment ${new Date(r.apptAt).toLocaleString()}` : ""}. Tap DONE when the dock releases you.`);
      setPlace("");
      invalidate();
    }).catch(() => setBanner("Couldn't start the detention clock — try again."))
      .finally(() => setBusy(false));
  };
  const end = (id: number) => {
    setBusy(true);
    void gps().then(({ lat, lon }) => api.endDetention({ id, lat, lon }))
      .then((r) => {
        setBanner(`Clock sealed — total wait ${fmtDur(r.waitMinutes)}, ${fmtDur(r.billableMinutes)} past the free time. The proof is in the record below; it shows time and place only.`);
        invalidate();
      })
      .catch(() => setBanner("Couldn't stop the clock — try again."))
      .finally(() => setBusy(false));
  };
  const proof = (id: number) => {
    void api.getDetentionProof({ id })
      .then((r) => downloadTextFile(r.filename, r.text))
      .catch(() => setBanner("That proof isn't ready — the clock seals when you tap DONE."));
  };
  return (
    <Section title={tt(lang, "money.detentionTitle")} ariaLabel="Detention timer — sealed dock clock">
      <p className="text-sm text-[var(--dim)]">
        Tap <strong className="text-[var(--text)]">ARRIVE</strong> at the gate and <strong className="text-[var(--text)]">DONE</strong> when the dock releases you — both stamps seal into the record with the appointment and your free time. The shareable proof shows times and place only, never a rate: your agreement prices the time, this proves it.
      </p>
      {open.map((r) => (
        <div key={r.id} className="mt-3 rounded-xl bg-amber-900/40 px-3 py-3" role="status">
          <p className="text-sm font-bold text-amber-200">⏱️ Clock running — {r.site === "pickup" ? "Pickup" : r.site === "delivery" ? "Delivery" : "Stop"}{r.placeLabel ? ` · ${r.placeLabel}` : ""}</p>
          <p className="text-xs text-amber-100/80">
            Arrived {new Date(r.arrivedAt).toLocaleString()} · {fmtDur((Date.now() - new Date(r.arrivedAt).getTime()) / 60000)} so far · free time {fmtDur(r.graceMinutes)}{r.apptAt ? ` · appointment ${new Date(r.apptAt).toLocaleString()}` : ""}{r.loadLabel ? ` · ${r.loadLabel}` : ""}
          </p>
          <button type="button" disabled={busy} className="btn-neon btn-press mt-2 w-full rounded-xl py-3 font-bold disabled:opacity-50" aria-label="Done — stop and seal this detention clock" onClick={() => end(r.id)}>
            {busy ? "Sealing…" : "✅ DONE — dock released me, seal the clock"}
          </button>
        </div>
      ))}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-3">
        <div>
          <label className={labelCls} htmlFor="det-site">Site</label>
          <select id="det-site" className={inputCls} value={site} aria-label="Detention site" onChange={(e) => setSite(e.target.value as typeof site)}>
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
            <option value="stop">Stop (no load)</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="det-grace">Free time (minutes)</label>
          <input id="det-grace" type="number" inputMode="numeric" min={0} max={720} className={inputCls} value={grace} aria-label="Free or grace time in minutes" onChange={(e) => setGrace(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="det-load">Load (optional)</label>
          <select id="det-load" className={inputCls} value={loadSel} aria-label="Load this clock belongs to" onChange={(e) => setLoadSel(e.target.value)}>
            <option value="">No load — standalone stop</option>
            {(loadsQ.data?.loads ?? []).map((l) => (
              <option key={l.id} value={l.id}>Load #{l.id} · {[l.pickupCity, l.pickupState].filter(Boolean).join(", ") || "?"} → {[l.deliveryCity, l.deliveryState].filter(Boolean).join(", ") || "?"}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="det-place">Place (optional)</label>
          <input id="det-place" className={inputCls} value={place} aria-label="Facility or place label" placeholder="e.g. Dallas, TX — gate 4" onChange={(e) => setPlace(e.target.value)} />
        </div>
      </div>
      <button type="button" disabled={busy} className="btn-neon btn-press mt-2 w-full rounded-xl py-3 font-bold disabled:opacity-50" aria-label="Arrive — start the detention clock" onClick={start}>
        {busy ? "Starting…" : "🅿️ ARRIVE — start the detention clock"}
      </button>
      <div className="mt-3 space-y-1.5">
        {records.filter((r) => r.departedAt != null).slice(0, 8).map((r) => (
          <div key={r.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <strong>{r.site === "pickup" ? "Pickup" : r.site === "delivery" ? "Delivery" : "Stop"}</strong>{r.placeLabel ? ` · ${r.placeLabel}` : ""}
                <span className="block text-xs text-[var(--dim)]">
                  {new Date(r.arrivedAt).toLocaleString()} → {r.departedAt ? new Date(r.departedAt).toLocaleString() : ""} · wait {r.waitMinutes != null ? fmtDur(r.waitMinutes) : "—"} · past free time {r.billableMinutes != null ? fmtDur(r.billableMinutes) : "—"}{r.loadLabel ? ` · ${r.loadLabel}` : ""}
                </span>
              </span>
              <button type="button" className={`${smallBtn} shrink-0`} aria-label={`Download the detention proof for record ${r.id}`} onClick={() => proof(r.id)}>⬇ Proof</button>
            </div>
          </div>
        ))}
        {records.length === 0 && !q.isLoading && <p className="text-xs text-[var(--dim)]">No detention clocked yet — your first ARRIVE tap starts the record.</p>}
      </div>
      {q.data && q.data.totalBillableMinutes > 0 && (
        <p className="mt-2 text-xs font-semibold text-[var(--dim)]">Total time past free time on sealed visits: {fmtDur(q.data.totalBillableMinutes)} — time only; what it pays is set by your agreement.</p>
      )}
    </Section>
  );
}

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
      <div id="detention-timer" className="scroll-mt-4">
        <DetentionPanel setBanner={setBanner} lang={lang} />
      </div>
      <div id="maintenance" className="scroll-mt-4">
        <MaintenancePanel setBanner={setBanner} lang={lang} />
      </div>
      <div id="maintenance-log" className="scroll-mt-4">
        <MaintenanceLogPanel setBanner={setBanner} lang={lang} />
      </div>
      <div id="breakdown-log" className="scroll-mt-4">
        <BreakdownLogPanel setBanner={setBanner} onOpenBreakdownHelp={onOpenBreakdownHelp} onOpenParking={onOpenParking} lang={lang} />
      </div>
    </>
  );
}
