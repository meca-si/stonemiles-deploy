// STONEMILES Broker Portal — poster accounts (migration 0073).
//
// A broker the RUGGS LOGISTICS desk invited posts loads to the OPEN
// board under its own name and logo, instead of loads passing hand to
// hand. Every load lands in the Owner Console review queue first —
// nothing hits the board until the desk releases it — and a release
// puts the load on the Open Board, where only vetted owner operators
// can see and claim it. Same gates as the Shipper Portal: rate and
// rate confirmation required (otherwise draft only), customer
// sign-off and offload-equipment confirmations.
//
// HARD RULES rendered honestly here: there is NO payment surface
// anywhere in this portal and nothing broker-facing shows any
// dispatch fee — the server's broker shapes don't carry those fields
// at all. Freight pay runs DIRECT from the broker to the claiming
// carrier; RUGGS LLC never touches freight money. A broker sees ONLY its
// own loads (the server resolves the account from the signed-in
// username, never from anything this client sends). Carrier
// credentials (migration 0083) are claim-gated like the phone:
// contact email, MC/DOT, TWIC, endorsements, and the FMCSA SAFER
// Web link from the carrier's own numbers — a link to the official
// record, never a score. Carrier phone:
// the number the carrier added to their own profile — the server
// surfaces it on a load only after that carrier has claimed it.
// Demo accounts are badged DEMO everywhere they appear.

import { useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { PdfViewer } from "@hatch/space-sdk/pdf";
import { api, type ApiResponse } from "./api";
import { laneKey, useLaneEstimates } from "./useLaneEstimate";
import { PerMileLine } from "./RatePerMile";
import { endorsementLabel } from "./credentials";

type PortalData = ApiResponse<typeof api, "getBrokerPortal">;
type PortalLoad = PortalData["myLoads"][number];
type PortalAccount = NonNullable<PortalData["broker"]>;

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
  "On the open board": "bg-emerald-900/60 text-emerald-300",
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
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  prefix: string;
}) {
  const f = (key: keyof Draft) => ({
    value: draft[key] as string,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft({ ...draft, [key]: e.target.value }),
  });
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <div>
        <label className={LABEL} htmlFor={`${prefix}-ref`}>Broker reference # (your load / order #)</label>
        <input id={`${prefix}-ref`} aria-label="Broker reference number" className={INPUT} {...f("referenceNumber")} placeholder="e.g. Load 1042" />
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
        <label className={LABEL} htmlFor={`${prefix}-rate`}>Rate ($) — the agreed freight amount, paid direct to the carrier</label>
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
        <input id={`${prefix}-commodity`} aria-label="Commodity" className={INPUT} {...f("commodity")} placeholder="e.g. Steel coils" />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${prefix}-class`}>Freight class</label>
        <input id={`${prefix}-class`} aria-label="Freight class" className={INPUT} {...f("freightClass")} placeholder="e.g. 60" />
      </div>
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
    queryKey: ["broker-doc", loadId, kind],
    queryFn: () => api.getBrokerLoadDoc({ id: loadId, kind }),
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
    queryKey: ["broker-tracking", token],
    queryFn: () => api.getBrokerTracking({ token }),
    enabled: token.trim().length >= 8,
  });
  if (token.trim().length < 8) return <p className="text-sm text-[var(--dim)]">Paste a tracking token to see the load's tracking view.</p>;
  if (q.isPending) return <p className="text-sm text-[var(--dim)]">Checking this tracking link…</p>;
  if (!q.data || !q.data.valid) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3" role="note">
        <div className="font-condensed text-lg font-bold">This tracking link isn't live</div>
        <p className="mt-0.5 text-sm text-[var(--dim)]">Tracking starts when RUGGS LOGISTICS releases a load to the Open Board. Check the token, or ask dispatch for a fresh one.</p>
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
        <div>Broker: <span className="font-semibold text-[var(--text)]">{d.brokerName}</span>{d.referenceNumber ? <> · ref <span className="font-semibold text-[var(--text)]">{d.referenceNumber}</span></> : null}</div>
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

// ---- Post-a-load flow (broker) ------------------------------------------------

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
      const res = await api.saveBrokerLoad({
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
          Your load is <strong className="text-[var(--text)]">With dispatch</strong>. Nothing is on the Open Board
          yet — RUGGS LOGISTICS checks it and releases it. You'll see the status move to “On the open board” in your
          load list below, and the carrier's name appears there once a vetted owner operator claims it. Freight pay
          runs direct from you to the carrier — RUGGS LLC never holds freight money.
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
        <h3 className="font-condensed text-xl font-semibold">{initial ? "✏️ Edit load" : "🏢 New load — to the Open Board"}</h3>
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
            <LoadFieldsForm draft={draft} setDraft={setDraft} prefix="broker-post" />
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
            <div>Ref: <strong>{draft.referenceNumber || "—"}</strong> · Rate: <strong>{money(num(draft.rate))}</strong> — paid direct from {account.name} to the carrier</div>
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
            Sending puts the load in the RUGGS LOGISTICS review queue — it reaches the Open Board only when dispatch
            releases it, under {account.name}'s name. No payment happens in this portal, ever; freight pay runs direct
            from you to the carrier who hauls it.
          </p>
        </>
      )}
    </section>
  );
}

// ---- Broker load card -----------------------------------------------------------

function BrokerLoadCard({
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
      const res = await api.saveBrokerLoad({
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
            {load.brokerName}{load.brokerMc ? ` · ${load.brokerMc}` : ""}{load.referenceNumber ? ` · ref ${load.referenceNumber}` : ""} · posted {new Date(load.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
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
              Freight pay runs direct from you to this carrier. 📞 Carrier phone:{" "}
              <a href={`tel:${load.carrierPhone.replace(/[^+0-9]/g, "")}`} className="font-bold text-[var(--accent)] underline" aria-label={`Call carrier ${load.carrierName} at ${load.carrierPhone}`}>
                {load.carrierPhone}
              </a>{" "}
              — the number this carrier put on their profile, shown because they claimed your load.
            </span>
          ) : (
            <span className="block text-xs text-[var(--dim)]">Freight pay runs direct from you to this carrier. Carrier phone isn't on file in STONEMILES — RUGGS LOGISTICS dispatch can connect you.</span>
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
                void api.deleteBrokerLoad({ id: load.id })
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
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Review broker load ${laneOf(load)} from ${load.brokerName}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-condensed text-lg font-bold leading-tight">{laneOf(load)}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
            From <strong className="text-[var(--text)]">{load.brokerName}</strong>{load.brokerMc ? ` · ${load.brokerMc}` : ""}{load.referenceNumber ? ` · ref ${load.referenceNumber}` : ""} · sent {new Date(load.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
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
        <button type="button" className="btn-press mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold" aria-label={`View the rate confirmation for ${laneOf(load)}`} onClick={() => onViewDoc(load.id, "ratecon", "Rate confirmation — broker portal load")}>
          📄 View rate con
        </button>
      )}
      {editing && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <LoadFieldsForm draft={draft} setDraft={setDraft} prefix={`broker-review-${load.id}`} />
          <button
            type="button"
            disabled={busy != null}
            className="btn-press mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            aria-label={`Save desk edits to ${laneOf(load)}`}
            onClick={() => void run("edit", () => api.updateBrokerLoadDesk({ id: load.id, ...fieldsOf(draft), docDataBase64: null, docMime: null }), "Edits saved — the load is still in your review queue.")}
          >
            {busy === "edit" ? "Saving…" : "Save edits"}
          </button>
        </div>
      )}
      <div className="mt-3">
        <label className={LABEL} htmlFor={`broker-return-note-${load.id}`}>Return note (the broker sees this)</label>
        <input id={`broker-return-note-${load.id}`} aria-label="Return note for the broker" className={INPUT} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="e.g. Rate con is last month's — send the current one" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy != null}
          className={`btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${armRelease ? "bg-[var(--danger)] text-white" : "btn-neon"}`}
          aria-label={`Release ${laneOf(load)} to the Open Board`}
          onClick={() => {
            if (!armRelease) { setArmRelease(true); return; }
            void run("release", async () => {
              const res = await api.releaseBrokerLoad({ id: load.id });
              return { ok: res.ok, error: res.error };
            }, `Released — ${laneOf(load)} is live on the Open Board under ${load.brokerName}'s name, for vetted owner operators. The broker now sees “On the open board”.`);
          }}
        >
          {busy === "release" ? "Releasing…" : armRelease ? "Tap again — release to Open Board" : "✓ Release to Open Board"}
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
          aria-label={`Return ${laneOf(load)} to the broker with a note`}
          onClick={() => void run("return", () => api.returnBrokerLoad({ id: load.id, note: clean(returnNote) }), "Returned to the broker with your note — it never reached the board.")}
        >
          {busy === "return" ? "Returning…" : "↩ Return with note"}
        </button>
      </div>
    </article>
  );
}

// ---- Desk: broker accounts ------------------------------------------------------

type AccountDraft = {
  brokerName: string;
  email: string;
  brokerMc: string;
  dispatcherFeePct: string;
  linkedUsername: string;
  contactName: string;
  defaultPickupAddress: string;
  defaultPickupCity: string;
  defaultPickupState: string;
  defaultCommodity: string;
  defaultFreightClass: string;
  defaultContactName: string;
  defaultContactPhone: string;
  suspended: boolean;
  isDemo: boolean;
};

const EMPTY_ACCOUNT: AccountDraft = {
  brokerName: "",
  email: "",
  brokerMc: "",
  dispatcherFeePct: "",
  linkedUsername: "",
  contactName: "",
  defaultPickupAddress: "",
  defaultPickupCity: "",
  defaultPickupState: "",
  defaultCommodity: "",
  defaultFreightClass: "",
  defaultContactName: "",
  defaultContactPhone: "",
  suspended: false,
  isDemo: false,
};

function accountDraftOf(a: PortalData["accounts"][number]): AccountDraft {
  return {
    brokerName: a.name,
    email: a.email,
    brokerMc: a.brokerMc ?? "",
    dispatcherFeePct: a.dispatcherFeePct != null ? String(a.dispatcherFeePct) : "",
    linkedUsername: a.linkedUsername ?? "",
    contactName: a.contactName ?? "",
    defaultPickupAddress: a.defaultPickupAddress ?? "",
    defaultPickupCity: a.defaultPickupCity ?? "",
    defaultPickupState: a.defaultPickupState ?? "",
    defaultCommodity: a.defaultCommodity ?? "",
    defaultFreightClass: a.defaultFreightClass ?? "",
    defaultContactName: a.defaultContactName ?? "",
    defaultContactPhone: a.defaultContactPhone ?? "",
    suspended: a.status === "suspended",
    isDemo: a.isDemo,
  };
}

function AccountForm({
  initial,
  setBanner,
  onDone,
}: {
  initial: PortalData["accounts"][number] | null;
  setBanner: (s: string | null) => void;
  onDone: () => void;
}) {
  const [d, setD] = useState<AccountDraft>(() => (initial ? accountDraftOf(initial) : EMPTY_ACCOUNT));
  const [busy, setBusy] = useState(false);
  const f = (key: keyof AccountDraft) => ({
    value: d[key] as string,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setD({ ...d, [key]: e.target.value }),
  });
  const save = async () => {
    setBusy(true);
    try {
      const defaults = {
        contactName: clean(d.contactName),
        brokerMc: clean(d.brokerMc),
        dispatcherFeePct: d.dispatcherFeePct.trim() === "" ? null : Number(d.dispatcherFeePct),
        defaultPickupAddress: clean(d.defaultPickupAddress),
        defaultPickupCity: clean(d.defaultPickupCity),
        defaultPickupState: clean(d.defaultPickupState),
        defaultCommodity: clean(d.defaultCommodity),
        defaultFreightClass: clean(d.defaultFreightClass),
        defaultContactName: clean(d.defaultContactName),
        defaultContactPhone: clean(d.defaultContactPhone),
      };
      const res = initial
        ? await api.updateBrokerAccount({
            id: initial.id,
            status: d.suspended ? "suspended" : "active",
            linkedUsername: clean(d.linkedUsername),
            ...defaults,
          })
        : await api.createBrokerAccount({
            name: d.brokerName.trim(),
            email: d.email.trim(),
            linkedUsername: clean(d.linkedUsername),
            isDemo: d.isDemo,
            ...defaults,
          });
      if (!res.ok) { setBanner(res.error ?? "That didn't save."); return; }
      setBanner(
        initial
          ? "Broker account saved."
          : (clean(d.linkedUsername)
              ? `Broker account created — the invite is attached to @${clean(d.linkedUsername)}. When that STONEMILES user opens the Broker Portal, it's theirs.`
              : "Broker account created. Attach a linked username so the broker's own STONEMILES sign-in claims it — until then only the desk sees it."),
      );
      onDone();
    } catch {
      setBanner("That didn't save — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={initial ? `Edit broker ${initial.name}` : "Add a broker"}>
      <h4 className="font-condensed text-lg font-bold">{initial ? `✏️ ${initial.name}` : "➕ New broker"}</h4>
      <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="broker-account-name">Broker name (shown on the Open Board)</label>
          <input id="broker-account-name" aria-label="Broker name" className={INPUT} {...f("brokerName")} placeholder="e.g. Apex Freight Brokers" disabled={initial != null} />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-mc">Broker MC number</label>
          <input id="broker-account-mc" aria-label="Broker MC number" className={INPUT} {...f("brokerMc")} placeholder="e.g. MC-123456" />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-invite">Linked username (@name in STONEMILES)</label>
          <input id="broker-account-invite" aria-label="Linked username" className={INPUT} {...f("linkedUsername")} placeholder="Their STONEMILES username — no leading @ needed" />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-email">Broker email</label>
          <input id="broker-account-email" aria-label="Broker email" className={INPUT} {...f("email")} placeholder="Broker's email — required to create" disabled={initial != null} />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-contact">Contact name</label>
          <input id="broker-account-contact" aria-label="Contact name" className={INPUT} {...f("contactName")} />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-fee">Their dispatcher fee % (0–20)</label>
          <input id="broker-account-fee" aria-label="Dispatcher fee percent" className={INPUT} {...f("dispatcherFeePct")} inputMode="decimal" placeholder="Blank = their company's fee, or none" />
          <p className="mt-1 text-xs text-[var(--dim)]">
            The poster's OWN fee — it rides their released loads and shows to the claiming carrier before they
            claim. Over 20% is refused. This is never the RUGGS LLC house fee.
          </p>
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-dc-name">Default load contact name</label>
          <input id="broker-account-dc-name" aria-label="Default load contact name" className={INPUT} {...f("defaultContactName")} placeholder="Pre-fills their new loads" />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-dc-phone">Default load contact phone</label>
          <input id="broker-account-dc-phone" aria-label="Default load contact phone" className={INPUT} {...f("defaultContactPhone")} />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-dp-addr">Default pickup address</label>
          <input id="broker-account-dp-addr" aria-label="Default pickup address" className={INPUT} {...f("defaultPickupAddress")} placeholder="Pre-fills their new loads" />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-dp-city">Default pickup city</label>
          <input id="broker-account-dp-city" aria-label="Default pickup city" className={INPUT} {...f("defaultPickupCity")} />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-dp-state">Default pickup state</label>
          <input id="broker-account-dp-state" aria-label="Default pickup state" className={INPUT} {...f("defaultPickupState")} />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-df">Default commodity</label>
          <input id="broker-account-df" aria-label="Default commodity" className={INPUT} {...f("defaultCommodity")} />
        </div>
        <div>
          <label className={LABEL} htmlFor="broker-account-dc">Default freight class</label>
          <input id="broker-account-dc" aria-label="Default freight class" className={INPUT} {...f("defaultFreightClass")} />
        </div>
        {initial && (
          <label className="flex min-h-[44px] items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={d.suspended} onChange={(e) => setD({ ...d, suspended: e.target.checked })} aria-label="Account suspended" />
            Suspended (posting paused; their loads can't be sent or released)
          </label>
        )}
        {!initial && (
          <label className="flex min-h-[44px] items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={d.isDemo} onChange={(e) => setD({ ...d, isDemo: e.target.checked })} aria-label="Demo account" />
            Demo account — badged DEMO everywhere it appears
          </label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || (!initial && (!d.brokerName.trim() || d.email.trim().length < 3))} className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50" aria-label={initial ? "Save broker account edits" : "Create this broker account"} onClick={() => void save()}>
          {busy ? "Saving…" : initial ? "Save account" : "Create account"}
        </button>
        <button type="button" className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-bold" aria-label="Cancel account editing" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
        Approving a broker here is the whole invite: the account is created by the desk, and the invite username is
        how the broker's own STONEMILES sign-in claims it. No broker sees another broker's loads — the server scopes
        every read to the account their username claims.
      </p>
    </section>
  );
}

// ---- Main panel -------------------------------------------------------------------

/** The poster's OWN dispatcher fee (round 2): set on their own
 *  account, capped at 20 server-side, riding their loads released
 *  from now on and shown to the claiming carrier before they claim.
 *  Blank clears it — a poster linked to a dispatch company then
 *  carries the company's fee; otherwise no fee. */
function PosterFeeCard({
  account,
  setBanner,
  refresh,
}: {
  account: { id: number; name: string; dispatcherFeePct: number | null };
  setBanner: (s: string | null) => void;
  refresh: () => void;
}) {
  const [fee, setFee] = useState<string>(account.dispatcherFeePct != null ? String(account.dispatcherFeePct) : "");
  const [busyFee, setBusyFee] = useState(false);
  return (
    <section className="glass-panel p-4" aria-label="Your dispatcher fee">
      <h3 className="font-condensed text-lg font-semibold">💲 Your dispatcher fee</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Your own fee on the loads you post — 0 to 20%. It rides each load released from now on and shows to the
        claiming carrier on the load, with your name, <strong className="text-[var(--text)]">before</strong> they
        claim; they pay it once per load. Blank = no fee of your own (a dispatch company's poster then carries the
        company's fee). The desk can also set it; the last save stands. Records only — no payment is made or
        collected here.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-36">
          <label className={LABEL} htmlFor="poster-fee-pct">Fee % (0–20)</label>
          <input
            id="poster-fee-pct"
            className={INPUT}
            inputMode="decimal"
            placeholder="Blank = none"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            aria-label="Your dispatcher fee percent, 0 to 20"
          />
        </div>
        <button
          type="button"
          disabled={busyFee}
          className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50"
          aria-label="Save your dispatcher fee"
          onClick={() => {
            setBusyFee(true);
            const trimmed = fee.trim();
            void api
              .setMyPosterFee({ feePct: trimmed === "" ? null : Number(trimmed) })
              .then((r) => {
                if (r.ok) {
                  setBanner(
                    r.dispatcherFeePct != null
                      ? `Dispatcher fee saved — ${r.dispatcherFeePct}% rides your loads released from now on.`
                      : "Dispatcher fee cleared — your loads carry no fee of your own.",
                  );
                  refresh();
                } else {
                  setBanner(r.error ?? "That fee didn't save.");
                }
              })
              .catch(() => setBanner("That fee didn't save — check your connection and try again."))
              .finally(() => setBusyFee(false));
          }}
        >
          {busyFee ? "Saving…" : "Save fee"}
        </button>
        <span className="text-xs text-[var(--dim)]">
          {account.dispatcherFeePct != null ? `Now set: ${account.dispatcherFeePct}%` : "Not set — no fee of your own."}
        </span>
      </div>
    </section>
  );
}

export function BrokerPortalPanel({
  setBanner,
  variant,
}: {
  setBanner: (s: string | null) => void;
  variant?: "console" | "standard";
}) {
  const queryClient = useQueryClient();
  const portalQuery = useQuery({ queryKey: ["broker-portal"], queryFn: () => api.getBrokerPortal({}) });
  const data = portalQuery.data;
  const [posting, setPosting] = useState(false);
  const [editingLoad, setEditingLoad] = useState<PortalLoad | null>(null);
  const [accountForm, setAccountForm] = useState<"new" | PortalData["accounts"][number] | null>(null);
  const [docView, setDocView] = useState<{ id: number; kind: "ratecon" | "bol"; title: string } | null>(null);
  const [trackToken, setTrackToken] = useState<string>("");
  const [trackInput, setTrackInput] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["broker-portal"] });
    void queryClient.invalidateQueries({ queryKey: ["open-board"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
  };

  if (portalQuery.isPending) {
    return (
      <section className="glass-panel p-3.5" aria-label="Broker Portal">
        <p className="text-sm text-[var(--dim)]">Loading the Broker Portal…</p>
      </section>
    );
  }

  const broker = data?.broker ?? null;
  const desk = data?.mode === "desk" || data?.mode === "both";
  const review = data?.reviewQueue ?? [];
  const accounts = data?.accounts ?? [];

  if (!broker && !desk) {
    return (
      <section className="glass-panel p-4" aria-label="Broker Portal — by invitation">
        <h2 className="font-condensed text-2xl font-bold">🏢 Broker Portal — by invitation</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          The Broker Portal is how a broker posts loads to the STONEMILES <strong className="text-[var(--text)]">Open
          Board</strong> under its own name and logo — no load-passing by text or email. Every load the broker sends
          lands in the <strong className="text-[var(--text)]">RUGGS LOGISTICS review queue</strong> first; nothing
          reaches the board until dispatch releases it, and only vetted owner operators can claim from there. Freight
          pay runs direct from the broker to the carrier — RUGGS LLC never holds freight money.
        </p>
        <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm font-semibold leading-relaxed" role="note">
          You're not a broker on the desk's list yet. If you're a broker, give the dispatch desk your STONEMILES
          username — the desk approves a broker account here and attaches it to that username, and the portal opens
          for you on your next sign-in.
        </p>
        <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm leading-relaxed" role="note">
          <strong className="text-[var(--text)]">Request access — Stonervision team — brokers, shippers &amp; help:</strong>{" "}
          to gain Broker Portal access, contact the Stonervision team at{" "}
          <a
            href="mailto:stonervisionteam@gmail.com"
            className="font-bold text-[var(--accent)] underline"
            aria-label="Email the Stonervision team — brokers, shippers and help — at stonervisionteam@gmail.com to request Broker Portal access"
          >
            stonervisionteam@gmail.com
          </a>{" "}
          — this address is the Stonervision team's contact for brokers, shippers &amp; help; portal access runs
          through it.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      {broker && (
        <>
          <header className="glass-panel p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] font-condensed text-xl font-bold text-[#0a1408]" aria-hidden="true">
                {broker.logoInitials}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-condensed text-2xl font-bold leading-tight">{broker.name}</h2>
                  {broker.isDemo && <span className="rounded-full bg-[var(--danger)] px-2 py-0.5 text-[11px] font-bold text-white">DEMO</span>}
                </div>
                <div className="text-xs text-[var(--dim)]">
                  Broker Portal{broker.brokerMc ? ` · ${broker.brokerMc}` : ""} · loads post to the Open Board under your name
                </div>
              </div>
            </div>
            {broker.status !== "active" && (
              <p className="mt-2.5 rounded-xl bg-[var(--danger)] px-3 py-2.5 text-sm font-semibold leading-relaxed text-white" role="alert">
                ⛔ This broker account is suspended by the desk — posting is paused. Contact RUGGS LOGISTICS dispatch.
                Your existing loads stay visible below.
              </p>
            )}
            <p className="mt-2.5 rounded-xl bg-[#2c2207] px-3 py-2.5 text-sm font-semibold leading-relaxed text-amber-200" role="note">
              Your loads reach the board only after RUGGS LOGISTICS reviews them — nothing you send is live until
              dispatch releases it. Freight pay runs direct from you to the carrier; no payment is made or collected
              in this portal, ever.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-neon btn-press rounded-xl px-4 py-3 font-bold"
                aria-label="Post a new load to the Open Board"
                onClick={() => { setEditingLoad(null); setPosting(true); }}
              >
                🏢 Post a load — {broker.name}
              </button>
            </div>
          </header>

          <PosterFeeCard account={broker} setBanner={setBanner} refresh={refresh} />

          {posting && (
            <PostLoadFlow
              key={editingLoad ? `edit-${editingLoad.id}` : "new"}
              account={broker}
              initial={editingLoad}
              setBanner={setBanner}
              onClose={() => { setPosting(false); setEditingLoad(null); }}
              refresh={refresh}
            />
          )}

          <section aria-label="Your broker loads" className="space-y-3">
            <h3 className="font-condensed text-xl font-semibold">
              Your loads <span className="text-base font-normal text-[var(--dim)]">({data?.myLoads.length ?? 0})</span>
            </h3>
            {(data?.myLoads.length ?? 0) === 0 && !posting && (
              <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-sm text-[var(--dim)]">
                No loads yet. Post your first one above — it saves as a draft until the rate and rate confirmation
                are on it and both confirmations are checked, then it goes to RUGGS LOGISTICS for review.
              </p>
            )}
            {(data?.myLoads ?? []).map((l) => (
              <BrokerLoadCard
                key={l.id}
                load={l}
                setBanner={setBanner}
                onEdit={(load) => { setEditingLoad(load); setPosting(true); }}
                onViewDoc={(id, kind, title) => setDocView({ id, kind, title })}
                onTrack={(token) => setTrackToken(token)}
                refresh={refresh}
              />
            ))}
          </section>
        </>
      )}

      {desk && (
        <>
          <section className="glass-panel p-3.5" aria-label="Broker Portal review queue">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-condensed text-xl font-bold">🏢 Broker Portal — review queue</h3>
              <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">{review.length} waiting</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
              Broker loads land here before the Open Board. Release puts the load live on the Open Board under the
              broker's own name — vetted owner operators only — and mints the broker's tracking. Return sends it back
              with your note. The broker never sees any fee or payment surface; freight pay runs direct from the
              broker to the carrier.
            </p>
            <div className="mt-3 space-y-3">
              {review.length === 0 && (
                <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-sm text-[var(--dim)]">
                  Queue is clear — nothing broker-sent is waiting on you.
                </p>
              )}
              {review.map((l) => (
                <ReviewCard key={l.id} load={l} setBanner={setBanner} onViewDoc={(id, kind, title) => setDocView({ id, kind, title })} refresh={refresh} />
              ))}
            </div>
          </section>

          <section className="glass-panel p-3.5" aria-label="Broker accounts">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-condensed text-xl font-bold">Broker accounts</h3>
              {accountForm == null && (
                <button type="button" className="btn-neon btn-press rounded-xl px-3.5 py-2.5 text-sm font-bold" aria-label="Add a broker account" onClick={() => setAccountForm("new")}>
                  ➕ Add broker
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--dim)]">
              The desk invites and approves brokers — each account is attached to the broker contact's STONEMILES
              username, and that's the whole sign-in. Brokers see only their own loads.
            </p>
            {accountForm === "new" && <div className="mt-3"><AccountForm initial={null} setBanner={setBanner} onDone={() => { setAccountForm(null); refresh(); }} /></div>}
            {accountForm !== null && accountForm !== "new" && (
              <div className="mt-3"><AccountForm initial={accountForm} setBanner={setBanner} onDone={() => { setAccountForm(null); refresh(); }} /></div>
            )}
            <div className="mt-3 space-y-2">
              {accounts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] font-condensed text-sm font-bold text-[#0a1408]" aria-hidden="true">{a.logoInitials}</span>
                      {a.name}
                      {a.isDemo && <span className="rounded-full bg-[var(--danger)] px-2 py-0.5 text-[11px] font-bold text-white">DEMO</span>}
                    </div>
                    <div className="text-xs text-[var(--dim)]">
                      {a.brokerMc ? `${a.brokerMc} · ` : ""}{a.linkedUsername ? `linked: @${a.linkedUsername}` : "no linked username yet"}{a.contactName ? ` · ${a.contactName}` : ""} · {a.loadCount} loads · {a.status === "active" ? "active" : "SUSPENDED"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
                    aria-label={`Edit broker account ${a.name}`}
                    onClick={() => setAccountForm(a)}
                  >
                    Edit
                  </button>
                </div>
              ))}
              {accounts.length === 0 && <p className="text-sm text-[var(--dim)]">No broker accounts yet.</p>}
            </div>
          </section>
        </>
      )}

      <section className="glass-panel p-3.5" aria-label="Check a load's tracking">
        <h3 className="font-condensed text-xl font-bold">📍 Track a load</h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Paste a tracking token (yours from a load card, or one a broker shared with you) to see its tracking view —
          status and lane only, no precise location.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={INPUT + " min-w-0 flex-1"}
            value={trackInput}
            onChange={(e) => setTrackInput(e.target.value)}
            placeholder="Tracking token"
            aria-label="Tracking token to check"
          />
          <button
            type="button"
            className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold"
            aria-label="Check this tracking token"
            onClick={() => setTrackToken(trackInput.trim())}
          >
            Check
          </button>
        </div>
        {trackToken && <div className="mt-3"><TrackingCard token={trackToken} /></div>}
        <p className="mt-2 text-xs text-[var(--dim)]">
          {variant === "console" ? "" : ""}Powered by STONEMILES · Dispatch: RUGGS LOGISTICS
        </p>
      </section>

      {docView && <DocViewer loadId={docView.id} kind={docView.kind} title={docView.title} onClose={() => setDocView(null)} />}
    </div>
  );
}
