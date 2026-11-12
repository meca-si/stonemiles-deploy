// NextLevel.tsx — the 2026-10-22 "next level" pass for STONEMILES:
// IFTA Complete, Money Truth, Load Worth-It Advisor, Settlement Checker,
// Meca Co-pilot briefing, Verify-Anywhere + Reputation Passport + Merkle
// root, scale tickets, personal document vault, formal DVIR, weigh-station
// intel status, and chain-law notes. Every number here comes from the
// driver's own sealed records through server actions — nothing is invented,
// staged items are labelled staged.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { api, type ApiResponse } from "./api";
import { t as tt, type Lang } from "./i18n";
import { qrGrid } from "./qrcode";
import { apptBehaviourLabel, groupVisitsByFacility } from "./extras";
import { ensureStepUp } from "./SecurityPack";

// ---------- shared bits ------------------------------------------------------

type Banner = (s: string | null) => void;

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
  "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

export function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function shareText(title: string, text: string, filename?: string): Promise<string> {
  try {
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (filename && nav.canShare) {
      const file = new File([text], filename, { type: "text/plain" });
      if (nav.canShare({ files: [file] })) {
        await navigator.share({ title, files: [file] });
        return "shared";
      }
    }
    if (navigator.share) {
      await navigator.share({ title, text });
      return "shared";
    }
  } catch {
    return "cancelled";
  }
  try {
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text.slice(0, 1800))}`;
    return "emailed";
  } catch {
    return (await copyText(text)) ? "copied" : "failed";
  }
}

/** Download · Copy · Print view · Send out — the one export pattern. */
export function XBar({ label, filename, resolve, setBanner }: { label: string; filename: string; resolve: () => Promise<string | null> | string | null; setBanner: Banner }) {
  const [printText, setPrintText] = useState<string | null>(null);
  const btn = "btn-press rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold";
  const go = async (fn: (t: string) => void | Promise<void>) => {
    // Security Pack 2 step-up: exports need a PIN entry fresh within
    // 5 minutes before any Download / Copy / Print / Send runs.
    if (!(await ensureStepUp(`Export — ${label}`))) {
      setBanner(`Export of ${label} cancelled — it needs a fresh PIN entry first (Security Pack 2 step-up).`);
      return;
    }
    const t = await resolve();
    if (t == null) {
      setBanner(`Nothing to export for ${label} yet.`);
      return;
    }
    await fn(t);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Export ${label}`}>
      <button type="button" className={btn} aria-label={`Download ${label}`} onClick={() => void go((t) => { downloadTextFile(filename, t); setBanner(`${label} downloaded as ${filename}.`); })}>⬇ Download</button>
      <button type="button" className={btn} aria-label={`Copy ${label}`} onClick={() => void go(async (t) => setBanner((await copyText(t)) ? `${label} copied.` : "Copy didn't work here — use Download."))}>📋 Copy</button>
      <button type="button" className={btn} aria-label={`Open print view for ${label}`} onClick={() => void go((t) => setPrintText(t))}>🖨 Print view</button>
      <button type="button" className={btn} aria-label={`Send out ${label}`} onClick={() => void go(async (t) => { const r = await shareText(label, t, filename); setBanner(r === "shared" ? `${label} sent.` : r === "emailed" ? `${label} opened in an email draft.` : r === "copied" ? `${label} copied — no share sheet here.` : `${label} wasn't sent.`); })}>📤 Send out</button>
      {printText != null && (
        <div className="fixed inset-0 z-[970] overflow-y-auto bg-white text-black" role="dialog" aria-label={`Print view — ${label}`}>
          <div className="mx-auto max-w-2xl px-5 py-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-condensed text-2xl font-bold">{label}</h2>
              <button type="button" className="rounded-lg bg-black px-4 py-2 font-bold text-white" aria-label="Close print view" onClick={() => setPrintText(null)}>✕ Close</button>
            </div>
            <pre className="mt-4 whitespace-pre-wrap font-mono text-[13px] leading-relaxed">{printText}</pre>
            <p className="mt-4 text-xs text-neutral-500">Print from your browser/device print command while this view is open.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Real scannable QR rendered from the local encoder — no external service. */
export function Qr({ text, size = 148, label }: { text: string; size?: number; label: string }) {
  const grid = useMemo(() => qrGrid(text), [text]);
  if (!grid) return <p className="text-xs text-[var(--dim)]">Code too long for a QR — use the written code below.</p>;
  const n = grid.length;
  const cell = size / (n + 2);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n + 2} ${n + 2}`} role="img" aria-label={label} className="rounded-lg bg-white p-0">
      <rect x={0} y={0} width={n + 2} height={n + 2} fill="#ffffff" />
      {grid.map((row, y) =>
        row.map((dark, x) =>
          dark ? <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1.02} height={1.02} fill="#000000" /> : null,
        ),
      )}
      <title>{label}</title>
      {void cell}
    </svg>
  );
}

export function Section({ title, children, ariaLabel, defaultOpen = false, open: openProp, onOpenChange }: { title: string; children: ReactNode; ariaLabel: string; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const toggle = () => {
    const next = !open;
    setOpenState(next);
    onOpenChange?.(next);
  };
  return (
    <section className="glass-panel p-3.5" aria-label={ariaLabel}>
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-label={`${open ? "Collapse" : "Expand"} ${ariaLabel}`} aria-expanded={open} onClick={toggle}>
        <h2 className="font-condensed text-xl font-semibold">{title}</h2>
        <span aria-hidden className="text-[var(--dim)]">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </section>
  );
}

const inputCls = "w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-[var(--text)]";
const labelCls = "block text-xs font-bold uppercase tracking-wide text-[var(--dim)] mb-1";

async function photoToBase64(e: ChangeEvent<HTMLInputElement>): Promise<{ base64: string; mime: string } | null> {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return null;
  if (f.type !== "image/jpeg" && f.type !== "image/png") return null;
  const enc = await fileToBase64(f);
  return { base64: enc.dataBase64, mime: f.type };
}

// ---------- Meca Co-pilot: Morning Briefing ---------------------------------

export function BriefingCard({ setBanner, onSpeak }: { setBanner: Banner; onSpeak: (t: string) => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["copilot-briefing"], queryFn: () => api.getCopilotBriefing({}) });
  const [debrief, setDebrief] = useState<string | null>(null);
  const b = q.data;
  // SM Points daily table: opening the briefing IS the check-in — the
  // server awards +25 on the first unlocked load of the day; refresh the
  // points balance so the driver sees it land.
  const briefingDayRef = useRef<string | null>(null);
  useEffect(() => {
    if (!b || b.locked) return;
    const day = new Date().toDateString();
    if (briefingDayRef.current === day) return;
    briefingDayRef.current = day;
    queryClient.invalidateQueries({ queryKey: ["points"] });
  }, [b, queryClient]);
  const text = b ? [b.headline, ...b.lines, ...(b.dueItems.length ? b.dueItems.map((d) => `Due: ${d}`) : [])].join("\n") : "";
  return (
    <section className="glass-panel p-3.5" aria-label="Meca co-pilot briefing">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-condensed text-xl font-semibold">🧭 Meca Co-pilot — Morning Briefing</h2>
        <button
          type="button"
          className="btn-press shrink-0 rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
          aria-label="Hear the morning briefing spoken"
          onClick={() => {
            if (b) onSpeak([b.headline, ...b.lines].join(". "));
            else setBanner("Briefing is still loading.");
          }}
        >
          🔊 Hear it
        </button>
      </div>
      {q.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">Pulling your board together…</p>}
      {b?.locked && (
        <div className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5" aria-label="Meca co-pilot locked — Diamond feature">
          <p className="text-sm font-semibold">🔒 {b.headline}</p>
          <p className="mt-1 text-xs text-[var(--dim)]">Billing is still staged until the app-store release — upgrading records your plan, nothing is charged before then.</p>
        </div>
      )}
      {b && !b.locked && (
        <>
          <p className="mt-2 text-sm font-semibold">{b.headline}</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[var(--dim)]">
            {b.lines.map((l, i) => <li key={i}>{l}</li>)}
            {b.lines.length === 0 && <li>No trips, loads, or costs logged yet today — the board is clean and the day is wide open.</li>}
          </ul>
          {b.dueItems.length > 0 && (
            <p className="mt-2 rounded-xl bg-amber-900/40 px-3 py-2 text-sm font-semibold text-amber-200">⏰ Due: {b.dueItems.join(" · ")}</p>
          )}
          <p className="mt-2 text-xs text-[var(--dim)]">
            Weather on today's route, the parking plan, and the cheapest-fuel plan ride on the Drive and Fuel tabs from the same live sources — this card is your money, loads, and paperwork board, from your sealed records only.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="btn-press rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
              aria-label="Show my post-trip debrief"
              onClick={() => {
                if (!b.lastTrip) { setDebrief("No sealed trip yet — the debrief writes itself the moment a trip closes: miles, pay, cost per mile, and detention ready to claim."); return; }
                const parts = [b.lastTrip];
                if (b.breakEvenPerMile != null) parts.push(`Your break-even is ${money(b.breakEvenPerMile)}/mi — any rate under that loses money at your own costs.`);
                if (b.detentionOpen > 0) parts.push(`Watch-out: a detention clock is still open — close it or the time won't pay.`);
                else parts.push("Detention: no open clocks — nothing left unclaimed on the board.");
                setDebrief(parts.join(" "));
                // SM Points daily table: reviewing the debrief pays +25
                // (server-side, first review of the day).
                void api
                  .recordDebriefReview({})
                  .then((r) => {
                    if (r.awarded > 0) {
                      queryClient.invalidateQueries({ queryKey: ["points"] });
                      setBanner(`Debrief reviewed — +${r.awarded} points (daily table).`);
                    }
                  })
                  .catch(() => undefined);
              }}
            >
              📋 Post-trip debrief
            </button>
            <button type="button" className="btn-press rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2 text-xs font-bold" aria-label="Refresh the briefing" onClick={() => void q.refetch()}>↻ Refresh</button>
          </div>
          {debrief && <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm" role="status">{debrief}</p>}
          {void text}
        </>
      )}
    </section>
  );
}

// ---------- Fuel Coach (Diamond full · Gold weekly summary) ------------------

export function FuelCoachCard({ setBanner }: { setBanner: Banner }) {
  const q = useQuery({ queryKey: ["fuel-coach"], queryFn: () => api.getFuelCoach({}) });
  const c = q.data;
  return (
    <section className="glass-panel p-3.5" aria-label="Fuel coach">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-condensed text-xl font-semibold">⛽ Fuel Coach</h2>
        <button
          type="button"
          className="btn-press shrink-0 rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
          aria-label="Refresh the fuel coach"
          onClick={() => void q.refetch()}
        >
          ↻ Refresh
        </button>
      </div>
      {q.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">Reading your sealed trips…</p>}
      {c?.tier === "locked" && (
        <div className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5" aria-label="Fuel coach locked">
          <p className="text-sm font-semibold">🔒 {c.headline}</p>
          <p className="mt-1 text-xs text-[var(--dim)]">Gold Driver gets the weekly speed/idle summary; Diamond gets the full coach — per-trip "fuel left on the table" and the one fix that matters. Your coach data is yours: you see all of it first, and no owner board reads it in this version.</p>
        </div>
      )}
      {c && c.tier !== "locked" && (
        <>
          <p className="mt-2 text-sm font-semibold">{c.headline}</p>
          {c.lastTrip && (
            <div className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5" aria-label="Last trip fuel debrief">
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Post-trip debrief — {c.lastTrip.label} · {c.lastTrip.date} · {c.lastTrip.miles} mi</div>
              <div className="mt-1 font-condensed text-2xl font-bold">Fuel left on the table: {money(c.lastTrip.leftDollars)}</div>
              <p className="mt-1 text-sm">{c.lastTrip.fix}</p>
              <p className="mt-1 text-xs text-[var(--dim)]">
                {c.lastTrip.over65Min} min over 65 mph ({money(c.lastTrip.speedDollars)}) · {c.lastTrip.idleMin} min stationary on the live trip — probable idle, GPS-inferred ({money(c.lastTrip.idleDollars)}).
              </p>
            </div>
          )}
          {c.week && (
            <div className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5" aria-label="Weekly fuel coach summary">
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">This week · {c.week.tripsCounted} trip{c.week.tripsCounted === 1 ? "" : "s"} the coach could read</div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                <div><div className="font-condensed text-xl font-bold">{c.week.over65Min} min</div><div className="text-[10px] text-[var(--dim)]">OVER 65 MPH</div></div>
                <div><div className="font-condensed text-xl font-bold">{c.week.over70Min} min</div><div className="text-[10px] text-[var(--dim)]">OVER 70 MPH</div></div>
                <div><div className="font-condensed text-xl font-bold">{c.week.idleMin} min</div><div className="text-[10px] text-[var(--dim)]">PROBABLE IDLE</div></div>
              </div>
              <p className="mt-1.5 text-sm">About <strong>{money(c.week.leftDollars)}</strong> of fuel left on the table this week (estimate). {c.tier === "diamond" ? c.week.fix : ""}</p>
              {c.tier === "gold" && (
                <p className="mt-1 text-xs font-semibold text-[var(--dim)]">🔒 The full coach — per-trip debriefs and the one fix per trip — comes with Diamond Driver.</p>
              )}
            </div>
          )}
          {c.untrackedTrips > 0 && (
            <p className="mt-2 text-xs text-[var(--dim)]">{c.untrackedTrips} older trip{c.untrackedTrips === 1 ? "" : "s"} predate coach tracking and aren't counted — nothing is back-filled or guessed.</p>
          )}
          <p className="mt-2 text-xs text-[var(--dim)]">{c.methodNote}</p>
          {c.pricePerGal != null && <p className="mt-1 text-xs text-[var(--dim)]">Dollars figured at {money(c.pricePerGal)}/gal — {c.priceSource}.</p>}
          {void setBanner}
        </>
      )}
    </section>
  );
}

// ---------- A) IFTA Complete ---------------------------------------------------

export function IftaPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const q = useQuery({ queryKey: ["ifta-report", year, quarter], queryFn: () => api.getIftaReport({ year, quarter }) });
  const r = q.data;
  return (
    <Section title={tt(lang, "money.ifta")} ariaLabel="IFTA complete">
      <p className="text-sm text-[var(--dim)]">
        The gap in every other IFTA tool, closed: miles by state from your sealed trip sheets AND fuel bought by state from your sealed fuel purchases, one fleet MPG, and a per-state tax estimate — tax owed per state = (state miles ÷ MPG) × the state's rate, minus the tax you already paid on fuel bought in that state.
      </p>
      <p className="mt-2 rounded-xl bg-amber-900/40 px-3 py-2 text-sm font-semibold text-amber-200">
        Estimate for planning only — this is not a filing. It runs on the miles and fuel YOU logged; a jurisdiction whose rate isn't loaded shows "rate not loaded" and is left out of the totals rather than guessed.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls} htmlFor="ifta-year">Year</label>
          <input id="ifta-year" type="number" className={inputCls} value={year} aria-label="IFTA year" onChange={(e) => setYear(parseInt(e.target.value || "0", 10) || now.getFullYear())} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ifta-q">Quarter</label>
          <select id="ifta-q" className={inputCls} value={quarter} aria-label="IFTA quarter" onChange={(e) => setQuarter(parseInt(e.target.value, 10))}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Q{n}</option>)}
          </select>
        </div>
      </div>
      {q.isLoading && <p className="mt-3 text-sm text-[var(--dim)]">Building the quarter…</p>}
      {r && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5"><div className="font-condensed text-xl font-bold">{r.totalMiles.toFixed(1)}</div><div className="text-[11px] text-[var(--dim)]">miles</div></div>
            <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5"><div className="font-condensed text-xl font-bold">{r.totalGallonsBought.toFixed(1)}</div><div className="text-[11px] text-[var(--dim)]">gal bought</div></div>
            <div className="rounded-xl bg-[var(--surface2)] px-2 py-2.5"><div className="font-condensed text-xl font-bold">{r.fleetMpg != null ? r.fleetMpg.toFixed(2) : "—"}</div><div className="text-[11px] text-[var(--dim)]">fleet MPG</div></div>
          </div>
          {r.rows.length === 0 && <p className="mt-3 text-sm text-[var(--dim)]">Nothing logged in Q{quarter} {year} yet — save trip sheets and log fuel below and this fills in.</p>}
          <div className="mt-3 space-y-1.5">
            {r.rows.map((row) => (
              <div key={row.state} className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold">{row.state}</span>
                  <span className={row.net != null ? (row.net >= 0 ? "font-bold text-red-300" : "font-bold text-emerald-300") : "text-[var(--dim)]"}>
                    {row.net != null ? `${money(Math.abs(row.net))} ${row.net >= 0 ? "owed" : "credit"}` : "—"}
                  </span>
                </div>
                <div className="text-xs text-[var(--dim)]">
                  {row.miles.toFixed(1)} mi · bought {row.gallonsBought.toFixed(2)} gal · used {row.gallonsUsed != null ? row.gallonsUsed.toFixed(2) : "—"} gal
                  {row.taxRate != null ? ` · rate $${row.taxRate.toFixed(4)}/gal` : " · rate not loaded"}
                  {row.taxPaid != null ? ` · paid ${money(row.taxPaid)}` : ""}
                </div>
              </div>
            ))}
          </div>
          {r.totalNet != null && (
            <p className="mt-3 text-sm font-bold">Estimated quarter net: {money(Math.abs(r.totalNet))} {r.totalNet >= 0 ? "owed" : "credit"} <span className="font-normal text-[var(--dim)]">(estimate from your logged data only)</span></p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
            Tax rates: {r.ratesSource}. {r.ratesDate}
          </p>
          <XBar
            label={`IFTA report Q${quarter} ${year}`}
            filename={`stonemiles-ifta-Q${quarter}-${year}.txt`}
            setBanner={setBanner}
            resolve={async () => (await api.exportIftaReport({ year, quarter })).text}
          />
        </>
      )}
      <FuelLogForm setBanner={setBanner} />
    </Section>
  );
}

function FuelLogForm({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState("");
  const [station, setStation] = useState("");
  const [gallons, setGallons] = useState("");
  const [ppg, setPpg] = useState("");
  const [receipt, setReceipt] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["fuel-purchases"], queryFn: () => api.listFuelPurchases({ limit: 60 }) });
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const p = await photoToBase64(e);
    if (!p) { setBanner("Receipt photo needs to be a JPEG or PNG image."); return; }
    setReceipt(p);
    setBusy(true);
    try {
      const r = await api.extractMoneyDoc({ kind: "fuel", dataBase64: p.base64, mimeType: p.mime as "image/jpeg" | "image/png" });
      if (r.found) {
        if (r.station) setStation(r.station);
        if (r.state && US_STATES.includes(r.state)) setState(r.state);
        if (r.gallons != null) setGallons(String(r.gallons));
        if (r.pricePerGallon != null) setPpg(String(r.pricePerGallon));
        if (r.gallons == null && r.total != null && r.pricePerGallon != null) setGallons(String(Math.round((r.total / r.pricePerGallon) * 100) / 100));
        setBanner("Receipt read — check the numbers, fix anything the photo got wrong, then log it. Nothing was saved yet.");
      } else {
        setBanner("That photo doesn't read as a fuel receipt — the photo is still attached; type the numbers in.");
      }
    } catch {
      setBanner("Couldn't read that receipt — the photo is attached; type the numbers in.");
    } finally {
      setBusy(false);
    }
  };
  const gpsState = () => {
    try {
      const s = localStorage.getItem("tgps-current-state");
      if (s && US_STATES.includes(s)) setState(s);
      else setBanner("No GPS state saved yet — GPS is automatic; once there's a fix I'll know the state, or pick it from the list.");
    } catch { setBanner("Pick the state from the list."); }
  };
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <h3 className="font-condensed text-lg font-bold">Log a fuel purchase</h3>
      <p className="text-xs text-[var(--dim)]">State auto-fills from your GPS position when known. A receipt photo is fingerprinted and sealed with the purchase.</p>
      <p className="mt-1.5 text-xs text-[var(--dim)]">
        Attach the receipt and this stop earns a <strong className="text-[var(--text)]">+15 bonus points</strong> on paid plans — once a day, and each receipt can earn the bonus only once, anywhere. Your price — never your name — joins the fuel prices other drivers see, marked receipt-verified when a receipt is attached. The receipt itself stays sealed in your own records for IFTA and taxes.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls} htmlFor="fuel-state">State (full name)</label>
          <div className="flex gap-1.5">
            <select id="fuel-state" className={inputCls} value={state} aria-label="Fuel purchase state" onChange={(e) => setState(e.target.value)}>
              <option value="">Pick a state…</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" className="btn-press shrink-0 rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 font-bold" aria-label="Use my GPS state for this fuel purchase" onClick={gpsState}>📍 GPS</button>
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls} htmlFor="fuel-station">Station</label>
          <input id="fuel-station" className={inputCls} value={station} aria-label="Fuel station" placeholder="Love's, Pilot, independent…" onChange={(e) => setStation(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="fuel-gal">Gallons</label>
          <input id="fuel-gal" type="number" inputMode="decimal" className={inputCls} value={gallons} aria-label="Gallons purchased" onChange={(e) => setGallons(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="fuel-ppg">Price / gallon ($)</label>
          <input id="fuel-ppg" type="number" inputMode="decimal" step="0.001" className={inputCls} value={ppg} aria-label="Price per gallon" onChange={(e) => setPpg(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
          📷 Receipt photo
          <input type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Upload a fuel receipt photo" onChange={(e) => void onPhoto(e)} />
        </label>
        {receipt && <span className="text-xs font-semibold text-emerald-300">Receipt attached ✓</span>}
        <button
          type="button"
          disabled={busy || !state || !(parseFloat(gallons) > 0) || !(parseFloat(ppg) > 0)}
          className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
          aria-label="Log this fuel purchase sealed"
          onClick={() => {
            setBusy(true);
            void api.logFuelPurchase({
              purchasedAt: new Date().toISOString(),
              state,
              station: station.trim() || null,
              gallons: parseFloat(gallons),
              pricePerGallon: parseFloat(ppg),
              odometer: null,
              notes: null,
              receiptDataBase64: receipt?.base64 ?? null,
              receiptMime: receipt?.mime ?? null,
            }).then((r) => {
              setBanner(`Fuel logged & sealed — ${gallons} gal in ${state}, ${money(r.total)}. It counts toward IFTA and your break-even.${r.receiptBonusAwarded > 0 ? ` Receipt bonus landed: +${r.receiptBonusAwarded} SM Points for the fingerprinted receipt.` : ""}`);
              setGallons(""); setPpg(""); setReceipt(null);
              void queryClient.invalidateQueries({ queryKey: ["fuel-purchases"] });
              void queryClient.invalidateQueries({ queryKey: ["ifta-report"] });
              void queryClient.invalidateQueries({ queryKey: ["money-truth"] });
            }).catch(() => setBanner("Couldn't log that fuel purchase — try again.")).finally(() => setBusy(false));
          }}
        >
          {busy ? "Reading…" : "Log fuel — sealed"}
        </button>
      </div>
      <div className="mt-3 space-y-1.5">
        {(list.data?.purchases ?? []).slice(0, 8).map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-bold">{p.state}</span> · {p.gallons.toFixed(2)} gal @ {money(p.pricePerGallon)} = <strong>{money(p.total)}</strong>
              <span className="block truncate text-xs text-[var(--dim)]">{p.station ?? "Station not named"} · {new Date(p.purchasedAt).toLocaleDateString()} {p.hasReceipt ? "· receipt sealed" : ""}</span>
            </span>
            <button type="button" className="shrink-0 text-xs font-bold underline" aria-label={`Delete fuel purchase in ${p.state} for ${money(p.total)}`} onClick={() => void api.deleteFuelPurchase({ id: p.id }).then(() => { void queryClient.invalidateQueries({ queryKey: ["fuel-purchases"] }); void queryClient.invalidateQueries({ queryKey: ["ifta-report"] }); })}>Delete</button>
          </div>
        ))}
        {(list.data?.purchases ?? []).length === 0 && !list.isLoading && <p className="text-xs text-[var(--dim)]">No fuel logged yet.</p>}
      </div>
    </div>
  );
}

// ---------- B) Money Truth -----------------------------------------------------

const EXPENSE_CATS = ["fuel", "maintenance", "tolls", "parking", "meals", "supplies", "lumper", "insurance", "scale", "permits", "repairs", "dot_testing", "licensing", "software", "other"] as const;

/** Display names for the expense categories — the stored keys stay
 *  the snake_case the records sealed with; the driver reads words.
 *  (Tax Worksheet batch, 2026-11-12: repairs / DOT testing /
 *  licensing / software joined the picker.) */
export const EXPENSE_CAT_LABELS: Record<string, string> = {
  fuel: "Fuel",
  maintenance: "Maintenance",
  tolls: "Tolls",
  parking: "Parking",
  meals: "Meals",
  supplies: "Supplies",
  lumper: "Lumper",
  insurance: "Insurance",
  scale: "Scale",
  permits: "Permits",
  repairs: "Repairs",
  dot_testing: "DOT testing / physical",
  licensing: "Licensing & fees",
  software: "Software & satellite",
  other: "Other",
};

export function expenseCategoryLabel(category: string): string {
  return EXPENSE_CAT_LABELS[category] ?? category;
}

export function MoneyPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<"week" | "month" | "quarter" | "all">("month");
  const q = useQuery({ queryKey: ["money-truth", period], queryFn: () => api.getMoneyTruth({ period }) });
  const m = q.data;
  const [cat, setCat] = useState<string>("maintenance");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [receipt, setReceipt] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const expList = useQuery({ queryKey: ["expenses"], queryFn: () => api.listExpenses({ limit: 100 }) });
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const p = await photoToBase64(e);
    if (!p) { setBanner("Receipt photo needs to be a JPEG or PNG image."); return; }
    setReceipt(p);
    setBusy(true);
    try {
      const r = await api.extractMoneyDoc({ kind: "expense", dataBase64: p.base64, mimeType: p.mime as "image/jpeg" | "image/png" });
      if (r.found) {
        if (r.amount != null) setAmount(String(r.amount));
        else if (r.total != null) setAmount(String(r.total));
        if (r.vendor) setVendor(r.vendor);
        setBanner("Receipt read — confirm the amount and category, then log it.");
      } else setBanner("That photo doesn't read as an expense receipt — it's attached; type the amount in.");
    } catch { setBanner("Couldn't read that receipt — type the amount in."); } finally { setBusy(false); }
  };
  const exportText = () => {
    if (!m) return null;
    const lines = [
      `MONEY TRUTH — TAX-TIME CATEGORY EXPORT (${period}) — STONEMILES`,
      "Built only from your own sealed fuel purchases, expenses, trips, and loads. No market rates anywhere.",
      `Miles: ${m.totalMiles.toFixed(1)} · Revenue: ${money(m.revenue)} (load rates ${money(m.loadRevenue)} · trip pay ${money(m.tripPay)})`,
      `Fuel: ${m.fuelGallons.toFixed(2)} gal · ${money(m.fuelCost)}`,
      ...m.byCategory.map((c) => `${c.category}: ${money(c.amount)}`),
      `Total cost: ${money(m.totalCost)} · Profit: ${money(m.profit)}`,
      `Cost per mile: ${m.costPerMile != null ? money(m.costPerMile) + "/mi" : "—"} · Break-even: ${m.breakEvenPerMile != null ? money(m.breakEvenPerMile) + "/mi" : "—"}`,
    ];
    return lines.join("\n");
  };
  return (
    <Section title={tt(lang, "money.truth")} ariaLabel="Money truth">
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[var(--surface2)] p-1" role="tablist" aria-label="Money truth period">
        {(["week", "month", "quarter", "all"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} aria-label={`Show ${p} money view`} onClick={() => setPeriod(p)} className={`btn-press rounded-xl py-2 text-xs font-bold capitalize ${period === p ? "btn-neon" : "text-[var(--dim)]"}`}>{p === "all" ? "All time" : p}</button>
        ))}
      </div>
      {m && (
        <>
          {!m.hasData && <p className="mt-3 text-sm text-[var(--dim)]">Nothing logged in this view yet. Log fuel (IFTA panel) and expenses below — your cost per mile appears from YOUR numbers only.</p>}
          {m.hasData && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[var(--surface2)] px-3 py-2.5"><div className="text-[11px] uppercase tracking-wide text-[var(--dim)]">Cost per mile</div><div className="font-condensed text-2xl font-bold neon-text">{m.costPerMile != null ? money(m.costPerMile) : "—"}</div></div>
                <div className="rounded-xl bg-[var(--surface2)] px-3 py-2.5"><div className="text-[11px] uppercase tracking-wide text-[var(--dim)]">Break-even rate</div><div className="font-condensed text-2xl font-bold neon-text">{m.breakEvenPerMile != null ? money(m.breakEvenPerMile) + "/mi" : "—"}</div></div>
                <div className="rounded-xl bg-[var(--surface2)] px-3 py-2.5"><div className="text-[11px] uppercase tracking-wide text-[var(--dim)]">Revenue</div><div className="font-condensed text-xl font-bold">{money(m.revenue)}</div><div className="text-[11px] text-[var(--dim)]">{m.totalMiles.toFixed(0)} mi</div></div>
                <div className="rounded-xl bg-[var(--surface2)] px-3 py-2.5"><div className="text-[11px] uppercase tracking-wide text-[var(--dim)]">Profit</div><div className={`font-condensed text-xl font-bold ${m.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(m.profit)}</div><div className="text-[11px] text-[var(--dim)]">cost {money(m.totalCost)}</div></div>
              </div>
              <div className="mt-2 space-y-1">
                <p className="text-sm">Fuel: {m.fuelGallons.toFixed(2)} gal · {money(m.fuelCost)}</p>
                {m.byCategory.map((c) => <p key={c.category} className="text-sm capitalize">{c.category}: <strong>{money(c.amount)}</strong></p>)}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">{m.note}</p>
              {m.scoredLoads.length > 0 && (
                <div className="mt-2">
                  <h3 className="font-condensed text-lg font-bold">Per-load profit (from your sealed Worth-It scores)</h3>
                  {m.scoredLoads.map((s, i) => (
                    <p key={i} className="text-sm">{s.verdict === "green" ? "🟢" : s.verdict === "yellow" ? "🟡" : "🔴"} {s.label} — rate {money(s.rate)}, estimated profit <strong>{money(s.profit)}</strong> <span className="text-[var(--dim)]">({new Date(s.at).toLocaleDateString()})</span></p>
                  ))}
                </div>
              )}
            </>
          )}
          <XBar label={`Money Truth tax export (${period})`} filename={`stonemiles-money-truth-${period}.txt`} setBanner={setBanner} resolve={exportText} />
        </>
      )}
      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <h3 className="font-condensed text-lg font-bold">Log an expense</h3>
        <p className="mt-0.5 text-xs text-[var(--dim)]">Pick the tax category yourself — a receipt scan may suggest one, but the category that seals is the one you confirm here. The year-end totals live in Tax Records (Driver tab).</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="exp-cat">Category</label>
            <select id="exp-cat" className={inputCls} value={cat} aria-label="Expense category" onChange={(e) => setCat(e.target.value)}>
              {EXPENSE_CATS.map((c) => <option key={c} value={c}>{expenseCategoryLabel(c)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="exp-amt">Amount ($)</label>
            <input id="exp-amt" type="number" inputMode="decimal" className={inputCls} value={amount} aria-label="Expense amount" onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls} htmlFor="exp-vendor">Vendor</label>
            <input id="exp-vendor" className={inputCls} value={vendor} aria-label="Expense vendor" placeholder="Who got paid" onChange={(e) => setVendor(e.target.value)} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
            📷 Receipt photo
            <input type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Upload an expense receipt photo" onChange={(e) => void onPhoto(e)} />
          </label>
          {receipt && <span className="text-xs font-semibold text-emerald-300">Receipt attached ✓</span>}
          <button
            type="button"
            disabled={busy || !(parseFloat(amount) > 0)}
            className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
            aria-label="Log this expense sealed"
            onClick={() => {
              setBusy(true);
              void api.logExpense({ spentAt: new Date().toISOString(), category: cat as typeof EXPENSE_CATS[number], amount: parseFloat(amount), vendor: vendor.trim() || null, state: null, loadId: null, notes: null, receiptDataBase64: receipt?.base64 ?? null, receiptMime: receipt?.mime ?? null })
                .then(() => { setBanner(`Expense logged & sealed — ${cat} ${money(parseFloat(amount))}.`); setAmount(""); setVendor(""); setReceipt(null); void queryClient.invalidateQueries({ queryKey: ["expenses"] }); void queryClient.invalidateQueries({ queryKey: ["money-truth"] }); })
                .catch(() => setBanner("Couldn't log that expense — try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Reading…" : "Log expense — sealed"}
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {(expList.data?.expenses ?? []).slice(0, 8).map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
              <span>{expenseCategoryLabel(e.category)} · <strong>{money(e.amount)}</strong> <span className="text-xs normal-case text-[var(--dim)]">{e.vendor ?? ""} · {new Date(e.spentAt).toLocaleDateString()}{e.hasReceipt ? " · receipt sealed" : ""}</span></span>
              <button type="button" className="shrink-0 text-xs font-bold underline" aria-label={`Delete ${e.category} expense of ${money(e.amount)}`} onClick={() => void api.deleteExpense({ id: e.id }).then(() => { void queryClient.invalidateQueries({ queryKey: ["expenses"] }); void queryClient.invalidateQueries({ queryKey: ["money-truth"] }); })}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------- B1b) Pay-stub sharing — the DRIVER's optional email ----------------
// x's refinement (2026-10-27): email is driver-optional. This button
// is the driver's OWN share: it builds a SINGLE stub's summary (one
// pile only: W-2 and 1099 paperwork stays separate, per the filing
// rule), attaches the stub file through the device share sheet where
// the platform supports it, and otherwise downloads the stub copy and
// opens a mailto: draft in the DRIVER'S OWN mail app. STONEMILES does
// not send that email and does not store the recipient; nothing is
// ever pre-filled from company data.
// x's follow-up (2026-10-30, "both optional also") added a SECOND,
// separate path beside this one: the pay-stub email-copies toggle in
// Document copies settings (default OFF). Only when the driver turns
// it on does confirming a stub into the Pay Book also email a copy to
// the driver / dispatch / owner seats — handled server-side
// (maybeEmailPayStubCopy), never by this button.

export const STUB_EMAIL_POSTURE =
  "Emailing is your choice — it opens your own mail app. STONEMILES does not send the email and does not store who you send it to.";

/** The opt-in automatic-copy posture, shown in the Pay Book beside
 *  the toggle status (mirrors PAY_STUB_AUTO_EMAIL_POSTURE server-side). */
export const STUB_AUTO_EMAIL_POSTURE =
  "Pay-stub email copies are off unless you turn them on in Document copies settings (Loads → All loads). When they're on, confirming a stub into your Pay Book — logging a scanned stub, or accepting one your company sent — also emails a copy to the driver, dispatch, and owner addresses in those settings. Your Pay Book filing happens either way.";

/** Per-diem packet line label — mirrors PER_DIEM_PACKET_LABEL in
 *  server/src/payBook.ts. Filing gross is always taxable-only; per
 *  diem appears only as this labelled line, never in a filing total. */
export const PER_DIEM_PACKET_LABEL =
  "Per diem (non-taxable, paid separately) — not included in filing gross";

export function perDiemPacketLine(perDiemTotal: number): string | null {
  return perDiemTotal > 0 ? `${PER_DIEM_PACKET_LABEL}: ${money(perDiemTotal)}` : null;
}

/** The per-diem block a tax packet appends after its totals: the
 *  labelled line plus the total-received line — or nothing at all
 *  when the pile has no per diem in the period. */
export function perDiemPacketLines(perDiemTotal: number, totalReceived: number): string[] {
  const line = perDiemPacketLine(perDiemTotal);
  return line ? [line, `Total received (net + per diem): ${money(totalReceived)}`] : [];
}

export function stubSummaryText(s: {
  kind: "w2" | "1099";
  isForm: boolean;
  payer: string;
  paidAt: string;
  taxYear: number | null;
  gross: number;
  federalWithheld: number;
  stateWithheld: number;
  otherDeductions: number;
  deductionLines?: { label: string; amount: number }[];
  perDiem?: number;
  hasStub: boolean;
  sourceNote?: string | null;
}): string {
  const kindLabel = s.kind === "w2" ? "W-2" : "1099";
  const perDiem = !s.isForm && (s.perDiem ?? 0) > 0 ? (s.perDiem ?? 0) : 0;
  const lines = [
    `STONEMILES — ${kindLabel} ${s.isForm ? "YEAR-END FORM" : "PAY STUB"} (single stub)`,
    `${s.kind === "w2" ? "Employer" : "Payer"}: ${s.payer}`,
    s.isForm ? `Date received: ${new Date(s.paidAt).toLocaleDateString()}` : `Pay date: ${new Date(s.paidAt).toLocaleDateString()}`,
    ...(s.isForm ? [`Tax year on the form: ${s.taxYear ?? "—"}`] : []),
    `Gross pay: ${money(s.gross)}`,
    ...(s.kind === "w2"
      ? [
          `Federal withheld: ${money(s.federalWithheld)}`,
          `State withheld: ${money(s.stateWithheld)}`,
          ...(s.otherDeductions ? [`Other deductions: ${money(s.otherDeductions)}`] : []),
          `Net paid: ${money(s.gross - s.federalWithheld - s.stateWithheld - s.otherDeductions)}`,
        ]
      : [
          "Tax withheld: not applicable — no tax is ever withheld from 1099 pay.",
          ...((s.deductionLines ?? []).length
            ? [
                "Deductions on the stub (came off before the pay reached the owner):",
                ...(s.deductionLines ?? []).map((l) => `  ${l.label}: ${money(l.amount)}`),
                `Deductions total: ${money(s.otherDeductions)}`,
                `Paid to owner: ${money(s.gross - s.otherDeductions)}`,
              ]
            : []),
        ]),
    ...(perDiem
      ? [
          `Per diem (non-taxable — paid separately): ${money(perDiem)}`,
          `Total received: ${money(s.gross - s.federalWithheld - s.stateWithheld - s.otherDeductions + perDiem)}`,
        ]
      : []),
    s.hasStub ? "The stub file itself is attached / downloaded with this copy." : "No stub file is attached to this record.",
    ...(s.sourceNote ? [s.sourceNote] : []),
    "",
    `This is one ${kindLabel} stub only. W-2 and 1099 paperwork is filed separately — the two are never merged into a filing figure.`,
    "Shared by the driver from their own STONEMILES Pay Book.",
  ];
  return lines.join("\n");
}

export function StubShareButton({
  title,
  buildText,
  textFilename,
  stubFilename,
  fetchFile,
  setBanner,
}: {
  title: string;
  buildText: () => string;
  textFilename: string;
  stubFilename: string;
  fetchFile: () => Promise<{ url: string | null; mime: string | null }>;
  setBanner: Banner;
}) {
  const [busy, setBusy] = useState(false);
  const onShare = async () => {
    if (!(await ensureStepUp(`Email / share — ${title}`))) {
      setBanner("Sharing cancelled — it needs a fresh PIN entry first (Security Pack 2 step-up).");
      return;
    }
    setBusy(true);
    try {
      const text = buildText();
      const f = await fetchFile().catch(() => null);
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      let shared = false;
      let cancelled = false;
      if (f?.url && typeof navigator.share === "function" && typeof nav.canShare === "function") {
        try {
          const res = await fetch(f.url);
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], stubFilename, { type: f.mime ?? blob.type ?? "image/jpeg" });
            if (nav.canShare({ files: [file] })) {
              await navigator.share({ title, text, files: [file] });
              shared = true;
            }
          }
        } catch {
          cancelled = true;
        }
      }
      if (!shared && !cancelled && typeof navigator.share === "function") {
        try {
          await navigator.share({ title, text });
          shared = true;
        } catch {
          cancelled = true;
        }
      }
      if (cancelled) {
        setBanner("Sharing cancelled — nothing was sent.");
        return;
      }
      if (shared) {
        setBanner("Opened in the share sheet — you pick who gets it. STONEMILES didn't send anything.");
        return;
      }
      // No share sheet here: download the copies, then open a draft in
      // the driver's own mail app (recipient left blank — the driver
      // fills it in; nothing is pre-filled from company data).
      downloadTextFile(textFilename, text);
      if (f?.url) {
        const a = document.createElement("a");
        a.href = f.url;
        a.download = stubFilename;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.click();
      }
      window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text.slice(0, 1800))}`;
      setBanner("Your mail app is opening with the stub summary — attach the downloaded stub copy, pick who it goes to, and send it yourself. STONEMILES does not send the email and does not store the recipient.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1.5">
      <button
        type="button"
        disabled={busy}
        className="btn-press rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50"
        aria-label={`Email or share ${title}`}
        onClick={() => void onShare()}
      >
        {busy ? "Preparing…" : "📤 Email / share this stub"}
      </button>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--dim)]">{STUB_EMAIL_POSTURE}</p>
    </div>
  );
}

/** Inline viewer for a sealed stub image (stubs attach as JPEG/PNG). */
export function StubFileView({ view, onClose }: { view: { url: string; mime: string | null; name: string } | null; onClose: () => void }) {
  if (!view) return null;
  return (
    <div className="fixed inset-0 z-[970] flex items-end bg-black/75" role="dialog" aria-label="Pay stub file viewer">
      <div className="animate-sheet max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 pb-safe">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-condensed text-xl font-bold">🧾 {view.name}</h3>
          <button type="button" className="rounded-full bg-[var(--surface2)] px-4 py-2 font-bold" aria-label="Close stub file viewer" onClick={onClose}>✕ Close</button>
        </div>
        <div className="mt-3">
          {view.mime?.startsWith("image/") ? (
            <img src={view.url} alt="Pay stub file" className="w-full rounded-xl" />
          ) : (
            <a href={view.url} target="_blank" rel="noreferrer" className="font-bold underline">Open / download the stub file</a>
          )}
        </div>
        <div className="mt-3">
          <a href={view.url} download={view.name} target="_blank" rel="noreferrer" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black" aria-label={`Download ${view.name}`}>
            ⬇ Download original
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------- B1c) 1099 deductions — itemized lines + taxes not applicable ------
// x's 1099 model (2026-10-27): the broker just pays the owner — NO tax
// is ever withheld from 1099 pay, so the federal/state fields are not
// "zero", they are NOT APPLICABLE. What CAN come off a 1099 stub
// before the owner sees the money is named deductions — fuel, truck
// payment, insurance, escrow, quickpay/service fees — and those are
// logged line by line so the entry mirrors the settlement stub. The
// lines sum into the entry's deductions total (one number, never
// two). Expenses the owner pays out of pocket stay in the expense
// tracker; the packet nets each kind once.

export const TYPICAL_DEDUCTION_LABELS = ["Fuel", "Truck payment", "Insurance", "Escrow", "Quickpay fee", "Service fee"];

export type DedLineDraft = { label: string; amount: string };

export function cleanDeductionLines(lines: DedLineDraft[]): { label: string; amount: number }[] {
  return lines
    .map((l) => ({ label: l.label.trim(), amount: parseFloat(l.amount) || 0 }))
    .filter((l) => l.label && l.amount > 0);
}

export function deductionLinesTotal(lines: DedLineDraft[]): number {
  return cleanDeductionLines(lines).reduce((s, l) => s + l.amount, 0);
}

/** The note that stands where the tax fields would be on the 1099
 *  side — a driver should never be left guessing at empty tax boxes. */
export function TaxNotApplicableNote() {
  return (
    <div className="col-span-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5" role="note" aria-label="Taxes not applicable on 1099 pay">
      <p className="text-sm font-bold">Taxes — not applicable on 1099 pay</p>
      <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
        No federal or state tax is ever withheld from 1099 pay — the broker just pays the owner, and the owner settles their own taxes at filing time. That's why there are no tax boxes on this side. What can come off the stub is below: the named deductions.
      </p>
    </div>
  );
}

/** Add/remove rows of label + amount for the deductions on a stub —
 *  a 1099 settlement or a W-2 paycheck alike (the lines always stay in
 *  the entry's own lane and are never tax withholding). Labels pick
 *  from the typical stub labels or type freely. The rows sum live
 *  into the entry's deductions total. */
export function DeductionLinesEditor({
  lines,
  onChange,
  idPrefix,
}: {
  lines: DedLineDraft[];
  onChange: (lines: DedLineDraft[]) => void;
  idPrefix: string;
}) {
  const total = deductionLinesTotal(lines);
  const setRow = (i: number, patch: Partial<DedLineDraft>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="col-span-2 min-w-0">
      <span className={labelCls}>Deductions on the stub — line by line ($)</span>
      <datalist id={`${idPrefix}-ded-labels`}>
        {TYPICAL_DEDUCTION_LABELS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={`${inputCls} min-w-0 flex-1`}
              value={l.label}
              list={`${idPrefix}-ded-labels`}
              aria-label={`Deduction ${i + 1} label`}
              placeholder="Fuel, Truck payment, Insurance…"
              onChange={(e) => setRow(i, { label: e.target.value })}
            />
            <input
              type="number"
              inputMode="decimal"
              className={`${inputCls} w-28 shrink-0`}
              value={l.amount}
              aria-label={`Deduction ${i + 1} amount in dollars`}
              placeholder="0.00"
              onChange={(e) => setRow(i, { amount: e.target.value })}
            />
            <button
              type="button"
              className="btn-press shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs font-bold"
              aria-label={`Remove deduction line ${i + 1}${l.label ? ` (${l.label})` : ""}`}
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        {lines.length === 0 && (
          <p className="text-xs text-[var(--dim)]">Nothing came off this stub? Leave this empty — plenty of pay has no deductions on the paper.</p>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn-press rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
          aria-label="Add a deduction line"
          onClick={() => onChange([...lines, { label: "", amount: "" }])}
        >
          + Add deduction line
        </button>
        <span className="text-xs font-semibold" aria-label="Deductions total from these lines">
          Deductions total: {money(total)}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Only what's printed on the stub goes here — these amounts already came off before the pay reached you, and they are never tax withholding (W-2 tax lives in the withheld fields above; 1099 pay has no tax withheld at all). Fuel and repairs you paid out of your own pocket belong in the expense log instead; this pile's tax packet nets each once, never twice.
      </p>
    </div>
  );
}

/** Read-only itemized deduction lines for a logged entry / delivery —
 *  the packet named is the entry's OWN lane's packet. */
export function DeductionLinesList({ lines, total, packetName = "1099 packet" }: { lines: { label: string; amount: number }[]; total: number; packetName?: string }) {
  if (!lines.length) return null;
  return (
    <div className="mt-1 text-xs text-[var(--dim)]">
      <span className="font-semibold text-[var(--text)]">Deductions on the stub:</span>{" "}
      {lines.map((l) => `${l.label} ${money(l.amount)}`).join(" · ")} — <strong className="text-[var(--text)]">total {money(total)}</strong> (netted once in the {packetName})
    </div>
  );
}

// ---------- B2) Pay Book — W-2 + 1099, tracked together, filed separately ----
// x's rule: keep up with both kinds of pay in ONE place with one combined
// tracking total — but the piles stay separate and tax time gets TWO
// packets, one per pile. The combined total is labelled a tracking
// number everywhere it appears and never enters either packet as a
// filing figure.

type PayPeriod = "week" | "month" | "quarter" | "year" | "all";
const PAY_PERIODS: { key: PayPeriod; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
];

/** One lane's Year-to-Date pie — W-2 and 1099 are drawn as two of
 *  these, side by side, never merged (x, 2026-10-30: "Keep W-2 & 1099
 *  separate lanes. Don't mix"). Three slices, all from THIS lane only:
 *  gross, per diem (non-taxable, its own slice), and deductions. The
 *  percentages divide by this lane's own slice total — there is no
 *  cross-lane total anywhere in the YTD view. */
function YtdLanePie({
  title,
  count,
  grossLabel,
  grossColor,
  lane,
  deductionsNote,
  year,
}: {
  title: string;
  count: number;
  grossLabel: string;
  grossColor: string;
  lane: { gross: number; perDiem: number; deductions: number; total: number };
  deductionsNote: string;
  year: number;
}) {
  const slices = [
    { name: grossLabel, value: lane.gross, color: grossColor },
    { name: "Per diem (non-taxable)", value: lane.perDiem, color: "#38bdf8" },
    { name: "Deductions", value: lane.deductions, color: "#fb7185" },
  ];
  const drawn = slices.filter((s) => s.value > 0);
  const pct = (v: number) => (lane.total > 0 ? `${((v / lane.total) * 100).toFixed(1)}%` : "—");
  return (
    <div className="min-w-0 rounded-xl bg-[var(--surface)] px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-condensed text-lg font-bold">{title}</h4>
        <span className="text-[11px] text-[var(--dim)]">{count} paycheck{count === 1 ? "" : "s"} in {year}</span>
      </div>
      {lane.total <= 0 ? (
        <p className="mt-2 text-sm text-[var(--dim)]">No pay logged in this lane for {year} yet — paychecks you log for {year} build this pie.</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`${title} year-to-date pie for ${year}: ${slices.map((s) => `${s.name} ${money(s.value)} (${pct(s.value)})`).join(", ")}`}
          >
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Tooltip
                  formatter={(value) => money(Number(value ?? 0))}
                  contentStyle={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }}
                />
                <Pie data={drawn} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={2} stroke="var(--surface)" strokeWidth={2}>
                  {drawn.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-1 space-y-1">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
                <span className="min-w-0 flex-1">{s.name}</span>
                <strong>{money(s.value)}</strong>
                <span className="w-12 text-right text-xs text-[var(--dim)]">{pct(s.value)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--dim)]">
            Pie total {money(lane.total)} — this lane's three slices added for size comparison only, not a filing number. {deductionsNote}
          </p>
        </>
      )}
    </div>
  );
}

export function PayBookPanel({ setBanner, openSignal = 0, lang = "en" }: { setBanner: Banner; openSignal?: number; lang?: Lang }) {
  const queryClient = useQueryClient();
  // The panel is a closed card by default; a jump (Ask Meca, the Money
  // tab's Pay Book button, the More list) bumps openSignal to open it.
  const [bookOpen, setBookOpen] = useState(false);
  useEffect(() => {
    if (openSignal > 0) setBookOpen(true);
  }, [openSignal]);
  // Default to All time: a driver's older paychecks (e.g. last year's
  // stubs) must be visible the moment the book opens — a narrower
  // default period made real entries look missing.
  const [period, setPeriod] = useState<PayPeriod>("all");
  const q = useQuery({ queryKey: ["pay-book", period], queryFn: () => api.getPayBook({ period }) });
  // Year-to-Date lane pies: their own calendar-year view, independent
  // of the period tabs above. The year picker defaults to this year
  // and drives BOTH lane pies (W-2 and 1099 stay separate lanes).
  const [ytdYear, setYtdYear] = useState(() => new Date().getFullYear());
  const ytd = useQuery({ queryKey: ["pay-book-ytd", ytdYear], queryFn: () => api.getPayBookYtd({ year: ytdYear }) });
  const list = useQuery({ queryKey: ["pay-entries"], queryFn: () => api.listPayEntries({ limit: 300 }) });
  const inbox = useQuery({ queryKey: ["received-stubs"], queryFn: () => api.listReceivedStubs({}) });
  // Pay-stub email copies toggle status (both optional, 2026-10-30):
  // the switch itself lives in Document copies settings (Loads → All
  // loads); the Pay Book shows the state so the driver can see it
  // where they confirm stubs.
  const copySettings = useQuery({ queryKey: ["doc-copy-settings"], queryFn: () => api.getDocCopySettings({}) });
  const received = inbox.data?.deliveries ?? [];
  const [flagFor, setFlagFor] = useState<number | null>(null);
  const [flagText, setFlagText] = useState("");
  const [stubView, setStubView] = useState<{ url: string; mime: string | null; name: string } | null>(null);
  const [inboxBusy, setInboxBusy] = useState<number | null>(null);
  const pb = q.data;
  const entries = list.data?.entries ?? [];
  const inPeriod = entries.filter((e) => !pb?.startIso || new Date(e.paidAt).getTime() >= new Date(pb.startIso).getTime());

  const [kind, setKind] = useState<"w2" | "1099">("w2");
  const [isForm, setIsForm] = useState(false);
  const [payer, setPayer] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [gross, setGross] = useState("");
  const [fed, setFed] = useState("");
  const [st, setSt] = useState("");
  const [other, setOther] = useState("");
  const [dedLines, setDedLines] = useState<DedLineDraft[]>([]);
  // Edit-deductions on a logged entry (x, 2026-10-30): the same
  // itemized lines the scan files automatically, editable after the
  // fact — per entry, in that entry's own lane.
  const [editDedFor, setEditDedFor] = useState<number | null>(null);
  const [editDedLines, setEditDedLines] = useState<DedLineDraft[]>([]);
  const [editDedBusy, setEditDedBusy] = useState(false);
  const openDedEditor = (e: { id: number; deductionLines: { label: string; amount: number }[]; otherDeductions: number }) => {
    setEditDedFor(e.id);
    setEditDedLines(
      e.deductionLines.length
        ? e.deductionLines.map((l) => ({ label: l.label, amount: String(l.amount) }))
        : e.otherDeductions > 0
          ? [{ label: "Other deductions (as logged)", amount: String(e.otherDeductions) }]
          : [],
    );
  };
  const [perDiemAmt, setPerDiemAmt] = useState("");
  const [taxYear, setTaxYear] = useState(() => String(new Date().getFullYear()));
  const [stub, setStub] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onStub = async (e: ChangeEvent<HTMLInputElement>) => {
    const p = await photoToBase64(e);
    if (!p) { setBanner("Pay stub / form photo needs to be a JPEG or PNG image. For a PDF form, keep the file in your document vault and log the form's numbers here."); return; }
    setStub(p);
    setBanner("Photo attached — it seals behind this entry when you log it.");
  };

  // Payroll scan (2026-10-30): Meca reads a pay stub / weekly
  // settlement / year-end form photo and fills this form — the same
  // scan-and-confirm pattern as loads. Nothing files from the read:
  // the driver checks every figure (and the W-2 vs 1099 pile, which
  // always stays separate) and taps Log pay.
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState<{ title: string; found: string[]; missing: string[]; warnings: string[] } | null>(null);

  const onScanStub = async (e: ChangeEvent<HTMLInputElement>) => {
    const p = await photoToBase64(e);
    if (!p) { setScanNote(null); setBanner("Payroll scan reads a photo (JPEG or PNG) of the stub or settlement. For a PDF, snap or screenshot its pages — the PDF itself can still seal behind a hand-typed entry."); return; }
    setScanBusy(true);
    setScanNote(null);
    try {
      const r = await api.extractPayStub({ dataBase64: p.base64, mimeType: p.mime as "image/jpeg" | "image/png" });
      if (!r.found) {
        setBanner("That photo doesn't show readable pay details — nothing was filled in and nothing was guessed. Type the stub in by hand below; the photo button can still seal it behind the entry.");
        return;
      }
      // The scanned photo seals behind the entry when it's logged.
      setStub(p);
      if (r.kind) setKind(r.kind);
      setIsForm(r.isForm);
      if (r.payer) setPayer(r.payer);
      if (r.paidDateIso && /^\d{4}-\d{2}-\d{2}$/.test(r.paidDateIso)) setDate(r.paidDateIso);
      if (r.gross != null) setGross(String(r.gross));
      if (r.federalWithheld != null) setFed(String(r.federalWithheld));
      if (r.stateWithheld != null) setSt(String(r.stateWithheld));
      if (r.otherDeductions != null) setOther(String(r.otherDeductions));
      if (r.perDiem != null) setPerDiemAmt(String(r.perDiem));
      if (r.taxYear != null) setTaxYear(String(r.taxYear));
      if (r.deductionLines.length) setDedLines(r.deductionLines.map((l) => ({ label: l.label, amount: String(l.amount) })));
      const foundLines: string[] = [];
      const missing: string[] = [];
      const push = (label: string, present: boolean, display?: string) => {
        if (present) foundLines.push(`${label}: ${display ?? ""}`.trim());
        else missing.push(label);
      };
      push(r.isForm ? "Payer on the form" : "Payer", !!r.payer, r.payer ?? undefined);
      if (r.isForm) push("Tax year", r.taxYear != null, r.taxYear != null ? String(r.taxYear) : undefined);
      else push("Pay date", !!r.paidDateIso, r.paidDateIso ?? r.periodText ?? undefined);
      push("Gross", r.gross != null, r.gross != null ? money(r.gross) : undefined);
      if (r.kind === "w2") {
        push("Federal withheld", r.federalWithheld != null, r.federalWithheld != null ? money(r.federalWithheld) : undefined);
        push("State withheld", r.stateWithheld != null, r.stateWithheld != null ? money(r.stateWithheld) : undefined);
      }
      if (r.deductionLines.length) {
        foundLines.push(`Stub deductions (filed as itemized lines on the entry): ${r.deductionLines.map((l) => `${l.label} ${money(l.amount)}`).join(" · ")}`);
      }
      push("Per diem (non-taxable)", r.perDiem != null && r.perDiem > 0, r.perDiem != null ? money(r.perDiem) : undefined);
      const warnings: string[] = [];
      if (r.kind == null) {
        warnings.push("Meca couldn't tell whether this is W-2 or 1099 pay from the document — pick the right pile above before logging. The two piles file separately and are never merged into a filing number.");
      }
      if (!r.isForm && r.netPay != null && r.gross != null && !(r.perDiem != null && r.perDiem > 0)) {
        const dedTotal = r.deductionLines.length ? r.deductionLines.reduce((s, l) => s + l.amount, 0) : (r.otherDeductions ?? 0);
        const expected = Math.round((r.gross - (r.federalWithheld ?? 0) - (r.stateWithheld ?? 0) - dedTotal) * 100) / 100;
        if (Math.abs(r.netPay - expected) >= 0.01) {
          warnings.push(`Check the figures: the document's printed net is ${money(r.netPay)}, but gross minus what's taken off adds to ${money(expected)}. One figure was read differently than it's printed — fix the fields before logging.`);
        }
      }
      setScanNote({
        title:
          r.docKind === "settlement"
            ? "🧾 Meca read this as a weekly settlement"
            : r.docKind === "w2_form"
              ? "🧾 Meca read this as the year-end W-2 form"
              : r.docKind === "1099_form"
                ? "🧾 Meca read this as the year-end 1099 form"
                : "🧾 Meca read this as a pay stub",
        found: foundLines,
        missing,
        warnings,
      });
      setBanner("Meca filled the Log pay form from that photo — check every figure against the paper, then log it. The photo seals behind the entry.");
    } catch {
      setBanner("Couldn't read that photo — type the stub in by hand below; nothing was filled in.");
    } finally {
      setScanBusy(false);
    }
  };

  const w2Packet = () => {
    if (!pb) return null;
    const rows = inPeriod.filter((e) => e.kind === "w2" && !e.isForm);
    const lines = [
      `PAY BOOK — W-2 PACKET (${period}) — STONEMILES`,
      "For your tax preparer: this packet is the W-2 pile ONLY.",
      "STONEMILES organizes paperwork — it does not file taxes.",
      "",
      "PER EMPLOYER",
      ...(pb.w2.byPayer.length ? pb.w2.byPayer.map((p) => `${p.payer}: gross ${money(p.gross)} · federal withheld ${money(p.federalWithheld)} · state withheld ${money(p.stateWithheld)}${p.perDiem ? ` · per diem (non-taxable, separate) ${money(p.perDiem)}` : ""} · ${p.count} paycheck(s)`) : ["No W-2 pay logged in this period."]),
      "",
      "PAYCHECKS LOGGED",
      ...(rows.length ? rows.map((e) => `${new Date(e.paidAt).toLocaleDateString()} · ${e.payer} · gross ${money(e.gross)} · federal ${money(e.federalWithheld)} · state ${money(e.stateWithheld)}${e.deductionLines.length ? ` · other deductions on the stub: ${e.deductionLines.map((l) => `${l.label} ${money(l.amount)}`).join(", ")} (total ${money(e.otherDeductions)})` : e.otherDeductions ? ` · other deductions ${money(e.otherDeductions)}` : ""}${e.perDiem ? ` · per diem (non-taxable — paid separately) ${money(e.perDiem)}` : ""}${e.hasStub ? " · stub photo sealed" : ""}`) : ["None."]),
      "",
      `W-2 TOTALS — gross ${money(pb.w2.gross)} · federal withheld ${money(pb.w2.federalWithheld)} · state withheld ${money(pb.w2.stateWithheld)} · total withheld ${money(pb.w2.totalWithheld)} · other deductions ${money(pb.w2.otherDeductions)} · net paid ${money(pb.w2.netPaid)}`,
      ...perDiemPacketLines(pb.w2.perDiemTotal, pb.w2.totalReceived),
      "",
      "YEAR-END W-2 FORMS ON FILE",
      ...(pb.forms.w2.length ? pb.forms.w2.map((f) => `${f.payer} · tax year ${f.taxYear ?? "—"} · gross as printed ${money(f.gross)}`) : ["No W-2 form logged yet — when the January form arrives, log it in the Pay Book as a year-end form so it ties to this pile."]),
      "",
      "This packet holds W-2 pay only. 1099 pay is a separate packet — the two are filed separately and are never merged into a filing figure. Your combined W-2 + 1099 number in the app is a tracking total for keeping up, not a number to file.",
    ];
    return lines.join("\n");
  };

  const p1099Packet = () => {
    if (!pb) return null;
    const rows = inPeriod.filter((e) => e.kind === "1099" && !e.isForm);
    const lines = [
      `PAY BOOK — 1099 PACKET (${period}) — STONEMILES`,
      "For your tax preparer: this packet is the 1099 / self-employment pile ONLY.",
      "STONEMILES organizes paperwork — it does not file taxes.",
      "",
      "PER PAYER",
      ...(pb.ten99.byPayer.length ? pb.ten99.byPayer.map((p) => `${p.payer}: gross ${money(p.gross)}${p.perDiem ? ` · per diem (non-taxable, separate) ${money(p.perDiem)}` : ""} · ${p.count} payment(s)`) : ["No 1099 pay logged in this period."]),
      "",
      "PAYMENTS LOGGED",
      ...(rows.length ? rows.map((e) => `${new Date(e.paidAt).toLocaleDateString()} · ${e.payer} · gross ${money(e.gross)}${e.deductionLines.length ? ` · deductions on the stub: ${e.deductionLines.map((l) => `${l.label} ${money(l.amount)}`).join(", ")} (total ${money(e.otherDeductions)})` : ""}${e.perDiem ? ` · per diem (non-taxable — paid separately) ${money(e.perDiem)}` : ""}${e.hasStub ? " · stub photo sealed" : ""}`) : ["None."]),
      "",
      `1099 GROSS TOTAL — ${money(pb.ten99.gross)}`,
      ...(pb.ten99.deductionLines.length
        ? [
            "DEDUCTIONS ON THE STUBS (itemized — came off before the pay reached you; netted once, below)",
            ...pb.ten99.deductionLines.map((l) => `${l.label}: ${money(l.amount)}`),
            `Deductions total: ${money(pb.ten99.otherDeductions)}`,
          ]
        : ["No deductions were printed on these stubs — nothing was taken off before the pay reached you."]),
      ...perDiemPacketLines(pb.ten99.perDiemTotal, pb.ten99.totalReceived),
      "",
      "EXPENSES YOU PAID OUT OF POCKET (from your own logged records — separate from the stub deductions above; each dollar nets once, never twice)",
      ...(pb.expenses.byCategory.length ? pb.expenses.byCategory.map((c) => `${c.category}: ${money(c.amount)}`) : ["No expenses logged in this period."]),
      `Expenses total: ${money(pb.expenses.total)} · Fuel purchases: ${money(pb.expenses.fuelTotal)}`,
      `1099 NET (gross − stub deductions − expenses − fuel, from your logged records): ${money(pb.net1099)}`,
      "",
      "YEAR-END 1099 FORMS ON FILE",
      ...(pb.forms.ten99.length ? pb.forms.ten99.map((f) => `${f.payer} · tax year ${f.taxYear ?? "—"} · gross as printed ${money(f.gross)}`) : ["No 1099 form logged yet — when the January form arrives, log it in the Pay Book as a year-end form so it ties to this pile."]),
      "",
      "This packet holds 1099 pay only — no tax was withheld from it, which is why your expenses ride in this packet. W-2 pay is a separate packet; the two are filed separately and are never merged into a filing figure.",
    ];
    return lines.join("\n");
  };

  const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // One plain sentence on what the pay-stub email copies did for a
  // confirmation, from the server's summary — empty when the toggle
  // is off or no stub file rode along (nothing to report).
  const stubEmailNote = (s: { attempted: boolean; off: boolean; sent: number; queued: number; noAddress: number } | undefined): string => {
    if (!s || !s.attempted) return "";
    const bits: string[] = [];
    if (s.sent > 0) bits.push(`Pay-stub email copy sent to ${s.sent} of driver / dispatch / owner.`);
    if (s.queued > 0) bits.push(`${s.queued} pay-stub email ${s.queued === 1 ? "copy is" : "copies are"} queued — the mail provider isn't connected yet; they send when email connects at go-live. The record is under Filed document copies (Loads → All loads).`);
    if (s.noAddress > 0) bits.push(`${s.noAddress} ${s.noAddress === 1 ? "seat has" : "seats have"} no email on file for the pay-stub copy — add addresses in Document copies settings (Loads → All loads).`);
    return bits.length ? ` ${bits.join(" ")}` : "";
  };

  return (
    <Section title={tt(lang, "money.paybookTitle")} ariaLabel="Pay book" open={bookOpen} onOpenChange={setBookOpen}>
      <p className="text-sm text-[var(--dim)]">
        Keep up with both kinds of pay in one place. Tracking mixes them into one total below — filing never does: at tax time you export two separate packets, one per pile. The Year-to-Date pies further down keep the lanes apart — one pie per lane, never combined — and every logged entry&apos;s deductions can be itemized or edited right on the entry. This book is YOUR pay — if you run a company, sending stubs to your drivers lives in Owner Console → Send Pay Stubs.
      </p>
      <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5" role="status" aria-label="Pay stub email copies status">
        <p className="text-sm font-bold">
          ✉️ Pay-stub email copies: {copySettings.isPending ? "…" : copySettings.data?.payStubEmailEnabled ? "ON — your opt-in" : "OFF (default)"}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
          {STUB_AUTO_EMAIL_POSTURE} The switch and the addresses live in Loads → All loads → Document copies settings — the same card as the load-document copies toggle (that one defaults on; this one defaults off). You can always share a single stub yourself with the “Email / share this stub” button on an entry, whichever way the switch sits.
        </p>
      </div>
      <div id="pay-book-log" className="mt-3 scroll-mt-4">
        <h3 className="font-condensed text-lg font-bold">Log pay</h3>
        <div className="mt-2 rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-3">
          <label className={`btn-press flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-3 text-sm font-bold text-black ${scanBusy ? "opacity-60" : ""}`}>
            📷 {scanBusy ? "Meca is reading…" : "Scan stub / settlement — Meca fills the form"}
            <input type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Scan a pay stub or settlement photo for Meca to read and fill the form" onChange={(e) => void onScanStub(e)} />
          </label>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
            Photograph or upload a pay stub, a weekly settlement statement, or the year-end W-2 / 1099 form — Meca reads what's printed and fills the form below. You check it and log it; nothing files itself. W-2 and 1099 stay in their separate piles, per diem rides its own non-taxable line, and the deductions printed on the stub land as itemized lines on the entry in its own lane — never as tax.
          </p>
          {scanNote && (
            <div className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2.5" role="status" aria-label="What Meca read off the pay document">
              <div className="text-sm font-bold">{scanNote.title} — check it against the paper</div>
              {scanNote.found.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {scanNote.found.map((line) => (
                    <li key={line}>✓ {line}</li>
                  ))}
                </ul>
              )}
              {scanNote.missing.length > 0 && (
                <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">Not on this document: {scanNote.missing.join(" · ")} — those fields keep what's below; nothing was guessed.</p>
              )}
              {scanNote.warnings.map((w) => (
                <p key={w} className="mt-1.5 rounded-lg bg-amber-900/40 px-2.5 py-2 text-xs font-semibold leading-relaxed text-amber-200" role="alert">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-[var(--surface2)] p-1" role="group" aria-label="Pay kind">
          {(["w2", "1099"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} aria-label={`Pay kind ${k === "w2" ? "W-2" : "1099"}`} onClick={() => setKind(k)} className={`btn-press rounded-xl py-2 text-sm font-bold ${kind === k ? "btn-neon" : "text-[var(--dim)]"}`}>{k === "w2" ? "W-2 — employer job" : "1099 — contract work"}</button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={isForm} aria-label="This entry is the year-end form itself" onChange={(e) => setIsForm(e.target.checked)} />
          This is the year-end {kind === "w2" ? "W-2" : "1099"} form itself (arrived in January)
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="col-span-2 min-w-0">
            <label className={labelCls} htmlFor="pay-payer">{kind === "w2" ? "Employer" : "Payer"}</label>
            <input id="pay-payer" className={inputCls} value={payer} aria-label="Pay payer or employer name" placeholder={kind === "w2" ? "Employer name" : "Who paid you"} onChange={(e) => setPayer(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="pay-date">{isForm ? "Date received" : "Pay date"}</label>
            <input id="pay-date" type="date" className={inputCls} value={date} aria-label="Pay date" onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="pay-gross">Gross pay ($)</label>
            <input id="pay-gross" type="number" inputMode="decimal" className={inputCls} value={gross} aria-label="Gross pay amount" onChange={(e) => setGross(e.target.value)} />
          </div>
          {kind === "w2" && (
            <>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="pay-fed">Federal withheld ($)</label>
                <input id="pay-fed" type="number" inputMode="decimal" className={inputCls} value={fed} aria-label="Federal tax withheld" onChange={(e) => setFed(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="pay-state">State withheld ($)</label>
                <input id="pay-state" type="number" inputMode="decimal" className={inputCls} value={st} aria-label="State tax withheld" onChange={(e) => setSt(e.target.value)} />
              </div>
              {dedLines.length === 0 ? (
                <div className="min-w-0">
                  <label className={labelCls} htmlFor="pay-other">Other deductions ($)</label>
                  <input id="pay-other" type="number" inputMode="decimal" className={inputCls} value={other} aria-label="Other deductions" onChange={(e) => setOther(e.target.value)} />
                </div>
              ) : (
                <p className="col-span-2 text-xs leading-relaxed text-[var(--dim)]">
                  Other deductions are itemized in the lines below — their total is this check&apos;s other deductions, so there&apos;s no second lump figure to fill in. The tax withheld stays in the two fields above; the lines are never tax.
                </p>
              )}
              {!isForm && <DeductionLinesEditor lines={dedLines} onChange={setDedLines} idPrefix="pay" />}
            </>
          )}
          {kind === "1099" && (
            <>
              <TaxNotApplicableNote />
              {!isForm && <DeductionLinesEditor lines={dedLines} onChange={setDedLines} idPrefix="pay" />}
            </>
          )}
          {!isForm && (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="pay-perdiem">Per diem (non-taxable — paid separately)</label>
              <input id="pay-perdiem" type="number" inputMode="decimal" className={inputCls} value={perDiemAmt} aria-label="Per diem amount, non-taxable, paid separately" placeholder="0.00" onChange={(e) => setPerDiemAmt(e.target.value)} />
            </div>
          )}
          {isForm && (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="pay-taxyear">Tax year on the form</label>
              <input id="pay-taxyear" type="number" className={inputCls} value={taxYear} aria-label="Tax year printed on the form" onChange={(e) => setTaxYear(e.target.value)} />
            </div>
          )}
        </div>
        {!isForm ? (
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            Per diem is the non-taxable amount paid on a separate check — on many per-mile stubs the printed gross is what's left after per diem was taken out. Log it here so your totals match what you actually received; it never counts as taxable gross.
          </p>
        ) : (
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            No per-diem field on a year-end form — that's on purpose: a form never carries per diem, because per diem was paid separately along the way. It isn't lost — log it on each paycheck above (form box unticked) and your totals and “total received” lines include it. This form entry stays per-diem-free so its numbers tie exactly to the printed form.
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
            📷 {isForm ? "Form photo" : "Pay stub photo"}
            <input type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Upload a pay stub or form photo" onChange={(e) => void onStub(e)} />
          </label>
          {stub && <span className="text-xs font-semibold text-emerald-300">Photo attached ✓</span>}
          <button
            type="button"
            disabled={busy || !payer.trim() || !(num(gross) > 0)}
            className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
            aria-label="Log this pay entry sealed"
            onClick={() => {
              setBusy(true);
              void api.logPayEntry({
                kind, isForm, payer: payer.trim(),
                paidAt: new Date(`${date}T12:00:00`).toISOString(),
                taxYear: isForm ? (parseInt(taxYear, 10) || null) : null,
                gross: num(gross),
                federalWithheld: kind === "w2" ? num(fed) : 0,
                stateWithheld: kind === "w2" ? num(st) : 0,
                otherDeductions: kind === "w2" ? num(other) : 0,
                deductionLines: !isForm ? cleanDeductionLines(dedLines) : [],
                perDiem: isForm ? 0 : num(perDiemAmt),
                notes: null,
                stubDataBase64: stub?.base64 ?? null,
                stubMime: stub?.mime ?? null,
              })
                .then((res) => {
                  setBanner((isForm ? `Year-end ${kind === "w2" ? "W-2" : "1099"} form logged & sealed — tied to the ${kind === "w2" ? "W-2" : "1099"} pile.` : `Pay logged & sealed — ${kind === "w2" ? "W-2" : "1099"} ${money(num(gross))} from ${payer.trim()}.`) + stubEmailNote(res.stubEmail));
                  setPayer(""); setGross(""); setFed(""); setSt(""); setOther(""); setDedLines([]); setPerDiemAmt(""); setStub(null); setIsForm(false);
                  void queryClient.invalidateQueries({ queryKey: ["pay-entries"] });
                  void queryClient.invalidateQueries({ queryKey: ["pay-book"] });
                  void queryClient.invalidateQueries({ queryKey: ["pay-book-ytd"] });
                  void queryClient.invalidateQueries({ queryKey: ["pay-stub-email-deliveries"] });
                })
                .catch(() => setBanner("Couldn't log that pay entry — try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Sealing…" : isForm ? "Log form — sealed" : "Log pay — sealed"}
          </button>
        </div>
      </div>
      <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-3" aria-label="Stubs from your company">
        <h3 className="font-condensed text-lg font-bold">📥 From your company</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
          Stubs your company sends land here — before payday, in the app. Accept files the stub into your Pay Book; flag it if the numbers look wrong and your company sees why. The send itself is never emailed. An email copy goes out only when YOU accept and your pay-stub email copies are turned on (see the status card at the top of this book) — otherwise the sealed record lives here, in-app only.
        </p>
        {inbox.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">Checking for stubs from your company…</p>}
        {!inbox.isLoading && received.length === 0 && (
          <p className="mt-2 text-sm text-[var(--dim)]">Nothing from your company yet — when your owner or dispatch sends you a stub, it shows up here ahead of payday.</p>
        )}
        <div className="mt-2 space-y-2">
          {received.map((d) => {
            const isFormDelivery = d.deliveryType === "form";
            const stubFileName = `paystub-${d.kind}-${d.paidAt.slice(0, 10)}.${d.stubMime === "image/png" ? "png" : "jpg"}`;
            return (
              <div key={d.id} className="rounded-xl bg-[var(--surface)] px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <strong>{d.kind === "w2" ? "W-2" : "1099"}</strong>
                    {isFormDelivery ? " · YEAR-END FORM" : " · PAY STUB"} · {d.companyName} · <strong>{money(d.gross)}</strong>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${d.status === "sent" ? "bg-[var(--accent)] text-black" : d.status === "accepted" ? "bg-emerald-900/60 text-emerald-300" : "bg-amber-900/60 text-amber-200"}`}>
                    {d.status === "sent" ? "Waiting on you" : d.status === "accepted" ? "In your Pay Book ✓" : "Flagged"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--dim)]">
                  From @{d.senderUsername} · {isFormDelivery ? "received" : "pay date"} {new Date(d.paidAt).toLocaleDateString()}
                  {isFormDelivery ? ` · tax year ${d.taxYear ?? "—"}` : d.kind === "w2" ? ` · withheld ${money(d.federalWithheld + d.stateWithheld)}` : ""}
                  {!isFormDelivery && d.perDiem > 0 ? ` · per diem ${money(d.perDiem)} (non-taxable — paid separately)` : ""}
                  {d.hasStub ? " · stub file sealed" : " · no stub file attached"}
                  {d.stubSha256 ? ` · fingerprint ${d.stubSha256.slice(0, 12)}…` : ""}
                  {` · sent ${new Date(d.sentAt).toLocaleDateString()}`}
                </p>
                {d.kind === "1099" && !isFormDelivery && <DeductionLinesList lines={d.deductionLines} total={d.otherDeductions} />}
                {d.notes && <p className="mt-1 text-xs">{d.notes}</p>}
                {d.status === "flagged" && d.flagReason && <p className="mt-1 text-xs font-semibold text-amber-200">You flagged: “{d.flagReason}” — your company can see this.</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {d.hasStub && (
                    <button
                      type="button"
                      className="btn-press rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                      aria-label={`View the stub file from ${d.companyName} of ${money(d.gross)}`}
                      onClick={() => void api.getPayStubFile({ id: d.id }).then((r) => { if (r.url) setStubView({ url: r.url, mime: r.mime, name: stubFileName }); else setBanner("That stub file couldn't be opened."); })}
                    >
                      🧾 Stub file
                    </button>
                  )}
                  {d.status === "sent" && (
                    <>
                      <button
                        type="button"
                        disabled={inboxBusy === d.id}
                        className="btn-neon btn-press rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
                        aria-label={`Accept the ${d.kind === "w2" ? "W-2" : "1099"} stub from ${d.companyName} of ${money(d.gross)} into my Pay Book`}
                        onClick={() => {
                          setInboxBusy(d.id);
                          void api.acceptPayStub({ id: d.id })
                            .then((r) => {
                              if (r.ok) {
                                setBanner((isFormDelivery ? `Form filed & sealed — tied to the ${d.kind === "w2" ? "W-2" : "1099"} pile (forms never add to the pay totals).` : `Stub filed into your Pay Book & sealed — ${money(d.gross)} from ${d.companyName}, counted by its pay date.`) + stubEmailNote(r.stubEmail));
                                void queryClient.invalidateQueries({ queryKey: ["received-stubs"] });
                                void queryClient.invalidateQueries({ queryKey: ["pay-entries"] });
                                void queryClient.invalidateQueries({ queryKey: ["pay-book"] });
                                void queryClient.invalidateQueries({ queryKey: ["pay-book-ytd"] });
                                void queryClient.invalidateQueries({ queryKey: ["pay-stub-email-deliveries"] });
                              } else setBanner(r.error ?? "That accept didn't go through.");
                            })
                            .catch(() => setBanner("That accept didn't go through — try again."))
                            .finally(() => setInboxBusy(null));
                        }}
                      >
                        {inboxBusy === d.id ? "Filing…" : "✓ Accept — file it in my Pay Book"}
                      </button>
                      <button
                        type="button"
                        className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-xs font-bold"
                        aria-label={`Flag the stub from ${d.companyName} of ${money(d.gross)} as wrong`}
                        aria-expanded={flagFor === d.id}
                        onClick={() => { setFlagFor(flagFor === d.id ? null : d.id); setFlagText(""); }}
                      >
                        ⚠ Flag it
                      </button>
                    </>
                  )}
                </div>
                {d.status === "sent" && flagFor === d.id && (
                  <div className="mt-2">
                    <label className={labelCls} htmlFor={`stub-flag-${d.id}`}>What looks wrong?</label>
                    <input
                      id={`stub-flag-${d.id}`}
                      className={inputCls}
                      value={flagText}
                      maxLength={300}
                      aria-label="Why this stub looks wrong"
                      placeholder="e.g. Gross is short a load — $180 missing"
                      onChange={(e) => setFlagText(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={inboxBusy === d.id || !flagText.trim()}
                      className="btn-press mt-2 rounded-lg bg-amber-900/60 px-3 py-2 text-xs font-bold text-amber-200 disabled:opacity-50"
                      aria-label="Send this flag to my company"
                      onClick={() => {
                        setInboxBusy(d.id);
                        void api.flagPayStub({ id: d.id, reason: flagText.trim() })
                          .then((r) => {
                            if (r.ok) {
                              setBanner("Flagged & sealed — your company sees the flag and your reason. Nothing was filed into your Pay Book.");
                              setFlagFor(null);
                              setFlagText("");
                              void queryClient.invalidateQueries({ queryKey: ["received-stubs"] });
                            } else setBanner(r.error ?? "That flag didn't go through.");
                          })
                          .catch(() => setBanner("That flag didn't go through — try again."))
                          .finally(() => setInboxBusy(null));
                      }}
                    >
                      {inboxBusy === d.id ? "Flagging…" : "Send flag — no entry filed"}
                    </button>
                  </div>
                )}
                <StubShareButton
                  title={`${d.kind === "w2" ? "W-2" : "1099"} ${isFormDelivery ? "form" : "pay stub"} — ${d.companyName} — ${money(d.gross)}`}
                  textFilename={`stonemiles-paystub-${d.kind}-${d.paidAt.slice(0, 10)}.txt`}
                  stubFilename={stubFileName}
                  setBanner={setBanner}
                  fetchFile={() => api.getPayStubFile({ id: d.id })}
                  buildText={() => stubSummaryText({
                    kind: d.kind as "w2" | "1099",
                    isForm: isFormDelivery,
                    payer: d.companyName,
                    paidAt: d.paidAt,
                    taxYear: d.taxYear,
                    gross: d.gross,
                    federalWithheld: d.federalWithheld,
                    stateWithheld: d.stateWithheld,
                    otherDeductions: d.otherDeductions,
                    deductionLines: d.deductionLines,
                    perDiem: d.perDiem,
                    hasStub: d.hasStub,
                    sourceNote: `Sent by ${d.companyName} (@${d.senderUsername}) in STONEMILES on ${new Date(d.sentAt).toLocaleDateString()} — sealed in the app, not sent by email.`,
                  })}
                />
              </div>
            );
          })}
        </div>
      </div>
      <StubFileView view={stubView} onClose={() => setStubView(null)} />
      <div className="mt-3 grid grid-cols-5 gap-1 rounded-2xl bg-[var(--surface2)] p-1" role="tablist" aria-label="Pay book period">
        {PAY_PERIODS.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={period === p.key} aria-label={`Show ${p.label} pay view`} onClick={() => setPeriod(p.key)} className={`btn-press rounded-xl py-2 text-xs font-bold ${period === p.key ? "btn-neon" : "text-[var(--dim)]"}`}>{p.label}</button>
        ))}
      </div>
      {pb && (
        <>
          {!pb.hasData && <p className="mt-3 text-sm text-[var(--dim)]">No pay logged yet. Every paycheck — W-2 job or 1099 contract work — gets logged once below, tagged with its kind. Your totals build from your own entries only.</p>}
          {pb.hasData && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="min-w-0 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--dim)]">W-2 total · {pb.w2.count} paycheck(s)</div>
                  <div className="font-condensed text-2xl font-bold">{money(pb.w2.gross)}</div>
                  <div className="text-[11px] text-[var(--dim)]">withheld {money(pb.w2.totalWithheld)} (federal {money(pb.w2.federalWithheld)} · state {money(pb.w2.stateWithheld)})</div>
                  {pb.w2.perDiemTotal > 0 && (
                    <>
                      <div className="mt-1 text-[11px] text-[var(--dim)]">per diem (non-taxable — paid separately) {money(pb.w2.perDiemTotal)}</div>
                      <div className="text-[11px] font-semibold">total received {money(pb.w2.totalReceived)}</div>
                    </>
                  )}
                </div>
                <div className="min-w-0 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--dim)]">1099 total · {pb.ten99.count} payment(s)</div>
                  <div className="font-condensed text-2xl font-bold">{money(pb.ten99.gross)}</div>
                  <div className="text-[11px] text-[var(--dim)]">no tax withheld — taxes are not applicable on 1099 pay</div>
                  {pb.ten99.otherDeductions > 0 && (
                    <div className="mt-1 text-[11px] text-[var(--dim)]">
                      deductions on the stubs {money(pb.ten99.otherDeductions)}
                      {pb.ten99.deductionLines.length ? ` (${pb.ten99.deductionLines.map((l) => `${l.label} ${money(l.amount)}`).join(" · ")})` : ""} · total received {money(pb.ten99.totalReceived)}
                    </div>
                  )}
                  {pb.ten99.perDiemTotal > 0 && (
                    <>
                      <div className="mt-1 text-[11px] text-[var(--dim)]">per diem (non-taxable — paid separately) {money(pb.ten99.perDiemTotal)}</div>
                      <div className="text-[11px] font-semibold">total received {money(pb.ten99.totalReceived)}</div>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-[var(--dim)]">Combined tracking total</div>
                <div className="font-condensed text-2xl font-bold neon-text">{money(pb.combinedGross)}</div>
                <div className="text-[11px] text-[var(--dim)]">W-2 gross + 1099 gross — for keeping up, not a filing number. The two piles file separately.</div>
                {pb.combinedPerDiem > 0 && (
                  <div className="mt-1 text-[11px] text-[var(--dim)]">
                    Per diem (non-taxable — paid separately): {money(pb.combinedPerDiem)} · <span className="font-semibold text-[var(--text)]">total received {money(pb.combinedTotalReceived)}</span> — real earnings for keeping up; per diem is never in a filing gross.
                  </div>
                )}
              </div>
              {(pb.w2.byPayer.length > 0 || pb.ten99.byPayer.length > 0) && (
                <div className="mt-2 space-y-1">
                  {pb.w2.byPayer.map((p) => <p key={`w2-${p.payer}`} className="text-sm">W-2 · {p.payer}: <strong>{money(p.gross)}</strong> <span className="text-xs text-[var(--dim)]">({p.count} · withheld {money(p.federalWithheld + p.stateWithheld)})</span></p>)}
                  {pb.ten99.byPayer.map((p) => <p key={`99-${p.payer}`} className="text-sm">1099 · {p.payer}: <strong>{money(p.gross)}</strong> <span className="text-xs text-[var(--dim)]">({p.count})</span></p>)}
                </div>
              )}
              {(pb.forms.w2.length > 0 || pb.forms.ten99.length > 0) && (
                <div className="mt-2">
                  <h3 className="font-condensed text-lg font-bold">Year-end forms on file</h3>
                  {pb.forms.w2.map((f, i) => <p key={`fw-${i}`} className="text-sm">📄 W-2 form · {f.payer} · tax year {f.taxYear ?? "—"} · gross as printed <strong>{money(f.gross)}</strong></p>)}
                  {pb.forms.ten99.map((f, i) => <p key={`f9-${i}`} className="text-sm">📄 1099 form · {f.payer} · tax year {f.taxYear ?? "—"} · gross as printed <strong>{money(f.gross)}</strong></p>)}
                  <p className="text-xs text-[var(--dim)]">Forms tie to their pile for your preparer to compare against the logged paychecks — they are never added into the pay totals (the paychecks already counted that money).</p>
                </div>
              )}
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">{pb.note}</p>
              <h3 className="mt-3 font-condensed text-lg font-bold">Tax packets — filed separately</h3>
              <p className="text-xs text-[var(--dim)]">Two packets, one per pile. STONEMILES organizes paperwork — it does not file taxes.</p>
              <XBar label={`Pay Book W-2 packet (${period})`} filename={`stonemiles-paybook-w2-${period}.txt`} setBanner={setBanner} resolve={w2Packet} />
              <XBar label={`Pay Book 1099 packet (${period})`} filename={`stonemiles-paybook-1099-${period}.txt`} setBanner={setBanner} resolve={p1099Packet} />
            </>
          )}
        </>
      )}
      <div id="pay-book-ytd-pie" className="mt-4 scroll-mt-4 border-t border-[var(--border)] pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-condensed text-lg font-bold">📊 Year-to-Date pies — one per lane</h3>
          <label className="flex items-center gap-2 text-sm font-semibold">
            Year
            <select
              className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-sm font-bold text-[var(--text)]"
              value={ytdYear}
              aria-label="Year for the year-to-date lane pies"
              onChange={(e) => setYtdYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
            >
              {[...new Set([new Date().getFullYear(), ytdYear, ...(ytd.data?.availableYears ?? [])])].sort((a, b) => b - a).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
          {ytdYear === new Date().getFullYear() ? `${ytdYear} so far (year to date).` : `The full year ${ytdYear}.`} W-2 and 1099 are separate lanes — each gets its OWN pie, and the two are never mixed into one pie or one total. Tracking view only: the piles below stay separate and file separately. Per diem rides its own slice in each lane — non-taxable, paid separately, never part of that lane&apos;s filing gross.
        </p>
        {ytd.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">Building your {ytdYear} lane pies…</p>}
        {ytd.data && (
          <>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <YtdLanePie
                title="W-2 lane"
                count={ytd.data.w2.count}
                grossLabel="W-2 gross"
                grossColor="#f5b93f"
                lane={ytd.data.w2}
                year={ytdYear}
                deductionsNote={`This lane's deductions are the tax withheld (federal ${money(ytd.data.w2.federalWithheld)} · state ${money(ytd.data.w2.stateWithheld)}) plus other deductions ${money(ytd.data.w2.otherDeductions)} — money that already came out of the W-2 gross slice.`}
              />
              <YtdLanePie
                title="1099 lane"
                count={ytd.data.ten99.count}
                grossLabel="1099 gross"
                grossColor="#3ddc84"
                lane={ytd.data.ten99}
                year={ytdYear}
                deductionsNote="This lane's deductions are the itemized amounts that came off the 1099 stubs before the pay reached you — never tax; no tax is withheld from 1099 pay."
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">{ytd.data.note}</p>
          </>
        )}
        {!ytd.isLoading && !ytd.data && <p className="mt-2 text-sm text-[var(--dim)]">The lane pies couldn&apos;t load — your logged pay below is unaffected.</p>}
      </div>
      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <h3 className="font-condensed text-lg font-bold">Logged pay — newest first</h3>
        <div className="mt-3 space-y-1.5">
          {entries.slice(0, 10).map((e) => (
            <div key={e.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <strong>{e.kind === "w2" ? "W-2" : "1099"}</strong>{e.isForm ? " · FORM" : ""} · {e.payer} · <strong>{money(e.gross)}</strong>{" "}
                  <span className="text-xs text-[var(--dim)]">
                    {new Date(e.paidAt).toLocaleDateString()}
                    {e.isForm ? ` · tax year ${e.taxYear ?? "—"}` : e.kind === "w2" ? ` · withheld ${money(e.federalWithheld + e.stateWithheld)}` : ""}
                    {e.hasStub ? " · photo sealed" : ""}
                  </span>
                  {e.source === "company" && <span className="ml-1 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold">🏢 Company-sent</span>}
                </span>
                <button type="button" className="shrink-0 text-xs font-bold underline" aria-label={`Delete ${e.kind === "w2" ? "W-2" : "1099"} entry from ${e.payer} of ${money(e.gross)}`} onClick={() => void api.deletePayEntry({ id: e.id }).then(() => { void queryClient.invalidateQueries({ queryKey: ["pay-entries"] }); void queryClient.invalidateQueries({ queryKey: ["pay-book"] }); void queryClient.invalidateQueries({ queryKey: ["pay-book-ytd"] }); })}>Delete</button>
              </div>
              {!e.isForm && e.perDiem > 0 && (
                <p className="mt-0.5 text-xs text-[var(--dim)]">Per diem (non-taxable — paid separately): <strong className="text-[var(--text)]">{money(e.perDiem)}</strong> · total received {money(e.gross - e.federalWithheld - e.stateWithheld - e.otherDeductions + e.perDiem)}</p>
              )}
              {!e.isForm && <DeductionLinesList lines={e.deductionLines} total={e.otherDeductions} packetName={e.kind === "w2" ? "W-2 packet" : "1099 packet"} />}
              {e.kind === "w2" && !e.isForm && e.deductionLines.length === 0 && e.otherDeductions > 0 && (
                <p className="mt-0.5 text-xs text-[var(--dim)]">Other deductions: <strong className="text-[var(--text)]">{money(e.otherDeductions)}</strong> (logged as one lump figure — itemize it with Edit deductions below)</p>
              )}
              {!e.isForm && (
                editDedFor === e.id ? (
                  <div className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2.5">
                    <DeductionLinesEditor lines={editDedLines} onChange={setEditDedLines} idPrefix={`edit-${e.id}`} />
                    <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                      These lines are this entry&apos;s deductions in the {e.kind === "w2" ? "W-2" : "1099"} lane — their total replaces the entry&apos;s other-deductions figure and feeds that lane&apos;s Year-to-Date pie. Tax withheld is separate and is never edited here.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={editDedBusy}
                        className="btn-neon btn-press rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
                        aria-label={`Save the edited deduction lines on the ${e.kind === "w2" ? "W-2" : "1099"} entry from ${e.payer} of ${money(e.gross)}`}
                        onClick={() => {
                          setEditDedBusy(true);
                          void api.updatePayEntryDeductions({ id: e.id, deductionLines: cleanDeductionLines(editDedLines) })
                            .then((r) => {
                              if (r.ok) {
                                setBanner(`Deductions updated & sealed — ${money(r.otherDeductions ?? 0)} itemized on the ${e.kind === "w2" ? "W-2" : "1099"} entry from ${e.payer}. That lane's totals and Year-to-Date pie now use the lines.`);
                                setEditDedFor(null);
                                void queryClient.invalidateQueries({ queryKey: ["pay-entries"] });
                                void queryClient.invalidateQueries({ queryKey: ["pay-book"] });
                                void queryClient.invalidateQueries({ queryKey: ["pay-book-ytd"] });
                              } else setBanner(r.error ?? "Those deductions didn't save.");
                            })
                            .catch(() => setBanner("Those deductions didn't save — try again."))
                            .finally(() => setEditDedBusy(false));
                        }}
                      >
                        {editDedBusy ? "Sealing…" : "Save deductions — sealed"}
                      </button>
                      <button
                        type="button"
                        className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-xs font-bold"
                        aria-label="Cancel editing these deductions"
                        onClick={() => setEditDedFor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-bold"
                      aria-label={`${e.deductionLines.length || e.otherDeductions > 0 ? "Edit" : "Add"} the itemized deductions on the ${e.kind === "w2" ? "W-2" : "1099"} entry from ${e.payer} of ${money(e.gross)}`}
                      onClick={() => openDedEditor(e)}
                    >
                      ✏️ {e.deductionLines.length || e.otherDeductions > 0 ? "Edit deductions" : "Add deductions"}
                    </button>
                  </div>
                )
              )}
              <StubShareButton
                title={`${e.kind === "w2" ? "W-2" : "1099"} ${e.isForm ? "form" : "pay stub"} — ${e.payer} — ${money(e.gross)}`}
                textFilename={`stonemiles-paystub-${e.kind}-${e.paidAt.slice(0, 10)}.txt`}
                stubFilename={`paystub-${e.kind}-${e.paidAt.slice(0, 10)}.jpg`}
                setBanner={setBanner}
                fetchFile={() => api.getPayEntryStubFile({ id: e.id })}
                buildText={() => stubSummaryText({
                  kind: e.kind as "w2" | "1099",
                  isForm: e.isForm,
                  payer: e.payer,
                  paidAt: e.paidAt,
                  taxYear: e.taxYear,
                  gross: e.gross,
                  federalWithheld: e.federalWithheld,
                  stateWithheld: e.stateWithheld,
                  otherDeductions: e.otherDeductions,
                  deductionLines: e.deductionLines,
                  perDiem: e.perDiem,
                  hasStub: e.hasStub,
                  sourceNote: e.source === "company" ? "This stub was sent by the company in STONEMILES and accepted into the driver's Pay Book — sealed in the app, not sent by email." : null,
                })}
              />
            </div>
          ))}
          {entries.length === 0 && !list.isLoading && <p className="text-xs text-[var(--dim)]">Nothing in the Pay Book yet — your logged paychecks land here, newest first.</p>}
        </div>
      </div>
    </Section>
  );
}

// ---------- B3) Pay stubs — Owner Console send desk -----------------------------
// Owner/Dispatch sends a driver in their OWN company a W-2 stub, 1099
// stub, or the year-end form itself — in-app, before payday, instead
// of email. The roster comes from listSentStubs (server-scoped to the
// sender's company); the sent list shows each delivery's status, and a
// flagged stub shows the driver's reason — the mismatch path. Sending
// itself is in-app only and never emails anyone; an email copy exists
// only as the DRIVER's opt-in on their side, fired when they accept
// the stub into their Pay Book (pay-stub toggle, default OFF).

export function PayStubSendPanel({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["sent-stubs"], queryFn: () => api.listSentStubs({}) });
  const roster = q.data?.roster ?? [];
  const deliveries = q.data?.deliveries ?? [];
  const [recipient, setRecipient] = useState("");
  const [kind, setKind] = useState<"w2" | "1099">("w2");
  const [deliveryType, setDeliveryType] = useState<"stub" | "form">("stub");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [gross, setGross] = useState("");
  const [fed, setFed] = useState("");
  const [st, setSt] = useState("");
  const [other, setOther] = useState("");
  const [sendDedLines, setSendDedLines] = useState<DedLineDraft[]>([]);
  const [stubPerDiem, setStubPerDiem] = useState("");
  const [taxYear, setTaxYear] = useState(() => String(new Date().getFullYear()));
  const [notes, setNotes] = useState("");
  const [stub, setStub] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stubView, setStubView] = useState<{ url: string; mime: string | null; name: string } | null>(null);
  const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const isForm = deliveryType === "form";
  const chip = (status: string) =>
    status === "sent"
      ? "bg-[var(--accent)] text-black"
      : status === "accepted"
        ? "bg-emerald-900/60 text-emerald-300"
        : status === "flagged"
          ? "bg-amber-900/60 text-amber-200"
          : "bg-[var(--surface)] text-[var(--dim)]";

  if (q.data && !q.data.canView) {
    return (
      <section className="glass-panel p-4" aria-label="Send pay stubs">
        <h3 className="font-condensed text-xl font-semibold">Send pay stubs</h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">{q.data.note}</p>
      </section>
    );
  }
  return (
    <div className="space-y-4">
      <section className="glass-panel p-4" aria-label="Send a pay stub">
        <h3 className="font-condensed text-xl font-semibold">Send a stub</h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Sent in STONEMILES, not by email — the sealed record lives here. Send it before payday if you like; the pay date on the stub is what the driver's totals follow. The driver accepts it into their Pay Book, or flags it if the numbers look wrong. (If that driver has turned pay-stub email copies on in their own Document copies settings, accepting also emails them a copy — that's their opt-in, never the send.)
        </p>
        <div className="mt-3 grid max-w-2xl grid-cols-2 gap-2">
          <div className="col-span-2 min-w-0">
            <label className={labelCls} htmlFor="stub-recipient">Driver (your roster)</label>
            <select id="stub-recipient" className={inputCls} value={recipient} aria-label="Driver to send this stub to" onChange={(e) => setRecipient(e.target.value)}>
              <option value="">Pick a driver…</option>
              {roster.map((r) => (
                <option key={r.username} value={r.username}>@{r.username}</option>
              ))}
            </select>
            {roster.length === 0 && !q.isLoading && <p className="mt-1 text-xs text-[var(--dim)]">No drivers on your roster yet — add drivers in Drivers first; stubs can only go to your own roster.</p>}
          </div>
          <div className="col-span-2">
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[var(--surface2)] p-1" role="group" aria-label="Stub kind">
              {(["w2", "1099"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} aria-label={`Stub kind ${k === "w2" ? "W-2" : "1099"}`} onClick={() => setKind(k)} className={`btn-press rounded-xl py-2 text-sm font-bold ${kind === k ? "btn-neon" : "text-[var(--dim)]"}`}>{k === "w2" ? "W-2 — employer job" : "1099 — contract work"}</button>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1 rounded-2xl bg-[var(--surface2)] p-1" role="group" aria-label="Stub or year-end form">
              {(["stub", "form"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={deliveryType === t} aria-label={t === "stub" ? "A paycheck stub" : "The year-end form itself"} onClick={() => setDeliveryType(t)} className={`btn-press rounded-xl py-2 text-sm font-bold ${deliveryType === t ? "btn-neon" : "text-[var(--dim)]"}`}>{t === "stub" ? "Pay stub" : `Year-end ${kind === "w2" ? "W-2" : "1099"} form`}</button>
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--dim)]">{isForm ? "A form files as the year-end form in the driver's Pay Book — it ties to the pile and never adds to the pay totals (the paychecks already counted that money)." : "A pay stub files as a paycheck in the driver's Pay Book, counted by its pay date."}</p>
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="stub-date">{isForm ? "Date sent / received" : "Pay date"}</label>
            <input id="stub-date" type="date" className={inputCls} value={date} aria-label="Stub pay date" onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="stub-gross">Gross pay ($)</label>
            <input id="stub-gross" type="number" inputMode="decimal" className={inputCls} value={gross} aria-label="Stub gross pay amount" onChange={(e) => setGross(e.target.value)} />
          </div>
          {kind === "w2" && (
            <>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="stub-fed">Federal withheld ($)</label>
                <input id="stub-fed" type="number" inputMode="decimal" className={inputCls} value={fed} aria-label="Stub federal tax withheld" onChange={(e) => setFed(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="stub-state">State withheld ($)</label>
                <input id="stub-state" type="number" inputMode="decimal" className={inputCls} value={st} aria-label="Stub state tax withheld" onChange={(e) => setSt(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="stub-other">Other deductions ($)</label>
                <input id="stub-other" type="number" inputMode="decimal" className={inputCls} value={other} aria-label="Stub other deductions" onChange={(e) => setOther(e.target.value)} />
              </div>
            </>
          )}
          {kind === "1099" && (
            <>
              <TaxNotApplicableNote />
              {!isForm && <DeductionLinesEditor lines={sendDedLines} onChange={setSendDedLines} idPrefix="stub" />}
            </>
          )}
          {!isForm && (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="stub-perdiem">Per diem (non-taxable — paid separately)</label>
              <input id="stub-perdiem" type="number" inputMode="decimal" className={inputCls} value={stubPerDiem} aria-label="Stub per diem amount, non-taxable, paid separately" placeholder="0.00" onChange={(e) => setStubPerDiem(e.target.value)} />
            </div>
          )}
          {isForm && (
            <div className="min-w-0">
              <label className={labelCls} htmlFor="stub-taxyear">Tax year on the form</label>
              <input id="stub-taxyear" type="number" className={inputCls} value={taxYear} aria-label="Tax year printed on the form" onChange={(e) => setTaxYear(e.target.value)} />
            </div>
          )}
          <div className="col-span-2 min-w-0">
            <label className={labelCls} htmlFor="stub-notes">Note for the driver (optional)</label>
            <input id="stub-notes" className={inputCls} value={notes} maxLength={300} aria-label="Note for the driver" placeholder="e.g. Week of Oct 19 — includes the detention pay" onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {isForm && (
          <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
            No per-diem field on a year-end form — that's on purpose: forms never carry per diem, because it was paid separately along the way. Send per diem with each pay stub instead; the driver logs it there and it rides into their totals.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
            📷 {isForm ? "Form photo" : "Stub photo"}
            <input
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              aria-label="Upload the stub or form photo"
              onChange={(e) => void photoToBase64(e).then((p) => { if (p) { setStub(p); setBanner("Photo attached — it seals behind this stub when you send it."); } else setBanner("Stub photo needs to be a JPEG or PNG image. For a PDF stub, send the numbers here and keep the PDF in the paperwork vault."); })}
            />
          </label>
          {stub && <span className="text-xs font-semibold text-emerald-300">Photo attached ✓</span>}
          <button
            type="button"
            disabled={busy || !recipient || !(num(gross) > 0)}
            className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
            aria-label="Send this stub to the driver in STONEMILES"
            onClick={() => {
              setBusy(true);
              void api.sendPayStub({
                recipientUsername: recipient,
                kind,
                deliveryType,
                paidAt: new Date(`${date}T12:00:00`).toISOString(),
                taxYear: isForm ? (parseInt(taxYear, 10) || null) : null,
                gross: num(gross),
                federalWithheld: kind === "w2" ? num(fed) : 0,
                stateWithheld: kind === "w2" ? num(st) : 0,
                otherDeductions: kind === "w2" ? num(other) : 0,
                deductionLines: kind === "1099" && !isForm ? cleanDeductionLines(sendDedLines) : [],
                perDiem: isForm ? 0 : num(stubPerDiem),
                notes: notes.trim() || null,
                stubDataBase64: stub?.base64 ?? null,
                stubMime: stub?.mime ?? null,
              })
                .then((r) => {
                  if (r.ok) {
                    setBanner(`Stub sent to @${recipient} in STONEMILES — sealed, not emailed. It lands in their Pay Book inbox ahead of payday.`);
                    setGross(""); setFed(""); setSt(""); setOther(""); setSendDedLines([]); setStubPerDiem(""); setNotes(""); setStub(null);
                    void queryClient.invalidateQueries({ queryKey: ["sent-stubs"] });
                  } else setBanner(r.error ?? "That send didn't go through.");
                })
                .catch(() => setBanner("That send didn't go through — try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Sending…" : "Send stub — sealed"}
          </button>
        </div>
      </section>
      <section className="glass-panel p-4" aria-label="Stubs you have sent">
        <h3 className="font-condensed text-xl font-semibold">Sent stubs</h3>
        {q.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">Loading your sent stubs…</p>}
        {!q.isLoading && deliveries.length === 0 && (
          <p className="mt-2 text-sm text-[var(--dim)]">No stubs sent yet — the first one you send shows up here with its status: waiting on the driver, in their Pay Book, or flagged with their reason.</p>
        )}
        <div className="mt-2 space-y-2">
          {deliveries.map((d) => {
            const fileName = `paystub-${d.kind}-${d.paidAt.slice(0, 10)}.${d.stubMime === "image/png" ? "png" : "jpg"}`;
            return (
              <div key={d.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <strong>@{d.recipientUsername}</strong> · <strong>{d.kind === "w2" ? "W-2" : "1099"}</strong>
                    {d.deliveryType === "form" ? " · YEAR-END FORM" : " · PAY STUB"} · <strong>{money(d.gross)}</strong>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${chip(d.status)}`}>
                    {d.status === "sent" ? "Sent" : d.status === "accepted" ? "Accepted ✓" : d.status === "flagged" ? "Flagged ⚠" : "Withdrawn"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--dim)]">
                  {d.deliveryType === "form" ? "received" : "pay date"} {new Date(d.paidAt).toLocaleDateString()}
                  {d.deliveryType === "form" ? ` · tax year ${d.taxYear ?? "—"}` : d.kind === "w2" ? ` · withheld ${money(d.federalWithheld + d.stateWithheld)}` : ""}
                  {d.deliveryType !== "form" && d.perDiem > 0 ? ` · per diem ${money(d.perDiem)} (non-taxable — paid separately)` : ""}
                  {d.hasStub ? " · stub file sealed" : ""}
                  {` · sent ${new Date(d.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} by @${d.senderUsername}`}
                  {d.respondedAt ? ` · answered ${new Date(d.respondedAt).toLocaleDateString()}` : ""}
                </p>
                {d.kind === "1099" && d.deliveryType !== "form" && <DeductionLinesList lines={d.deductionLines} total={d.otherDeductions} />}
                {d.notes && <p className="mt-1 text-xs">{d.notes}</p>}
                {d.status === "flagged" && d.flagReason && (
                  <p className="mt-1 rounded-lg bg-amber-900/40 px-2.5 py-2 text-xs font-semibold text-amber-200">Driver flagged: “{d.flagReason}” — that's the number to fix; send a corrected stub when it's sorted.</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.hasStub && (
                    <button
                      type="button"
                      className="btn-press rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                      aria-label={`View the stub file sent to ${d.recipientUsername} of ${money(d.gross)}`}
                      onClick={() => void api.getPayStubFile({ id: d.id }).then((r) => { if (r.url) setStubView({ url: r.url, mime: r.mime, name: fileName }); else setBanner("That stub file couldn't be opened."); })}
                    >
                      🧾 Stub file
                    </button>
                  )}
                  {d.status === "sent" && (
                    <button
                      type="button"
                      className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--danger)]"
                      aria-label={`Withdraw the stub sent to ${d.recipientUsername} of ${money(d.gross)}`}
                      onClick={() => void api.withdrawPayStub({ id: d.id }).then((r) => { setBanner(r.ok ? `Stub to @${d.recipientUsername} withdrawn — it left their inbox.` : (r.error ?? "That withdraw didn't go through.")); if (r.ok) void queryClient.invalidateQueries({ queryKey: ["sent-stubs"] }); })}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <StubFileView view={stubView} onClose={() => setStubView(null)} />
    </div>
  );
}

// ---------- C) Load Worth-It Advisor + Facility Memory -------------------------

export function AdvisorPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const [label, setLabel] = useState("");
  const [rate, setRate] = useState("");
  const [loaded, setLoaded] = useState("");
  const [deadhead, setDeadhead] = useState("");
  const [facility, setFacility] = useState("");
  const [detHours, setDetHours] = useState("");
  const [result, setResult] = useState<ApiResponse<typeof api, "scoreLoad"> | null>(null);
  const [busy, setBusy] = useState(false);
  const fac = useQuery({ queryKey: ["facility-visits"], queryFn: () => api.getFacilityVisits({ facility: null }) });
  return (
    <Section title={tt(lang, "money.advisor")} ariaLabel="Load worth-it advisor">
      <p className="text-sm text-[var(--dim)]">
        Before you book: scored against YOUR break-even, your deadhead, and your own sealed detention history at that facility. The math shows line by line — the decision stays yours.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className={labelCls} htmlFor="adv-label">Load label</label>
          <input id="adv-label" className={inputCls} value={label} aria-label="Load label for scoring" placeholder="e.g. Peacock Pavers — Mobile to Atlanta" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="adv-rate">Rate ($)</label>
          <input id="adv-rate" type="number" inputMode="decimal" className={inputCls} value={rate} aria-label="Load rate in dollars" onChange={(e) => setRate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="adv-fac">Facility / shipper</label>
          <input id="adv-fac" className={inputCls} value={facility} aria-label="Facility or shipper name" placeholder="Matches your detention history" onChange={(e) => setFacility(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="adv-loaded">Loaded miles</label>
          <input id="adv-loaded" type="number" inputMode="decimal" className={inputCls} value={loaded} aria-label="Loaded miles" onChange={(e) => setLoaded(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="adv-dh">Deadhead miles</label>
          <input id="adv-dh" type="number" inputMode="decimal" className={inputCls} value={deadhead} aria-label="Deadhead miles" onChange={(e) => setDeadhead(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelCls} htmlFor="adv-det">Expected detention past free time (hours, optional)</label>
          <input id="adv-det" type="number" inputMode="decimal" className={inputCls} value={detHours} aria-label="Expected detention hours past free time" placeholder="Blank = use your facility history" onChange={(e) => setDetHours(e.target.value)} />
        </div>
      </div>
      <button
        type="button"
        disabled={busy || !label.trim() || !(parseFloat(rate) > 0) || !(parseFloat(loaded) > 0)}
        className="btn-neon btn-press mt-3 w-full rounded-xl py-3 font-bold disabled:opacity-50"
        aria-label="Score this load"
        onClick={() => {
          setBusy(true);
          void api.scoreLoad({ label: label.trim(), rate: parseFloat(rate), loadedMiles: parseFloat(loaded), deadheadMiles: parseFloat(deadhead || "0") || 0, facility: facility.trim() || null, expectedDetentionHours: detHours ? parseFloat(detHours) : null, detentionRatePerHour: 50 })
            .then((r) => {
              if (r.locked) { setResult(null); setBanner(r.lines[0] ?? "The full Worth-It Advisor comes with Diamond Driver — nothing was scored or sealed."); return; }
              setResult(r); setBanner(`Scored & sealed: ${r.verdict.toUpperCase()} — estimated profit ${money(r.profit)}.`);
            })
            .catch(() => setBanner("Couldn't score that load — try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Scoring…" : "Score this load"}
      </button>
      {result && (
        <div className={`mt-3 rounded-2xl border px-3 py-3 ${result.verdict === "green" ? "border-emerald-500/50 bg-emerald-900/30" : result.verdict === "yellow" ? "border-amber-500/50 bg-amber-900/30" : "border-red-500/50 bg-red-900/30"}`} role="status" aria-label={`Load verdict ${result.verdict}`}>
          <div className="font-condensed text-2xl font-bold">{result.verdict === "green" ? "🟢 WORTH IT" : result.verdict === "yellow" ? "🟡 THIN — YOUR CALL" : "🔴 LOSES MONEY"}</div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
            {result.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          {result.detentionNote && <p className="mt-2 text-sm font-semibold">🏭 {result.detentionNote}</p>}
        </div>
      )}
      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <h3 className="font-condensed text-lg font-bold">{tt(lang, "extras.facilityTitle")}</h3>
        <p className="text-xs text-[var(--dim)]">{tt(lang, "extras.facilityOwnOnly")}</p>
        {groupVisitsByFacility(fac.data?.visits ?? []).length === 0 && <p className="mt-1 text-sm text-[var(--dim)]">{tt(lang, "extras.facilityNone")}</p>}
        {groupVisitsByFacility(fac.data?.visits ?? []).map((g) => (
          <div key={`${g.facility}|${g.site}`} className="mt-1.5 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <strong>{g.facility}</strong> ({g.site}) — {g.visits.length} visit{g.visits.length === 1 ? "" : "s"}, average dwell {g.avgDwellHours.toFixed(1)} h, average detention past free time {g.avgExcessHours.toFixed(1)} h.
            <span className="block text-xs text-[var(--dim)]">
              Last time ({new Date(g.last.departedAt).toLocaleDateString()}): dwell {g.last.dwellHours.toFixed(1)} h, detention past free time {g.last.excessHours.toFixed(1)} h
              {apptBehaviourLabel(g.last.apptDeltaMin) ? ` · ${apptBehaviourLabel(g.last.apptDeltaMin)}` : ""}
              {g.last.lumperFee != null ? ` · lumper ${money(g.last.lumperFee)}` : ""}
              {g.last.dockDoor ? ` · door ${g.last.dockDoor}` : ""}
            </span>
            {g.last.dockNote && <span className="block text-xs italic text-[var(--dim)]">Your check-in note: “{g.last.dockNote}”</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------- D) Settlement Checker ----------------------------------------------

type SettleLine = { label: string; amount: string; loadId: number | null };

export function SettlementPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const [carrier, setCarrier] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [lines, setLines] = useState<SettleLine[]>([{ label: "", amount: "", loadId: null }]);
  const [doc, setDoc] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["settlements"], queryFn: () => api.listSettlements({ limit: 20 }) });
  const loads = useQuery({ queryKey: ["loads-brief"], queryFn: () => api.listLoads({ limit: 50 }) });
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const p = await photoToBase64(e);
    if (!p) { setBanner("Settlement photo needs to be a JPEG or PNG image."); return; }
    setDoc(p);
    setBusy(true);
    try {
      const r = await api.extractMoneyDoc({ kind: "settlement", dataBase64: p.base64, mimeType: p.mime as "image/jpeg" | "image/png" });
      if (r.found) {
        if (r.carrier) setCarrier(r.carrier);
        if (r.periodLabel) setPeriodLabel(r.periodLabel);
        if (r.lines.length > 0) setLines(r.lines.map((l) => ({ label: l.label, amount: String(l.amount), loadId: null })));
        setBanner("Settlement read — match each line to a load where you can, fix anything wrong, then save & check it.");
      } else setBanner("That photo doesn't read as a settlement — it's attached; type the lines in.");
    } catch { setBanner("Couldn't read that settlement — type the lines in."); } finally { setBusy(false); }
  };
  return (
    <Section title={tt(lang, "money.settlementTitle")} ariaLabel="Settlement checker">
      <p className="text-sm text-[var(--dim)]">
        Import a settlement (photo or by hand) and it gets compared line-by-line against your sealed trips, loads, and detention logs. Underpayments and missing loads get flagged with amounts — the report is sealed and exportable for the carrier conversation.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls} htmlFor="stl-carrier">Carrier</label>
          <input id="stl-carrier" className={inputCls} value={carrier} aria-label="Settlement carrier" onChange={(e) => setCarrier(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="stl-period">Pay period</label>
          <input id="stl-period" className={inputCls} value={periodLabel} aria-label="Settlement pay period" placeholder="e.g. Oct 12–18" onChange={(e) => setPeriodLabel(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_96px] gap-2">
            <input className={inputCls} value={l.label} aria-label={`Settlement line ${i + 1} description`} placeholder="Line description (e.g. Load Mobile → Atlanta)" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className={inputCls} type="number" inputMode="decimal" value={l.amount} aria-label={`Settlement line ${i + 1} amount`} placeholder="$" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <select className={`${inputCls} col-span-2`} value={l.loadId ?? ""} aria-label={`Settlement line ${i + 1} matching load`} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, loadId: e.target.value ? parseInt(e.target.value, 10) : null } : x)))}>
              <option value="">Match to a load (optional, makes the check exact)</option>
              {(loads.data?.loads ?? []).map((ld) => (
                <option key={ld.id} value={ld.id}>Load #{ld.id} — {ld.pickupCity ?? "?"} → {ld.deliveryCity ?? "?"}{ld.rate != null ? ` · ${money(ld.rate)}` : ""}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-press rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold" aria-label="Add another settlement line" onClick={() => setLines([...lines, { label: "", amount: "", loadId: null }])}>＋ Add line</button>
        <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
          📷 Settlement photo
          <input type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Upload a settlement photo" onChange={(e) => void onPhoto(e)} />
        </label>
        {doc && <span className="self-center text-xs font-semibold text-emerald-300">Document attached ✓</span>}
      </div>
      <button
        type="button"
        disabled={busy || lines.every((l) => !l.label.trim() && !l.amount)}
        className="btn-neon btn-press mt-3 w-full rounded-xl py-3 font-bold disabled:opacity-50"
        aria-label="Save this settlement and run the check"
        onClick={() => {
          setBusy(true);
          const clean = lines.filter((l) => l.label.trim() || l.amount).map((l) => ({ label: l.label.trim() || "Line", amount: parseFloat(l.amount || "0") || 0, loadId: l.loadId }));
          const total = clean.reduce((s, l) => s + l.amount, 0);
          void api.saveSettlement({ carrier: carrier.trim() || null, periodLabel: periodLabel.trim() || null, gross: null, net: Math.round(total * 100) / 100, lines: clean, docDataBase64: doc?.base64 ?? null, docMime: doc?.mime ?? null })
            .then(async (r) => {
              if (r.error) { setBanner(r.error); return; }
              const chk = await api.checkSettlement({ id: r.id });
              setReport(chk.report);
              setBanner(chk.flags.length === 0 ? "Settlement checked & sealed — no mismatches found." : `Settlement checked & sealed — ${chk.flags.length} flag${chk.flags.length === 1 ? "" : "s"} found. The report is below.`);
              void queryClient.invalidateQueries({ queryKey: ["settlements"] });
            })
            .catch(() => setBanner("Couldn't save that settlement — try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Working…" : "Save & run the check — sealed"}
      </button>
      {report && (
        <div className="mt-3">
          <pre className="whitespace-pre-wrap rounded-2xl bg-[var(--surface2)] px-3 py-3 font-mono text-[13px] leading-relaxed">{report}</pre>
          <XBar label="Settlement check report" filename="stonemiles-settlement-check.txt" setBanner={setBanner} resolve={() => report} />
        </div>
      )}
      <div className="mt-3 space-y-1.5">
        {(list.data?.settlements ?? []).map((s) => (
          <div key={s.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span><strong>{s.carrier ?? "Carrier not named"}</strong> · {s.periodLabel ?? "period not labelled"} <span className="text-[var(--dim)]">({s.lines} lines, net {s.net != null ? money(s.net) : "—"})</span></span>
              <button type="button" className="shrink-0 text-xs font-bold underline" aria-label={`Re-run the check on settlement ${s.id}`} onClick={() => void api.checkSettlement({ id: s.id }).then((c) => { setReport(c.report); void queryClient.invalidateQueries({ queryKey: ["settlements"] }); })}>Re-check</button>
            </div>
            {s.checkReport ? <p className="mt-1 text-xs font-semibold">{s.checkFlags === 0 ? "✓ Last check: clean" : `⚠ Last check: ${s.checkFlags} flag${s.checkFlags === 1 ? "" : "s"}`} — open the report from the checker above after a re-check.</p> : <p className="mt-1 text-xs text-[var(--dim)]">Not checked yet.</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------- F) Verify-Anywhere + Passport + Merkle -------------------------------

export function VerifyPanel({ setBanner }: { setBanner: Banner }) {
  const [codeInput, setCodeInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<ApiResponse<typeof api, "verifyCode"> | null>(null);
  const [custodyResult, setCustodyResult] = useState<ApiResponse<typeof api, "checkCustody"> | null>(null);
  const [issued, setIssued] = useState<{ code: string; what: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const trips = useQuery({ queryKey: ["trips-brief"], queryFn: () => api.listTrips({ limit: 5 }) });
  const loads = useQuery({ queryKey: ["loads-brief"], queryFn: () => api.listLoads({ limit: 50 }) });
  const issue = (kind: "trip" | "load" | "pod" | "passport", refId: number | null, what: string) => {
    setBusy(true);
    void api.createVerifyCode({ kind, refId })
      .then((r) => { setIssued({ code: r.code, what }); setBanner(`Verify code issued for ${what}: ${r.code}. Anyone with the code or QR can confirm the record — no account needed.`); })
      .catch(() => setBanner("Couldn't issue a code — that record may not be sealed yet."))
      .finally(() => setBusy(false));
  };
  const latestTrip = trips.data?.trips[0];
  const sealedLoad = (loads.data?.loads ?? []).find((l) => l.podSealed);
  const anyLoad = loads.data?.loads[0];
  const qrText = issued ? `STONEMILES VERIFY ${issued.code}` : "";
  return (
    <Section title="🔗 Verify-Anywhere — blockchain proof anyone can check" ariaLabel="Verify anywhere">
      <p className="text-sm text-[var(--dim)]">
        Every sealed record can carry a short code + QR. A broker, receiver, or auditor enters the code — <strong className="text-[var(--text)]">no account, no login</strong> — and the sealed chain itself answers: genuine or tampered, what it is, and when. State-level detail only: no precise location, no wallet data, ever.
      </p>
      <div className="mt-3 grid gap-2">
        <button type="button" disabled={busy || !latestTrip} className="btn-press rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-3 text-left font-bold disabled:opacity-50" aria-label="Issue a verify code for my latest trip sheet" onClick={() => latestTrip && issue("trip", latestTrip.id, "latest trip sheet")}>
          🧾 Latest trip sheet {latestTrip ? `(${latestTrip.totalMiles.toFixed(1)} mi)` : "(none yet)"} — issue code
        </button>
        <button type="button" disabled={busy || !sealedLoad} className="btn-press rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-3 text-left font-bold disabled:opacity-50" aria-label="Issue a custody seal code for my latest sealed delivery" onClick={() => sealedLoad && issue("pod", sealedLoad.id, "sealed delivery")}>
          📦 Latest sealed delivery {sealedLoad ? `(Load #${sealedLoad.id})` : "(none sealed yet)"} — issue custody code
        </button>
        <button type="button" disabled={busy || !anyLoad} className="btn-press rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-3 text-left font-bold disabled:opacity-50" aria-label="Issue a verify code for my latest load record" onClick={() => anyLoad && issue("load", anyLoad.id, "load record")}>
          📋 Latest load record {anyLoad ? `(Load #${anyLoad.id})` : "(none yet)"} — issue code
        </button>
      </div>
      {issued && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl bg-[var(--surface2)] px-3 py-4 text-center">
          <Qr text={qrText} label={`QR code to verify ${issued.what}, code ${issued.code}`} />
          <div className="font-condensed text-3xl font-bold tracking-widest">{issued.code}</div>
          <p className="text-xs text-[var(--dim)]">{issued.what} · Show the QR or read the code out. The checker below is the same one anyone uses.</p>
          <XBar label={`Verify code for ${issued.what}`} filename="stonemiles-verify-code.txt" setBanner={setBanner} resolve={() => `STONEMILES — VERIFY-ANYWHERE\nRecord: ${issued.what}\nCode: ${issued.code}\nEnter the code in STONEMILES → Driver → Verify-Anywhere (no account needed) to confirm this record is genuine and untampered. State-level detail only — no precise location, no wallet data.`} />
        </div>
      )}
      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <h3 className="font-condensed text-lg font-bold">Check a code</h3>
        <div className="mt-2 flex gap-2">
          <input className={inputCls} value={codeInput} aria-label="Verify code to check" placeholder="SM-XXXXXX" onChange={(e) => setCodeInput(e.target.value.toUpperCase())} />
          <button type="button" className="btn-neon btn-press shrink-0 rounded-xl px-4 font-bold" aria-label="Verify this code against the sealed chain" onClick={() => void api.verifyCode({ code: codeInput }).then(setVerifyResult).catch(() => setBanner("Verify failed — try again."))}>Verify</button>
          <button type="button" className="btn-press shrink-0 rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 font-bold" aria-label="Check this code as a delivery custody seal" onClick={() => void api.checkCustody({ code: codeInput }).then(setCustodyResult).catch(() => setBanner("Custody check failed — try again."))}>Custody</button>
        </div>
        {verifyResult && (
          <div className={`mt-2 rounded-2xl border px-3 py-3 ${verifyResult.genuine ? "border-emerald-500/50 bg-emerald-900/30" : "border-red-500/50 bg-red-900/30"}`} role="status" aria-label="Verification result">
            <div className="font-condensed text-xl font-bold">{verifyResult.found ? (verifyResult.genuine ? "✓ GENUINE — untampered" : "✗ NOT VERIFIED") : "Code not found"}</div>
            <p className="mt-1 text-sm">{verifyResult.note}</p>
            {verifyResult.summary && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{(() => { try { return JSON.stringify(JSON.parse(verifyResult.summary) as unknown, null, 1); } catch { return verifyResult.summary; } })()}</pre>}
            {verifyResult.recordHashShort && <p className="mt-1 text-xs text-[var(--dim)]">Record hash: {verifyResult.recordHashShort} · Issued {verifyResult.issuedAt ? new Date(verifyResult.issuedAt).toLocaleString() : ""}</p>}
          </div>
        )}
        {custodyResult && (
          <div className={`mt-2 rounded-2xl border px-3 py-3 ${custodyResult.ok ? "border-emerald-500/50 bg-emerald-900/30" : "border-amber-500/50 bg-amber-900/30"}`} role="status" aria-label="Custody check result">
            <div className="font-condensed text-xl font-bold">{custodyResult.ok ? "✓ CUSTODY CONFIRMED" : "Custody not confirmed"}</div>
            <p className="mt-1 text-sm">{custodyResult.note}</p>
            {custodyResult.lane && <p className="mt-1 text-sm">Lane: {custodyResult.lane} · Sealed: {custodyResult.sealed ? (custodyResult.sealedAt ? new Date(custodyResult.sealedAt).toLocaleString() : "yes") : "no"}</p>}
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--dim)]">At the dock: the receiver enters the load's custody code here before signing — a genuine seal means the load record and its document fingerprint are exactly what was sealed.</p>
      </div>
    </Section>
  );
}

export function PassportPanel({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["passport"], queryFn: () => api.getPassport({}) });
  const [code, setCode] = useState<string | null>(null);
  const p = q.data;
  const toggle = (patch: Partial<{ enabled: boolean; showMiles: boolean; showOnTime: boolean; showSafety: boolean; showSeasons: boolean }>) => {
    if (!p) return;
    const next = { enabled: p.enabled, showMiles: p.showMiles, showOnTime: p.showOnTime, showSafety: p.showSafety, showSeasons: p.showSeasons, ...patch };
    void api.savePassportPrefs(next).then(() => void queryClient.invalidateQueries({ queryKey: ["passport"] }));
  };
  const Row = ({ label, desc, on, onToggle, aria }: { label: string; desc: string; on: boolean; onToggle: () => void; aria: string }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
      <span><span className="font-semibold">{label}</span><span className="block text-xs text-[var(--dim)]">{desc}</span></span>
      <button type="button" role="switch" aria-checked={on} aria-label={aria} onClick={onToggle} className={`h-8 w-14 shrink-0 rounded-full p-1 ${on ? "bg-[var(--accent)]" : "bg-[var(--surface)] border border-[var(--border)]"}`}>
        <span className={`block h-6 w-6 rounded-full bg-white transition-transform ${on ? "translate-x-6" : ""}`} />
      </button>
    </div>
  );
  return (
    <Section title="🛂 Reputation Passport — your verified record, your call" ariaLabel="Reputation passport">
      <p className="text-sm text-[var(--dim)]">A shareable, verifiable summary of your sealed record — miles, on-time, safety, seasons. <strong className="text-[var(--text)]">Off by default.</strong> You pick exactly what shows; nothing shares until you turn it on and hand out the card or code yourself.</p>
      {p && (
        <>
          <div className="mt-3 space-y-2">
            <Row label="Passport sharing" desc="Master switch — off means the card is a private preview only" on={p.enabled} onToggle={() => toggle({ enabled: !p.enabled })} aria="Turn Reputation Passport sharing on or off" />
            <Row label="Sealed miles & deliveries" desc="Totals from your sealed trip sheets and POD seals" on={p.showMiles} onToggle={() => toggle({ showMiles: !p.showMiles })} aria="Show sealed miles on the passport" />
            <Row label="On-time record" desc="From the Driver tab scores — same sealed inputs" on={p.showOnTime} onToggle={() => toggle({ showOnTime: !p.showOnTime })} aria="Show on-time record on the passport" />
            <Row label="Safety & Reliability" desc="Current season scores and rank" on={p.showSafety} onToggle={() => toggle({ showSafety: !p.showSafety })} aria="Show safety and reliability on the passport" />
            <Row label="Seasons & all-time best" desc="31-day season history headline" on={p.showSeasons} onToggle={() => toggle({ showSeasons: !p.showSeasons })} aria="Show seasons on the passport" />
          </div>
          <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-[var(--surface2)] px-3 py-3 font-mono text-[13px] leading-relaxed">{p.card}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-press rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold"
              aria-label="Issue a verify code for my passport"
              onClick={() => void api.createVerifyCode({ kind: "passport", refId: null }).then((r) => { setCode(r.code); setBanner(`Passport verify code: ${r.code}`); }).catch(() => setBanner("Seal a trip first — the passport code anchors to your chain."))}
            >
              Issue passport verify code
            </button>
            {code && <span className="self-center font-condensed text-xl font-bold tracking-widest">{code}</span>}
          </div>
          {code && <div className="mt-2 flex justify-center"><Qr text={`STONEMILES VERIFY ${code}`} label={`QR code for passport verification, code ${code}`} /></div>}
          <XBar label="Reputation Passport card" filename="stonemiles-passport.txt" setBanner={setBanner} resolve={() => (p.enabled ? p.card + (code ? `\nVerify code: ${code}` : "") : null)} />
          {!p.enabled && <p className="text-xs text-[var(--dim)]">Exports unlock when sharing is ON — while it's off, the card never leaves the app.</p>}
        </>
      )}
    </Section>
  );
}

export function MerkleCard() {
  const q = useQuery({ queryKey: ["merkle-root"], queryFn: () => api.getMerkleRoot({ date: null }) });
  const m = q.data;
  return (
    <div className="mt-3 rounded-xl bg-[var(--surface2)] p-3" aria-label="Daily Merkle root">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">🌳 Daily Merkle root — set-proof for the whole chain</div>
        <button type="button" className="shrink-0 text-xs font-bold underline" aria-label="Recompute the Merkle root" onClick={() => void q.refetch()}>Recompute</button>
      </div>
      {m ? (
        <>
          <p className="mt-1 break-all font-mono text-xs">{m.root ?? "No sealed records yet — the first seal starts the tree."}</p>
          <p className="mt-1 text-xs text-[var(--dim)]">
            {m.leaves} record{m.leaves === 1 ? "" : "s"} under this root ({m.date}) · Chain {m.chainIntact ? "intact ✓" : "BROKEN ✗"} · Head {m.headHash.slice(0, 16)}…
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">{m.anchoring}</p>
        </>
      ) : (
        <p className="mt-1 text-xs text-[var(--dim)]">Computing…</p>
      )}
    </div>
  );
}

// ---------- G) Scale tickets · Vault · DVIR · Weigh intel · Chain law ---------

export function ScalePanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useState("");
  const [state, setState] = useState("");
  const [steer, setSteer] = useState("");
  const [drive, setDrive] = useState("");
  const [trailer, setTrailer] = useState("");
  const [photo, setPhoto] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticketLoadId, setTicketLoadId] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["scale-tickets"], queryFn: () => api.listScaleTickets({ limit: 30 }) });
  const loadsQ = useQuery({ queryKey: ["loads-brief"], queryFn: () => api.listLoads({ limit: 50 }) });
  const gross = (parseInt(steer || "0", 10) || 0) + (parseInt(drive || "0", 10) || 0) + (parseInt(trailer || "0", 10) || 0);
  return (
    <Section title={tt(lang, "records.scale")} ariaLabel="Scale tickets">
      <p className="text-sm text-[var(--dim)]">
        Weigh stations and CAT Scale locations ride the same map data as your alerts (weighbridge tags) — find them with the Scales chip on the Drive map (Explore), then log the ticket here: per-axle weights, photo fingerprinted and sealed. Attach it to a load and it seals into that load's record and rides its exports. Every weight is {tt(lang, "extras.driverEntered").toLowerCase()} — you type what the ticket says; the seal proves what you entered and when. Legal limits shown for reference: steer 12,000 · tandem 34,000 · gross 80,000 lbs (state rules vary — posted law rules).
      </p>
      <div className="mt-2">
        <label className={labelCls} htmlFor="sc-load">Attach to a load (optional)</label>
        <select id="sc-load" className={inputCls} value={ticketLoadId ?? ""} aria-label="Attach this ticket to a load" onChange={(e) => setTicketLoadId(e.target.value ? parseInt(e.target.value, 10) : null)}>
          <option value="">No load — driver record only</option>
          {(loadsQ.data?.loads ?? []).map((l) => (
            <option key={l.id} value={l.id}>Load #{l.id} — {l.shipper ?? "Load"} · {l.pickupCity ?? "?"} → {l.deliveryCity ?? "?"}</option>
          ))}
        </select>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls} htmlFor="sc-loc">Scale location</label>
          <input id="sc-loc" className={inputCls} value={location} aria-label="Scale location" placeholder="CAT Scale — …" onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="sc-state">State</label>
          <select id="sc-state" className={inputCls} value={state} aria-label="Scale state" onChange={(e) => setState(e.target.value)}>
            <option value="">Pick a state…</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="sc-steer">Steer (lbs)</label>
          <input id="sc-steer" type="number" inputMode="numeric" className={inputCls} value={steer} aria-label="Steer axle weight in pounds" onChange={(e) => setSteer(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="sc-drive">Drive tandems (lbs)</label>
          <input id="sc-drive" type="number" inputMode="numeric" className={inputCls} value={drive} aria-label="Drive axle weight in pounds" onChange={(e) => setDrive(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="sc-trailer">Trailer tandems (lbs)</label>
          <input id="sc-trailer" type="number" inputMode="numeric" className={inputCls} value={trailer} aria-label="Trailer axle weight in pounds" onChange={(e) => setTrailer(e.target.value)} />
        </div>
        <div className="flex items-end pb-1">
          <p className={`font-condensed text-xl font-bold ${gross > 80000 ? "text-red-300" : ""}`}>Gross: {gross > 0 ? gross.toLocaleString() + " lbs" : "—"}{gross > 80000 ? " ⚠ OVER 80,000" : ""}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
          📷 Ticket photo
          <input type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Upload a scale ticket photo" onChange={(e) => void photoToBase64(e).then((p) => { if (p) { setPhoto(p); setBanner("Ticket photo attached — it gets fingerprinted and sealed with the weights."); } else setBanner("Ticket photo needs to be a JPEG or PNG."); })} />
        </label>
        {photo && <span className="text-xs font-semibold text-emerald-300">Photo attached ✓</span>}
        <button
          type="button"
          disabled={busy || gross <= 0}
          className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
          aria-label="Log this scale ticket sealed"
          onClick={() => {
            setBusy(true);
            void api.logScaleTicket({ weighedAt: new Date().toISOString(), location: location.trim() || null, state: state || null, steerLbs: steer ? parseInt(steer, 10) : null, driveLbs: drive ? parseInt(drive, 10) : null, trailerLbs: trailer ? parseInt(trailer, 10) : null, grossLbs: gross || null, loadId: ticketLoadId, photoDataBase64: photo?.base64 ?? null, photoMime: photo?.mime ?? null })
              .then((r) => { setBanner(r.overGross ? "Ticket sealed — heads up: gross is OVER 80,000 lbs on this ticket." : "Scale ticket logged & sealed."); setSteer(""); setDrive(""); setTrailer(""); setPhoto(null); void queryClient.invalidateQueries({ queryKey: ["scale-tickets"] }); })
              .catch(() => setBanner("Couldn't log that ticket — try again."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Sealing…" : "Log ticket — sealed"}
        </button>
      </div>
      <div className="mt-3 space-y-1.5">
        {(list.data?.tickets ?? []).map((t) => (
          <div key={t.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <strong>{t.location ?? "Scale"}</strong>{t.state ? `, ${t.state}` : ""} — gross <strong className={(t.grossLbs ?? 0) > 80000 ? "text-red-300" : ""}>{t.grossLbs?.toLocaleString() ?? "—"} lbs</strong>
            <span className="block text-xs text-[var(--dim)]">Steer {t.steerLbs?.toLocaleString() ?? "—"} · Drive {t.driveLbs?.toLocaleString() ?? "—"} · Trailer {t.trailerLbs?.toLocaleString() ?? "—"} · {new Date(t.weighedAt).toLocaleString()}{t.hasPhoto ? " · photo sealed" : ""}{t.loadId != null ? ` · Load #${t.loadId}` : ""} · {tt(lang, "extras.driverEntered")}</span>
          </div>
        ))}
        {(list.data?.tickets ?? []).length === 0 && !list.isLoading && <p className="text-xs text-[var(--dim)]">No tickets logged yet.</p>}
      </div>
    </Section>
  );
}

// ---------- Tax Records (Final Extras): year summary + per-diem days --------

export function TaxPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["tax-year", year], queryFn: () => api.getTaxYearSummary({ year }) });
  const d = q.data;
  return (
    <Section title={tt(lang, "extras.taxTitle")} ariaLabel="Tax records — year summary and per-diem days">
      <div className="flex flex-wrap items-center gap-2">
        <label className={labelCls} htmlFor="tax-year">Tax year</label>
        <select id="tax-year" className={`${inputCls} w-auto`} value={year} aria-label="Tax year" onChange={(e) => setYear(parseInt(e.target.value, 10))}>
          {[nowYear, nowYear - 1, nowYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {!d && <p className="mt-2 text-sm text-[var(--dim)]">Reading your records…</p>}
      {d && (
        <>
          <div className="mt-3 rounded-2xl bg-[var(--surface2)] px-3 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">{tt(lang, "extras.perDiemDays")}</div>
            <div className="font-condensed text-4xl font-bold">{d.perDiemDays}</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">{tt(lang, "extras.perDiemNote")}</p>
          </div>
          <div className="mt-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Expenses by category — {year}</div>
            {d.expenseByCategory.length === 0 && <p className="mt-1 text-sm text-[var(--dim)]">No expenses logged in {year} yet. Log them in Money Truth above — the category you pick there is the one that seals.</p>}
            <div className="mt-1.5 space-y-1.5">
              {d.expenseByCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                  <span>{expenseCategoryLabel(c.category)} <span className="text-xs normal-case text-[var(--dim)]">· {c.count} record{c.count === 1 ? "" : "s"}</span></span>
                  <strong>{money(c.total)}</strong>
                </div>
              ))}
            </div>
            {d.expenseByCategory.length > 0 && <p className="mt-2 text-sm">Expenses total: <strong>{money(d.expenseTotal)}</strong></p>}
            <p className="mt-2 text-sm text-[var(--dim)]">
              Fuel purchases logged in {year}: <strong className="text-[var(--text)]">{d.fuelCount > 0 ? `${money(d.fuelTotal)} · ${d.fuelGallons.toLocaleString()} gal · ${d.fuelCount} purchase${d.fuelCount === 1 ? "" : "s"}` : "none"}</strong> — counted from the fuel log (they feed IFTA too), kept out of the expense categories so nothing double-counts.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            className="btn-neon btn-press mt-3 w-full rounded-xl py-3 font-bold disabled:opacity-50"
            aria-label={`Download the ${year} tax-year summary`}
            onClick={() => {
              setBusy(true);
              void api.exportTaxYearSummary({ year })
                .then((r) => { downloadTextFile(r.filename, r.text); setBanner(`Tax-year ${year} summary downloaded — hand it to your tax preparer.`); })
                .catch(() => setBanner("Couldn't build that export — try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Building…" : `⬇ Download ${year} tax summary`}
          </button>
          <p className="mt-2 text-xs text-[var(--dim)]">A record for tax prep — not tax advice. The packet carries the per-diem W-2 note on its face so it travels with the numbers.</p>
        </>
      )}
    </Section>
  );
}

// ---------- Tax Worksheet (2026-11-12): the paper worksheet, one full view --
// The "Tax Deduction Worksheet for Truck Driver Operators" laid out
// like the paper form, assembled from the records already in the app
// (getTaxWorksheet — a view, never a second store): header with the
// name/company already on the account (no tax ID anywhere), the
// income tracker with W-2 / 1099 in separate lanes, the worksheet's
// expense sections, per-diem days, the fuel block kept separate, and
// per-lane totals. The W-2 warning prints ON the worksheet's face.

export function TaxWorksheetPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["tax-worksheet", year], queryFn: () => api.getTaxWorksheet({ year }) });
  const d = q.data;
  const lineLabel = (key: string, fallback: string) => {
    const v = tt(lang, `extras.wsLine.${key}`);
    return v.startsWith("extras.") ? fallback : v;
  };
  const sectionTitle = (key: string, fallback: string) =>
    key === "vehicle" ? tt(lang, "extras.wsSectionVehicle") : key === "equipment" ? tt(lang, "extras.wsSectionEquipment") : fallback;
  return (
    <Section title={tt(lang, "extras.wsTitle")} ariaLabel="Tax worksheet — the year on one page">
      <div className="flex flex-wrap items-center gap-2">
        <label className={labelCls} htmlFor="tax-worksheet-year">Tax year</label>
        <select id="tax-worksheet-year" className={`${inputCls} w-auto`} value={year} aria-label="Tax worksheet year" onChange={(e) => setYear(parseInt(e.target.value, 10))}>
          {[nowYear, nowYear - 1, nowYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {!d && <p className="mt-2 text-sm text-[var(--dim)]">Reading your records…</p>}
      {d && (
        <>
          <p className="mt-3 text-sm">
            <strong>{d.driverName}</strong>{d.companyName ? <span className="text-[var(--dim)]"> · {d.companyName}</span> : null}
            <span className="block text-xs text-[var(--dim)]">Tax Worksheet — {year} · built only from your own records in this app. No tax ID is asked for or kept here.</span>
          </p>
          <p className="mt-3 rounded-xl bg-amber-900/40 px-3 py-2 text-xs leading-relaxed text-amber-200" role="note">
            {tt(lang, "extras.wsW2Warning")}
          </p>

          <div className="mt-4">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">{tt(lang, "extras.wsIncome")}</div>
            {d.incomeRows.length === 0 && <p className="mt-1 text-sm text-[var(--dim)]">No pay logged in {year} yet. Log it in the Pay Book (Money tab) — every paycheck becomes a row here, in its own lane.</p>}
            <div className="mt-1.5 space-y-1.5">
              {d.incomeRows.map((r, i) => (
                <div key={`${r.dateIso}-${r.payer}-${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                  <span className="min-w-0">
                    {new Date(`${r.dateIso}T12:00:00`).toLocaleDateString()} · <strong>{r.payer}</strong>{" "}
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${r.lane === "1099" ? "bg-sky-900/60 text-sky-200" : "bg-emerald-900/60 text-emerald-200"}`}>{r.lane === "1099" ? "1099" : "W-2"}</span>
                    <span className="block text-xs text-[var(--dim)]">Miles: {r.miles != null ? r.miles.toLocaleString() : "— (pay records carry no miles; sealed trip miles stand below)"}</span>
                  </span>
                  <strong className="shrink-0">{money(r.gross)}</strong>
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-1 text-sm">
              <p>W-2 subtotal: <strong>{money(d.w2.gross)}</strong> <span className="text-xs text-[var(--dim)]">({d.w2.count} payment{d.w2.count === 1 ? "" : "s"})</span></p>
              <p>1099 subtotal: <strong>{money(d.ten99.gross)}</strong> <span className="text-xs text-[var(--dim)]">({d.ten99.count} payment{d.ten99.count === 1 ? "" : "s"})</span></p>
              <p className="text-xs text-[var(--dim)]">The two lanes file separately — this worksheet never adds them into one filing total. Year-end forms are not rows: the paychecks already counted that money.</p>
            </div>
          </div>

          {d.sections.map((s) => (
            <div key={s.key} className="mt-4">
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">{sectionTitle(s.key, s.title)} — {year}</div>
              <div className="mt-1.5 space-y-1.5">
                {s.lines.map((l) => (
                  <div key={l.key} className="flex items-center justify-between rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                    <span>{lineLabel(l.key, l.label)} <span className="text-xs text-[var(--dim)]">· {l.count} record{l.count === 1 ? "" : "s"}</span></span>
                    <strong>{money(l.total)}</strong>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm">Section subtotal: <strong>{money(s.subtotal)}</strong></p>
            </div>
          ))}

          <div className="mt-4 rounded-2xl bg-[var(--surface2)] px-3 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">{tt(lang, "extras.perDiemDays")}</div>
            <div className="font-condensed text-4xl font-bold">{d.perDiemDays}</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">{tt(lang, "extras.perDiemNote")}</p>
          </div>

          <p className="mt-3 text-sm text-[var(--dim)]">
            Fuel purchases logged in {year}: <strong className="text-[var(--text)]">{d.fuelCount > 0 ? `${money(d.fuelTotal)} · ${d.fuelGallons.toLocaleString()} gal · ${d.fuelCount} purchase${d.fuelCount === 1 ? "" : "s"}` : "none"}</strong> — counted from the fuel log (they feed IFTA too), kept out of the expense sections above so nothing double-counts.
          </p>

          <div className="mt-3 rounded-2xl bg-[var(--surface2)] px-3 py-3 text-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Totals — {year}</div>
            <div className="mt-1.5 space-y-1">
              <p>W-2 gross: <strong>{money(d.w2.gross)}</strong> · 1099 gross: <strong>{money(d.ten99.gross)}</strong></p>
              <p>Expenses total: <strong>{money(d.expenseTotal)}</strong> <span className="text-xs text-[var(--dim)]">({d.expenseCount} record{d.expenseCount === 1 ? "" : "s"})</span></p>
              <p>Sealed trip miles in {year}: <strong>{d.sealedTripMiles.toLocaleString()}</strong> <span className="text-xs text-[var(--dim)]">— from your sealed trip records</span></p>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            className="btn-neon btn-press mt-3 w-full rounded-xl py-3 font-bold disabled:opacity-50"
            aria-label={`Download the ${year} tax worksheet`}
            onClick={() => {
              setBusy(true);
              void api.exportTaxWorksheet({ year })
                .then((r) => { downloadTextFile(r.filename, r.text); setBanner(`Tax worksheet ${year} downloaded — hand it to your tax preparer.`); })
                .catch(() => setBanner("Couldn't build that worksheet — try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Building…" : `⬇ Download ${year} tax worksheet`}
          </button>
          <p className="mt-2 text-xs text-[var(--dim)]">A record for tax prep — not tax advice. The W-2 warning above prints on the downloaded worksheet too, and the export files itself in your Library's Filings, like the tax-year summary.</p>
        </>
      )}
    </Section>
  );
}

const DOC_KINDS = [
  { key: "cdl", label: "CDL (driver's licence)" },
  { key: "medical", label: "Medical card (DOT)" },
  { key: "insurance", label: "Insurance" },
  { key: "registration", label: "Registration / cab card" },
  { key: "ifta_licence", label: "IFTA licence" },
  { key: "dot_inspection", label: "Annual DOT inspection" },
  { key: "other", label: "Other document" },
] as const;

export function VaultPanel({ setBanner, lang = "en" }: { setBanner: Banner; lang?: Lang }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string>("cdl");
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [last4, setLast4] = useState("");
  const [file, setFile] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["personal-docs"], queryFn: () => api.listPersonalDocs({}) });
  const viewDoc = (id: number) => {
    void api.getPersonalDocFile({ id }).then((r) => {
      if (r.url) window.open(r.url, "_blank");
      else setBanner("That document has no file attached — it's a reminder-only entry.");
    });
  };
  return (
    <Section title={tt(lang, "records.vault")} ariaLabel="Personal document vault">
      <p className="text-sm text-[var(--dim)]">
        CDL, medical card, insurance, registration, IFTA licence, annual DOT inspection — dates YOU enter drive the reminders (45 / 30 / 7 days out and expired, here and in the Morning Briefing; the Expiry Wallet above runs the tighter 30 / 14 / 7-day alerts). Lists show kind + expiry + last 4 only; the document itself opens only from here.
      </p>
      {(list.data?.docs ?? []).filter((d) => d.daysLeft != null && d.daysLeft <= 45).map((d) => (
        <p key={d.id} className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${d.daysLeft != null && d.daysLeft < 0 ? "bg-red-900/50 text-red-200" : "bg-amber-900/40 text-amber-200"}`} role="alert">
          {d.daysLeft != null && d.daysLeft < 0 ? `⛔ ${d.label} EXPIRED ${Math.abs(d.daysLeft)} days ago — renew before you roll.` : d.daysLeft === 0 ? `⏰ ${d.label} expires TODAY.` : `⏰ ${d.label} expires in ${d.daysLeft} days.`}
        </p>
      ))}
      <div className="mt-3 space-y-1.5">
        {(list.data?.docs ?? []).map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <span className="min-w-0">
              <strong>{d.label}</strong> <span className="text-xs text-[var(--dim)]">({DOC_KINDS.find((k) => k.key === d.kind)?.label ?? d.kind})</span>
              <span className="block text-xs text-[var(--dim)]">{d.expiresAt ? `Expires ${new Date(d.expiresAt).toLocaleDateString()}${d.daysLeft != null ? ` · ${d.daysLeft} days left` : ""}` : "No expiry set"}{d.docNumberLast4 ? ` · •••${d.docNumberLast4}` : ""}</span>
            </span>
            <span className="flex shrink-0 gap-2">
              {d.hasFile && <button type="button" className="text-xs font-bold underline" aria-label={`View ${d.label}`} onClick={() => viewDoc(d.id)}>View</button>}
              <button type="button" className="text-xs font-bold underline" aria-label={`Delete ${d.label}`} onClick={() => void api.deletePersonalDoc({ id: d.id }).then(() => void queryClient.invalidateQueries({ queryKey: ["personal-docs"] }))}>Delete</button>
            </span>
          </div>
        ))}
        {(list.data?.docs ?? []).length === 0 && !list.isLoading && <p className="text-xs text-[var(--dim)]">Vault is empty — add your first document below.</p>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-3">
        <div>
          <label className={labelCls} htmlFor="vault-kind">Document kind</label>
          <select id="vault-kind" className={inputCls} value={kind} aria-label="Personal document kind" onChange={(e) => setKind(e.target.value)}>
            {DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="vault-label">Label</label>
          <input id="vault-label" className={inputCls} value={label} aria-label="Personal document label" placeholder="e.g. Texas CDL" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="vault-exp">Expiry date</label>
          <input id="vault-exp" type="date" className={inputCls} value={expiry} aria-label="Document expiry date" onChange={(e) => setExpiry(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="vault-last4">Doc number — last 4 only</label>
          <input id="vault-last4" className={inputCls} value={last4} maxLength={4} aria-label="Document number last four characters" placeholder="••••" onChange={(e) => setLast4(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="btn-press cursor-pointer rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-sm font-bold">
          📎 Attach file/photo
          <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" aria-label="Attach the document file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (f.type === "image/jpeg" || f.type === "image/png" || f.type === "application/pdf") { void fileToBase64(f).then((enc) => setFile({ base64: enc.dataBase64, mime: f.type })); } else setBanner("Attach a JPEG, PNG, or PDF."); }} />
        </label>
        {file && <span className="text-xs font-semibold text-emerald-300">File attached ✓</span>}
        <button
          type="button"
          disabled={busy || !label.trim()}
          className="btn-neon btn-press rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
          aria-label="Save this document to the vault"
          onClick={() => {
            setBusy(true);
            void api.savePersonalDoc({ kind: kind as typeof DOC_KINDS[number]["key"], label: label.trim(), expiresAt: expiry ? new Date(expiry + "T12:00:00").toISOString() : null, docNumberLast4: last4.trim() || null, notes: null, dataBase64: file?.base64 ?? null, mime: file?.mime ?? null })
              .then((r) => {
                if (r.error) { setBanner(r.error); return; }
                setBanner("Saved to your vault & sealed in the log (label + dates only — the file stays a file)."); setLabel(""); setExpiry(""); setLast4(""); setFile(null); void queryClient.invalidateQueries({ queryKey: ["personal-docs"] }); void queryClient.invalidateQueries({ queryKey: ["copilot-briefing"] });
              })
              .catch(() => setBanner("Couldn't save that document — try again."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : "Save to vault"}
        </button>
      </div>
    </Section>
  );
}

export const DVIR_ITEMS = [
  "Tires & wheels", "Brakes", "Lights & reflectors", "Steering", "Horn", "Mirrors",
  "Coupling (fifth wheel / kingpin)", "Load securement", "Emergency equipment",
];

export type DvirKind = "pretrip" | "posttrip";

export function DvirPanel({ setBanner, focus, lang = "en" }: { setBanner: Banner; focus?: { kind: DvirKind; n: number } | null; lang?: Lang }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<DvirKind>("pretrip");
  const [checks, setChecks] = useState<Record<string, boolean>>(() => Object.fromEntries(DVIR_ITEMS.map((i) => [i, true])));
  const [defectNotes, setDefectNotes] = useState<Record<string, string>>({});
  const [signName, setSignName] = useState("");
  const [odometer, setOdometer] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<{ kind: DvirKind; at: string; dutyStamped: boolean } | null>(null);
  const list = useQuery({ queryKey: ["dvirs"], queryFn: () => api.listDvirs({ limit: 20 }) });
  const criticalItems = new Set(["Tires & wheels", "Brakes", "Lights & reflectors", "Coupling (fifth wheel / kingpin)", "Load securement"]);
  // A Today-tab checklist button lands here with a kind picked: switch
  // the form to it and clear any earlier "started" stamp for the other.
  useEffect(() => {
    if (!focus) return;
    setKind(focus.kind);
    setStarted((s) => (s && s.kind === focus.kind ? s : null));
  }, [focus]);
  const startChecklist = () => {
    setStarting(true);
    let locationLabel: string | null = null;
    try {
      const st = localStorage.getItem("tgps-current-state");
      if (st) locationLabel = `${st} (GPS state at the change)`;
    } catch { /* no fix recorded — the stamp simply has no location */ }
    void api.beginDvirChecklist({ kind, locationLabel })
      .then((r) => {
        setStarted({ kind, at: r.at, dutyStamped: r.dutyStamped });
        void queryClient.invalidateQueries({ queryKey: ["duty"] });
        if (kind === "pretrip") {
          setBanner(r.dutyStamped
            ? "Pre-trip checklist started — you're stamped On Duty (not driving) in the sealed log. Walk the truck, then sign below."
            : "Pre-trip checklist started — you were already On Duty or Driving, so no new duty stamp was needed.");
        } else {
          setBanner("Post-trip checklist started — walk the truck, then sign below. Your duty status doesn't change here; tap Off Duty or Sleeper when you're done for the day.");
        }
      })
      .catch(() => setBanner("Couldn't start the checklist — check your connection and try again."))
      .finally(() => setStarting(false));
  };
  return (
    <Section title={tt(lang, "records.dvir")} ariaLabel="Pre-trip and post-trip inspection checklists">
      <p className="text-sm text-[var(--dim)]">
        The walk-around, formalized: start the checklist, check each system, flag defects with notes, sign it. The signed report seals into your record for the day; defects marked on safety-critical systems flag 🚨 to the owner portal feed immediately. A critical defect warns YOU — the go/no-go call is always the driver's.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Choose the checklist kind">
        <button type="button" aria-pressed={kind === "pretrip"} aria-label="Pre-trip checklist — start of day" onClick={() => setKind("pretrip")} className={`btn-press rounded-xl px-3 py-3 text-left ${kind === "pretrip" ? "btn-neon" : "bg-[var(--surface2)] border border-[var(--border)]"}`}>
          <span className="block font-condensed text-lg font-bold leading-tight">🌅 Pre-trip</span>
          <span className="block text-xs">Start of day · signing earns +50 pts</span>
        </button>
        <button type="button" aria-pressed={kind === "posttrip"} aria-label="Post-trip checklist — end of day" onClick={() => setKind("posttrip")} className={`btn-press rounded-xl px-3 py-3 text-left ${kind === "posttrip" ? "btn-neon" : "bg-[var(--surface2)] border border-[var(--border)]"}`}>
          <span className="block font-condensed text-lg font-bold leading-tight">🌙 Post-trip</span>
          <span className="block text-xs">End of day · signing earns +25 pts</span>
        </button>
      </div>
      {started?.kind === kind ? (
        <p className="mt-2 rounded-xl bg-emerald-900/50 px-3 py-2.5 text-sm font-semibold" role="status">
          ✓ {kind === "pretrip" ? "Pre-trip" : "Post-trip"} checklist started {new Date(started.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          {kind === "pretrip" && (started.dutyStamped ? " — stamped On Duty (not driving) in the sealed log" : " — already On Duty/Driving, no stamp needed")}
        </p>
      ) : (
        <button
          type="button"
          disabled={starting}
          className="btn-neon btn-press mt-2 w-full rounded-xl py-3.5 font-bold disabled:opacity-50"
          aria-label={kind === "pretrip" ? "Start the pre-trip checklist — stamps you On Duty, not driving" : "Start the post-trip checklist"}
          onClick={startChecklist}
        >
          {starting ? "Starting…" : kind === "pretrip" ? "▶ Start pre-trip checklist — stamps you On Duty (not driving)" : "▶ Start post-trip checklist"}
        </button>
      )}
      {kind === "pretrip" && (
        <p className="mt-1.5 text-xs text-[var(--dim)]">Starting stamps you On Duty (not driving) — inspecting the truck is on-duty work, and the stamp is sealed with a PRE-TRIP START tag so it never reads as an edit. Signing the finished checklist earns the +50 Pre-trip DVIR points line.</p>
      )}
      {kind === "posttrip" && (
        <p className="mt-1.5 text-xs text-[var(--dim)]">Same walk-around at the end of the day — anything that broke or wore goes on this report so it's on record before the next driver (or tomorrow-you) rolls. Signing earns the +25 Post-trip DVIR points line. Daily points still cap at 500.</p>
      )}
      <div className="mt-2 space-y-1.5">
        {DVIR_ITEMS.map((item) => (
          <div key={item} className="rounded-xl bg-[var(--surface2)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{item}{criticalItems.has(item) ? <span className="text-xs text-amber-300"> · safety-critical</span> : ""}</span>
              <span className="flex gap-1.5">
                <button type="button" aria-label={`Mark ${item} OK`} aria-pressed={checks[item] === true} onClick={() => setChecks({ ...checks, [item]: true })} className={`btn-press rounded-lg px-3 py-1.5 text-xs font-bold ${checks[item] ? "btn-neon" : "bg-[var(--surface)] border border-[var(--border)]"}`}>OK</button>
                <button type="button" aria-label={`Report a defect on ${item}`} aria-pressed={checks[item] === false} onClick={() => setChecks({ ...checks, [item]: false })} className={`btn-press rounded-lg px-3 py-1.5 text-xs font-bold ${checks[item] === false ? "bg-red-800 text-white" : "bg-[var(--surface)] border border-[var(--border)]"}`}>Defect</button>
              </span>
            </div>
            {checks[item] === false && (
              <input className={`${inputCls} mt-2`} value={defectNotes[item] ?? ""} aria-label={`Defect note for ${item}`} placeholder="What's wrong? (goes to the owner feed if critical)" onChange={(e) => setDefectNotes({ ...defectNotes, [item]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls} htmlFor="dvir-sign">Sign — your name</label>
          <input id="dvir-sign" className={inputCls} value={signName} aria-label="Driver signature name for the DVIR" placeholder="Type your name to sign" onChange={(e) => setSignName(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="dvir-odo">Odometer (optional)</label>
          <input id="dvir-odo" type="number" inputMode="numeric" className={inputCls} value={odometer} aria-label="Odometer reading" onChange={(e) => setOdometer(e.target.value)} />
        </div>
      </div>
      <button
        type="button"
        disabled={busy || signName.trim().length < 2}
        className="btn-neon btn-press mt-3 w-full rounded-xl py-3 font-bold disabled:opacity-50"
        aria-label={kind === "pretrip" ? "Sign and seal this pre-trip DVIR" : "Sign and seal this post-trip DVIR"}
        onClick={() => {
          setBusy(true);
          const items = DVIR_ITEMS.map((i) => ({ item: i, ok: checks[i] !== false }));
          const defects = DVIR_ITEMS.filter((i) => checks[i] === false).map((i) => ({ item: i, note: defectNotes[i] ?? "", critical: criticalItems.has(i) }));
          void api.saveDvir({ kind, items, defects, signedName: signName.trim(), odometer: odometer ? parseFloat(odometer) : null })
            .then((r) => {
              const pts = kind === "pretrip" ? " +50 SM Points for the day." : " +25 SM Points for the day.";
              setBanner(r.criticalDefect ? "🚨 DVIR sealed with a SAFETY-CRITICAL defect — it flagged to the owner feed. The go/no-go call is yours; a critical defect is a strong reason not to roll." + pts : defects.length > 0 ? "DVIR signed & sealed — defects noted for the owner feed." + pts : "DVIR signed & sealed — all systems OK." + pts);
              void queryClient.invalidateQueries({ queryKey: ["dvirs"] });
              void queryClient.invalidateQueries({ queryKey: ["points"] });
              setStarted(null);
            })
            .catch(() => setBanner("Couldn't save the DVIR — try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Sealing…" : kind === "pretrip" ? "✍️ Sign & seal pre-trip DVIR" : "✍️ Sign & seal post-trip DVIR"}
      </button>
      <div className="mt-3 space-y-1.5">
        {(list.data?.reports ?? []).slice(0, 6).map((r) => (
          <div key={r.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <strong>{r.kind === "pretrip" ? "Pretrip" : "Post-trip"} DVIR</strong> · {new Date(r.inspectedAt).toLocaleString()} · signed {r.signedName}
            {r.defects.length > 0 ? <span className="block text-xs font-semibold text-red-300">Defects: {r.defects.map((d) => `${d.item}${d.critical ? " 🚨" : ""}`).join(" · ")}</span> : <span className="block text-xs text-emerald-300">All {r.items} systems OK</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Weigh-station + parking intel status — crowd-sourced, timestamped, never invented.
 *  Parking intel is part of Diamond's full parking assistance (x, 2026-10-25):
 *  off-Diamond the strip shows weigh-station intel only. */
export function WeighIntelStrip({ parkingIntel = false }: { parkingIntel?: boolean }) {
  const q = useQuery({ queryKey: ["intel-weigh"], queryFn: () => api.listIntelReports({ limit: 100 }) });
  const kinds = parkingIntel ? ["weigh_open", "weigh_closed", "parking_open", "parking_full"] : ["weigh_open", "weigh_closed"];
  const reports = (q.data?.reports ?? []).filter((r) => kinds.includes(r.kind));
  const latest = reports.slice(0, 4);
  return (
    <section className="glass-panel p-3.5" aria-label="Weigh station and parking intel status">
      <h2 className="font-condensed text-xl font-semibold">⚖️ {parkingIntel ? "Scale & parking status — driver intel" : "Scale status — driver intel"}</h2>
      <p className="mt-1 text-xs text-[var(--dim)]">Crowd-sourced from drivers' own sealed intel reports, always with the time it was reported. No report = “not reported” — the app never guesses a scale is open{parkingIntel ? " or a lot has spots" : ""}.{parkingIntel ? "" : " Parking intel rides with Diamond's full parking assistance."}</p>
      <div className="mt-2 space-y-1.5">
        {latest.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <span className="font-semibold">
              {r.kind === "weigh_open" ? "🟢 Weigh station reported OPEN" : r.kind === "weigh_closed" ? "🔴 Weigh station reported CLOSED" : r.kind === "parking_open" ? "🅿️ Parking reported available" : "🅿️ Parking reported FULL"}
              {r.note ? <span className="block text-xs font-normal text-[var(--dim)]">{r.note}</span> : null}
            </span>
            <span className="shrink-0 text-xs text-[var(--dim)]">{new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </div>
        ))}
        {latest.length === 0 && <p className="text-sm text-[var(--dim)]">Not reported — no driver intel on scales{parkingIntel ? " or parking" : ""} yet. Drop a report on the Drive tab and it shows here with its timestamp.</p>}
      </div>
    </section>
  );
}

// Chain-law / winter notes by state — labelled reference data, not live law.
export const CHAIN_LAW_NOTES: Record<string, string> = {
  California: "Chain controls (R1–R3) are set live by Caltrans on mountain passes — when R2/R3 posts, chains are required on drive axles. Check Caltrans QuickMap before Donner/Siskiyou/Grapevine in winter.",
  Colorado: "Colorado's chain law: Sept 1–May 31 on I-70 between Dotsero and Morrison, commercial vehicles must CARRY chains; when the Passenger Vehicle Chain Law / CDL chain requirement activates, they must be on. Fines are steep — carry them.",
  Oregon: "Oregon chain law: carry chains Nov 1–Apr 1 in mountain zones; when ODOT posts 'chains required', traction tires aren't enough for heavy trucks on many passes.",
  Washington: "WSDOT requires trucks to carry chains Nov 1–Apr 1 on mountain passes; 'chains required' on Snoqualmie/Blewett/Stevens means install before the checkpoint.",
  Wyoming: "Wyoming posts chain requirements by segment on I-80/I-25 during storms — and closes the road entirely when it's beyond chains. WYDOT 511 is the source.",
  Montana: "Montana posts chain requirements on passes (Lookout, Bozeman, Homestake) during storms via MDT 511.",
  Idaho: "Idaho posts chain requirements via Idaho 511 — Fourth of July Pass and Lookout see them most winters.",
  Nevada: "Nevada requires chains when NHP/NDOT posts chain controls, common on I-80 over Donner approach and US-50.",
  Utah: "Utah's traction law activates on canyon/par-ley routes during storms (UDOT) — Big/Little Cottonwood and Parley's Summit; trucks need chains or approved traction devices when posted.",
};

export function ChainLawPanel({ states }: { states: string[] }) {
  const hits = states.filter((s) => CHAIN_LAW_NOTES[s]);
  return (
    <section className="glass-panel p-3.5" aria-label="Chain law and winter alerts">
      <h2 className="font-condensed text-xl font-semibold">⛓️ Chain law & winter — states on your board</h2>
      {hits.length === 0 && <p className="mt-1 text-sm text-[var(--dim)]">No chain-law states in your current trips or destination yet. When your route crosses one, its rule shows here.</p>}
      <div className="mt-2 space-y-1.5">
        {hits.map((s) => (
          <div key={s} className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
            <strong>{s}:</strong> {CHAIN_LAW_NOTES[s]}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--dim)]">Reference summaries from state DOT chain-law pages (Caltrans, CDOT, ODOT, WSDOT, WYDOT, MDT, ITD, NDOT, UDOT), labelled October 2026. Live postings rule — always check the state's 511/DOT feed before a mountain run; this panel is a planning aid, not the law.</p>
    </section>
  );
}
