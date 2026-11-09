// STONEMILES Shipper Portal — v1.
//
// A shipper posts a load straight to the RUGGS LOGISTICS desk in about
// three clicks, under its own name, instead of loads passing hand to
// hand. The desk (Owner/Dispatch) reviews every sent load in the
// review queue — Release to board, Edit, or Return with a note — and
// only a release creates a normal Fleet Board load, which then runs
// the existing claim → sealed POD → auto-invoice path unchanged.
//
// HARD RULES rendered honestly here: there is NO payment surface
// anywhere in this portal, and nothing shipper-facing shows any
// dispatch fee or internal percentage — the server's shipper shapes
// don't carry those fields at all. A shipper sees ONLY its own loads
// (the server resolves the account from the signed-in username, never
// from anything this client sends). Carrier phone: the number the
// carrier added to their own profile — the server surfaces it on a
// load only after that carrier has claimed it, so this card shows it
// then and says "not on file" plainly before/without one. Carrier
// credentials (migration 0083) ride the same claim gate: contact
// email, MC/DOT, TWIC, endorsements, and the FMCSA SAFER Web link
// built from the carrier's own numbers — a link to the official
// federal record, never a score. Demo accounts are badged DEMO
// everywhere they appear.

import { useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { PdfViewer } from "@hatch/space-sdk/pdf";
import { api, type ApiResponse } from "./api";
import { laneKey, useLaneEstimates } from "./useLaneEstimate";
import { PerMileLine } from "./RatePerMile";
import { endorsementLabel } from "./credentials";

type PortalData = ApiResponse<typeof api, "getShipperPortal">;
type PortalLoad = PortalData["myLoads"][number];
type PortalAccount = NonNullable<PortalData["shipper"]>;

const INPUT =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";

const EQUIPMENT_OPTIONS = [
  { value: "flatbed", label: "Flatbed" },
  { value: "step_deck", label: "Step-deck" },
  { value: "rgn", label: "RGN" },
] as const;

type Draft = {
  referenceNumber: string;
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupDate: string;
  pickupWindow: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryState: string;
  deliveryDate: string;
  deliveryWindow: string;
  commodity: string;
  freightClass: string;
  weightLbs: string;
  pieces: string;
  dimensions: string;
  equipment: string;
  tarps: boolean;
  edgeProtectors: boolean;
  rate: string;
  signoffConfirmed: boolean;
  offloadConfirmed: boolean;
  contactName: string;
  contactPhone: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = {
  referenceNumber: "",
  pickupAddress: "",
  pickupCity: "",
  pickupState: "",
  pickupDate: "",
  pickupWindow: "",
  deliveryAddress: "",
  deliveryCity: "",
  deliveryState: "",
  deliveryDate: "",
  deliveryWindow: "",
  commodity: "",
  freightClass: "",
  weightLbs: "",
  pieces: "",
  dimensions: "",
  equipment: "flatbed",
  tarps: false,
  edgeProtectors: false,
  rate: "",
  signoffConfirmed: false,
  offloadConfirmed: false,
  contactName: "",
  contactPhone: "",
  notes: "",
};

function draftOfLoad(l: PortalLoad): Draft {
  return {
    referenceNumber: l.referenceNumber ?? "",
    pickupAddress: l.pickupAddress ?? "",
    pickupCity: l.pickupCity ?? "",
    pickupState: l.pickupState ?? "",
    pickupDate: l.pickupDate ?? "",
    pickupWindow: l.pickupWindow ?? "",
    deliveryAddress: l.deliveryAddress ?? "",
    deliveryCity: l.deliveryCity ?? "",
    deliveryState: l.deliveryState ?? "",
    deliveryDate: l.deliveryDate ?? "",
    deliveryWindow: l.deliveryWindow ?? "",
    commodity: l.commodity ?? "",
    freightClass: l.freightClass ?? "",
    weightLbs: l.weightLbs != null ? String(l.weightLbs) : "",
    pieces: l.pieces != null ? String(l.pieces) : "",
    dimensions: l.dimensions ?? "",
    equipment: l.equipment ?? "flatbed",
    tarps: l.tarps,
    edgeProtectors: l.edgeProtectors,
    rate: l.rate != null ? String(l.rate) : "",
    signoffConfirmed: l.signoffConfirmed,
    offloadConfirmed: l.offloadConfirmed,
    contactName: l.contactName ?? "",
    contactPhone: l.contactPhone ?? "",
    notes: l.notes ?? "",
  };
}

function draftOfDefaults(a: PortalAccount): Draft {
  return {
    ...EMPTY_DRAFT,
    pickupAddress: a.defaultPickupAddress ?? "",
    pickupCity: a.defaultPickupCity ?? "",
    pickupState: a.defaultPickupState ?? "",
    commodity: a.defaultCommodity ?? "",
    freightClass: a.defaultFreightClass ?? "",
    contactName: a.defaultContactName ?? a.contactName ?? "",
    contactPhone: a.defaultContactPhone ?? "",
  };
}

const num = (s: string): number | null => {
  const v = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const clean = (s: string): string | null => (s.trim() ? s.trim() : null);

function fieldsOf(d: Draft) {
  return {
    referenceNumber: clean(d.referenceNumber),
    pickupAddress: clean(d.pickupAddress),
    pickupCity: clean(d.pickupCity),
    pickupState: clean(d.pickupState),
    pickupDate: clean(d.pickupDate),
    pickupWindow: clean(d.pickupWindow),
    deliveryAddress: clean(d.deliveryAddress),
    deliveryCity: clean(d.deliveryCity),
    deliveryState: clean(d.deliveryState),
    deliveryDate: clean(d.deliveryDate),
    deliveryWindow: clean(d.deliveryWindow),
    commodity: clean(d.commodity),
    freightClass: clean(d.freightClass),
    weightLbs: num(d.weightLbs) != null ? Math.round(num(d.weightLbs)!) : null,
    pieces: num(d.pieces) != null ? Math.round(num(d.pieces)!) : null,
    dimensions: clean(d.dimensions),
    equipment: (d.equipment || null) as "flatbed" | "step_deck" | "rgn" | null,
    tarps: d.tarps,
    edgeProtectors: d.edgeProtectors,
    rate: num(d.rate),
    signoffConfirmed: d.signoffConfirmed,
    offloadConfirmed: d.offloadConfirmed,
    contactName: clean(d.contactName),
    contactPhone: clean(d.contactPhone),
    notes: clean(d.notes),
  };
}

function laneOf(r: { pickupCity: string | null; pickupState: string | null; deliveryCity: string | null; deliveryState: string | null }): string {
  const a = [r.pickupCity, r.pickupState].filter(Boolean).join(", ") || "Pickup TBD";
  const b = [r.deliveryCity, r.deliveryState].filter(Boolean).join(", ") || "Delivery TBD";
  return `${a} → ${b}`;
}

function money(n: number | null): string {
  return n == null ? "Rate not set" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLE: Record<string, string> = {
  Draft: "bg-[var(--surface)] text-[var(--dim)]",
  "Returned — needs fixes": "bg-[var(--danger)] text-white",
  "With dispatch": "bg-amber-900/60 text-amber-200",
  "On the board": "bg-emerald-900/60 text-emerald-300",
  "Carrier assigned": "bg-emerald-900/60 text-emerald-300",
  "Picked up": "bg-emerald-900/60 text-emerald-300",
  "In transit": "bg-emerald-900/60 text-emerald-300",
  Delivered: "bg-emerald-900/70 text-emerald-100",
};

// ---- Shared load-fields form ------------------------------------------------

function LoadFieldsForm({
  draft,
  setDraft,
  prefix,
  account,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  prefix: string;
  account?: PortalAccount | null;
}) {
  const f = (key: keyof Draft) => ({
    value: draft[key] as string,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft({ ...draft, [key]: e.target.value }),
  });
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <div>
        <label className={LABEL} htmlFor={`${prefix}-ref`}>Shipper reference # (your PO / order #)</label>
        <input id={`${prefix}-ref`} aria-label="Shipper reference number" className={INPUT} {...f("referenceNumber")} placeholder="e.g. PO 1042" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-contact-name`}>Load contact name</label>
        <input id={`${prefix}-contact-name`} aria-label="Load contact name" className={INPUT} {...f("contactName")} placeholder="Who dispatch calls about this load" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-contact-phone`}>Load contact phone</label>
        <input id={`${prefix}-contact-phone`} aria-label="Load contact phone" className={INPUT} {...f("contactPhone")} placeholder="For en-route communication" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-rate`}>Rate ($) — the agreed freight amount</label>
        <input id={`${prefix}-rate`} aria-label="Rate in dollars" className={INPUT} inputMode="decimal" {...f("rate")} placeholder="Required to send" />
      </div>

      <div className="sm:col-span-2 mt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Pickup</div>
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor={`${prefix}-paddr`}>Pickup address</label>
        <input id={`${prefix}-paddr`} aria-label="Pickup address" className={INPUT} {...f("pickupAddress")} placeholder="Street address" />
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
        <label className={LABEL} htmlFor={`${prefix}-pdate`}>Pickup date</label>
        <input id={`${prefix}-pdate`} aria-label="Pickup date" className={INPUT} {...f("pickupDate")} placeholder="e.g. Fri Oct 30" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-pwin`}>Pickup window</label>
        <input id={`${prefix}-pwin`} aria-label="Pickup window" className={INPUT} {...f("pickupWindow")} placeholder="e.g. 08:00–12:00" />
      </div>

      <div className="sm:col-span-2 mt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Delivery</div>
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor={`${prefix}-daddr`}>Delivery address</label>
        <input id={`${prefix}-daddr`} aria-label="Delivery address" className={INPUT} {...f("deliveryAddress")} placeholder="Street address" />
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
        <label className={LABEL} htmlFor={`${prefix}-ddate`}>Delivery date</label>
        <input id={`${prefix}-ddate`} aria-label="Delivery date" className={INPUT} {...f("deliveryDate")} placeholder="e.g. Mon Nov 2" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-dwin`}>Delivery window</label>
        <input id={`${prefix}-dwin`} aria-label="Delivery window" className={INPUT} {...f("deliveryWindow")} placeholder="e.g. by 17:00" />
      </div>

      <div className="sm:col-span-2 mt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Freight</div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-commodity`}>Commodity</label>
        <input id={`${prefix}-commodity`} aria-label="Commodity" className={INPUT} {...f("commodity")} placeholder="e.g. Concrete pavers" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-class`}>Freight class</label>
        <input id={`${prefix}-class`} aria-label="Freight class" className={INPUT} {...f("freightClass")} placeholder="e.g. 60" />
      </div>
      {account && (
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
            aria-label="Use the concrete pavers default — commodity concrete pavers, class 60"
            onClick={() => setDraft({ ...draft, commodity: "Concrete pavers", freightClass: "60" })}
          >
            Pavers — class 60
          </button>
          <button
            type="button"
            className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
            aria-label="Use the sealer default — commodity sealer, class 55"
            onClick={() => setDraft({ ...draft, commodity: "Sealer", freightClass: "55" })}
          >
            Sealer — class 55
          </button>
        </div>
      )}
      <div>
        <label className={LABEL} htmlFor={`${prefix}-weight`}>Weight (lbs)</label>
        <input id={`${prefix}-weight`} aria-label="Weight in pounds" className={INPUT} inputMode="numeric" {...f("weightLbs")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-pieces`}>Pieces</label>
        <input id={`${prefix}-pieces`} aria-label="Piece count" className={INPUT} inputMode="numeric" {...f("pieces")} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-dims`}>Dimensions</label>
        <input id={`${prefix}-dims`} aria-label="Dimensions" className={INPUT} {...f("dimensions")} placeholder="e.g. 40×48 pallets, 4 ft high" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-equipment`}>Equipment needed</label>
        <select id={`${prefix}-equipment`} className={INPUT} value={draft.equipment} onChange={(e) => setDraft({ ...draft, equipment: e.target.value })} aria-label="Equipment needed">
          {EQUIPMENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <label className="flex min-h-[44px] items-center gap-2.5 text-sm font-semibold">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={draft.tarps}
          onChange={(e) => setDraft({ ...draft, tarps: e.target.checked })}
          aria-label="Tarps required"
        />
        Tarps required
      </label>
      <label className="flex min-h-[44px] items-center gap-2.5 text-sm font-semibold">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={draft.edgeProtectors}
          onChange={(e) => setDraft({ ...draft, edgeProtectors: e.target.checked })}
          aria-label="Edge protectors required"
        />
        Edge protectors required
      </label>
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor={`${prefix}-notes`}>Notes for dispatch</label>
        <input id={`${prefix}-notes`} aria-label="Notes for dispatch" className={INPUT} {...f("notes")} placeholder="Gate code, site rules, anything dispatch needs" />
      </div>

      <div className="sm:col-span-2 mt-1 rounded-xl bg-[var(--surface)] px-3 py-3">
        <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Two confirmations — a load can't be sent without both</div>
        <label className="mt-2 flex min-h-[44px] items-start gap-2.5 text-sm font-semibold">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
            checked={draft.signoffConfirmed}
            onChange={(e) => setDraft({ ...draft, signoffConfirmed: e.target.checked })}
            aria-label="Customer has signed off and agreed to pay"
          />
          Customer has signed off and agreed to pay
        </label>
        <label className="mt-1 flex min-h-[44px] items-start gap-2.5 text-sm font-semibold">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
            checked={draft.offloadConfirmed}
            onChange={(e) => setDraft({ ...draft, offloadConfirmed: e.target.checked })}
            aria-label="Offload equipment confirmed on site"
          />
          Offload equipment confirmed on site (forklift / equipment at delivery)
        </label>
      </div>
    </div>
  );
}

// ---- Document viewer ---------------------------------------------------------

function DocViewer({
  loadId,
  kind,
  title,
  onClose,
}: {
  loadId: number;
  kind: "ratecon" | "bol";
  title: string;
  onClose: () => void;
}) {
  const docQuery = useQuery({
    queryKey: ["shipper-doc", loadId, kind],
    queryFn: () => api.getShipperLoadDoc({ id: loadId, kind }),
  });
  return (
    <div className="fixed inset-0 z-[960] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label={title}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="font-condensed text-xl font-bold">{title}</div>
          <button type="button" onClick={onClose} className="rounded-full bg-[var(--surface2)] px-3.5 py-2 font-bold" aria-label="Close document viewer">✕</button>
        </div>
        <div className="mt-3">
          {docQuery.isPending && <p className="text-sm text-[var(--dim)]">Loading document…</p>}
          {docQuery.data?.url && docQuery.data.mime === "application/pdf" && (
            <PdfViewer
              src={docQuery.data.url}
              ariaLabel={`${title} PDF`}
              labels={{ loading: "Loading PDF…", loadError: "This PDF couldn't be displayed.", previousPage: "Previous page", nextPage: "Next page" }}
            />
          )}
          {docQuery.data?.url && docQuery.data.mime?.startsWith("image/") && (
            <img src={docQuery.data.url} alt={title} className="w-full rounded-lg" />
          )}
          {docQuery.data?.url && docQuery.data.mime !== "application/pdf" && !docQuery.data.mime?.startsWith("image/") && (
            <p className="text-sm">
              This file type can't be previewed here.{" "}
              <a className="font-bold text-[var(--accent)] underline" href={docQuery.data.url} target="_blank" rel="noreferrer">Open / download the file</a>
            </p>
          )}
          {docQuery.data?.url && (
            <p className="mt-2 text-sm">
              <a className="font-bold text-[var(--accent)] underline" href={docQuery.data.url} target="_blank" rel="noreferrer">⬇ Download original</a>
            </p>
          )}
          {docQuery.data && !docQuery.data.url && (
            <p className="text-sm text-[var(--dim)]">No document is stored for this load in this slot — or it isn't yours to see.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Tracking viewer (token) --------------------------------------------------

function TrackingCard({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["shipper-tracking", token],
    queryFn: () => api.getShipperTracking({ token }),
    enabled: token.trim().length >= 8,
  });
  if (token.trim().length < 8) return <p className="text-sm text-[var(--dim)]">Paste a tracking token to see the load's tracking view.</p>;
  if (q.isPending) return <p className="text-sm text-[var(--dim)]">Checking this tracking link…</p>;
  if (!q.data || !q.data.valid) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3" role="note">
        <div className="font-condensed text-lg font-bold">This tracking link isn't live</div>
        <p className="mt-0.5 text-sm text-[var(--dim)]">Tracking starts when RUGGS LOGISTICS releases a load to the board. Check the token, or ask dispatch for a fresh one.</p>
      </div>
    );
  }
  const d = q.data;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3" role="status" aria-label="Load tracking">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-condensed text-lg font-bold">{d.lane}</div>
        <span className="rounded-full bg-emerald-900/60 px-2.5 py-1 text-[11px] font-bold text-emerald-300">{(d.plainStatus ?? "").toUpperCase()}</span>
      </div>
      <dl className="mt-1.5 space-y-0.5 text-sm text-[var(--dim)]">
        <div>Shipper: <span className="font-semibold text-[var(--text)]">{d.shipperName}</span>{d.referenceNumber ? <> · ref <span className="font-semibold text-[var(--text)]">{d.referenceNumber}</span></> : null}</div>
        {d.commodity && <div>Freight: <span className="font-semibold text-[var(--text)]">{d.commodity}</span></div>}
        {d.pickupText && <div>Pickup: <span className="font-semibold text-[var(--text)]">{d.pickupText}</span></div>}
        {d.deliveryText && <div>Delivery: <span className="font-semibold text-[var(--text)]">{d.deliveryText}</span></div>}
        {d.carrierName && <div>Carrier: <span className="font-semibold text-[var(--text)]">{d.carrierName}</span></div>}
        {d.carrierName && d.carrierPhone && (
          <div>
            Carrier phone:{" "}
            <a href={`tel:${d.carrierPhone.replace(/[^+0-9]/g, "")}`} className="font-semibold text-[var(--accent)] underline" aria-label={`Call carrier ${d.carrierName} at ${d.carrierPhone}`}>
              {d.carrierPhone}
            </a>
          </div>
        )}
        {d.carrierName && d.carrierSaferUrl && (
          <div>
            Safety record:{" "}
            <a href={d.carrierSaferUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent)] underline" aria-label={`View carrier ${d.carrierName} official FMCSA SAFER Web safety record`}>
              FMCSA SAFER Web →
            </a>{" "}
            (official FMCSA Company Snapshot)
          </div>
        )}
        {d.podSealedAt && <div>Delivered — POD sealed {new Date(d.podSealedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
        {d.updatedAt && <div className="text-xs">Updated {new Date(d.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · state-level tracking — no precise location is shared.</div>}
      </dl>
      <p className="mt-1.5 text-xs text-[var(--dim)]">Powered by STONEMILES · Dispatch: RUGGS LOGISTICS</p>
    </div>
  );
}

// ---- Post-a-load flow (shipper) ------------------------------------------------

function PostLoadFlow({
  account,
  initial,
  setBanner,
  onClose,
  refresh,
}: {
  account: PortalAccount;
  initial: PortalLoad | null;
  setBanner: (s: string | null) => void;
  onClose: () => void;
  refresh: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draftId, setDraftId] = useState<number | null>(initial?.id ?? null);
  const [draft, setDraft] = useState<Draft>(() => (initial ? draftOfLoad(initial) : draftOfDefaults(account)));
  const [pendingDoc, setPendingDoc] = useState<{ base64: string; mime: string } | null>(null);
  const [hasDoc, setHasDoc] = useState<boolean>(initial?.hasRateCon ?? false);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const handleDoc = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const mime = file.type || "application/octet-stream";
      const enc = await fileToBase64(file);
      setPendingDoc({ base64: enc.dataBase64, mime: enc.mimeType || mime });
      setHasDoc(true);
      if (mime === "image/jpeg" || mime === "image/png") {
        try {
          const result = await api.extractLoad({ dataBase64: enc.dataBase64, mimeType: mime, purpose: "new_load" });
          if (result.found) {
            setDraft((d) => ({
              ...d,
              pickupAddress: result.pickupAddress ?? d.pickupAddress,
              pickupCity: result.pickupCity ?? d.pickupCity,
              pickupState: result.pickupState ?? d.pickupState,
              deliveryAddress: result.deliveryAddress ?? d.deliveryAddress,
              deliveryCity: result.deliveryCity ?? d.deliveryCity,
              deliveryState: result.deliveryState ?? d.deliveryState,
              rate: result.rate != null ? String(result.rate) : d.rate,
              weightLbs: result.weightLbs != null ? String(Math.round(result.weightLbs)) : d.weightLbs,
              commodity: result.commodity ?? d.commodity,
            }));
          }
        } catch { /* the file is attached either way; fields stay as typed */ }
      }
    } catch {
      setBanner("Couldn't attach that file — try again, or save the load and attach it from an edit.");
    }
  };

  const save = async (send: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await api.saveShipperLoad({
        id: draftId,
        send,
        ...fieldsOf(draft),
        docDataBase64: pendingDoc?.base64 ?? null,
        docMime: pendingDoc?.mime ?? null,
      });
      if (!res.ok) {
        setBanner(res.error ?? "That didn't save.");
        return false;
      }
      setDraftId(res.id);
      setMissing(res.missing);
      if (send && res.sent) {
        setStep(3);
        setBanner("Received — RUGGS LOGISTICS dispatch is reviewing your load.");
        refresh();
        return true;
      }
      if (send && !res.sent) {
        setBanner(`Saved as a draft — it still needs ${res.missing.join(", ")} before it can be sent.`);
        refresh();
        return false;
      }
      setBanner("Draft saved — finish it anytime from your load list.");
      refresh();
      return true;
    } catch {
      setBanner("That didn't save — check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (step === 3) {
    return (
      <section className="glass-panel p-4" aria-label="Load sent confirmation">
        <div className="font-condensed text-2xl font-bold">✅ Received — RUGGS LOGISTICS dispatch is reviewing</div>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          Your load is <strong className="text-[var(--text)]">With dispatch</strong>. Nothing is on the carrier board
          yet — RUGGS LOGISTICS checks it and releases it. You'll see the status move to “On the board” in your load
          list below, and the carrier's name appears there once a carrier claims it.
        </p>
        <button type="button" className="btn-neon btn-press mt-3 rounded-xl px-4 py-3 font-bold" aria-label="Done — back to my loads" onClick={onClose}>
          Back to my loads
        </button>
      </section>
    );
  }

  return (
    <section className="glass-panel p-3.5" aria-label={initial ? "Edit load" : "Post a load"}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-condensed text-xl font-semibold">{initial ? "✏️ Edit load" : "🚚 New load"}</h3>
        <span className="text-xs font-bold text-[var(--dim)]">Step {step} of 2 — {step === 1 ? "Load details" : "Review & send"}</span>
      </div>

      {step === 1 && (
        <>
          <label className="btn-press mt-3 flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface2)] px-3 py-3 text-center text-sm font-bold">
            📎 {hasDoc ? "Rate confirmation attached — tap to replace (PDF or photo)" : "Attach the rate confirmation — PDF or photo, always accepted *"}
            <input type="file" accept="image/*,application/pdf" className="sr-only" aria-label="Attach the rate confirmation" onChange={handleDoc} />
          </label>
          <p className="mt-1 text-xs text-[var(--dim)]">* A load can save as a draft without it — it just can't be sent until the rate confirmation is attached.</p>
          <div className="mt-3">
            <LoadFieldsForm draft={draft} setDraft={setDraft} prefix="ship-post" account={account} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="btn-neon btn-press flex-1 rounded-xl px-4 py-3 font-bold disabled:opacity-50"
              aria-label="Review this load before sending"
              onClick={() => void save(false).then((ok) => { if (ok) setStep(2); })}
            >
              {busy ? "Saving…" : "Review →"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-bold disabled:opacity-50"
              aria-label="Save this load as a draft"
              onClick={() => void save(false).then((ok) => { if (ok) onClose(); })}
            >
              Save draft
            </button>
            <button type="button" className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-bold" aria-label="Cancel posting this load" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <dl className="mt-3 space-y-1.5 rounded-xl bg-[var(--surface2)] px-3.5 py-3 text-sm">
            <div className="font-condensed text-lg font-bold">{laneOf(draft)}</div>
            <div>Ref: <strong>{draft.referenceNumber || "—"}</strong> · Rate: <strong>{money(num(draft.rate))}</strong></div>
            <div>Pickup: <strong>{[draft.pickupAddress, draft.pickupDate, draft.pickupWindow].filter(Boolean).join(" · ") || "—"}</strong></div>
            <div>Delivery: <strong>{[draft.deliveryAddress, draft.deliveryDate, draft.deliveryWindow].filter(Boolean).join(" · ") || "—"}</strong></div>
            <div>Freight: <strong>{draft.commodity || "—"}{draft.freightClass ? ` · class ${draft.freightClass}` : ""}</strong>{draft.weightLbs ? ` · ${draft.weightLbs} lbs` : ""}{draft.pieces ? ` · ${draft.pieces} pcs` : ""}</div>
            <div>Equipment: <strong>{EQUIPMENT_OPTIONS.find((o) => o.value === draft.equipment)?.label ?? "—"}</strong>{draft.tarps ? " · tarps" : ""}{draft.edgeProtectors ? " · EDGE PROTECTORS REQUIRED" : ""}</div>
            <div>Rate confirmation: <strong>{hasDoc ? "attached ✓" : "NOT attached"}</strong></div>
            <div>Customer sign-off: <strong>{draft.signoffConfirmed ? "confirmed ✓" : "NOT confirmed"}</strong> · Offload equipment: <strong>{draft.offloadConfirmed ? "confirmed ✓" : "NOT confirmed"}</strong></div>
            <div>Load contact: <strong>{[draft.contactName, draft.contactPhone].filter(Boolean).join(" · ") || "—"}</strong></div>
          </dl>
          {missing.length > 0 && (
            <p className="mt-2 rounded-xl bg-amber-900/40 px-3 py-2.5 text-sm font-semibold text-amber-200" role="note">
              Still needed before this can be sent: {missing.join(", ")}. It can only save as a draft until then.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="btn-neon btn-press flex-1 rounded-xl px-4 py-3 font-bold disabled:opacity-50"
              aria-label="Send this load to RUGGS LOGISTICS dispatch"
              onClick={() => void save(true)}
            >
              {busy ? "Sending…" : "Send to dispatch"}
            </button>
            <button
              type="button"
              className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-bold"
              aria-label="Back to editing the load details"
              onClick={() => setStep(1)}
            >
              ← Back to details
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
            Sending puts the load in the RUGGS LOGISTICS review queue — it reaches the carrier board only when
            dispatch releases it. No payment happens in this portal, ever.
          </p>
        </>
      )}
    </section>
  );
}

// ---- Shipper load card -----------------------------------------------------------

function ShipperLoadCard({
  load,
  setBanner,
  onEdit,
  onViewDoc,
  onTrack,
  refresh,
}: {
  load: PortalLoad;
  setBanner: (s: string | null) => void;
  onEdit: (l: PortalLoad) => void;
  onViewDoc: (id: number, kind: "ratecon" | "bol", title: string) => void;
  onTrack: (token: string) => void;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [armDelete, setArmDelete] = useState(false);
  // Portal loads carry no miles of their own — the $/mi here is the
  // labelled lane estimate only (see loadRate.ts rules).
  const cardEstimates = useLaneEstimates([{ ...load, extraCharges: 0, loadedMiles: null }]);
  const editable = load.status === "draft" || load.status === "returned";
  const resend = async () => {
    setBusy(true);
    try {
      const res = await api.saveShipperLoad({
        id: load.id,
        send: true,
        referenceNumber: load.referenceNumber,
        pickupAddress: load.pickupAddress,
        pickupCity: load.pickupCity,
        pickupState: load.pickupState,
        pickupDate: load.pickupDate,
        pickupWindow: load.pickupWindow,
        deliveryAddress: load.deliveryAddress,
        deliveryCity: load.deliveryCity,
        deliveryState: load.deliveryState,
        deliveryDate: load.deliveryDate,
        deliveryWindow: load.deliveryWindow,
        commodity: load.commodity,
        freightClass: load.freightClass,
        weightLbs: load.weightLbs,
        pieces: load.pieces,
        dimensions: load.dimensions,
        equipment: load.equipment as "flatbed" | "step_deck" | "rgn" | null,
        tarps: load.tarps,
        edgeProtectors: load.edgeProtectors,
        rate: load.rate,
        signoffConfirmed: load.signoffConfirmed,
        offloadConfirmed: load.offloadConfirmed,
        contactName: load.contactName,
        contactPhone: load.contactPhone,
        notes: load.notes,
        docDataBase64: null,
        docMime: null,
      });
      if (!res.ok) setBanner(res.error ?? "That didn't send.");
      else if (!res.sent) setBanner(`Still a draft — it needs ${res.missing.join(", ")} before it can be sent. Open it to finish.`);
      else setBanner("Sent — RUGGS LOGISTICS dispatch is reviewing your load.");
      refresh();
    } catch {
      setBanner("That didn't send — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Your load ${laneOf(load)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-condensed text-lg font-bold leading-tight">{laneOf(load)}</div>
          <div className="mt-0.5 text-xs text-[var(--dim)]">
            {load.shipperName}{load.referenceNumber ? ` · ref ${load.referenceNumber}` : ""} · posted {new Date(load.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[load.plainStatus] ?? ""}`}>{load.plainStatus.toUpperCase()}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
        <span className="neon-text font-condensed text-2xl font-bold">{money(load.rate)}</span>
        <PerMileLine load={{ rate: load.rate, extraCharges: 0, totalWithExtras: load.rate, loadedMiles: null, totalPerMile: null }} estMiles={cardEstimates.get(laneKey({ ...load, extraCharges: 0, loadedMiles: null })) ?? null} />
        {load.commodity && <span className="text-sm text-[var(--dim)]">{load.commodity}{load.freightClass ? ` · class ${load.freightClass}` : ""}</span>}
        {load.equipmentLabel && <span className="text-sm text-[var(--dim)]">{load.equipmentLabel}{load.edgeProtectors ? " · edge protectors" : ""}</span>}
      </div>
      {load.status === "returned" && load.reviewNote && (
        <p className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm font-semibold" role="note">
          ↩ Returned by RUGGS LOGISTICS{load.reviewedBy ? ` (@${load.reviewedBy})` : ""}: {load.reviewNote}
        </p>
      )}
      {editable && load.missingForSend.length > 0 && (
        <p className="mt-2 text-xs font-semibold text-amber-200">Needs before it can be sent: {load.missingForSend.join(", ")}.</p>
      )}
      {load.carrierName && (
        <p className="mt-2 text-sm">
          🚛 Carrier: <strong>{load.carrierName}</strong>
          {load.carrierUsername ? <span className="text-[var(--dim)]"> (@{load.carrierUsername})</span> : null}
          {load.carrierPhone ? (
            <span className="block text-xs text-[var(--dim)]">
              📞 Carrier phone:{" "}
              <a href={`tel:${load.carrierPhone.replace(/[^+0-9]/g, "")}`} className="font-bold text-[var(--accent)] underline" aria-label={`Call carrier ${load.carrierName} at ${load.carrierPhone}`}>
                {load.carrierPhone}
              </a>{" "}
              — the number this carrier put on their profile, shown because they claimed your load.
            </span>
          ) : (
            <span className="block text-xs text-[var(--dim)]">Carrier phone isn't on file in STONEMILES — RUGGS LOGISTICS dispatch can connect you, or message the carrier through dispatch.</span>
          )}
        </p>
      )}
      {load.carrierName && (load.carrierEmail || load.carrierMcNumber || load.carrierDotNumber || load.carrierTwicHas || load.carrierEndorsements.length > 0) && (
        <div className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed text-[var(--dim)]">
          <span className="font-bold uppercase tracking-wide">Carrier credentials</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3">
            {load.carrierDotNumber && <span>DOT: <strong className="text-[var(--text)]">{load.carrierDotNumber}</strong></span>}
            {load.carrierMcNumber && <span>MC: <strong className="text-[var(--text)]">{load.carrierMcNumber}</strong></span>}
            {load.carrierTwicHas && <span>🪪 TWIC{load.carrierTwicExpires ? ` · exp ${load.carrierTwicExpires}` : ""}</span>}
            {load.carrierEndorsements.length > 0 && <span>Endorsements: <strong className="text-[var(--text)]">{load.carrierEndorsements.map((k) => endorsementLabel(k)).join(" · ")}</strong></span>}
          </span>
          {load.carrierEmail && (
            <span className="mt-0.5 block">
              ✉️ Carrier email:{" "}
              <a href={`mailto:${load.carrierEmail}`} className="font-bold text-[var(--accent)] underline" aria-label={`Email carrier ${load.carrierName} at ${load.carrierEmail}`}>
                {load.carrierEmail}
              </a>{" "}
              — shown because they claimed your load, same as their phone.
            </span>
          )}
          {load.carrierSaferUrl && (
            <a href={load.carrierSaferUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-block font-bold text-[var(--accent)] underline" aria-label={`View carrier ${load.carrierName} official FMCSA SAFER Web safety record`}>
              🛡️ FMCSA SAFER Web safety record →
            </a>
          )}
          {load.carrierSaferUrl && <span className="block">The SAFER link opens this carrier's official Company Snapshot at FMCSA — the federal record itself.</span>}
        </div>
      )}
      {load.podSealed && (
        <p className="mt-2 text-sm font-semibold text-emerald-300">
          ✓ Delivered — POD sealed{load.podSealedAt ? ` ${new Date(load.podSealedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
          {load.podSealHash ? <span className="block text-xs font-normal text-[var(--dim)]">Seal record: <span className="font-mono">{load.podSealHash.slice(0, 16)}…</span> — tamper-evident in the sealed records.</span> : null}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {load.hasRateCon && (
          <button type="button" className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold" aria-label={`View or download your rate confirmation for ${laneOf(load)}`} onClick={() => onViewDoc(load.id, "ratecon", "Rate confirmation")}>
            📄 Rate con
          </button>
        )}
        {load.podSealed && load.hasBol && (
          <button type="button" className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold" aria-label={`View or download the sealed BOL for ${laneOf(load)}`} onClick={() => onViewDoc(load.id, "bol", "Sealed BOL — delivered load")}>
            📄 Sealed BOL
          </button>
        )}
        {load.trackToken && (
          <>
            <button type="button" className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold" aria-label={`Open live tracking for ${laneOf(load)}`} onClick={() => onTrack(load.trackToken!)}>
              📍 Live tracking
            </button>
            <button
              type="button"
              className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
              aria-label={`Copy the tracking link token for ${laneOf(load)}`}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(load.trackToken!)
                  .then(() => setBanner("Tracking token copied — share it with your customer; it shows this load's status and lane only, nothing else. In this build it opens in the portal's tracking view; a tap-to-open web link arrives with the public portal."))
                  .catch(() => setBanner("Copy didn't work on this device — use Live tracking above to view it here."));
              }}
            >
              📋 Copy tracking token
            </button>
          </>
        )}
        {editable && (
          <>
            <button type="button" className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold" aria-label={`Edit load ${laneOf(load)}`} onClick={() => onEdit(load)}>
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn-neon btn-press rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
              aria-label={`Send load ${laneOf(load)} to dispatch`}
              onClick={() => void resend()}
            >
              {busy ? "Sending…" : "Send to dispatch"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={`btn-press rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 ${armDelete ? "bg-[var(--danger)] text-white" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)]"}`}
              aria-label={`Delete load ${laneOf(load)}`}
              onClick={() => {
                if (!armDelete) { setArmDelete(true); return; }
                setBusy(true);
                void api.deleteShipperLoad({ id: load.id })
                  .then((res) => { setBanner(res.ok ? "Load deleted." : (res.error ?? "That delete didn't go through.")); if (res.ok) refresh(); })
                  .catch(() => setBanner("That delete didn't go through — check your connection."))
                  .finally(() => { setBusy(false); setArmDelete(false); });
              }}
            >
              {armDelete ? "Tap again to delete" : "Delete"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

// ---- Desk: review queue card -----------------------------------------------------

function ReviewCard({
  load,
  setBanner,
  onViewDoc,
  refresh,
}: {
  load: PortalLoad;
  setBanner: (s: string | null) => void;
  onViewDoc: (id: number, kind: "ratecon" | "bol", title: string) => void;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOfLoad(load));
  const [returnNote, setReturnNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [armRelease, setArmRelease] = useState(false);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, success: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) { setBanner(res.error ?? "That didn't go through."); return; }
      setBanner(success);
      setArmRelease(false);
      refresh();
    } catch {
      setBanner("That didn't go through — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Review portal load ${laneOf(load)} from ${load.shipperName}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-condensed text-lg font-bold leading-tight">{laneOf(load)}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
            From <strong className="text-[var(--text)]">{load.shipperName}</strong>{load.referenceNumber ? ` · ref ${load.referenceNumber}` : ""} · sent {new Date(load.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {load.hasRateCon ? <> · 📄 rate con on file{load.rateConSha256 ? ` · fingerprint ${load.rateConSha256.slice(0, 10)}…` : ""}</> : " · ⚠ no rate con"}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-900/60 px-2.5 py-1 text-[11px] font-bold text-amber-200">WITH DISPATCH</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
        <span className="neon-text font-condensed text-2xl font-bold">{money(load.rate)}</span>
        {load.commodity && <span className="text-sm text-[var(--dim)]">{load.commodity}{load.freightClass ? ` · class ${load.freightClass}` : ""}</span>}
        {load.weightLbs != null && <span className="text-sm text-[var(--dim)]">{load.weightLbs.toLocaleString()} lbs</span>}
        {load.equipmentLabel && <span className="text-sm text-[var(--dim)]">{load.equipmentLabel}</span>}
      </div>
      <dl className="mt-1.5 space-y-0.5 text-sm text-[var(--dim)]">
        <div>Pickup: <span className="font-semibold text-[var(--text)]">{[load.pickupAddress, load.pickupDate, load.pickupWindow].filter(Boolean).join(" · ") || "—"}</span></div>
        <div>Delivery: <span className="font-semibold text-[var(--text)]">{[load.deliveryAddress, load.deliveryDate, load.deliveryWindow].filter(Boolean).join(" · ") || "—"}</span></div>
        <div>Sign-off: <span className="font-semibold text-[var(--text)]">{load.signoffConfirmed ? "confirmed ✓" : "NOT confirmed"}</span> · Offload: <span className="font-semibold text-[var(--text)]">{load.offloadConfirmed ? "confirmed ✓" : "NOT confirmed"}</span>{load.edgeProtectors ? <> · <span className="font-bold text-[var(--text)]">EDGE PROTECTORS REQUIRED</span></> : null}{load.tarps ? " · tarps" : ""}</div>
        {(load.contactName || load.contactPhone) && <div>Load contact: <span className="font-semibold text-[var(--text)]">{[load.contactName, load.contactPhone].filter(Boolean).join(" · ")}</span></div>}
        {load.notes && <div>Notes: <span className="font-semibold text-[var(--text)]">{load.notes}</span></div>}
      </dl>
      {load.hasRateCon && (
        <button type="button" className="btn-press mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold" aria-label={`View the rate confirmation for ${laneOf(load)}`} onClick={() => onViewDoc(load.id, "ratecon", "Rate confirmation — shipper portal load")}>
          📄 View rate con
        </button>
      )}
      {editing && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <LoadFieldsForm draft={draft} setDraft={setDraft} prefix={`review-${load.id}`} />
          <button
            type="button"
            disabled={busy != null}
            className="btn-press mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            aria-label={`Save desk edits to ${laneOf(load)}`}
            onClick={() => void run("edit", () => api.updateShipperLoadDesk({ id: load.id, ...fieldsOf(draft), docDataBase64: null, docMime: null }), "Edits saved — the load is still in your review queue.")}
          >
            {busy === "edit" ? "Saving…" : "Save edits"}
          </button>
        </div>
      )}
      <div className="mt-3">
        <label className={LABEL} htmlFor={`return-note-${load.id}`}>Return note (the shipper sees this)</label>
        <input id={`return-note-${load.id}`} aria-label="Return note for the shipper" className={INPUT} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="e.g. Rate con is last month's — send the current one" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy != null}
          className={`btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${armRelease ? "bg-[var(--danger)] text-white" : "btn-neon"}`}
          aria-label={`Release ${laneOf(load)} to the Fleet Board`}
          onClick={() => {
            if (!armRelease) { setArmRelease(true); return; }
            void run("release", async () => {
              const res = await api.releaseShipperLoad({ id: load.id });
              return { ok: res.ok, error: res.error };
            }, `Released — ${laneOf(load)} is live on the Fleet Board as a normal board load. The shipper now sees “On the board”.`);
          }}
        >
          {busy === "release" ? "Releasing…" : armRelease ? "Tap again — release to board" : "✓ Release to board"}
        </button>
        <button
          type="button"
          className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-bold"
          aria-label={editing ? `Stop editing ${laneOf(load)}` : `Edit ${laneOf(load)} before deciding`}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Close edit" : "Edit"}
        </button>
        <button
          type="button"
          disabled={busy != null}
          className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-bold text-[var(--danger)] disabled:opacity-50"
          aria-label={`Return ${laneOf(load)} to the shipper with a note`}
          onClick={() => void run("return", () => api.returnShipperLoad({ id: load.id, note: clean(returnNote) }), "Returned to the shipper with your note — it never reached the board.")}
        >
          {busy === "return" ? "Returning…" : "↩ Return with note"}
        </button>
      </div>
    </article>
  );
}

// ---- Main panel -------------------------------------------------------------------

export function ShipperPortalPanel({
  setBanner,
  variant = "phone",
}: {
  setBanner: (s: string | null) => void;
  variant?: "phone" | "console";
}) {
  const queryClient = useQueryClient();
  const portalQuery = useQuery({ queryKey: ["shipper-portal"], queryFn: () => api.getShipperPortal({}) });
  const data = portalQuery.data;
  const [posting, setPosting] = useState(false);
  const [editingLoad, setEditingLoad] = useState<PortalLoad | null>(null);
  const [docView, setDocView] = useState<{ id: number; kind: "ratecon" | "bol"; title: string } | null>(null);
  const [trackToken, setTrackToken] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  // Desk: new shipper account form
  const [acctName, setAcctName] = useState("");
  const [acctEmail, setAcctEmail] = useState("");
  const [acctContact, setAcctContact] = useState("");
  const [acctLinked, setAcctLinked] = useState("");
  const [acctDemo, setAcctDemo] = useState(false);
  const [acctCommodity, setAcctCommodity] = useState("");
  const [acctClass, setAcctClass] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["shipper-portal"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
    void queryClient.invalidateQueries({ queryKey: ["owner-console"] });
  };

  if (portalQuery.isPending) {
    return (
      <section className="glass-panel p-3.5" aria-label="Shipper Portal">
        <p className="text-sm text-[var(--dim)]">Loading the Shipper Portal…</p>
      </section>
    );
  }
  if (!data) return null;

  const account = data.shipper;
  const isDesk = data.mode === "desk" || data.mode === "both";

  const header = account ? (
    <section className="glass-panel p-4" aria-label="Shipper Portal header">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] font-condensed text-xl font-bold text-black" aria-hidden>
          {account.logoInitials ?? account.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate font-condensed text-2xl font-bold leading-tight">
            {account.name}
            {account.isDemo && <span className="ml-2 rounded-full bg-[var(--surface2)] px-2 py-0.5 align-middle font-sans text-[10px] font-bold text-[var(--accent)]">DEMO — staging demo account</span>}
          </div>
          <div className="text-xs text-[var(--dim)]">Powered by STONEMILES · Dispatch: RUGGS LOGISTICS</div>
        </div>
      </div>
      {account.status !== "active" && (
        <p className="mt-2 rounded-xl bg-[var(--danger)] px-3 py-2.5 text-sm font-bold text-white" role="alert">
          This shipper account is suspended — posting is paused. Contact RUGGS LOGISTICS dispatch.
        </p>
      )}
      <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
        Post a load in about three clicks — it goes to RUGGS LOGISTICS dispatch for review, then onto the carrier
        board. You see only your own loads, their plain status, the carrier once one claims, live tracking, and your
        documents. No payments happen in this portal.
      </p>
      {account.status === "active" && !posting && !editingLoad && (
        <button
          type="button"
          className="btn-neon btn-press mt-3 rounded-xl px-4 py-3 font-bold"
          aria-label="Start a new load — step one of the three-click post"
          onClick={() => setPosting(true)}
        >
          🚚 New load
        </button>
      )}
    </section>
  ) : isDesk ? (
    <section className="glass-panel p-4" aria-label="Shipper Portal desk header">
      <h2 className="font-condensed text-2xl font-bold">🚚 Shipper Portal — RUGGS LOGISTICS desk</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        {data.deskCompanyName ?? "Your company"} · @{data.myUsername} · {data.deskRole === "owner" ? "Owner" : "Dispatch"}. Shippers post loads to
        your review queue; nothing reaches the Fleet Board until you release it. Invite a shipper below — link their
        STONEMILES username and they sign in with that same account.
      </p>
    </section>
  ) : (
    <section className="glass-panel p-4" aria-label="Shipper Portal">
      <h2 className="font-condensed text-2xl font-bold">🚚 Shipper Portal</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
        The portal is where a shipper posts loads straight to <strong className="text-[var(--text)]">RUGGS LOGISTICS</strong> dispatch —
        about three clicks, under the shipper's own name, with the rate confirmation attached. Loads land in the
        desk's review queue first; nothing reaches the carrier board until dispatch releases it.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
        This account isn't linked to a shipper and doesn't hold a desk seat, so there's no portal to open here.
        RUGGS LOGISTICS invites each shipper and links their STONEMILES account — if that's you, ask dispatch to
        link @{data.myUsername}. Desk seats manage the portal from here and from Owner Console → Shipper Portal.
      </p>
      <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm leading-relaxed" role="note">
        <strong className="text-[var(--text)]">Request access — Stonervision team — brokers, shippers &amp; help:</strong>{" "}
        to gain Shipper Portal access, contact the Stonervision team at{" "}
        <a
          href="mailto:stonervisionteam@gmail.com"
          className="font-bold text-[var(--accent)] underline"
          aria-label="Email the Stonervision team — brokers, shippers and help — at stonervisionteam@gmail.com to request Shipper Portal access"
        >
          stonervisionteam@gmail.com
        </a>{" "}
        — this address is the Stonervision team's contact for brokers, shippers &amp; help; portal access runs
        through it.
      </p>
    </section>
  );

  const createAccount = async () => {
    if (!acctName.trim() || !acctEmail.trim()) {
      setBanner("Name the shipper and give their email first.");
      return;
    }
    setAcctBusy(true);
    try {
      const res = await api.createShipperAccount({
        name: acctName.trim(),
        email: acctEmail.trim(),
        contactName: clean(acctContact),
        linkedUsername: clean(acctLinked),
        isDemo: acctDemo,
        defaultPickupAddress: null,
        defaultPickupCity: null,
        defaultPickupState: null,
        defaultCommodity: clean(acctCommodity),
        defaultFreightClass: clean(acctClass),
        defaultContactName: clean(acctContact),
        defaultContactPhone: null,
      });
      if (!res.ok) { setBanner(res.error ?? "That account didn't save."); return; }
      setBanner(
        acctDemo
          ? `Demo shipper account created for ${acctName.trim()} — it's labelled DEMO everywhere it appears.`
          : `Shipper account created for ${acctName.trim()} — link their STONEMILES username (below, or when you created it) and they can sign in and post.`,
      );
      setAcctName(""); setAcctEmail(""); setAcctContact(""); setAcctLinked(""); setAcctCommodity(""); setAcctClass(""); setAcctDemo(false);
      refresh();
    } catch {
      setBanner("That account didn't save — check your connection and try again.");
    } finally {
      setAcctBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {header}

      {(posting || editingLoad) && account && (
        <PostLoadFlow
          account={account}
          initial={editingLoad}
          setBanner={setBanner}
          onClose={() => { setPosting(false); setEditingLoad(null); }}
          refresh={refresh}
        />
      )}

      {account && !posting && !editingLoad && (
        <section aria-label="My loads" className="space-y-3">
          <h3 className="px-1 font-condensed text-xl font-semibold">My loads — {account.name} only</h3>
          {data.myLoads.length === 0 && (
            <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-sm text-[var(--dim)]">
              No loads yet. Tap <strong className="text-[var(--text)]">New load</strong> above — have the rate, the rate confirmation file, and your
              customer's sign-off ready and it takes about two minutes.
            </p>
          )}
          {data.myLoads.map((l) => (
            <ShipperLoadCard
              key={l.id}
              load={l}
              setBanner={setBanner}
              onEdit={(load) => { setEditingLoad(load); setPosting(false); }}
              onViewDoc={(id, kind, title) => setDocView({ id, kind, title })}
              onTrack={(token) => setTrackToken(token)}
              refresh={refresh}
            />
          ))}
        </section>
      )}

      {isDesk && (
        <>
          <section aria-label="Dispatch review queue" className="space-y-3">
            <div className="glass-panel p-3.5">
              <h3 className="font-condensed text-xl font-semibold">📥 Dispatch review queue — RUGGS LOGISTICS</h3>
              <p className="mt-1 text-sm text-[var(--dim)]">
                <strong className="text-[var(--text)]">{data.reviewQueue.length} waiting</strong> · Release puts the load on the Fleet Board as a normal
                board load (same claim, sealed POD, and auto-invoice path). Edit fixes it here; Return sends it back
                to the shipper with your note. Drafts never appear here and never reach the board.
              </p>
            </div>
            {data.reviewQueue.length === 0 && (
              <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-sm text-[var(--dim)]">
                Queue is empty. When a shipper sends a load from the portal, it lands here for your call.
              </p>
            )}
            {data.reviewQueue.map((l) => (
              <ReviewCard key={l.id} load={l} setBanner={setBanner} onViewDoc={(id, kind, title) => setDocView({ id, kind, title })} refresh={refresh} />
            ))}
            {data.deskLoads.length > 0 && (
              <>
                <h4 className="px-1 pt-1 font-condensed text-lg font-semibold text-[var(--dim)]">Portal loads — decided & moving</h4>
                {data.deskLoads.map((l) => (
                  <article key={l.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Portal load ${laneOf(l)} from ${l.shipperName}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-condensed text-lg font-bold leading-tight">{laneOf(l)}</div>
                        <div className="mt-0.5 text-xs text-[var(--dim)]">{l.shipperName}{l.referenceNumber ? ` · ref ${l.referenceNumber}` : ""} · {money(l.rate)}{l.carrierName ? ` · carrier ${l.carrierName}` : ""}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[l.plainStatus] ?? ""}`}>{l.plainStatus.toUpperCase()}</span>
                    </div>
                    {l.status === "returned" && l.reviewNote && <p className="mt-1.5 text-xs text-[var(--dim)]">Returned note: {l.reviewNote}</p>}
                  </article>
                ))}
              </>
            )}
          </section>

          <section className="glass-panel p-3.5" aria-label="Shipper accounts">
            <h3 className="font-condensed text-xl font-semibold">🏢 Shipper accounts — invite & manage</h3>
            <p className="mt-1 text-sm text-[var(--dim)]">
              RUGGS LOGISTICS invites the shipper's first user; the linked STONEMILES username is the account that
              signs in as that shipper (same email-login account system). Suspending an account pauses its posting
              without touching the board or other shippers.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="acct-name">Shipper company name</label>
                <input id="acct-name" aria-label="Shipper company name" className={INPUT} value={acctName} onChange={(e) => setAcctName(e.target.value)} placeholder="e.g. Peacock Pavers" />
              </div>
              <div>
                <label className={LABEL} htmlFor="acct-email">Shipper email (their login email)</label>
                <input id="acct-email" aria-label="Shipper email" className={INPUT} value={acctEmail} onChange={(e) => setAcctEmail(e.target.value)} placeholder="shipping@theircompany.com" />
              </div>
              <div>
                <label className={LABEL} htmlFor="acct-contact">Contact name</label>
                <input id="acct-contact" aria-label="Shipper contact name" className={INPUT} value={acctContact} onChange={(e) => setAcctContact(e.target.value)} />
              </div>
              <div>
                <label className={LABEL} htmlFor="acct-linked">Linked STONEMILES username</label>
                <input id="acct-linked" aria-label="Linked STONEMILES username" className={INPUT} value={acctLinked} onChange={(e) => setAcctLinked(e.target.value)} placeholder="@username that signs in as this shipper" />
              </div>
              <div>
                <label className={LABEL} htmlFor="acct-commodity">Default commodity (prefills their form)</label>
                <input id="acct-commodity" aria-label="Default commodity" className={INPUT} value={acctCommodity} onChange={(e) => setAcctCommodity(e.target.value)} placeholder="e.g. Concrete pavers" />
              </div>
              <div>
                <label className={LABEL} htmlFor="acct-class">Default freight class</label>
                <input id="acct-class" aria-label="Default freight class" className={INPUT} value={acctClass} onChange={(e) => setAcctClass(e.target.value)} placeholder="e.g. 60 (pavers) · 55 (sealer)" />
              </div>
            </div>
            <label className="mt-3 flex min-h-[44px] items-center gap-2.5 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={acctDemo} onChange={(e) => setAcctDemo(e.target.checked)} aria-label="This is a demo shipper account for staging" />
              Demo account — staging/demo data, labelled DEMO everywhere it appears
            </label>
            <button
              type="button"
              disabled={acctBusy}
              className="btn-neon btn-press mt-2 rounded-xl px-4 py-3 font-bold disabled:opacity-50"
              aria-label="Create this shipper account"
              onClick={() => void createAccount()}
            >
              {acctBusy ? "Creating…" : "Invite shipper — create account"}
            </button>
            <div className="mt-3 space-y-2.5">
              {data.accounts.length === 0 && <p className="text-sm text-[var(--dim)]">No shipper accounts yet — invite the first one above.</p>}
              {data.accounts.map((a) => (
                <article key={a.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Shipper account ${a.name}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-condensed text-lg font-bold leading-tight">
                        {a.name}
                        {a.isDemo && <span className="ml-2 rounded-full bg-[var(--surface)] px-2 py-0.5 align-middle font-sans text-[10px] font-bold text-[var(--accent)]">DEMO</span>}
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                        {a.email}{a.contactName ? ` · ${a.contactName}` : ""} · {a.loadCount} load{a.loadCount === 1 ? "" : "s"}
                        {a.linkedUsername ? <> · signs in as <strong className="text-[var(--text)]">@{a.linkedUsername}</strong></> : " · no STONEMILES username linked yet — link one so they can sign in"}
                        {a.defaultCommodity ? <> · defaults: {a.defaultCommodity}{a.defaultFreightClass ? ` class ${a.defaultFreightClass}` : ""}</> : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${a.status === "active" ? "bg-emerald-900/60 text-emerald-300" : "bg-[var(--danger)] text-white"}`}>
                      {a.status.toUpperCase()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-press mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
                    aria-label={a.status === "active" ? `Suspend ${a.name}'s portal account` : `Reactivate ${a.name}'s portal account`}
                    onClick={() => {
                      void api.updateShipperAccount({
                        id: a.id,
                        status: a.status === "active" ? "suspended" : "active",
                        linkedUsername: a.linkedUsername,
                        contactName: a.contactName,
                        defaultPickupAddress: a.defaultPickupAddress,
                        defaultPickupCity: a.defaultPickupCity,
                        defaultPickupState: a.defaultPickupState,
                        defaultCommodity: a.defaultCommodity,
                        defaultFreightClass: a.defaultFreightClass,
                        defaultContactName: a.defaultContactName,
                        defaultContactPhone: a.defaultContactPhone,
                      }).then((res) => {
                        setBanner(res.ok ? (a.status === "active" ? `${a.name} is suspended — their posting is paused; the board and other shippers are untouched.` : `${a.name} is active again.`) : (res.error ?? "That change didn't save."));
                        if (res.ok) refresh();
                      }).catch(() => setBanner("That change didn't save — check your connection."));
                    }}
                  >
                    {a.status === "active" ? "Suspend account" : "Reactivate account"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="glass-panel p-3.5" aria-label="Load tracking view">
        <h3 className="font-condensed text-xl font-semibold">📍 Tracking view — what a tracking link shows</h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Once dispatch releases a load, it carries a tracking token. Anyone holding it sees exactly this — the load's
          status and lane, state-level only, no app install. Paste a token to try it:
        </p>
        <div className="mt-2.5 flex gap-2">
          <label className="sr-only" htmlFor="shipper-manual-token">Tracking token</label>
          <input id="shipper-manual-token" aria-label="Tracking token" className={`${INPUT} font-mono text-sm`} value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="trk_…" />
          <button
            type="button"
            disabled={manualToken.trim().length < 8}
            className="btn-press shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            aria-label="Open the tracking view for this token"
            onClick={() => setTrackToken(manualToken.trim())}
          >
            Open
          </button>
        </div>
        {trackToken && <div className="mt-3"><TrackingCard token={trackToken} /></div>}
      </section>

      {variant === "console" && <p className="text-xs text-[var(--dim)]">Same portal as Loads → Shipper Portal on the phone — one queue, both faces.</p>}

      {docView && <DocViewer loadId={docView.id} kind={docView.kind} title={docView.title} onClose={() => setDocView(null)} />}
    </div>
  );
}
