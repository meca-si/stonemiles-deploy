// PermitsPanel.tsx — OS/OW Permit Mode: scan + confirm, the permit
// library, and the full docket (x, 2026-11-04, freeze exception).
// Permit Mode is a DIAMOND feature (x's call, 2026-11-04 — "put ours
// in diamond"): on Basic/Gold the panel renders the Safety Academy
// pattern — a lock banner naming the tier, the library still listed
// below it — and every write path (scan read, filing, the completed
// toggle) is Diamond-gated server-side as well (extractPermit /
// acceptPermit / setPermitCompleted). Filed permits stay READABLE on
// every plan: listPermits / getPermit are never gated, so a driver
// who drops off Diamond keeps sight of the dockets already on file.
//
// The scan half is the app's standing document pattern (extractLoad /
// extractPayStub): Meca reads the permit photo — or a PDF's rendered
// pages — and fills the confirm form; NOTHING files off the read.
// The driver checks and edits every field, then "File this permit"
// saves the docket exactly as confirmed through acceptPermit, sealing
// the document's bytes behind it and filing a copy into the load's
// paperwork when a load is attached. Permits never send email copies.
//
// The library groups by DERIVED status (permit.ts): Active (today
// inside the valid window, plus not-yet-open permits labelled with
// their start), Completed (driver marked done), Expired (window
// passed). The docket shows the confirmed fields verbatim — nothing
// re-worded, nothing re-summarized.

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { PdfViewer } from "@hatch/space-sdk/pdf";
import { api } from "./api";
import { t, type Lang } from "./i18n";
import { classifyDocFile, renderPdfPages } from "./pdfDoc";
import { base64FitsCap, fileBytesFitCap, prepareDocImage, docTooLargeMessage } from "./docImage";
import {
  buildPlacards,
  groupPermits,
  mergePermitReads,
  permitStatusOf,
  type PermitDocket,
  type PermitRead,
} from "./permit";

type Banner = (s: string | null) => void;

const inputCls = "w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-[var(--text)]";
const labelCls = "block text-xs font-bold uppercase tracking-wide text-[var(--dim)] mb-1";

function localTodayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(`${iso}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? iso : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type PermitForm = {
  permitNumber: string;
  issuingState: string;
  issuingAgency: string;
  routeStepsText: string;
  routePlacesText: string;
  heightText: string;
  widthText: string;
  lengthText: string;
  weightText: string;
  // Numeric readings from the scan. Each is dropped (sent as null)
  // the moment the driver edits its printed-text twin — a stale
  // conversion must never ride behind retyped text.
  heightIn: number | null;
  widthIn: number | null;
  lengthIn: number | null;
  weightLbs: number | null;
  validFrom: string;
  validTo: string;
  escorts: string;
  curfewsText: string;
  restrictionsText: string;
  qrText: string;
  loadId: string; // "" = no load
  doc: { base64: string; mime: string } | null;
  source: "scan" | "manual";
};

const blankForm = (): PermitForm => ({
  permitNumber: "",
  issuingState: "",
  issuingAgency: "",
  routeStepsText: "",
  routePlacesText: "",
  heightText: "",
  widthText: "",
  lengthText: "",
  weightText: "",
  heightIn: null,
  widthIn: null,
  lengthIn: null,
  weightLbs: null,
  validFrom: "",
  validTo: "",
  escorts: "",
  curfewsText: "",
  restrictionsText: "",
  qrText: "",
  loadId: "",
  doc: null,
  source: "manual",
});

function formFromRead(read: PermitRead, doc: { base64: string; mime: string } | null): PermitForm {
  return {
    ...blankForm(),
    permitNumber: read.permitNumber ?? "",
    issuingState: read.issuingState ?? "",
    issuingAgency: read.issuingAgency ?? "",
    routeStepsText: read.routeSteps.join("\n"),
    routePlacesText: read.routePlaces.join("\n"),
    heightText: read.heightText ?? "",
    widthText: read.widthText ?? "",
    lengthText: read.lengthText ?? "",
    weightText: read.weightText ?? "",
    heightIn: read.heightIn,
    widthIn: read.widthIn,
    lengthIn: read.lengthIn,
    weightLbs: read.weightLbs,
    validFrom: read.validFrom ?? "",
    validTo: read.validTo ?? "",
    escorts: read.escorts ?? "",
    curfewsText: read.curfews.join("\n"),
    restrictionsText: read.restrictions.join("\n"),
    qrText: read.qrText ?? "",
    doc,
    source: "scan",
  };
}

const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function PermitsPanel({
  setBanner,
  focusPermitId,
  focusNonce,
  diamond,
  planName,
  lang = "en",
}: {
  setBanner: Banner;
  focusPermitId?: number | null;
  focusNonce?: number;
  /** Diamond tier access (Diamond Driver / Owner) — App's plan query
   *  owns the value; the server re-checks it on every write. */
  diamond: boolean;
  /** The recorded plan's display name, for the lock copy. */
  planName: string;
  /** The driver's chosen language. Permit terms themselves stay in
   *  English exactly as issued (they govern); the note under the
   *  title says so in the driver's language. */
  lang?: Lang;
}) {
  const queryClient = useQueryClient();
  const permitsQuery = useQuery({ queryKey: ["permits"], queryFn: () => api.listPermits({ limit: 100 }) });
  const loadsQuery = useQuery({ queryKey: ["loads"], queryFn: () => api.listLoads({ limit: 100 }) });
  const [form, setForm] = useState<PermitForm | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const today = localTodayIso();

  // A corridor-match failure on the Drive screen lands the driver
  // here with the docket open (App passes the permit id + a nonce).
  useEffect(() => {
    if (focusPermitId != null && focusNonce != null && focusNonce > 0) {
      setOpenId(focusPermitId);
    }
  }, [focusPermitId, focusNonce]);

  const permits = useMemo(() => permitsQuery.data?.permits ?? [], [permitsQuery.data]);
  const groups = useMemo(() => groupPermits(permits, today), [permits, today]);
  const openPermit = permits.find((p) => p.id === openId) ?? null;
  const docQuery = useQuery({
    queryKey: ["permit-doc", openPermit?.id ?? 0],
    queryFn: () => api.getPermit({ id: openPermit!.id }),
    enabled: openPermit != null && openPermit.hasDoc,
  });

  const onScanFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const mime = file.type || "application/octet-stream";
    const kind = classifyDocFile(mime, file.name);
    setScanNote(null);
    if (kind === "photo") {
      const prep = await prepareDocImage(file);
      if (!prep.ok) {
        setBanner(prep.reason === "too_large" ? docTooLargeMessage("photo") : "Couldn't read that file — you can still file the permit by hand below.");
        return;
      }
      setScanBusy(true);
      try {
        const r = await api.extractPermit({ dataBase64: prep.dataBase64, mimeType: prep.mimeType });
        if (!r.premium) {
          setBanner(`Permit Mode is a Diamond Driver feature — your recorded plan is ${planName}, so nothing was read. It unlocks with Diamond Driver or Owner (Owner drivers get Diamond included); see Plans.`);
          return;
        }
        const doc = { base64: prep.dataBase64, mime: prep.mimeType };
        if (!r.found) {
          setForm({ ...blankForm(), doc, source: "scan" });
          setScanNote("That photo doesn't show a readable OS/OW permit — nothing was filled in and nothing was guessed. The photo is attached; type the docket from the paper, then file it.");
          return;
        }
        setForm(formFromRead(r, doc));
        setScanNote("Meca filled this form from the permit — check EVERY field against the paper (the route especially: it must read exactly as printed) and fix anything off before filing. Nothing is filed yet.");
      } catch {
        setBanner("Couldn't read that photo — file the permit by hand below; nothing was filled in.");
      } finally {
        setScanBusy(false);
      }
      return;
    }
    if (kind === "pdf") {
      if (!fileBytesFitCap(file.size)) {
        setBanner(docTooLargeMessage("file"));
        return;
      }
      const enc = await fileToBase64(file).catch(() => null);
      if (!enc || !base64FitsCap(enc.dataBase64)) {
        setBanner(docTooLargeMessage("file"));
        return;
      }
      const doc = { base64: enc.dataBase64, mime: enc.mimeType || "application/pdf" };
      setScanBusy(true);
      setScanNote("Reading the PDF's pages…");
      try {
        const rendered = await renderPdfPages(file);
        if (!rendered.ok) {
          setForm({ ...blankForm(), doc, source: "scan" });
          setScanNote("That PDF couldn't be rendered for reading — it's attached below; type the docket from the paper, then file it.");
          return;
        }
        const reads: PermitRead[] = [];
        for (const page of rendered.pages) {
          const pageRead = await api.extractPermit({ dataBase64: page.dataBase64, mimeType: page.mimeType });
          if (!pageRead.premium) {
            setBanner(`Permit Mode is a Diamond Driver feature — your recorded plan is ${planName}, so nothing was read. It unlocks with Diamond Driver or Owner (Owner drivers get Diamond included); see Plans.`);
            setScanNote(null);
            return;
          }
          reads.push(pageRead);
        }
        const merged = mergePermitReads(reads);
        if (!merged) {
          setForm({ ...blankForm(), doc, source: "scan" });
          setScanNote("Those pages don't show a readable OS/OW permit — nothing was filled in and nothing was guessed. The PDF is attached; type the docket from the paper, then file it.");
          return;
        }
        setForm(formFromRead(merged, doc));
        setScanNote("Meca filled this form from the permit PDF — check EVERY field against the paper (the route especially: it must read exactly as printed) and fix anything off before filing. Nothing is filed yet.");
      } catch {
        setBanner("Couldn't read that PDF — file the permit by hand below; nothing was filled in.");
        setScanNote(null);
      } finally {
        setScanBusy(false);
      }
      return;
    }
    setBanner("Permits read from a photo (JPEG/PNG) or a PDF. For another file type, file the permit by hand below.");
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await api.acceptPermit({
        loadId: form.loadId ? Number(form.loadId) : null,
        permitNumber: form.permitNumber.trim() || null,
        issuingState: form.issuingState.trim() || null,
        issuingAgency: form.issuingAgency.trim() || null,
        routeSteps: linesOf(form.routeStepsText),
        routePlaces: linesOf(form.routePlacesText),
        heightText: form.heightText.trim() || null,
        widthText: form.widthText.trim() || null,
        lengthText: form.lengthText.trim() || null,
        weightText: form.weightText.trim() || null,
        heightIn: form.heightIn,
        widthIn: form.widthIn,
        lengthIn: form.lengthIn,
        weightLbs: form.weightLbs,
        validFrom: form.validFrom || null,
        validTo: form.validTo || null,
        escorts: form.escorts.trim() || null,
        curfews: linesOf(form.curfewsText),
        restrictions: linesOf(form.restrictionsText),
        qrText: form.qrText.trim() || null,
        docDataBase64: form.doc?.base64 ?? null,
        docMime: form.doc?.mime ?? null,
      });
      if (!res.ok) {
        setBanner(res.error ?? "That permit didn't file — check the fields and try again.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["permits"] });
      setForm(null);
      setScanNote(null);
      setOpenId(res.permitId);
      setBanner(
        res.filedCopy
          ? "Permit filed — the docket is in your permit library and a copy rides in the load's filed paperwork."
          : "Permit filed — the docket is in your permit library below.",
      );
    } catch {
      setBanner("That permit didn't file — check your connection and try again. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  const toggleCompleted = async (p: PermitDocket) => {
    const res = await api.setPermitCompleted({ id: p.id, completed: p.completedAt == null });
    if (!res.ok) {
      setBanner(res.error ?? "That didn't save — try again.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["permits"] });
    setBanner(p.completedAt == null ? "Permit marked completed — it shelves under Completed in your library." : "Permit reopened — its status follows its valid window again.");
  };

  const statusChip = (p: PermitDocket) => {
    const s = permitStatusOf(p, today);
    if (s === "completed") return <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">Completed</span>;
    if (s === "expired") return <span className="rounded-full bg-[var(--danger)] px-2.5 py-1 text-xs font-bold text-white">Expired</span>;
    if (s === "upcoming") return <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-bold text-black">Starts {fmtDay(p.validFrom)}</span>;
    return <span className="rounded-full bg-[var(--ok)] px-2.5 py-1 text-xs font-bold text-black">Active</span>;
  };

  const renderDocket = (p: PermitDocket) => (
    <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3 text-sm">
      <p className="text-xs font-semibold text-[var(--dim)]">
        The full docket, exactly as you confirmed it — nothing here is re-worded or re-summarized.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={labelCls}>Permit #</span>{p.permitNumber ?? "—"}</div>
        <div><span className={labelCls}>Issued by</span>{[p.issuingAgency, p.issuingState].filter(Boolean).join(" · ") || "—"}</div>
        <div><span className={labelCls}>Valid</span>{fmtDay(p.validFrom)} → {fmtDay(p.validTo)}</div>
        <div><span className={labelCls}>Attached load</span>{p.loadId != null ? `Load #${p.loadId}` : "None"}</div>
        <div><span className={labelCls}>Height</span>{p.heightText ?? "—"}</div>
        <div><span className={labelCls}>Width</span>{p.widthText ?? "—"}</div>
        <div><span className={labelCls}>Total length</span>{p.lengthText ?? "—"}</div>
        <div><span className={labelCls}>Weight</span>{p.weightText ?? "—"}</div>
      </div>
      <div>
        <span className={labelCls}>Approved route — as printed, in order</span>
        {p.routeSteps.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5">
            {p.routeSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        ) : (
          <p className="text-[var(--dim)]">No route lines on file.</p>
        )}
      </div>
      {p.routePlaces.length > 0 && (
        <div>
          <span className={labelCls}>Places on the route (as printed)</span>
          <p>{p.routePlaces.join(" → ")}</p>
        </div>
      )}
      <div>
        <span className={labelCls}>Escorts</span>
        <p>{p.escorts ?? "—"}</p>
      </div>
      {p.curfews.length > 0 && (
        <div>
          <span className={labelCls}>Curfews / no-movement windows</span>
          <ul className="list-disc space-y-1 pl-5">
            {p.curfews.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {p.restrictions.length > 0 && (
        <div>
          <span className={labelCls}>Restrictions & conditions</span>
          <ul className="list-disc space-y-1 pl-5">
            {p.restrictions.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {p.qrText && (
        <div>
          <span className={labelCls}>QR code on the permit</span>
          <p className="break-all">{p.qrText}</p>
        </div>
      )}
      {p.hasDoc && (
        <div>
          <span className={labelCls}>The permit document</span>
          {docQuery.isLoading ? (
            <p className="text-[var(--dim)]">Loading the filed document…</p>
          ) : docQuery.data?.docUrl ? (
            docQuery.data.permit?.docMime === "application/pdf" ? (
              <PdfViewer src={docQuery.data.docUrl} ariaLabel={`OS/OW permit ${p.permitNumber ?? p.id}`} />
            ) : (
              <img src={docQuery.data.docUrl} alt={`Scanned OS/OW permit ${p.permitNumber ?? p.id}`} className="w-full rounded-xl border border-[var(--border)]" />
            )
          ) : (
            <p className="text-[var(--dim)]">The filed document couldn't be loaded right now.</p>
          )}
        </div>
      )}
      {diamond && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-press min-h-[44px] rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-4 py-2.5 text-sm font-bold"
            aria-label={p.completedAt == null ? `Mark permit ${p.permitNumber ?? p.id} completed` : `Reopen permit ${p.permitNumber ?? p.id}`}
            onClick={() => void toggleCompleted(p)}
          >
            {p.completedAt == null ? "✓ Mark completed" : "↩ Reopen permit"}
          </button>
          {permitStatusOf(p, today) === "active" && (
            <p className="w-full text-xs font-semibold text-[var(--dim)]">
              To drive it: plan a route on the Drive screen — the route chooser offers “Permit route” for this permit, and navigation follows the approved route instead of the fastest one.
            </p>
          )}
        </div>
      )}
    </div>
  );

  const renderPermitRow = (p: PermitDocket) => (
    <div key={p.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <button
        type="button"
        className="btn-press flex w-full items-start gap-2 text-left"
        aria-expanded={openId === p.id}
        aria-label={`${openId === p.id ? "Close" : "Open"} the full docket for permit ${p.permitNumber ?? p.id}`}
        onClick={() => setOpenId(openId === p.id ? null : p.id)}
      >
        <div className="min-w-0 flex-1">
          <div className="font-condensed text-lg font-bold leading-tight">
            🪧 {p.permitNumber ?? "Permit"} {p.issuingState ? `· ${p.issuingState}` : ""}
          </div>
          <div className="truncate text-xs font-semibold text-[var(--dim)]">
            {fmtDay(p.validFrom)} → {fmtDay(p.validTo)}
            {p.loadId != null ? ` · Load #${p.loadId}` : ""}
            {p.routeSteps.length > 0 ? ` · ${p.routeSteps.length} route lines` : ""}
          </div>
        </div>
        {statusChip(p)}
      </button>
      {openId === p.id && renderDocket(p)}
    </div>
  );

  const set = (patch: Partial<PermitForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <section className="glass-panel p-4" aria-label="OS/OW permits">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-condensed text-2xl font-bold">
            🪧 OS/OW Permits{" "}
            <span className="ml-1 align-middle rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-extrabold tracking-wide text-black">💎 DIAMOND</span>
          </h2>
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            Scan a state oversize/overweight permit and Meca fills the docket — route, dimensions, dates, escorts, curfews, restrictions. You confirm every field before it files. On the road, Permit route navigation follows the approved route.
          </p>
          {lang !== "en" && (
            <p className="mt-1 text-xs font-semibold text-[var(--dim)]" role="note">
              {t(lang, "govern.permitsNote")} {t(lang, "govern.note")}
            </p>
          )}
        </div>
      </div>

      {!diamond && (
        <div className="mt-3 rounded-2xl border-2 border-[var(--border)] bg-[var(--surface)] p-3.5" aria-label="Permit Mode locked — Diamond feature">
          <p className="text-sm leading-relaxed">
            🔒 <strong>Permit Mode comes with Diamond Driver and Owner plans</strong> (Owner drivers get Diamond included). Your recorded plan is {planName} — scanning permits, filing new dockets, and driving the approved route with its restriction placards unlock when you upgrade to Diamond. Permits already on file stay readable below.
          </p>
        </div>
      )}

      {diamond && !form && (
        <div className="mt-3 flex flex-wrap gap-2">
          <label
            className={`btn-neon btn-press inline-flex min-h-[48px] cursor-pointer items-center rounded-xl px-4 font-condensed text-lg font-bold ${scanBusy ? "pointer-events-none opacity-60" : ""}`}
          >
            {scanBusy ? "Reading…" : "📷 Scan a permit"}
            <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" aria-label="Scan an OS/OW permit photo or PDF" onChange={(e) => void onScanFile(e)} disabled={scanBusy} />
          </label>
          <button
            type="button"
            className="btn-press min-h-[48px] rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-4 font-bold"
            aria-label="File a permit by hand"
            onClick={() => { setForm(blankForm()); setScanNote(null); }}
          >
            File by hand
          </button>
        </div>
      )}
      {scanNote && !form && (
        <p className="mt-2 rounded-xl bg-amber-900/40 px-3 py-2 text-sm font-semibold text-amber-200" role="status">{scanNote}</p>
      )}

      {form && (
        <div className="mt-3 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="font-condensed text-xl font-bold leading-tight">
            {form.source === "scan" ? "Confirm the permit docket" : "File a permit by hand"}
          </div>
          {scanNote && (
            <p className="rounded-xl bg-amber-900/40 px-3 py-2 text-sm font-semibold text-amber-200" role="status">{scanNote}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls} htmlFor="permit-number">Permit number</label>
              <input id="permit-number" className={inputCls} value={form.permitNumber} onChange={(e) => set({ permitNumber: e.target.value })} autoComplete="off" />
            </div>
            <div>
              <label className={labelCls} htmlFor="permit-state">Issuing state</label>
              <input id="permit-state" className={inputCls} value={form.issuingState} onChange={(e) => set({ issuingState: e.target.value })} autoComplete="off" />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-agency">Issuing agency</label>
            <input id="permit-agency" className={inputCls} value={form.issuingAgency} onChange={(e) => set({ issuingAgency: e.target.value })} autoComplete="off" />
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-route">Approved route — one line per printed step, in order, exactly as printed</label>
            <textarea id="permit-route" className={`${inputCls} min-h-[110px]`} value={form.routeStepsText} onChange={(e) => set({ routeStepsText: e.target.value })} placeholder={"I-10 W\nUS-98 N\nAL-158 E to delivery"} />
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-places">Places on the route — one per line, in order (used to match the printed route to the road network)</label>
            <textarea id="permit-places" className={`${inputCls} min-h-[64px]`} value={form.routePlacesText} onChange={(e) => set({ routePlacesText: e.target.value })} placeholder={"Mobile, AL\nPensacola, FL"} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls} htmlFor="permit-height">Height (as printed)</label>
              <input id="permit-height" className={inputCls} value={form.heightText} onChange={(e) => set({ heightText: e.target.value, heightIn: null })} autoComplete="off" />
            </div>
            <div>
              <label className={labelCls} htmlFor="permit-width">Width (as printed)</label>
              <input id="permit-width" className={inputCls} value={form.widthText} onChange={(e) => set({ widthText: e.target.value, widthIn: null })} autoComplete="off" />
            </div>
            <div>
              <label className={labelCls} htmlFor="permit-length">Total length (as printed)</label>
              <input id="permit-length" className={inputCls} value={form.lengthText} onChange={(e) => set({ lengthText: e.target.value, lengthIn: null })} autoComplete="off" />
            </div>
            <div>
              <label className={labelCls} htmlFor="permit-weight">Weight (as printed)</label>
              <input id="permit-weight" className={inputCls} value={form.weightText} onChange={(e) => set({ weightText: e.target.value, weightLbs: null })} autoComplete="off" />
            </div>
            <div>
              <label className={labelCls} htmlFor="permit-from">Valid from</label>
              <input id="permit-from" type="date" className={inputCls} value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="permit-to">Valid to</label>
              <input id="permit-to" type="date" className={inputCls} value={form.validTo} onChange={(e) => set({ validTo: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-escorts">Escort requirements (as printed)</label>
            <input id="permit-escorts" className={inputCls} value={form.escorts} onChange={(e) => set({ escorts: e.target.value })} autoComplete="off" />
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-curfews">Curfews / no-movement windows — one per line, as printed</label>
            <textarea id="permit-curfews" className={`${inputCls} min-h-[64px]`} value={form.curfewsText} onChange={(e) => set({ curfewsText: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-restrictions">Restrictions — bridge bypasses, bans, conditions — one per line, as printed</label>
            <textarea id="permit-restrictions" className={`${inputCls} min-h-[64px]`} value={form.restrictionsText} onChange={(e) => set({ restrictionsText: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-qr">QR code content (when the permit carries one)</label>
            <input id="permit-qr" className={inputCls} value={form.qrText} onChange={(e) => set({ qrText: e.target.value })} autoComplete="off" />
          </div>
          <div>
            <label className={labelCls} htmlFor="permit-load">Attach to a load (optional)</label>
            <select id="permit-load" className={inputCls} value={form.loadId} onChange={(e) => set({ loadId: e.target.value })}>
              <option value="">No load — file it standalone</option>
              {(loadsQuery.data?.loads ?? []).map((l) => (
                <option key={l.id} value={String(l.id)}>
                  Load #{l.id} · {l.pickupCity ?? "?"} → {l.deliveryCity ?? "?"}
                </option>
              ))}
            </select>
          </div>
          {form.doc && (
            <p className="text-xs font-semibold text-[var(--dim)]">
              📎 The {form.doc.mime === "application/pdf" ? "PDF" : "photo"} is attached — it seals behind the permit when you file, fingerprinted so changes are detectable.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-neon btn-press min-h-[52px] flex-1 rounded-xl px-4 font-condensed text-xl font-bold"
              aria-label="File this permit with the fields as confirmed"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Filing…" : "✓ File this permit"}
            </button>
            <button
              type="button"
              className="btn-press min-h-[52px] rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-4 font-bold"
              aria-label="Cancel — file nothing"
              onClick={() => { setForm(null); setScanNote(null); }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs font-semibold text-[var(--dim)]">Nothing files until you tap “File this permit” — and permits never send email copies.</p>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {permitsQuery.isLoading ? (
          <p className="text-sm text-[var(--dim)]" role="status">Loading your permits…</p>
        ) : permits.length === 0 ? (
          <p className="text-sm text-[var(--dim)]">{diamond ? "No permits on file yet. Scan your first OS/OW permit above — it files here, grouped by its valid window." : "No permits on file yet."}</p>
        ) : (
          <>
            {groups.active.length > 0 && (
              <div>
                <h3 className="font-condensed text-lg font-bold">Active</h3>
                <div className="mt-1.5 space-y-2">{groups.active.map(renderPermitRow)}</div>
              </div>
            )}
            {groups.completed.length > 0 && (
              <div>
                <h3 className="font-condensed text-lg font-bold">Completed</h3>
                <div className="mt-1.5 space-y-2">{groups.completed.map(renderPermitRow)}</div>
              </div>
            )}
            {groups.expired.length > 0 && (
              <div>
                <h3 className="font-condensed text-lg font-bold">Expired</h3>
                <div className="mt-1.5 space-y-2">{groups.expired.map(renderPermitRow)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The Drive-screen restriction placards for Permit route mode:
 * compact chips built ONLY from the confirmed docket (permit.ts
 * buildPlacards), in the Go weather chip's pattern — glanceable,
 * display-only, no taps, nothing recorded. Rendered by App.tsx only
 * while permit navigation is active.
 */
export function PermitPlacardChips({ permit }: { permit: PermitDocket }) {
  const { placards, moreCount } = buildPlacards(permit);
  return (
    <div className="glass-pill max-w-[78vw] rounded-2xl px-3 py-2" role="status" aria-label={`Permit restrictions for permit ${permit.permitNumber ?? permit.id}`}>
      <div className="text-[10px] font-extrabold tracking-widest text-[var(--accent)]">
        🪧 PERMIT {permit.permitNumber ?? ""} — RESTRICTIONS
      </div>
      {placards.length === 0 ? (
        <div className="mt-0.5 text-xs font-semibold">No restrictions on the confirmed docket.</div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {placards.map((p) => (
            <span key={p.key} className="rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[11px] font-bold leading-tight">
              {p.icon} {p.label}
            </span>
          ))}
          {moreCount > 0 && (
            <span className="rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[11px] font-bold leading-tight">+{moreCount} more on the docket</span>
          )}
        </div>
      )}
    </div>
  );
}
