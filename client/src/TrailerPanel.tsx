// TrailerPanel.tsx — the Trailer Package UI (2026-11-06).
//
// Everything here hangs off the ONE trailer profile on the truck
// profile (profile.trailerType — dry van / reefer / flatbed / step
// deck / RGN, switchable any time in Settings → Truck or right here).
// The profile orders the tools; nothing is hidden — tools that fit
// another trailer sit below under "More trailer tools".
//
// Sections:
//  - TrailerToolsPanel (Loads tab): profile picker + the tools in
//    profile order — securement calculator, bridge-formula (axle)
//    calculator, pre-trip checklist, and the per-load tools aimed at
//    the active load.
//  - LoadTrailerSection (each load's details): loaded height, reefer
//    cold-chain log, dock helper for THAT load.
//  - WindAdvisoryBanner (Drive screen): the empty-high-profile
//    blow-over advisory, from trailer.ts + the Go weather reading.
//
// Honesty rules carried through: reefer temps are DRIVER-ENTERED and
// labelled so everywhere; both calculators label themselves planning
// guides, not legal advice / not a permit; the wind banner labels
// itself a STONEMILES advisory, not an official warning.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import { t as tt, type Lang } from "./i18n";
import { apptBehaviourLabel, groupVisitsByFacility } from "./extras";
import {
  bridgeFormulaCalc,
  fmtHeightIn,
  heightInUse,
  pretripChecklist,
  reeferBandStatus,
  securementCalc,
  trailerProfile,
  windAdvisory,
  REEFER_DEFAULT_BAND_F,
  TIEDOWN_PRESETS,
  TRAILER_TYPES,
  type BridgeGroupInput,
  type TrailerToolId,
  type TrailerType,
} from "./trailer";

type LoadT = ApiResponse<typeof api, "listLoads">["loads"][number];
type LatLon = { lat: number; lon: number };
type QueryClientT = ReturnType<typeof useQueryClient>;

const inputCls =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const labelCls = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";
const cardCls = "rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] p-3";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
}

/** ISO instant → the value a datetime-local input wants (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Loaded height (per load) -------------------------------------------

function LoadedHeightSection({
  load,
  truckHeightIn,
  setBanner,
  queryClient,
  lang = "en",
}: {
  load: LoadT;
  truckHeightIn: number;
  setBanner: (s: string | null) => void;
  queryClient: QueryClientT;
  lang?: Lang;
}) {
  const [ft, setFt] = useState<string>(load.loadedHeightIn != null ? String(Math.floor(load.loadedHeightIn / 12)) : "");
  const [inch, setInch] = useState<string>(load.loadedHeightIn != null ? String(load.loadedHeightIn % 12) : "");
  const [busy, setBusy] = useState(false);
  const inUse = heightInUse({ loadedHeightIn: load.loadedHeightIn, truckHeightIn });

  const save = async (valueIn: number | null) => {
    setBusy(true);
    try {
      const res = await api.setLoadTrailerData({ loadId: load.id, loadedHeightIn: valueIn });
      if (!res.ok) {
        setBanner(res.error ?? "Couldn't save the loaded height.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["loads"] });
      setBanner(
        valueIn != null
          ? `Loaded height ${fmtHeightIn(valueIn)} recorded on load #${load.id} ✓ — this height now drives the low-bridge alerts for this trip.`
          : `Loaded height cleared on load #${load.id} — low-bridge alerts fall back to your truck profile height ${fmtHeightIn(truckHeightIn)}.`,
      );
    } catch {
      setBanner("Couldn't save the loaded height — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardCls} aria-label="Loaded height">
      <div className="font-semibold">📏 {tt(lang, "trailer.loadedHeightThisLoad")}</div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">
        Every open-deck load rides at its own height. Record the actual loaded height and it — not a fixed trailer
        default — drives the low-bridge alerts for this trip. Height in use now:{" "}
        <strong className="text-[var(--text)]">{inUse.label}</strong>.
      </p>
      <div className="mt-2 flex items-end gap-2">
        <div className="w-24">
          <label className={labelCls} htmlFor={`lh-ft-${load.id}`}>Feet</label>
          <input id={`lh-ft-${load.id}`} type="number" inputMode="numeric" min={4} max={20} className={inputCls} value={ft} onChange={(e) => setFt(e.target.value)} placeholder="13" />
        </div>
        <div className="w-24">
          <label className={labelCls} htmlFor={`lh-in-${load.id}`}>Inches</label>
          <input id={`lh-in-${load.id}`} type="number" inputMode="numeric" min={0} max={11} className={inputCls} value={inch} onChange={(e) => setInch(e.target.value)} placeholder="6" />
        </div>
        <button
          type="button"
          disabled={busy || ft.trim() === ""}
          className="btn-neon rounded-xl px-4 py-2.5 font-bold disabled:opacity-50"
          onClick={() => {
            const total = (parseInt(ft, 10) || 0) * 12 + (parseInt(inch, 10) || 0);
            if (total >= 48 && total <= 240) void save(total);
          }}
        >
          Save height
        </button>
        {load.loadedHeightIn != null && (
          <button
            type="button"
            disabled={busy}
            className="rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 font-semibold disabled:opacity-50"
            onClick={() => void save(null)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Reefer cold-chain log (per load) ------------------------------------

function ReeferSection({
  load,
  pos,
  setBanner,
  queryClient,
  lang = "en",
}: {
  load: LoadT;
  pos: LatLon | null;
  setBanner: (s: string | null) => void;
  queryClient: QueryClientT;
  lang?: Lang;
}) {
  const [setpoint, setSetpoint] = useState<string>(load.reeferSetpointF != null ? String(load.reeferSetpointF) : "");
  const [band, setBand] = useState<string>(load.reeferBandF != null ? String(load.reeferBandF) : String(REEFER_DEFAULT_BAND_F));
  const [temp, setTemp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const checks = load.reeferChecks ?? [];

  const saveSetpoint = async () => {
    const sp = parseFloat(setpoint);
    const bd = parseFloat(band);
    if (!Number.isFinite(sp)) {
      setBanner("Enter the load's setpoint first — the check-ins are judged against it.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.setLoadTrailerData({
        loadId: load.id,
        reeferSetpointF: sp,
        reeferBandF: Number.isFinite(bd) && bd > 0 ? bd : REEFER_DEFAULT_BAND_F,
      });
      if (!res.ok) {
        setBanner(res.error ?? "Couldn't save the setpoint.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["loads"] });
      setBanner(`Reefer setpoint ${sp}°F ± ${Number.isFinite(bd) && bd > 0 ? bd : REEFER_DEFAULT_BAND_F}°F saved on load #${load.id} ✓`);
    } catch {
      setBanner("Couldn't save the setpoint — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const addCheck = async () => {
    const t = parseFloat(temp);
    if (!Number.isFinite(t)) {
      setBanner("Type the temperature you read at this stop — checks are driver-entered, never guessed.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.addReeferCheck({
        loadId: load.id,
        tempF: t,
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setBanner(res.error ?? "Couldn't seal that temperature check.");
        return;
      }
      setTemp("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["loads"] });
      const out =
        load.reeferSetpointF != null
          ? reeferBandStatus({ setpointF: load.reeferSetpointF, bandF: load.reeferBandF ?? REEFER_DEFAULT_BAND_F, tempF: t })
          : null;
      setBanner(
        out && out.status !== "in_band"
          ? `⚠️ Check sealed — ${t}°F is ${out.label}. Look at the load and the unit before you roll.`
          : `Temperature check ${t}°F sealed into load #${load.id} ✓ (driver-entered).`,
      );
    } catch {
      setBanner("Couldn't seal that check — check the connection and try again. Nothing was recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardCls} aria-label="Reefer cold-chain log">
      <div className="font-semibold">🌡️ {tt(lang, "trailer.reeferLog")}</div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">
        Every temperature here is <strong className="text-[var(--text)]">entered by you, the driver</strong> — the app
        has no reefer sensor feed and never presents these as sensor readings. Each check seals into this load's
        record with its time and location, and rides the load's paperwork export: your proof when a receiver claims
        a warm load.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-28">
          <label className={labelCls} htmlFor={`rf-sp-${load.id}`}>Setpoint °F</label>
          <input id={`rf-sp-${load.id}`} type="number" inputMode="decimal" step="0.5" className={inputCls} value={setpoint} onChange={(e) => setSetpoint(e.target.value)} placeholder="34" />
        </div>
        <div className="w-28">
          <label className={labelCls} htmlFor={`rf-band-${load.id}`}>Band ± °F</label>
          <input id={`rf-band-${load.id}`} type="number" inputMode="decimal" step="0.5" min={0.5} className={inputCls} value={band} onChange={(e) => setBand(e.target.value)} />
        </div>
        <button type="button" disabled={busy} className="rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 font-semibold disabled:opacity-50" onClick={() => void saveSetpoint()}>
          Save setpoint
        </button>
      </div>
      {load.reeferSetpointF != null ? (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-32">
              <label className={labelCls} htmlFor={`rf-temp-${load.id}`}>Temp you read °F</label>
              <input id={`rf-temp-${load.id}`} type="number" inputMode="decimal" step="0.1" className={inputCls} value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="35.5" />
            </div>
            <div className="min-w-40 flex-1">
              <label className={labelCls} htmlFor={`rf-note-${load.id}`}>Note (optional)</label>
              <input id={`rf-note-${load.id}`} type="text" maxLength={200} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Fuel stop check, unit running continuous…" />
            </div>
            <button type="button" disabled={busy || temp.trim() === ""} className="btn-neon rounded-xl px-4 py-2.5 font-bold disabled:opacity-50" onClick={() => void addCheck()}>
              Seal check-in
            </button>
          </div>
          {temp.trim() !== "" && Number.isFinite(parseFloat(temp)) && (
            <p className="mt-1.5 text-xs font-semibold" role="status">
              {(() => {
                const s = reeferBandStatus({ setpointF: load.reeferSetpointF, bandF: load.reeferBandF ?? REEFER_DEFAULT_BAND_F, tempF: parseFloat(temp) });
                return s.status === "in_band" ? (
                  <span className="text-[var(--ok)]">✓ {s.label}</span>
                ) : (
                  <span className="text-[var(--danger)]">⚠️ {s.label} — sealing it records the warning with the check.</span>
                );
              })()}
            </p>
          )}
          <div className="mt-2 space-y-1">
            {checks.length === 0 && <p className="text-sm text-[var(--dim)]">No checks sealed yet — log the first one at your next stop.</p>}
            {[...checks].reverse().map((c) => {
              const s = reeferBandStatus({ setpointF: load.reeferSetpointF!, bandF: load.reeferBandF ?? REEFER_DEFAULT_BAND_F, tempF: c.tempF });
              return (
                <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm">
                  <span>
                    <strong>{c.tempF}°F</strong>{" "}
                    <span className={s.status === "in_band" ? "text-[var(--ok)]" : "font-bold text-[var(--danger)]"}>
                      {s.status === "in_band" ? "✓ in band" : `⚠️ ${s.status === "above" ? "above" : "below"} band`}
                    </span>
                    {c.note ? <span className="text-[var(--dim)]"> · {c.note}</span> : null}
                    <span className="text-[var(--dim)]"> · driver-entered{c.lat != null ? " · located" : " · no GPS fix"}</span>
                  </span>
                  <span className="text-xs text-[var(--dim)]">{fmtWhen(c.at)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-[var(--dim)]">Set the setpoint first — check-ins are judged against it and its band.</p>
      )}
    </div>
  );
}

// ---------- Dock helper (per load) ----------------------------------------------

function DockSection({
  load,
  setBanner,
  queryClient,
  lang = "en",
}: {
  load: LoadT;
  setBanner: (s: string | null) => void;
  queryClient: QueryClientT;
  lang?: Lang;
}) {
  const [appt, setAppt] = useState<string>(toLocalInput(load.dockApptAt));
  const [door, setDoor] = useState<string>(load.dockDoor ?? "");
  const [fee, setFee] = useState<string>(load.lumperFee != null ? String(load.lumperFee) : "");
  const [note, setNote] = useState<string>(load.dockNote ?? "");
  const [busy, setBusy] = useState(false);
  // Facility Memory (Final Extras): what the driver's OWN sealed
  // history says about this load's pickup + delivery facilities —
  // shown right here, where the load names them. Other loads only:
  // this load's own visit is the one being recorded, not history.
  const pickupFacility = load.shipper ?? "";
  const deliveryFacility = [load.deliveryCity, load.deliveryState].filter(Boolean).join(", ");
  const expectPickup = useQuery({
    queryKey: ["facility-visits", pickupFacility],
    queryFn: () => api.getFacilityVisits({ facility: pickupFacility }),
    enabled: pickupFacility.trim().length > 1,
  });
  const expectDelivery = useQuery({
    queryKey: ["facility-visits", deliveryFacility],
    queryFn: () => api.getFacilityVisits({ facility: deliveryFacility }),
    enabled: deliveryFacility.trim().length > 1,
  });
  const expectGroups = [
    ...groupVisitsByFacility((expectPickup.data?.visits ?? []).filter((v) => v.loadId !== load.id)),
    ...groupVisitsByFacility((expectDelivery.data?.visits ?? []).filter((v) => v.loadId !== load.id)),
  ].filter((g, i, arr) => arr.findIndex((x) => x.facility === g.facility && x.site === g.site) === i);
  const receiptQuery = useQuery({
    queryKey: ["lumper-receipt", load.id],
    queryFn: () => api.getLumperReceipt({ loadId: load.id }),
    enabled: load.hasLumperReceipt,
  });

  const save = async () => {
    setBusy(true);
    try {
      const feeNum = fee.trim() === "" ? null : parseFloat(fee);
      const res = await api.setLoadTrailerData({
        loadId: load.id,
        dockApptAt: appt ? new Date(appt).toISOString() : null,
        dockDoor: door.trim() || null,
        lumperFee: feeNum != null && Number.isFinite(feeNum) ? feeNum : null,
        dockNote: note.trim() || null,
      });
      if (!res.ok) {
        setBanner(res.error ?? "Couldn't save the dock details.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["loads"] });
      setBanner(`Dock details saved on load #${load.id} ✓`);
    } catch {
      setBanner("Couldn't save the dock details — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const onReceipt = async (file: File) => {
    setBusy(true);
    try {
      const enc = await fileToBase64(file);
      const res = await api.attachLumperReceipt({ loadId: load.id, dataBase64: enc.dataBase64, mimeType: file.type || "image/jpeg" });
      if (!res.ok) {
        setBanner(res.error ?? "Couldn't file that receipt.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["loads"] });
      queryClient.invalidateQueries({ queryKey: ["lumper-receipt", load.id] });
      setBanner(`Lumper receipt filed on load #${load.id} ✓ — fingerprinted and sealed into the load record.`);
    } catch {
      setBanner("Couldn't file that receipt — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardCls} aria-label="Dock helper">
      <div className="font-semibold">🚪 {tt(lang, "trailer.dockHelper")}</div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">Appointment, dock door, and the lumper fee — kept on the load record so the claim paperwork is already together.</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <label className={labelCls} htmlFor={`dk-appt-${load.id}`}>Appointment</label>
          <input id={`dk-appt-${load.id}`} type="datetime-local" className={inputCls} value={appt} onChange={(e) => setAppt(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor={`dk-door-${load.id}`}>Dock door</label>
          <input id={`dk-door-${load.id}`} type="text" maxLength={40} className={inputCls} value={door} onChange={(e) => setDoor(e.target.value)} placeholder="Door 12 — when assigned" />
        </div>
        <div>
          <label className={labelCls} htmlFor={`dk-fee-${load.id}`}>Lumper fee $</label>
          <input id={`dk-fee-${load.id}`} type="number" inputMode="decimal" step="0.01" min={0} className={inputCls} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className="btn-neon rounded-xl px-4 py-2.5 font-bold disabled:opacity-50" onClick={() => void save()}>
          Save dock details
        </button>
        <label className="cursor-pointer rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 font-semibold">
          {load.hasLumperReceipt ? "Replace lumper receipt" : "📷 Scan lumper receipt"}
          <input
            type="file"
            accept="image/*,.pdf"
            className="sr-only"
            aria-label="Attach lumper receipt scan"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onReceipt(f);
              e.target.value = "";
            }}
          />
        </label>
        {load.hasLumperReceipt && receiptQuery.data?.url && (
          <a href={receiptQuery.data.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[var(--accent)] underline">
            View receipt{load.lumperReceiptSha256 ? ` (SHA-256 ${load.lumperReceiptSha256.slice(0, 10)}…)` : ""}
          </a>
        )}
      </div>
      <div className="mt-2">
        <label className={labelCls} htmlFor={`dk-note-${load.id}`}>{tt(lang, "extras.checkInNote")}</label>
        <input id={`dk-note-${load.id}`} type="text" maxLength={500} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Gate code, check in at the guard shack, ask for…" aria-label="Check-in note for this facility" />
        <p className="mt-1 text-xs text-[var(--dim)]">Saved with the dock details above — Facility Memory reads it back to you on the next load that names this facility.</p>
      </div>
      {expectGroups.length > 0 && (
        <div className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2" aria-label="What to expect here — your own history">
          <div className="text-sm font-semibold">🏭 {tt(lang, "extras.facilityTitle")}</div>
          <p className="text-xs text-[var(--dim)]">{tt(lang, "extras.facilityOwnOnly")}</p>
          {expectGroups.map((g) => (
            <p key={`${g.facility}|${g.site}`} className="mt-1.5 text-sm">
              <strong>{g.facility}</strong> ({g.site}) — {g.visits.length} past visit{g.visits.length === 1 ? "" : "s"}: average dwell {g.avgDwellHours.toFixed(1)} h, detention past free time {g.avgExcessHours.toFixed(1)} h.
              <span className="block text-xs text-[var(--dim)]">
                Last time: dwell {g.last.dwellHours.toFixed(1)} h{g.last.excessHours > 0 ? `, ${g.last.excessHours.toFixed(1)} h past free time` : ""}
                {apptBehaviourLabel(g.last.apptDeltaMin) ? ` · ${apptBehaviourLabel(g.last.apptDeltaMin)}` : ""}
                {g.last.lumperFee != null ? ` · lumper ${g.last.lumperFee.toLocaleString("en-US", { style: "currency", currency: "USD" })}` : ""}
                {g.last.dockDoor ? ` · door ${g.last.dockDoor}` : ""}
              </span>
              {g.last.dockNote && <span className="block text-xs italic text-[var(--dim)]">Your check-in note: “{g.last.dockNote}”</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Securement calculator ------------------------------------------------

function SecurementCalculator({ lang = "en" }: { lang?: Lang }) {
  const [lengthFt, setLengthFt] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [rows, setRows] = useState<{ count: string; wll: string; kind: "indirect" | "direct" }[]>([
    { count: "4", wll: "5400", kind: "indirect" },
  ]);
  const result = useMemo(
    () =>
      securementCalc({
        lengthFt: parseFloat(lengthFt) || 0,
        weightLbs: parseFloat(weightLbs) || 0,
        blockedForward: blocked,
        tiedowns: rows.map((r) => ({ count: parseInt(r.count, 10) || 0, wllLbs: parseFloat(r.wll) || 0, kind: r.kind })),
      }),
    [lengthFt, weightLbs, blocked, rows],
  );
  return (
    <div className={cardCls} aria-label="Securement calculator">
      <div className="font-semibold">⛓️ {tt(lang, "trailer.securementFmcsa")}</div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">
        The published minimums: 49 CFR 393.110 (tiedown count by article length &amp; weight) and 393.106(d)
        (aggregate working load limit ≥ 50% of the cargo weight). <strong className="text-[var(--text)]">Planning
        guide only — not legal advice.</strong> Special freight (logs, coils, paper rolls, pipe, autos, boulders…)
        has its own sections and is not covered here.
        {lang !== "en" && <span className="mt-1 block font-semibold">{tt(lang, "govern.note")}</span>}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls} htmlFor="sec-len">Article length (ft)</label>
          <input id="sec-len" type="number" inputMode="decimal" step="0.1" min={0} className={inputCls} value={lengthFt} onChange={(e) => setLengthFt(e.target.value)} placeholder="20" />
        </div>
        <div>
          <label className={labelCls} htmlFor="sec-wt">Article weight (lbs)</label>
          <input id="sec-wt" type="number" inputMode="numeric" min={0} className={inputCls} value={weightLbs} onChange={(e) => setWeightLbs(e.target.value)} placeholder="20000" />
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} className="h-5 w-5" />
        Blocked / braced against forward movement (headerboard, bulkhead, other cargo) — §393.110(c) count
      </label>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="w-20">
              <label className={labelCls} htmlFor={`sec-count-${i}`}>How many</label>
              <input id={`sec-count-${i}`} type="number" inputMode="numeric" min={0} className={inputCls} value={r.count} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} />
            </div>
            <div className="w-36">
              <label className={labelCls} htmlFor={`sec-wll-${i}`}>WLL each (lbs)</label>
              <input id={`sec-wll-${i}`} type="number" inputMode="numeric" min={0} className={inputCls} value={r.wll} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, wll: e.target.value } : x)))} />
            </div>
            <div className="w-40">
              <label className={labelCls} htmlFor={`sec-kind-${i}`}>How attached</label>
              <select id={`sec-kind-${i}`} className={inputCls} value={r.kind} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value as "indirect" | "direct" } : x)))}>
                <option value="indirect">Indirect — over the load (full WLL)</option>
                <option value="direct">Direct — to the load (half WLL)</option>
              </select>
            </div>
            <select
              aria-label={`Quick-pick tiedown rating for row ${i + 1}`}
              className="w-52 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2 py-2.5 text-sm"
              value=""
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setRows(rows.map((x, j) => (j === i ? { ...x, wll: String(v) } : x)));
              }}
            >
              <option value="">Quick-pick a rating…</option>
              {TIEDOWN_PRESETS.map((p) => (
                <option key={p.wllLbs} value={p.wllLbs}>{p.label}</option>
              ))}
            </select>
          </div>
        ))}
        <button type="button" className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-sm font-semibold" onClick={() => setRows([...rows, { count: "2", wll: "4700", kind: "indirect" }])}>
          + Another tiedown type
        </button>
      </div>
      <div className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2.5 text-sm" role="status" aria-label="Securement result">
        {!result.inScope ? (
          <span className="text-[var(--dim)]">{result.outOfScopeReason}</span>
        ) : (
          <>
            <div>
              Minimum tiedowns ({result.rule.split(" + ")[0]}):{" "}
              <strong className="text-lg">{result.minTiedowns}</strong> — you have {result.tiedownsPlanned} planned{" "}
              {result.tiedownCountPass ? <span className="font-bold text-[var(--ok)]">✓ count passes</span> : <span className="font-bold text-[var(--danger)]">✗ short — add tiedowns</span>}
            </div>
            <div>
              Aggregate WLL: <strong>{result.aggregateWllLbs.toLocaleString()} lbs</strong> vs required{" "}
              {result.requiredWllLbs.toLocaleString()} lbs (50% of cargo weight){" "}
              {result.wllPass ? <span className="font-bold text-[var(--ok)]">✓ WLL passes</span> : <span className="font-bold text-[var(--danger)]">✗ WLL short — add or upsize tiedowns</span>}
            </div>
          </>
        )}
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-[var(--dim)]">
        {result.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Bridge formula (axle weight & spacing) -------------------------------

function BridgeCalculator({ lang = "en" }: { lang?: Lang }) {
  const [groups, setGroups] = useState<BridgeGroupInput[]>([
    { axles: 1, spacingFt: 1, actualLbs: null },
    { axles: 2, spacingFt: 4.3, actualLbs: null },
    { axles: 2, spacingFt: 4.3, actualLbs: null },
  ]);
  const [actualText, setActualText] = useState<string[]>(["", "", ""]);
  const calc = useMemo(
    () => bridgeFormulaCalc(groups.map((g, i) => ({ ...g, actualLbs: actualText[i]?.trim() ? parseFloat(actualText[i]!) : null }))),
    [groups, actualText],
  );
  const setGroup = (i: number, patch: Partial<BridgeGroupInput>) =>
    setGroups(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <div className={cardCls} aria-label="Axle weight and spacing calculator">
      <div className="font-semibold">⚖️ {tt(lang, "trailer.axleBridge")}</div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">
        Allowed vs actual per axle group under 23 CFR 658.17 (single axle 20,000 lb · tandem ≤8 ft apart 34,000 lb ·
        gross 80,000 lb). <strong className="text-[var(--text)]">Planning guidance only</strong> — state rules, your
        permit, and posted bridge limits govern. Sits beside Permit Mode; it doesn't change it.
      </p>
      <div className="mt-2 space-y-2">
        {groups.map((g, i) => {
          const r = calc.groups[i];
          return (
            <div key={i} className="rounded-xl bg-[var(--surface)] px-3 py-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-20">
                  <label className={labelCls} htmlFor={`bf-ax-${i}`}>Axles</label>
                  <input id={`bf-ax-${i}`} type="number" inputMode="numeric" min={1} max={9} className={inputCls} value={g.axles} onChange={(e) => setGroup(i, { axles: parseInt(e.target.value, 10) || 1 })} />
                </div>
                <div className="w-28">
                  <label className={labelCls} htmlFor={`bf-sp-${i}`}>Outer spacing (ft)</label>
                  <input id={`bf-sp-${i}`} type="number" inputMode="decimal" step="0.1" min={0} className={inputCls} value={g.spacingFt} onChange={(e) => setGroup(i, { spacingFt: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="w-32">
                  <label className={labelCls} htmlFor={`bf-wt-${i}`}>Actual weight (lbs)</label>
                  <input id={`bf-wt-${i}`} type="number" inputMode="numeric" min={0} className={inputCls} value={actualText[i] ?? ""} onChange={(e) => setActualText(actualText.map((x, j) => (j === i ? e.target.value : x)))} placeholder="34000" />
                </div>
                <button type="button" aria-label={`Remove axle group ${i + 1}`} className="rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-2.5 py-2.5 text-sm" onClick={() => { setGroups(groups.filter((_, j) => j !== i)); setActualText(actualText.filter((_, j) => j !== i)); }}>
                  ✕
                </button>
              </div>
              <div className="mt-1 text-sm" role="status">
                {r?.outOfScopeReason ? (
                  <span className="text-[var(--dim)]">{r.outOfScopeReason}</span>
                ) : (
                  <>
                    Allowed: <strong>{r?.allowedLbs?.toLocaleString()} lbs</strong>{" "}
                    <span className="text-[var(--dim)]">({r?.basis})</span>
                    {r?.pass === true && <span className="font-bold text-[var(--ok)]"> · ✓ within</span>}
                    {r?.pass === false && <span className="font-bold text-[var(--danger)]"> · ✗ {r.overLbs?.toLocaleString()} lbs OVER</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-sm font-semibold" onClick={() => { setGroups([...groups, { axles: 2, spacingFt: 8, actualLbs: null }]); setActualText([...actualText, ""]); }}>
          + Add axle group (jeep / booster…)
        </button>
        {calc.grossActualLbs != null && (
          <span className="text-sm" role="status">
            Gross actual: <strong>{calc.grossActualLbs.toLocaleString()} lbs</strong> / 80,000{" "}
            {calc.grossPass ? <span className="font-bold text-[var(--ok)]">✓</span> : <span className="font-bold text-[var(--danger)]">✗ OVER GROSS</span>}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Pre-trip inspection checklist -----------------------------------------

function PretripChecklist({
  trailerType,
  activeLoad,
  pos,
  setBanner,
  queryClient,
  lang = "en",
}: {
  trailerType: TrailerType;
  activeLoad: LoadT | null;
  pos: LatLon | null;
  setBanner: (s: string | null) => void;
  queryClient: QueryClientT;
  lang?: Lang;
}) {
  const items = useMemo(() => pretripChecklist(trailerType), [trailerType]);
  const [marks, setMarks] = useState<Record<string, { ok: boolean; note: string }>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const recentQuery = useQuery({
    queryKey: ["pretrip-inspections"],
    queryFn: () => api.listPretripInspections({ limit: 5 }),
  });
  useEffect(() => {
    setMarks({});
    setPhoto(null);
  }, [trailerType]);
  const checkedCount = items.filter((i) => marks[i.id]).length;
  const defectCount = items.filter((i) => marks[i.id] && !marks[i.id]!.ok).length;

  const seal = async () => {
    setBusy(true);
    try {
      let photoDataBase64: string | null = null;
      let photoMime: string | null = null;
      if (photo) {
        const enc = await fileToBase64(photo);
        photoDataBase64 = enc.dataBase64;
        photoMime = photo.type || "image/jpeg";
      }
      const res = await api.savePretripInspection({
        loadId: activeLoad?.id ?? null,
        trailerType,
        items: items.map((i) => ({
          id: i.id,
          label: i.label,
          ok: marks[i.id]?.ok ?? true,
          note: marks[i.id]?.note.trim() || null,
        })),
        photoDataBase64,
        photoMime,
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
      });
      if (!res.ok) {
        setBanner(res.error ?? "Couldn't seal the inspection.");
        return;
      }
      setMarks({});
      setPhoto(null);
      queryClient.invalidateQueries({ queryKey: ["pretrip-inspections"] });
      setBanner(
        defectCount > 0
          ? `Pre-trip sealed for ${trailerProfile(trailerType).label} with ${defectCount} defect${defectCount === 1 ? "" : "s"} noted ⚠️ — defects ride the record; get them fixed before they ground you.`
          : `Pre-trip inspection sealed ✓ — ${trailerProfile(trailerType).label}, all items checked OK.`,
      );
    } catch {
      setBanner("Couldn't seal the inspection — check the connection and try again. Nothing was recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardCls} aria-label="Pre-trip inspection checklist">
      <div className="font-semibold">✅ {tt(lang, "trailer.pretripFor", { type: trailerTypeLabel(lang, trailerType) })}</div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">
        The checklist for your active trailer type. Walk it, mark anything wrong as a defect with a note, attach a
        photo if it helps, and seal it — it lands in the sealed record{activeLoad ? ` against load #${activeLoad.id}` : ""},
        like your trips and loads.
      </p>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => {
          const mark = marks[item.id];
          return (
            <div key={item.id} className="rounded-lg bg-[var(--surface)] px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm">{item.label}</span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Mark OK: ${item.label}`}
                    aria-pressed={mark?.ok === true}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold ${mark?.ok === true ? "bg-[var(--ok)] text-black" : "bg-[var(--surface2)] border border-[var(--border)]"}`}
                    onClick={() => setMarks({ ...marks, [item.id]: { ok: true, note: mark?.note ?? "" } })}
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    aria-label={`Mark defect: ${item.label}`}
                    aria-pressed={mark?.ok === false}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold ${mark?.ok === false ? "bg-[var(--danger)] text-white" : "bg-[var(--surface2)] border border-[var(--border)]"}`}
                    onClick={() => setMarks({ ...marks, [item.id]: { ok: false, note: mark?.note ?? "" } })}
                  >
                    Defect
                  </button>
                </span>
              </div>
              {mark?.ok === false && (
                <input
                  type="text"
                  maxLength={300}
                  className={`${inputCls} mt-1.5`}
                  value={mark.note}
                  onChange={(e) => setMarks({ ...marks, [item.id]: { ok: false, note: e.target.value } })}
                  placeholder="What's wrong? (rides the sealed record)"
                  aria-label={`Defect note: ${item.label}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 font-semibold">
          {photo ? `📷 ${photo.name.slice(0, 24)}` : "📷 Attach a photo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Attach inspection photo"
            onChange={(e) => {
              setPhoto(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
        <button type="button" disabled={busy} className="btn-neon rounded-xl px-4 py-2.5 font-bold disabled:opacity-50" onClick={() => void seal()}>
          Seal inspection
        </button>
        <span className="text-xs text-[var(--dim)]">
          {checkedCount}/{items.length} marked{defectCount > 0 ? ` · ${defectCount} defect${defectCount === 1 ? "" : "s"}` : ""} — unmarked items seal as OK.
        </span>
      </div>
      {(recentQuery.data?.inspections ?? []).length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Recent sealed inspections</div>
          {(recentQuery.data?.inspections ?? []).map((ins) => (
            <div key={ins.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm">
              <span>
                {trailerProfile((TRAILER_TYPES as string[]).includes(ins.trailerType) ? (ins.trailerType as TrailerType) : "dry_van").label}
                {ins.loadId != null ? ` · load #${ins.loadId}` : ""} ·{" "}
                {ins.defectCount > 0 ? <span className="font-bold text-[var(--danger)]">{ins.defectCount} defect{ins.defectCount === 1 ? "" : "s"}</span> : <span className="text-[var(--ok)]">all OK</span>}
                {ins.hasPhoto ? " · 📷 photo filed" : ""}
              </span>
              <span className="text-xs text-[var(--dim)]">{fmtWhen(ins.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Trailer type display name in the driver's language (the profile's
// English label stays the fallback and the record value).
function trailerTypeLabel(lang: Lang, type: TrailerType): string {
  switch (type) {
    case "dry_van": return tt(lang, "trailer.dryVan");
    case "reefer": return tt(lang, "trailer.reefer");
    case "flatbed": return tt(lang, "trailer.flatbed");
    case "step_deck": return tt(lang, "trailer.stepDeck");
    case "rgn": return tt(lang, "trailer.rgn");
    default: return trailerProfile(type).label;
  }
}

// ---------- Per-load trailer section (load details) -------------------------------

export function LoadTrailerSection({
  load,
  trailerType,
  truckHeightIn,
  pos,
  setBanner,
  queryClient,
  lang = "en",
}: {
  load: LoadT;
  trailerType: TrailerType;
  truckHeightIn: number;
  pos: LatLon | null;
  setBanner: (s: string | null) => void;
  queryClient: QueryClientT;
  lang?: Lang;
}) {
  const profile = trailerProfile(trailerType);
  const isReefer = trailerType === "reefer" || load.equipmentType === "reefer";
  const showHeight = profile.openDeck || load.equipmentFamily === "open";
  return (
    <div className="mt-2.5 space-y-2" aria-label="Trailer tools for this load">
      <div className="text-sm font-bold">🚛 {tt(lang, "trailer.toolsFor", { type: trailerTypeLabel(lang, trailerType) })}</div>
      {isReefer && <ReeferSection load={load} pos={pos} setBanner={setBanner} queryClient={queryClient} lang={lang} />}
      {showHeight && <LoadedHeightSection load={load} truckHeightIn={truckHeightIn} setBanner={setBanner} queryClient={queryClient} lang={lang} />}
      <DockSection load={load} setBanner={setBanner} queryClient={queryClient} lang={lang} />
      {!showHeight && (
        <p className="text-xs text-[var(--dim)]">
          Height in use for bridge alerts on this load: {heightInUse({ loadedHeightIn: load.loadedHeightIn, truckHeightIn: truckHeightIn }).label}.
          {load.loadedHeightIn != null ? "" : " Open-deck profiles (flatbed / step deck / RGN) record a per-load loaded height here."}
        </p>
      )}
    </div>
  );
}

// ---------- Trailer tools panel (Loads tab) ---------------------------------------

export function TrailerToolsPanel({
  trailerType,
  onTrailerTypeChange,
  activeLoad,
  truckHeightIn,
  pos,
  setBanner,
  queryClient,
  focusNonce,
  lang = "en",
}: {
  trailerType: TrailerType;
  onTrailerTypeChange: (t: TrailerType) => void;
  activeLoad: LoadT | null;
  truckHeightIn: number;
  pos: LatLon | null;
  setBanner: (s: string | null) => void;
  queryClient: QueryClientT;
  focusNonce: number;
  lang?: Lang;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (focusNonce > 0) setOpen(true);
  }, [focusNonce]);
  const profile = trailerProfile(trailerType);
  const allTools: TrailerToolId[] = ["reefer", "securement", "height", "axle", "dock", "checklist"];
  const ordered: TrailerToolId[] = [...profile.toolOrder, ...allTools.filter((t) => !profile.toolOrder.includes(t))];

  const renderTool = (tool: TrailerToolId) => {
    switch (tool) {
      case "securement":
        return <SecurementCalculator key="securement" lang={lang} />;
      case "axle":
        return <BridgeCalculator key="axle" lang={lang} />;
      case "checklist":
        return (
          <PretripChecklist key="checklist" trailerType={trailerType} activeLoad={activeLoad} pos={pos} setBanner={setBanner} queryClient={queryClient} lang={lang} />
        );
      case "reefer":
        return activeLoad ? (
          <ReeferSection key="reefer" load={activeLoad} pos={pos} setBanner={setBanner} queryClient={queryClient} lang={lang} />
        ) : (
          <div key="reefer" className={cardCls}>
            <div className="font-semibold">🌡️ {tt(lang, "trailer.reeferLog")}</div>
            <p className="mt-0.5 text-sm text-[var(--dim)]">The cold-chain log lives on each load — open a load below (or set one active) and its Trailer tools carry the setpoint and check-ins.</p>
          </div>
        );
      case "height":
        return activeLoad ? (
          <LoadedHeightSection key="height" load={activeLoad} truckHeightIn={truckHeightIn} setBanner={setBanner} queryClient={queryClient} lang={lang} />
        ) : (
          <div key="height" className={cardCls}>
            <div className="font-semibold">📏 {tt(lang, "trailer.loadedHeight")}</div>
            <p className="mt-0.5 text-sm text-[var(--dim)]">Loaded height is per load — open a load below and record it in its Trailer tools; until then bridge alerts use your truck profile height {fmtHeightIn(truckHeightIn)}.</p>
          </div>
        );
      case "dock":
        return activeLoad ? (
          <DockSection key="dock" load={activeLoad} setBanner={setBanner} queryClient={queryClient} lang={lang} />
        ) : (
          <div key="dock" className={cardCls}>
            <div className="font-semibold">🚪 {tt(lang, "trailer.dockHelper")}</div>
            <p className="mt-0.5 text-sm text-[var(--dim)]">Appointment, dock door, and lumper fee live on each load — open a load below to fill them in.</p>
          </div>
        );
    }
  };

  return (
    <section className="glass-panel p-3.5" aria-label="Trailer tools">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
        aria-label={open ? "Hide trailer tools" : "Show trailer tools"}
        onClick={() => setOpen(!open)}
      >
        <span>
          <span className="font-condensed text-xl font-bold">🚛 {tt(lang, "trailer.toolsFor", { type: trailerTypeLabel(lang, trailerType) })}</span>
          <span className="block text-xs text-[var(--dim)]">
            Tools tuned to your trailer profile
            {activeLoad ? ` · per-load tools are aimed at load #${activeLoad.id}` : " · no active load — calculators & checklist still work"}
          </span>
        </span>
        <span aria-hidden="true" className="text-lg">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div>
            <span className={labelCls}>Your trailer — one active profile per truck, switch any time (also in Settings → Truck)</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Trailer type">
              {TRAILER_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={trailerType === t}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ${trailerType === t ? "btn-neon" : "bg-[var(--surface2)] border border-[var(--border)]"}`}
                  onClick={() => onTrailerTypeChange(t)}
                >
                  {trailerTypeLabel(lang, t)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[var(--dim)]">
              The profile tunes the defaults: typical empty height {fmtHeightIn(profile.emptyHeightIn)}
              {profile.deckHeightIn != null ? ` · deck ${fmtHeightIn(profile.deckHeightIn)}` : ""}, the tool order below,
              the pre-trip checklist, and{profile.highProfile ? " high-wind blow-over advisories when running empty" : " open-deck securement & height tools first"}.
            </p>
          </div>
          {ordered.map((tool, i) => (
            <div key={tool}>
              {i === profile.toolOrder.length && (
                <div className="pt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">{tt(lang, "trailer.moreTools")}</div>
              )}
              {renderTool(tool)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- Wind advisory banner (Drive screen) -------------------------------------

export function WindAdvisoryBanner({
  trailerType,
  trailerEmpty,
  gustMph,
  windMph,
}: {
  trailerType: TrailerType;
  trailerEmpty: boolean;
  gustMph: number | null;
  windMph: number | null;
}) {
  const advisory = windAdvisory({ trailerType, trailerEmpty, gustMph, windMph });
  if (!advisory.show || !advisory.text) return null;
  return (
    <div
      role="alert"
      className="pointer-events-auto rounded-2xl border-2 border-amber-400 bg-amber-500/95 px-3.5 py-2.5 text-sm font-semibold text-black shadow-lg"
      aria-label="High wind advisory for empty trailer"
    >
      {advisory.text}
    </div>
  );
}
