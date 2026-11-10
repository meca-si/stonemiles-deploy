// STONEMILES Broker Upload Links + Approval Queue — OPTIONAL, OFF by
// default, Diamond owner-operators (solo) + Fleet/Owner accounts only.
//
// Owner/Dispatch (fleet) or the owner-operator (solo) create one
// unguessable upload link per broker (named, expiring, revocable).
// The broker side is UPLOAD-ONLY — BrokerUploadForm below is the whole
// of it: a rate con/BOL file or photo plus basic load details, and
// nothing else about the company (no board, drivers, other loads,
// prices, HOS, or documents). Submissions land in the Broker Inbox —
// never on the Fleet Board, never visible to drivers — where the
// owner reviews, edits every field, then approves (fleet → posts to
// the Fleet Board with the document attached; solo → creates the
// owner's own load at Booked) or rejects (kept on record).
//
// HONEST LIMIT, stated wherever a link is shown: a broker outside the
// app opening the link rides on the standalone/public portal
// packaging. Inside this build the complete flow runs in-app, and the
// "Broker view" preview shows exactly the upload-only form.

import { useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { PdfViewer } from "@hatch/space-sdk/pdf";
import { api, type ApiResponse } from "./api";
import { laneKey, useLaneEstimates } from "./useLaneEstimate";
import { PerMileLine } from "./RatePerMile";

type Center = ApiResponse<typeof api, "getBrokerCenter">;
type LinkRow = Center["links"][number];
type SubRow = Center["submissions"][number];

const EQUIPMENT_OPTIONS = [
  { value: "flatbed", label: "Flatbed" },
  { value: "open_deck", label: "Open deck" },
  { value: "rgn", label: "RGN" },
  { value: "oversized", label: "Oversized" },
  { value: "dry_van", label: "Dry van" },
  { value: "reefer", label: "Reefer" },
  { value: "container", label: "Container" },
] as const;
type EquipmentValue = (typeof EQUIPMENT_OPTIONS)[number]["value"];

const INPUT =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";

type Draft = {
  shipper: string;
  pickupCity: string;
  pickupState: string;
  deliveryCity: string;
  deliveryState: string;
  pickupText: string;
  deliveryText: string;
  rate: string;
  loadedMiles: string;
  milesSource: "document" | "entered" | "estimate" | null;
  extraCharges: string;
  extraChargesNote: string;
  weightLbs: string;
  commodity: string;
  hazmat: boolean;
  equipmentType: string;
  notes: string;
  referenceNumber: string;
  pickupApptAt: string;
  deliveryApptAt: string;
};

const EMPTY_DRAFT: Draft = {
  shipper: "",
  pickupCity: "",
  pickupState: "",
  deliveryCity: "",
  deliveryState: "",
  pickupText: "",
  deliveryText: "",
  rate: "",
  loadedMiles: "",
  milesSource: null,
  extraCharges: "",
  extraChargesNote: "",
  weightLbs: "",
  commodity: "",
  hazmat: false,
  equipmentType: "",
  notes: "",
  referenceNumber: "",
  pickupApptAt: "",
  deliveryApptAt: "",
};

function draftOf(r: {
  shipper: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  pickupText: string | null;
  deliveryText: string | null;
  rate: number | null;
  loadedMiles: number | null;
  milesSource: string | null;
  extraCharges: number;
  extraChargesNote: string | null;
  weightLbs: number | null;
  commodity: string | null;
  hazmat: boolean;
  equipmentType: string | null;
  notes: string | null;
  referenceNumber: string | null;
  pickupApptAt: string | null;
  deliveryApptAt: string | null;
}): Draft {
  return {
    shipper: r.shipper ?? "",
    pickupCity: r.pickupCity ?? "",
    pickupState: r.pickupState ?? "",
    deliveryCity: r.deliveryCity ?? "",
    deliveryState: r.deliveryState ?? "",
    pickupText: r.pickupText ?? "",
    deliveryText: r.deliveryText ?? "",
    rate: r.rate != null ? String(r.rate) : "",
    loadedMiles: r.loadedMiles != null ? String(r.loadedMiles) : "",
    milesSource: (r.milesSource as Draft["milesSource"]) ?? null,
    extraCharges: r.extraCharges > 0 ? String(r.extraCharges) : "",
    extraChargesNote: r.extraChargesNote ?? "",
    weightLbs: r.weightLbs != null ? String(r.weightLbs) : "",
    commodity: r.commodity ?? "",
    hazmat: r.hazmat,
    equipmentType: r.equipmentType ?? "",
    notes: r.notes ?? "",
    referenceNumber: r.referenceNumber ?? "",
    pickupApptAt: r.pickupApptAt ? r.pickupApptAt.slice(0, 16) : "",
    deliveryApptAt: r.deliveryApptAt ? r.deliveryApptAt.slice(0, 16) : "",
  };
}

const num = (s: string): number | null => {
  const v = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const clean = (s: string): string | null => (s.trim() ? s.trim() : null);

function fieldsOf(d: Draft) {
  return {
    shipper: clean(d.shipper),
    pickupCity: clean(d.pickupCity),
    pickupState: clean(d.pickupState),
    deliveryCity: clean(d.deliveryCity),
    deliveryState: clean(d.deliveryState),
    pickupText: clean(d.pickupText),
    deliveryText: clean(d.deliveryText),
    rate: num(d.rate),
    loadedMiles: num(d.loadedMiles),
    milesSource: num(d.loadedMiles) != null ? (d.milesSource ?? "entered") : null,
    extraCharges: num(d.extraCharges) ?? 0,
    extraChargesNote: clean(d.extraChargesNote),
    weightLbs: num(d.weightLbs) != null ? Math.round(num(d.weightLbs)!) : null,
    commodity: clean(d.commodity),
    hazmat: d.hazmat,
    equipmentType: (d.equipmentType || null) as EquipmentValue | null,
    notes: clean(d.notes),
    referenceNumber: clean(d.referenceNumber),
    // datetime-local values are the sender's local wall time — send
    // the true instant so the server stores it exactly.
    pickupApptAt: d.pickupApptAt ? new Date(d.pickupApptAt).toISOString() : null,
    deliveryApptAt: d.deliveryApptAt ? new Date(d.deliveryApptAt).toISOString() : null,
  };
}

function laneOf(r: { pickupCity: string | null; pickupState: string | null; deliveryCity: string | null; deliveryState: string | null }): string {
  const a = [r.pickupCity, r.pickupState].filter(Boolean).join(", ") || "Pickup TBD";
  const b = [r.deliveryCity, r.deliveryState].filter(Boolean).join(", ") || "Delivery TBD";
  return `${a} → ${b}`;
}

function money(n: number | null): string {
  return n == null ? "Pay not set" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function LoadFieldsForm({ draft, setDraft, prefix }: { draft: Draft; setDraft: (d: Draft) => void; prefix: string }) {
  const f = (key: keyof Draft) => ({
    value: draft[key] as string,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft({ ...draft, [key]: e.target.value }),
  });
  return (
    <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor={`${prefix}-shipper`}>Shipper / broker</label>
        <input id={`${prefix}-shipper`} aria-label="Shipper or broker" className={INPUT} {...f("shipper")} placeholder="As printed on the rate con" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-pcity`}>Pickup city</label>
        <input id={`${prefix}-pcity`} aria-label="Pickup city" className={INPUT} {...f("pickupCity")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-pstate`}>Pickup state</label>
        <input id={`${prefix}-pstate`} aria-label="Pickup state" className={INPUT} {...f("pickupState")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-dcity`}>Delivery city</label>
        <input id={`${prefix}-dcity`} aria-label="Delivery city" className={INPUT} {...f("deliveryCity")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-dstate`}>Delivery state</label>
        <input id={`${prefix}-dstate`} aria-label="Delivery state" className={INPUT} {...f("deliveryState")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-pwin`}>Pickup window</label>
        <input id={`${prefix}-pwin`} aria-label="Pickup window" className={INPUT} {...f("pickupText")} placeholder="e.g. Mon Oct 26, 08:00–12:00" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-dwin`}>Delivery window</label>
        <input id={`${prefix}-dwin`} aria-label="Delivery window" className={INPUT} {...f("deliveryText")} placeholder="e.g. Wed Oct 28 by 17:00" />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor={`${prefix}-ref`}>Reference # (BOL / PO / order)</label>
        <input id={`${prefix}-ref`} aria-label="Load reference number" className={INPUT} {...f("referenceNumber")} placeholder="The number the shipper or broker named for this load" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-pappt`}>Pickup appointment</label>
        <input id={`${prefix}-pappt`} aria-label="Pickup appointment" type="datetime-local" className={INPUT} {...f("pickupApptAt")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-dappt`}>Delivery appointment</label>
        <input id={`${prefix}-dappt`} aria-label="Delivery appointment" type="datetime-local" className={INPUT} {...f("deliveryApptAt")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-rate`}>Load pay ($)</label>
        <input id={`${prefix}-rate`} aria-label="Load pay in dollars" className={INPUT} inputMode="decimal" {...f("rate")} placeholder="Linehaul" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-miles`}>Loaded miles</label>
        <input id={`${prefix}-miles`} aria-label="Loaded miles for this load" className={INPUT} inputMode="decimal" value={draft.loadedMiles} onChange={(e) => setDraft({ ...draft, loadedMiles: e.target.value, milesSource: "entered" })} placeholder="From the rate con — drives the $/mi" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-extras`}>Extra charges ($)</label>
        <input id={`${prefix}-extras`} aria-label="Extra charges in dollars" className={INPUT} inputMode="decimal" {...f("extraCharges")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-extras-note`}>Extra charges note</label>
        <input id={`${prefix}-extras-note`} aria-label="Extra charges note" className={INPUT} {...f("extraChargesNote")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-weight`}>Weight (lbs)</label>
        <input id={`${prefix}-weight`} aria-label="Weight in pounds" className={INPUT} inputMode="numeric" {...f("weightLbs")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-commodity`}>Commodity</label>
        <input id={`${prefix}-commodity`} aria-label="Commodity" className={INPUT} {...f("commodity")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-equipment`}>Equipment</label>
        <select id={`${prefix}-equipment`} className={INPUT} value={draft.equipmentType} onChange={(e) => setDraft({ ...draft, equipmentType: e.target.value })} aria-label="Equipment type">
          <option value="">Not set</option>
          {EQUIPMENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor={`${prefix}-notes`}>Notes</label>
        <input id={`${prefix}-notes`} aria-label="Notes" className={INPUT} {...f("notes")} placeholder="Gate code, contact, appointment rules…" />
      </div>
      <label className="flex min-h-[44px] items-center gap-2.5 text-sm font-semibold sm:col-span-2">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={draft.hazmat}
          onChange={(e) => setDraft({ ...draft, hazmat: e.target.checked })}
          aria-label="This load is hazmat"
        />
        Hazmat load
      </label>
    </div>
  );
}

/** THE BROKER SIDE — upload-only. This form is everything a broker
 *  with a valid link gets: who the load is for, the file/photo upload,
 *  and the basic load fields. It reads nothing else and shows nothing
 *  else — no board, no drivers, no other loads, no prices beyond the
 *  load being uploaded, no HOS, no documents. */
export function BrokerUploadForm({
  token,
  setBanner,
  onSubmitted,
}: {
  token: string;
  setBanner: (s: string | null) => void;
  onSubmitted?: () => void;
}) {
  const infoQuery = useQuery({
    queryKey: ["broker-upload-info", token],
    queryFn: () => api.getBrokerUploadInfo({ token }),
    enabled: token.trim().length >= 8,
  });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [brokerName, setBrokerName] = useState("");
  const [senderCompany, setSenderCompany] = useState("");
  const [senderContact, setSenderContact] = useState("");
  const [pendingDoc, setPendingDoc] = useState<{ base64: string; mime: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const info = infoQuery.data;

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNote(null);
    try {
      const mime = file.type || "application/octet-stream";
      const enc = await fileToBase64(file);
      setPendingDoc({ base64: enc.dataBase64, mime: enc.mimeType || mime });
      if (mime === "image/jpeg" || mime === "image/png") {
        // Convenience pre-fill from the photo, same reading the app
        // uses; the server reads it again on submit either way.
        try {
          const result = await api.extractLoad({ dataBase64: enc.dataBase64, mimeType: mime, purpose: "new_load" });
          if (result.found) {
            setDraft((d) => ({
              ...d,
              shipper: result.shipper ?? d.shipper,
              pickupCity: result.pickupCity ?? d.pickupCity,
              pickupState: result.pickupState ?? d.pickupState,
              deliveryCity: result.deliveryCity ?? d.deliveryCity,
              deliveryState: result.deliveryState ?? d.deliveryState,
              pickupText: result.pickupText ?? d.pickupText,
              deliveryText: result.deliveryText ?? d.deliveryText,
              rate: result.rate != null ? String(result.rate) : d.rate,
              loadedMiles: result.miles != null && result.miles > 0 ? String(Math.round(result.miles)) : d.loadedMiles,
              milesSource: result.miles != null && result.miles > 0 ? "document" : d.milesSource,
              weightLbs: result.weightLbs != null ? String(Math.round(result.weightLbs)) : d.weightLbs,
              commodity: result.commodity ?? d.commodity,
            }));
            setNote("Pulled what the document shows — check it, fix anything off, then send it in.");
            return;
          }
        } catch { /* the server read on submit still applies */ }
        setNote("Photo attached. Fill in what you know below — anything you leave blank, the carrier's office fills from the document when they review it.");
      } else {
        setNote("File attached — it goes in with your upload. Fill in what you know below.");
      }
    } catch {
      setNote("Couldn't attach that file. You can still fill the load in by hand below.");
    }
  };

  if (token.trim().length < 8) {
    return <p className="text-sm text-[var(--dim)]">Paste or pick a broker upload link token to see the broker's upload form.</p>;
  }
  if (infoQuery.isPending) return <p className="text-sm text-[var(--dim)]">Checking this upload link…</p>;
  if (!info || !info.valid) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-4" role="note" aria-label="Upload link not usable">
        <div className="font-condensed text-xl font-bold">This link can't take uploads</div>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          {info?.reason ?? "This upload link isn't valid. Check the link your carrier sent you, or ask them for a fresh one."}
        </p>
        <p className="mt-2 text-xs text-[var(--dim)]">Nothing else is shown — an upload link only ever shows this form or this message.</p>
      </div>
    );
  }
  if (done) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-4" role="status" aria-label="Upload received">
        <div className="font-condensed text-xl font-bold">✅ Sent to {info.forName ?? "the carrier"}</div>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Your load is in the carrier's Broker Inbox for review. It is <strong className="text-[var(--text)]">not</strong> posted
          to their drivers yet — the carrier checks it and approves it first. That's the whole handoff; there's
          nothing else to see here.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Broker upload form" className="space-y-1">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
        <div className="font-condensed text-xl font-bold">{info.isDoor ? `Send a load to ${info.forName}` : `Upload a load for ${info.forName}`}</div>
        {info.isDoor ? (
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            This is {info.forName}'s send door — one code any shipper or broker can use to send them a load offer,
            no account needed. Your offer lands in their inbox only, for their review — never on a public board.
            Name yourself below: your name, your company, and a contact are required — nothing anonymous is accepted.
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            Link for {info.brokerName}{info.brokerCompany ? ` · ${info.brokerCompany}` : ""} · good through{" "}
            {info.expiresAt ? new Date(info.expiresAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : ""}.
            Upload the rate confirmation or BOL and add what you know — the carrier reviews everything before
            anything is posted to their drivers.
          </p>
        )}
      </div>
      <label className="btn-press mt-2 flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface2)] px-3 py-3 text-center text-sm font-bold">
        📎 {pendingDoc ? "Document attached — tap to replace" : "Attach rate con / BOL (photo or file)"}
        <input type="file" accept="image/*,application/pdf" className="sr-only" aria-label="Attach the rate confirmation or BOL" onChange={handleFile} />
      </label>
      {note && <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm leading-relaxed" role="note">{note}</p>}
      <div className="mt-3">
        <label className={LABEL} htmlFor="broker-up-name">{info.isDoor ? "Your name (required)" : "Your name / brokerage (as the carrier knows you)"}</label>
        <input
          id="broker-up-name"
          aria-label="Your name or brokerage"
          className={INPUT}
          value={brokerName}
          onChange={(e) => setBrokerName(e.target.value)}
          placeholder={info.brokerName ?? "Your name / brokerage"}
        />
      </div>
      {info.isDoor && (
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="broker-up-company">Your company (required)</label>
            <input
              id="broker-up-company"
              aria-label="Your company"
              className={INPUT}
              value={senderCompany}
              onChange={(e) => setSenderCompany(e.target.value)}
              placeholder="Brokerage or shipper name"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="broker-up-contact">Your contact — phone or email (required)</label>
            <input
              id="broker-up-contact"
              aria-label="Your contact phone or email"
              className={INPUT}
              value={senderContact}
              onChange={(e) => setSenderContact(e.target.value)}
              placeholder="So the fleet can reach you about this load"
            />
          </div>
        </div>
      )}
      <LoadFieldsForm draft={draft} setDraft={setDraft} prefix="broker-up" />
      <button
        type="button"
        disabled={busy}
        className="btn-neon btn-press mt-3 w-full rounded-xl px-4 py-3 font-bold disabled:opacity-50"
        aria-label="Send this load to the carrier for review"
        onClick={() => {
          if (info.isDoor && (!brokerName.trim() || !senderCompany.trim() || !senderContact.trim())) {
            setBanner("The send door needs your name, your company, and a contact — the fleet won't take an anonymous offer.");
            return;
          }
          setBusy(true);
          void api
            .submitBrokerUpload({
              token,
              brokerName: clean(brokerName),
              brokerCompany: info.isDoor ? clean(senderCompany) : info.brokerCompany,
              senderContact: info.isDoor ? clean(senderContact) : null,
              ...fieldsOf(draft),
              docDataBase64: pendingDoc?.base64 ?? null,
              docMime: pendingDoc?.mime ?? null,
            })
            .then((res) => {
              if (!res.ok) {
                setBanner(res.error ?? "That upload didn't go through.");
                return;
              }
              setDone(true);
              setBanner(
                res.extracted
                  ? "Upload received — the document's lane, pay, and windows were read in for the carrier's review."
                  : "Upload received — it's in the carrier's Broker Inbox for review.",
              );
              onSubmitted?.();
            })
            .catch(() => setBanner("That upload didn't go through — check the connection and try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Sending…" : "Send to the carrier for review"}
      </button>
      <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
        {info.isDoor
          ? "Send-door only: this offer goes to this one fleet's inbox and nowhere else — it never touches a public board, and the fleet decides whether to book it."
          : "Upload-only: this link can't see the carrier's load board, drivers, other loads, or anything else — and nothing you send posts anywhere until the carrier approves it."}
      </p>
    </section>
  );
}

function SubmissionCard({
  sub,
  mode,
  setBanner,
  onOpenMyLoad,
  refresh,
}: {
  sub: SubRow;
  mode: string;
  setBanner: (s: string | null) => void;
  onOpenMyLoad: (loadId: number) => void;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(sub));
  const subEstimates = useLaneEstimates([sub]);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [armReject, setArmReject] = useState(false);
  const [viewDoc, setViewDoc] = useState(false);
  const docQuery = useQuery({
    queryKey: ["broker-sub-doc", sub.id],
    queryFn: () => api.getBrokerSubmissionDoc({ id: sub.id }),
    enabled: viewDoc,
  });
  const pending = sub.status === "pending";

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, success: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        setBanner(res.error ?? "That didn't go through.");
        return;
      }
      setBanner(success);
      setArmReject(false);
      refresh();
    } catch {
      setBanner("That didn't go through — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Broker submission ${laneOf(sub)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-condensed text-lg font-bold leading-tight">{laneOf(sub)}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
            From {sub.brokerName}{sub.brokerCompany ? ` · ${sub.brokerCompany}` : ""}{" "}
            {sub.sourceKind === "door" ? "via the fleet send door" : `via link “${sub.brokerLinkLabel}”`}
            {sub.senderContact ? ` · contact ${sub.senderContact}` : ""}
            {sub.referenceNumber ? ` · Ref ${sub.referenceNumber}` : ""} ·{" "}
            {new Date(sub.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {sub.hasDoc && (
              <> · 📄 document on file{sub.docSha256 ? ` · fingerprint ${sub.docSha256.slice(0, 10)}…` : ""}</>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            sub.status === "pending"
              ? "bg-amber-900/60 text-amber-200"
              : sub.status === "approved"
                ? "bg-emerald-900/60 text-emerald-300"
                : "bg-[var(--surface)] text-[var(--danger)]"
          }`}
        >
          {sub.status === "pending" ? "⏳ AWAITING REVIEW" : sub.status === "approved" ? "✓ APPROVED" : "✕ REJECTED"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
        <span className="neon-text font-condensed text-2xl font-bold">{money(sub.totalWithExtras)}</span>
        <PerMileLine load={sub} estMiles={subEstimates.get(laneKey(sub)) ?? null} />
        {sub.commodity && <span className="text-sm text-[var(--dim)]">{sub.commodity}{sub.hazmat ? " · HAZMAT" : ""}</span>}
        {sub.weightLbs != null && <span className="text-sm text-[var(--dim)]">{sub.weightLbs.toLocaleString()} lbs</span>}
        {sub.equipmentLabel && <span className="text-sm text-[var(--dim)]">{sub.equipmentLabel}</span>}
      </div>
      {sub.status !== "pending" && (
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
          {sub.status === "approved"
            ? mode === "fleet"
              ? `Approved by @${sub.reviewedBy ?? "?"}${sub.reviewedAt ? ` · ${new Date(sub.reviewedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""} — posted to the Fleet Board${sub.boardLoadId ? ` (board #${sub.boardLoadId})` : ""}, document attached.`
              : `Approved by @${sub.reviewedBy ?? "?"}${sub.reviewedAt ? ` · ${new Date(sub.reviewedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""} — it's your load now, Load Tracker at Booked.`
            : `Rejected by @${sub.reviewedBy ?? "?"}${sub.reviewedAt ? ` · ${new Date(sub.reviewedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""} — kept on record here; it never reached the board or any driver.`}
          {sub.reviewNote ? ` Note: ${sub.reviewNote}` : ""}
        </p>
      )}
      {sub.hasDoc && (
        <button
          type="button"
          className="btn-press mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
          aria-label={`View the submitted rate confirmation or BOL for ${laneOf(sub)}`}
          onClick={() => setViewDoc(true)}
        >
          📄 View the submitted rate con / BOL
        </button>
      )}
      {pending && (
        <>
          <LoadFieldsForm draft={draft} setDraft={setDraft} prefix={`sub-${sub.id}`} />
          <div className="mt-3">
            <label className={LABEL} htmlFor={`sub-${sub.id}-review-note`}>Review note (optional, kept on the record)</label>
            <input
              id={`sub-${sub.id}-review-note`}
              aria-label="Review note"
              className={INPUT}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="e.g. Rate confirmed by phone"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy != null}
              className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-bold disabled:opacity-50"
              aria-label={`Save edits to the submission ${laneOf(sub)}`}
              onClick={() => void run("save", () => api.updateBrokerSubmission({ id: sub.id, ...fieldsOf(draft) }), "Edits saved — the submission still waits for your approve/reject call.")}
            >
              {busy === "save" ? "Saving…" : "Save edits"}
            </button>
            <button
              type="button"
              disabled={busy != null}
              className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50"
              aria-label={`Approve the submission ${laneOf(sub)}`}
              onClick={() =>
                void run(
                  "approve",
                  () => api.approveBrokerSubmission({ id: sub.id, ...fieldsOf(draft), reviewNote: clean(reviewNote) }),
                  mode === "fleet"
                    ? `Approved — ${laneOf(sub)} is live on the Fleet Board with the broker's document attached.`
                    : `Approved — ${laneOf(sub)} is in your Loads now, Load Tracker at Booked.`,
                )
              }
            >
              {busy === "approve" ? "Approving…" : mode === "fleet" ? "✓ Approve → Fleet Board" : "✓ Approve → my load"}
            </button>
            <button
              type="button"
              disabled={busy != null}
              className={`btn-press rounded-xl px-3.5 py-2.5 text-sm font-bold disabled:opacity-50 ${armReject ? "bg-[var(--danger)] text-white" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)]"}`}
              aria-label={`Reject the submission ${laneOf(sub)}`}
              onClick={() => {
                if (!armReject) {
                  setArmReject(true);
                  return;
                }
                void run("reject", () => api.rejectBrokerSubmission({ id: sub.id, reviewNote: clean(reviewNote) }), "Rejected — the submission stays on record in the inbox history and never reached the board.");
              }}
            >
              {busy === "reject" ? "Rejecting…" : armReject ? "Tap again to reject" : "✕ Reject"}
            </button>
          </div>
        </>
      )}
      {sub.status === "approved" && mode === "solo" && sub.loadId != null && (
        <button
          type="button"
          className="btn-neon btn-press mt-2.5 rounded-xl px-4 py-2.5 text-sm font-bold"
          aria-label={`Open ${laneOf(sub)} in the Load Tracker`}
          onClick={() => onOpenMyLoad(sub.loadId!)}
        >
          Open in Load Tracker →
        </button>
      )}
      {viewDoc && (
        <div className="fixed inset-0 z-[960] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="Broker submission document">
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <div className="font-condensed text-xl font-bold">Rate con / BOL — broker submission</div>
              <button type="button" onClick={() => setViewDoc(false)} className="rounded-full bg-[var(--surface2)] px-3.5 py-2 font-bold" aria-label="Close document viewer">✕</button>
            </div>
            <div className="mt-3">
              {docQuery.isPending && <p className="text-sm text-[var(--dim)]">Loading document…</p>}
              {docQuery.data?.url && docQuery.data.mime === "application/pdf" && (
                <PdfViewer
                  src={docQuery.data.url}
                  ariaLabel="Broker submission document PDF"
                  labels={{ loading: "Loading PDF…", loadError: "This PDF couldn't be displayed.", previousPage: "Previous page", nextPage: "Next page" }}
                />
              )}
              {docQuery.data?.url && docQuery.data.mime?.startsWith("image/") && (
                <img src={docQuery.data.url} alt="Rate confirmation or bill of lading uploaded by the broker" className="w-full rounded-lg" />
              )}
              {docQuery.data?.url && docQuery.data.mime !== "application/pdf" && !docQuery.data.mime?.startsWith("image/") && (
                <p className="text-sm">
                  This file type can't be previewed here.{" "}
                  <a className="font-bold text-[var(--accent)] underline" href={docQuery.data.url} target="_blank" rel="noreferrer">Open the file</a>
                </p>
              )}
              {docQuery.data && !docQuery.data.url && <p className="text-sm text-[var(--dim)]">No document is stored for this submission.</p>}
              {sub.docSha256 && <p className="mt-2 text-xs text-[var(--dim)]">SHA-256 fingerprint: {sub.docSha256}</p>}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function BrokerCenterPanel({
  setBanner,
  onOpenMyLoad,
  variant = "phone",
}: {
  setBanner: (s: string | null) => void;
  onOpenMyLoad: (loadId: number) => void;
  variant?: "phone" | "console";
}) {
  const queryClient = useQueryClient();
  const centerQuery = useQuery({ queryKey: ["broker-center"], queryFn: () => api.getBrokerCenter({}) });
  const data = centerQuery.data;
  const [linkName, setLinkName] = useState("");
  const [linkCompany, setLinkCompany] = useState("");
  const [linkContact, setLinkContact] = useState("");
  const [linkMc, setLinkMc] = useState("");
  const [linkDays, setLinkDays] = useState("30");
  const [busy, setBusy] = useState<string | null>(null);
  const [armKey, setArmKey] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["broker-center"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
    void queryClient.invalidateQueries({ queryKey: ["loads"] });
    void queryClient.invalidateQueries({ queryKey: ["trip-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["owner-console"] });
  };

  if (centerQuery.isPending) {
    return (
      <section className="glass-panel p-3.5" aria-label="Broker uploads">
        <p className="text-sm text-[var(--dim)]">Loading broker uploads…</p>
      </section>
    );
  }
  if (!data) return null;

  // Not eligible: Gold/Basic, or a company driver seat. Plain words,
  // no panel pretending otherwise.
  if (!data.eligible) {
    return (
      <section className="glass-panel p-3.5" aria-label="Broker uploads">
        <h2 className="font-condensed text-xl font-semibold">📥 Broker Upload Links</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          Broker upload links are a <strong className="text-[var(--text)]">Diamond / Fleet Owner</strong> feature:
          a broker gets an upload-only link for a rate con/BOL, and every submission waits in a Broker Inbox for
          the owner's approval before it posts. Gold and Basic don't include it — on{" "}
          {data.plan === "gold" ? "Gold Driver" : data.plan === "basic" ? "Basic" : "this plan"} there's no broker
          inbox to turn on. It switches on with Diamond Driver (owner-operators, personal inbox) or the Owner
          fleet plan (company inbox → Fleet Board) — see Plans.
        </p>
      </section>
    );
  }
  if (!data.canManage) {
    return (
      <section className="glass-panel p-3.5" aria-label="Broker uploads">
        <h2 className="font-condensed text-xl font-semibold">📥 Broker Upload Links</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          Broker links and the Broker Inbox belong to the owner and dispatch — driver seats never see them, and a
          broker never gets a driver code or a seat. Approved loads reach you the normal way: on the Fleet Board,
          ready to claim.
        </p>
      </section>
    );
  }

  const toggle = async (enabled: boolean) => {
    setBusy("toggle");
    try {
      const res = await api.setBrokerEnabled({ enabled });
      if (!res.ok) {
        setBanner(res.error ?? "That didn't save.");
        return;
      }
      setBanner(
        enabled
          ? "Broker uploads are ON — create a link for a broker below, and their submissions will land in your Broker Inbox."
          : "Broker uploads are OFF — every link stops accepting uploads until you turn this back on. Past submissions stay on record.",
      );
      refresh();
    } catch {
      setBanner("That didn't save — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!data.enabled) {
    return (
      <section className="glass-panel p-3.5" aria-label="Broker uploads">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-condensed text-2xl font-bold">📥 Broker Upload Links</h2>
          <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">OFF — optional feature</span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          {data.mode === "fleet"
            ? "Let a broker send rate cons straight to your fleet — without an account, a driver code, or a seat. Each broker gets their own upload-only link; every upload lands in your Broker Inbox, and nothing posts to the Fleet Board until you or dispatch approves it."
            : "Let a broker send rate cons straight to you — without an account. Each broker gets their own upload-only link; every upload lands in your Broker Inbox, and approving one makes it your load at Booked. Nothing becomes a load until you approve it."}{" "}
          It's <strong className="text-[var(--text)]">off by default</strong> — nobody has a broker link or an inbox until you turn it on.
        </p>
        {data.canToggle ? (
          <button
            type="button"
            disabled={busy != null}
            className="btn-neon btn-press mt-3 rounded-xl px-4 py-3 font-bold disabled:opacity-50"
            aria-label="Turn broker uploads on"
            aria-pressed={false}
            onClick={() => void toggle(true)}
          >
            {busy === "toggle" ? "Turning on…" : "Turn broker uploads ON"}
          </button>
        ) : (
          <p className="mt-2 text-sm font-semibold">Only the fleet owner can turn this on — ask your owner. Once it's on, dispatch manages the links and the inbox.</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]" role="note">
          Diamond / Fleet Owner feature. Turning it on changes no prices, tiers, or rewards — it's a switch, not a charge.
        </p>
      </section>
    );
  }

  const pending = data.submissions.filter((s) => s.status === "pending");
  const decided = data.submissions.filter((s) => s.status !== "pending");

  const createLink = async () => {
    if (!linkName.trim()) {
      setBanner("Name the broker first — one link per broker.");
      return;
    }
    setBusy("create-link");
    try {
      const res = await api.createBrokerLink({
        brokerName: linkName.trim(),
        brokerCompany: clean(linkCompany),
        brokerContact: clean(linkContact),
        brokerMc: clean(linkMc),
        expiresInDays: Math.max(1, Math.min(365, Math.round(num(linkDays) ?? 30))),
      });
      if (!res.ok || !res.link) {
        setBanner(res.error ?? "That link didn't save.");
        return;
      }
      setBanner(`Link created for ${res.link.brokerName} — copy it below and send it to that broker only.`);
      setLinkName("");
      setLinkCompany("");
      setLinkContact("");
      setLinkMc("");
      refresh();
    } catch {
      setBanner("That link didn't save — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const linkCard = (l: LinkRow) => (
    <article key={l.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Broker link for ${l.brokerName}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-condensed text-lg font-bold leading-tight">
            {l.brokerName}
            {l.brokerCompany ? <span className="text-sm font-semibold text-[var(--dim)]"> · {l.brokerCompany}</span> : null}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
            Created by @{l.createdBy} · {new Date(l.createdAt).toLocaleString([], { month: "short", day: "numeric" })}
            {l.brokerContact ? ` · ${l.brokerContact}` : ""}{l.brokerMc ? ` · ${l.brokerMc}` : ""} · {l.submissionCount} submission{l.submissionCount === 1 ? "" : "s"}
            {l.pendingCount > 0 ? ` · ${l.pendingCount} awaiting review` : ""}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            l.status === "active" ? "bg-emerald-900/60 text-emerald-300" : "bg-[var(--surface)] text-[var(--danger)]"
          }`}
        >
          {l.status === "active" ? `ACTIVE · to ${new Date(l.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : l.status === "expired" ? "EXPIRED" : "REVOKED"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--surface)] px-2.5 py-2 font-mono text-xs" aria-label={`Upload token for ${l.brokerName}`}>
          {l.token.slice(0, 18)}…
        </code>
        <button
          type="button"
          className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
          aria-label={`Copy the full upload link token for ${l.brokerName}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(l.token)
              .then(() => setBanner(`Link token copied for ${l.brokerName} — send it to that broker only. In this build the broker uses it in the app's Broker view; a tap-to-open web link arrives with the public portal.`))
              .catch(() => setBanner("Copy didn't work on this device — the token's first characters are shown on the card."));
          }}
        >
          📋 Copy link token
        </button>
        <button
          type="button"
          className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
          aria-label={`Preview what the broker sees for ${l.brokerName}'s link`}
          onClick={() => setPreviewToken(l.token)}
        >
          👁 Broker view
        </button>
        {l.status === "active" && (
          <button
            type="button"
            disabled={busy != null}
            className={`btn-press rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 ${armKey === `revoke-${l.id}` ? "bg-[var(--danger)] text-white" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)]"}`}
            aria-label={`Revoke the upload link for ${l.brokerName}`}
            onClick={() => {
              if (armKey !== `revoke-${l.id}`) {
                setArmKey(`revoke-${l.id}`);
                return;
              }
              setArmKey(null);
              setBusy(`revoke-${l.id}`);
              void api
                .revokeBrokerLink({ id: l.id })
                .then((res) => {
                  setBanner(res.ok ? `Link revoked — ${l.brokerName}'s link is dead now and takes no more uploads.` : (res.error ?? "That revoke didn't go through."));
                  if (res.ok) refresh();
                })
                .catch(() => setBanner("That revoke didn't go through — check your connection."))
                .finally(() => setBusy(null));
            }}
          >
            {armKey === `revoke-${l.id}` ? "Tap again to revoke" : "Revoke"}
          </button>
        )}
      </div>
    </article>
  );

  return (
    <div className="space-y-3">
      <section className="glass-panel p-3.5" aria-label="Broker uploads">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-condensed text-2xl font-bold">📥 Broker Inbox & Upload Links</h2>
            <p className="mt-1 text-sm text-[var(--dim)]">
              {data.mode === "fleet"
                ? `${data.companyName ?? "Your company"} · approvals post to the Fleet Board.`
                : "Your personal broker inbox · approvals become your loads at Booked."}{" "}
              <strong className="text-[var(--text)]">{pending.length} awaiting review</strong> · {data.links.filter((l) => l.status === "active").length} active link
              {data.links.filter((l) => l.status === "active").length === 1 ? "" : "s"}.
            </p>
          </div>
          {data.canToggle && (
            <button
              type="button"
              disabled={busy != null}
              className="btn-press shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-bold disabled:opacity-50"
              aria-label="Turn broker uploads off"
              aria-pressed={true}
              onClick={() => void toggle(false)}
            >
              {busy === "toggle" ? "Saving…" : "Turn OFF"}
            </button>
          )}
        </div>
        <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--dim)]" role="note">
          <strong className="text-[var(--text)]">How the broker reaches this today:</strong> the link token works in
          the app's Broker view (preview any link below — that's exactly what a broker sees). A broker tapping a
          link from outside the app arrives with the standalone/public portal packaging — the same step as the
          public portal address. Until then, a broker can still just send you the rate con and you upload it in a
          minute. Never give a broker a driver code or a dispatch seat instead.
        </p>
      </section>

      <section className="glass-panel p-3.5" aria-label="Create a broker upload link">
        <h3 className="font-condensed text-xl font-semibold">🔗 New broker link — one per broker</h3>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="broker-link-name">Broker name</label>
            <input id="broker-link-name" aria-label="Broker name" className={INPUT} value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="e.g. Dana at Landstar" />
          </div>
          <div>
            <label className={LABEL} htmlFor="broker-link-company">Broker company</label>
            <input id="broker-link-company" aria-label="Broker company" className={INPUT} value={linkCompany} onChange={(e) => setLinkCompany(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="broker-link-contact">Contact (optional)</label>
            <input id="broker-link-contact" aria-label="Broker contact" className={INPUT} value={linkContact} onChange={(e) => setLinkContact(e.target.value)} placeholder="Phone or email, for your records" />
          </div>
          <div>
            <label className={LABEL} htmlFor="broker-link-mc">MC number (optional)</label>
            <input id="broker-link-mc" aria-label="Broker MC number" className={INPUT} value={linkMc} onChange={(e) => setLinkMc(e.target.value)} placeholder="e.g. MC 123456 — recorded on every load from this broker" />
          </div>
          <div>
            <label className={LABEL} htmlFor="broker-link-days">Link expires in (days)</label>
            <input id="broker-link-days" aria-label="Link expiry in days" className={INPUT} inputMode="numeric" value={linkDays} onChange={(e) => setLinkDays(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          disabled={busy != null}
          className="btn-neon btn-press mt-3 rounded-xl px-4 py-3 font-bold disabled:opacity-50"
          aria-label="Create this broker upload link"
          onClick={() => void createLink()}
        >
          {busy === "create-link" ? "Creating…" : "Create link"}
        </button>
        <div className="mt-3 space-y-2.5">
          {data.links.length === 0 && <p className="text-sm text-[var(--dim)]">No broker links yet — create the first one above. Each broker gets their own; links are unguessable tokens, expire on the day you set, and can be revoked anytime.</p>}
          {data.links.map(linkCard)}
        </div>
      </section>

      {data.mode === "fleet" && (
        <section className="glass-panel p-3.5" aria-label="Fleet send door">
          <h3 className="font-condensed text-xl font-semibold">🚪 The send door — one code for every shipper &amp; broker</h3>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            One code for the whole fleet, instead of a named link per broker. Any shipper or broker holding the code
            can send your fleet a load offer — no account, no seat. Senders must name themselves (name, company,
            contact) or the door refuses the offer. Offers land <strong className="text-[var(--text)]">only in the
            Broker Inbox below</strong>, marked as send-door offers — they never touch the public board. You control
            the code: regenerate it and the old code dies in the same moment.
          </p>
          {data.sendDoor ? (
            <article className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label="Fleet send door code">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-condensed text-lg font-bold leading-tight">Send door code</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                    Created by @{data.sendDoor.createdBy} · {new Date(data.sendDoor.createdAt).toLocaleString([], { month: "short", day: "numeric" })} · {data.sendDoor.submissionCount} offer{data.sendDoor.submissionCount === 1 ? "" : "s"}
                    {data.sendDoor.pendingCount > 0 ? ` · ${data.sendDoor.pendingCount} awaiting review` : ""}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${data.sendDoor.status === "active" ? "bg-emerald-900/60 text-emerald-300" : "bg-[var(--surface)] text-[var(--danger)]"}`}>
                  {data.sendDoor.status === "active" ? "ACTIVE" : data.sendDoor.status === "expired" ? "EXPIRED" : "REVOKED"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--surface)] px-2.5 py-2 font-mono text-xs" aria-label="Send door code">
                  {data.sendDoor.token.slice(0, 18)}…
                </code>
                <button
                  type="button"
                  className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
                  aria-label="Copy the full send door code"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(data.sendDoor!.token)
                      .then(() => setBanner("Send door code copied — give it to shippers and brokers you want offers from. Anything sent with it lands in your Broker Inbox only."))
                      .catch(() => setBanner("Copy didn't work on this device — the code's first characters are shown on the card."));
                  }}
                >
                  📋 Copy door code
                </button>
                <button
                  type="button"
                  className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
                  aria-label="Preview what a sender sees at the send door"
                  onClick={() => setPreviewToken(data.sendDoor!.token)}
                >
                  👁 Sender view
                </button>
                <button
                  type="button"
                  disabled={busy != null}
                  className={`btn-press rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 ${armKey === "regen-door" ? "bg-[var(--danger)] text-white" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)]"}`}
                  aria-label="Regenerate the send door code — the old code stops working"
                  onClick={() => {
                    if (armKey !== "regen-door") {
                      setArmKey("regen-door");
                      return;
                    }
                    setArmKey(null);
                    setBusy("regen-door");
                    void api
                      .regenerateSendDoor({})
                      .then((res) => {
                        setBanner(res.ok ? "New send door code — the old code is dead now. Give the new code to your shippers and brokers." : (res.error ?? "That didn't go through."));
                        if (res.ok) refresh();
                      })
                      .catch(() => setBanner("That didn't go through — check your connection."))
                      .finally(() => setBusy(null));
                  }}
                >
                  {armKey === "regen-door" ? "Tap again — old code dies" : "Regenerate code"}
                </button>
              </div>
            </article>
          ) : (
            <button
              type="button"
              disabled={busy != null}
              className="btn-neon btn-press mt-3 rounded-xl px-4 py-3 font-bold disabled:opacity-50"
              aria-label="Open the fleet send door"
              onClick={() => {
                setBusy("create-door");
                void api
                  .createSendDoor({})
                  .then((res) => {
                    setBanner(res.ok ? "Send door open — copy the code on the card and give it to the shippers and brokers you want offers from." : (res.error ?? "That didn't go through."));
                    if (res.ok) refresh();
                  })
                  .catch(() => setBanner("That didn't go through — check your connection."))
                  .finally(() => setBusy(null));
              }}
            >
              {busy === "create-door" ? "Opening…" : "🚪 Open the send door"}
            </button>
          )}
        </section>
      )}

      <section className="glass-panel p-3.5" aria-label="Test an upload link as a broker">
        <h3 className="font-condensed text-xl font-semibold">👁 Broker view — test any link</h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Paste a link token to see exactly what that broker gets — the upload form and nothing else. Submissions
          made here land in the inbox below, same as a broker's would.
        </p>
        <div className="mt-2.5 flex gap-2">
          <label className="sr-only" htmlFor="broker-manual-token">Broker link token</label>
          <input
            id="broker-manual-token"
            aria-label="Broker link token"
            className={`${INPUT} font-mono text-sm`}
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="brk_…"
          />
          <button
            type="button"
            disabled={manualToken.trim().length < 8}
            className="btn-press shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            aria-label="Open the broker view for this token"
            onClick={() => setPreviewToken(manualToken.trim())}
          >
            Open
          </button>
        </div>
      </section>

      <section aria-label="Broker Inbox" className="space-y-3">
        <div className="glass-panel p-3.5">
          <h3 className="font-condensed text-xl font-semibold">📥 Broker Inbox — approval queue</h3>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Submissions wait here — never on the board, never visible to drivers. The document's lane, pay, and
            windows were read in at upload; check and edit every field, then approve or reject. Every decision is
            recorded: who sent it, which link, the document fingerprint, and who decided, when.
          </p>
        </div>
        {pending.length === 0 && decided.length === 0 && (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-sm text-[var(--dim)]">
            Inbox is empty. When a broker uploads through their link, the submission lands here for your review.
          </p>
        )}
        {pending.map((s) => (
          <SubmissionCard key={s.id} sub={s} mode={data.mode} setBanner={setBanner} onOpenMyLoad={onOpenMyLoad} refresh={refresh} />
        ))}
        {decided.length > 0 && (
          <>
            <h4 className="px-1 pt-1 font-condensed text-lg font-semibold text-[var(--dim)]">Decided — kept on record</h4>
            {decided.map((s) => (
              <SubmissionCard key={s.id} sub={s} mode={data.mode} setBanner={setBanner} onOpenMyLoad={onOpenMyLoad} refresh={refresh} />
            ))}
          </>
        )}
      </section>

      {previewToken && (
        <div className="fixed inset-0 z-[960] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="Broker view — upload only">
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-condensed text-xl font-bold">Broker view — upload only</div>
              <button type="button" onClick={() => setPreviewToken(null)} className="rounded-full bg-[var(--surface2)] px-3.5 py-2 font-bold" aria-label="Close broker view">✕</button>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
              This is the complete broker experience for this link — the form below and nothing else in the app.
            </p>
            <div className="mt-3">
              <BrokerUploadForm token={previewToken} setBanner={setBanner} onSubmitted={refresh} />
            </div>
          </div>
        </div>
      )}
      {variant === "console" && <p className="text-xs text-[var(--dim)]">Same inbox and links as the phone Loads tab — one queue, both faces.</p>}
    </div>
  );
}
