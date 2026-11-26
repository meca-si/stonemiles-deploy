// PaperworkPanel.tsx — paperwork-to-pay on a load (Wave 2 item 2).
// The driver files a scanned BOL/POD, checks what the automatic
// read pulled off it (or fills the fields in by hand when reading
// isn't set up — the panel says which, plainly), and confirms.
// Once the delivery is sealed and the POD is confirmed, the POD
// copy goes out to the broker/factor address on file and the
// invoice is cut on their own — the status strip at the top shows
// how far the paperwork has travelled. No rate or amount ever
// appears here: the invoice is named by number and status only.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { preparePaperworkUpload } from "./paperworkUpload";

type PaperworkState = ApiResponse<typeof api, "getLoadPaperwork">;
type DocState = PaperworkState["pod"];
type FieldKey = "lane" | "reference" | "weightLbs" | "pieces" | "deliveryText";

const FIELD_LABELS: Record<FieldKey, string> = {
  lane: "Lane",
  reference: "Reference #",
  weightLbs: "Weight (lbs)",
  pieces: "Pieces",
  deliveryText: "Delivery date/time",
};

const SEND_LINES: Record<string, string> = {
  not_ready: "POD copy hasn't gone out yet.",
  sent: "POD copy sent to the broker/factor address on file ✓",
  queued: "POD copy is queued — it goes out as soon as mail is set up.",
  no_recipient: "No broker/factor email on file — add the address below and the copy sends itself.",
  failed: "The last send didn't go through — it retries on its own when this panel is opened.",
};

function PaperworkDocForm({
  loadId,
  docKind,
  doc,
  recipientEmail,
  recipientLabel,
  setBanner,
  onDone,
}: {
  loadId: number;
  docKind: "bol" | "pod" | "rate_con";
  doc: DocState;
  recipientEmail: string | null;
  recipientLabel: string | null;
  setBanner: (s: string) => void;
  onDone: () => void;
}) {
  const start = doc.confirmed ? doc.confirmedFields : doc.candidates;
  const [lane, setLane] = useState(start.lane ?? "");
  const [reference, setReference] = useState(start.reference ?? "");
  const [weight, setWeight] = useState(start.weightLbs != null ? String(start.weightLbs) : "");
  const [pieces, setPieces] = useState(start.pieces != null ? String(start.pieces) : "");
  const [deliveryText, setDeliveryText] = useState(start.deliveryText ?? "");
  const [email, setEmail] = useState(recipientEmail ?? "");
  const [emailLabel, setEmailLabel] = useState(recipientLabel ?? "");
  const [busy, setBusy] = useState(false);

  // One tap files the scan (2026-11-25 fix): pick the photo or file
  // and it uploads itself — no staging behind a raw browser input
  // and a second button that stayed grey through every silent
  // failure. preparePaperworkUpload converts what the intake can't
  // take as-is (an iPhone HEIC becomes a JPG) and refuses the rest
  // with plain words; every failure lands on the banner, none is
  // swallowed.
  const uploadPicked = (f: File | null, okMessage: string) => {
    if (!f || busy) return;
    setBusy(true);
    void preparePaperworkUpload(f)
      .then((up) => api.fileLoadPaperwork({ loadId, docKind, dataBase64: up.base64, mime: up.mime }))
      .then((r) => {
        setBanner(r.ok ? okMessage : (r.error ?? "Couldn't file that document."));
        onDone();
      })
      .catch((e: unknown) => {
        setBanner(e instanceof Error ? e.message : "Couldn't file that document — try again.");
      })
      .finally(() => setBusy(false));
  };

  const values: Record<FieldKey, string> = { lane, reference, weightLbs: weight, pieces, deliveryText };
  const setters: Record<FieldKey, (v: string) => void> = {
    lane: setLane,
    reference: setReference,
    weightLbs: setWeight,
    pieces: setPieces,
    deliveryText: setDeliveryText,
  };
  const title =
    docKind === "pod" ? "PROOF OF DELIVERY (POD)" : docKind === "rate_con" ? "RATE CONFIRMATION" : "BILL OF LADING (BOL)";

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2">
      <div className="text-xs font-bold text-[var(--dim)]">{title}</div>
      {!doc.filed ? (
        <div className="mt-2">
          <label
            className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold ${busy ? "opacity-50" : ""}`}
          >
            {busy ? "Filing…" : "📎 Add the scan — photo or PDF"}
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                uploadPicked(e.target.files?.[0] ?? null, "Document filed against this load ✓");
                e.target.value = "";
              }}
            />
          </label>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            Pick it and it files itself — a phone photo, JPG, PNG, or PDF.
          </p>
        </div>
      ) : (
        <div className="mt-1">
          <p className="text-xs leading-relaxed text-[var(--dim)]">{doc.extractionNote}</p>
          <div className="mt-2 grid gap-2">
            {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => (
              <label key={k} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-28 shrink-0 font-bold text-[var(--dim)]">{FIELD_LABELS[k]}</span>
                <input
                  type={k === "weightLbs" || k === "pieces" ? "number" : "text"}
                  value={values[k]}
                  onChange={(e) => setters[k](e.target.value)}
                  className={`min-w-40 flex-1 rounded-lg border bg-[var(--surface)] px-2 py-2 text-sm ${
                    doc.flags[k] ? "border-amber-500/60" : "border-[var(--border)]"
                  }`}
                />
                {doc.flags[k] && <span className="font-semibold text-amber-300">⚠ differs from the load record — needs a look</span>}
              </label>
            ))}
          </div>
          {docKind === "pod" && (
            <div className="mt-2 grid gap-2">
              <label className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-28 shrink-0 font-bold text-[var(--dim)]">Send POD copy to</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Broker or factor email"
                  className="min-w-40 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
                />
              </label>
              <label className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-28 shrink-0 font-bold text-[var(--dim)]">Who is that?</span>
                <input
                  type="text"
                  value={emailLabel}
                  onChange={(e) => setEmailLabel(e.target.value)}
                  placeholder="Broker or factor name (optional)"
                  className="min-w-40 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
                />
              </label>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-[var(--ok)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                void api
                  .confirmPaperwork({
                    loadId,
                    docKind,
                    fields: {
                      lane: lane.trim() || null,
                      reference: reference.trim() || null,
                      weightLbs: weight.trim() === "" ? null : Number(weight),
                      pieces: pieces.trim() === "" ? null : Math.trunc(Number(pieces)),
                      deliveryText: deliveryText.trim() || null,
                    },
                    recipientEmail: docKind === "pod" ? email.trim() || null : null,
                    recipientLabel: docKind === "pod" ? emailLabel.trim() || null : null,
                  })
                  .then((r) => {
                    setBanner(r.ok ? "Paperwork confirmed ✓" : (r.error ?? "Couldn't confirm that paperwork."));
                    onDone();
                  })
                  .catch(() => setBanner("Couldn't confirm that paperwork — check your connection and try again."))
                  .finally(() => setBusy(false));
              }}
            >
              {doc.confirmed ? "✓ Confirmed — update it" : "✓ Confirm these fields"}
            </button>
            {doc.confirmed && (
              <span className="text-xs text-[var(--dim)]">
                Confirmed{doc.confirmedAt ? ` · ${new Date(doc.confirmedAt).toLocaleString()}` : ""}
              </span>
            )}
            <label className="cursor-pointer text-xs text-[var(--dim)] underline">
              Replace scan
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  uploadPicked(e.target.files?.[0] ?? null, "New scan filed — check the fields and confirm again.");
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// The paperwork door: one shareable LINK per load that a broker or
// carrier opens to upload this load's rate con / BOL / POD with no
// account. The link shows them the lane and date only — never the
// rate — and everything they send lands right here in this
// paperwork block for the driver's check and confirmation. Copy
// says LINK everywhere: nothing about this door is email.
function PaperworkDoorLinks({ loadId, setBanner }: { loadId: number; setBanner: (s: string) => void }) {
  const queryClient = useQueryClient();
  const linksQuery = useQuery({
    queryKey: ["load-docs-links", loadId],
    queryFn: () => api.getLoadDocsLinks({ loadId }),
  });
  const [busy, setBusy] = useState(false);
  const data = linksQuery.data;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["load-docs-links", loadId] });
  const live = data?.links.find((l) => l.state === "live") ?? null;
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2">
      <div className="text-xs font-bold text-[var(--dim)]">PAPERWORK LINK — let the broker send it in</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Give this link to the broker or carrier and they can upload this load's rate confirmation, BOL, or POD
        straight into the paperwork above — no account needed. The link shows them the lane and the date only,
        never the rate. It closes on its own when the load is delivered.
      </p>
      {data?.ok && live ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-40 flex-1 break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs">
            {live.url}
          </code>
          <button
            type="button"
            className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
            onClick={() => {
              void navigator.clipboard?.writeText(live.url).then(
                () => setBanner("Paperwork link copied ✓"),
                () => setBanner("Copy didn't work — long-press the link to copy it."),
              );
            }}
          >
            Copy link
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50"
            onClick={() => {
              setBusy(true);
              void api
                .revokeLoadDocsLink({ loadId, linkId: live.id })
                .then((r) => {
                  setBanner(r.ok ? "Paperwork link closed ✓" : (r.error ?? "Couldn't close that link."));
                  refresh();
                })
                .catch(() => setBanner("Couldn't close that link — check your connection and try again."))
                .finally(() => setBusy(false));
            }}
          >
            Close link
          </button>
        </div>
      ) : data?.ok && data.delivered ? (
        <p className="mt-2 text-xs text-[var(--dim)]">This load is delivered — its paperwork door is closed.</p>
      ) : data?.ok ? (
        <button
          type="button"
          disabled={busy}
          className="mt-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            void api
              .createLoadDocsLink({ loadId })
              .then((r) => {
                setBanner(r.ok ? "Paperwork link created ✓" : (r.error ?? "Couldn't create the link."));
                refresh();
              })
              .catch(() => setBanner("Couldn't create the link — check your connection and try again."))
              .finally(() => setBusy(false));
          }}
        >
          🔗 Create the paperwork link
        </button>
      ) : linksQuery.isError || (data && !data.ok) ? (
        <div className="mt-2">
          <p role="alert" className="text-sm font-semibold text-[var(--danger)]">
            {(data && !data.ok ? data.error : null) ?? "Couldn't load the paperwork link — nothing was changed."}
          </p>
          <button
            type="button"
            className="btn-press mt-2 min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold"
            onClick={() => void linksQuery.refetch()}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** POD → invoice step (2026-11-17): rendered by the delivery
 *  close-out the moment a delivery seals — the load is billable,
 *  and this is that next step, right where the POD landed. No
 *  invoice yet → one tap cuts the DRAFT through the same
 *  createInvoice the Pay door uses (Net-30, from the sealed load's
 *  rate; it refuses a load with no rate rather than invent one). An
 *  invoice already on the load — cut here, in Pay, or auto-issued
 *  by the paperwork pipeline — is named by number + status instead;
 *  a second one is never cut. Lives in this module, not the
 *  close-out file: the close-out carries the receiver-facing share
 *  surfaces, which the rate law keeps free of invoicing entirely. */
export function PodInvoiceStep({ loadId, setBanner }: { loadId: number; setBanner: (s: string) => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["load-paperwork", loadId],
    queryFn: () => api.getLoadPaperwork({ loadId }),
  });
  const [busy, setBusy] = useState(false);
  const data = q.data;
  // A failed read used to vanish this whole step silently
  // (2026-11-25 UX package E) — now it says so and offers a retry.
  // "Not sealed yet" is NOT a failure: the step simply doesn't
  // exist until the delivery seals, so that path still renders
  // nothing.
  if (q.isError || (data && !data.ok)) {
    return (
      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <div className="text-xs font-bold text-[var(--dim)]">NEXT — THE INVOICE FOR THIS LOAD</div>
        <p role="alert" className="mt-1.5 text-sm font-semibold text-[var(--danger)]">
          {(data && !data.ok ? data.error : null) ?? "Couldn't check this load's invoice step — nothing was changed."}
        </p>
        <button
          type="button"
          className="btn-press mt-2 min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold"
          onClick={() => void q.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data || !data.sealed) return null;
  const inv = data.invoice;
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2">
      <div className="text-xs font-bold text-[var(--dim)]">NEXT — THE INVOICE FOR THIS LOAD</div>
      {inv ? (
        <div className="mt-1.5 text-sm">
          🧾 Invoice <span className="font-bold">{inv.number}</span> — {inv.displayStatus}. Review or send it in <span className="font-semibold">Pay → Invoices</span>.
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-[var(--ok)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            onClick={() => {
              setBusy(true);
              void api
                .createInvoice({ loadId, dueDays: 30, notes: null })
                .then((r) => {
                  setBanner(`Invoice ${r.number} draft cut from the sealed load — review it in Pay → Invoices.`);
                  void queryClient.invalidateQueries({ queryKey: ["invoices"] });
                  void queryClient.invalidateQueries({ queryKey: ["load-paperwork", loadId] });
                  void queryClient.invalidateQueries({ queryKey: ["owed-board"] });
                })
                .catch((e: unknown) => {
                  setBanner(
                    e instanceof Error
                      ? e.message.replace(/^action \w+ error: /, "")
                      : "Couldn't cut the invoice — try again.",
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            🧾 Cut the invoice draft
          </button>
          <span className="text-xs text-[var(--dim)]">From the sealed load's rate, Net-30 — a draft for you to review and send in Pay → Invoices.</span>
        </div>
      )}
    </div>
  );
}

export function LoadPaperworkBlock({ loadId, setBanner }: { loadId: number; setBanner: (s: string) => void }) {
  const queryClient = useQueryClient();
  const pwQuery = useQuery({
    queryKey: ["load-paperwork", loadId],
    queryFn: () => api.getLoadPaperwork({ loadId }),
  });
  const data: PaperworkState | undefined = pwQuery.data;
  // A failed read used to make the WHOLE paperwork block vanish
  // with no sign anything was wrong (2026-11-25 UX package E) —
  // now a failure renders as a failure, with a retry. Still
  // loading renders nothing, as before.
  if (!data?.ok) {
    if (pwQuery.isPending) return null;
    return (
      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <div className="text-xs font-bold text-[var(--dim)]">PAPERWORK TO PAY — scan it, check it, it sends itself</div>
        <p role="alert" className="mt-1.5 text-sm font-semibold text-[var(--danger)]">
          {(data && !data.ok ? data.error : null) ?? "Couldn't load this load's paperwork — nothing was changed."}
        </p>
        <button
          type="button"
          className="btn-press mt-2 min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold"
          onClick={() => void pwQuery.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["load-paperwork", loadId] });
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2">
      <div className="text-xs font-bold text-[var(--dim)]">PAPERWORK TO PAY — scan it, check it, it sends itself</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        File the signed paperwork here and confirm the fields. Once the delivery is sealed and the POD is
        confirmed, the POD copy goes out to the broker or factor on its own and the invoice is cut by itself.
        Nothing is ever sent or billed off an unconfirmed read.
      </p>
      <div className="mt-2 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed">
        <span className="font-semibold">{data.stageLabel}</span>
        {data.sendStatus && <span className="text-[var(--dim)]"> · {SEND_LINES[data.sendStatus] ?? ""}</span>}
        {data.invoice && (
          <span className="text-[var(--dim)]">
            {" "}
            · Invoice {data.invoice.number} — {data.invoice.displayStatus}
          </span>
        )}
        {!data.sealed && <div className="text-[var(--dim)]">The send and the invoice fire once the delivery is sealed.</div>}
      </div>
      <PaperworkDocForm
        key={`pod:${data.pod.sha256 ?? "none"}:${data.pod.confirmed ? "c" : "u"}`}
        loadId={loadId}
        docKind="pod"
        doc={data.pod}
        recipientEmail={data.recipientEmail}
        recipientLabel={data.recipientLabel}
        setBanner={setBanner}
        onDone={refresh}
      />
      <PaperworkDocForm
        key={`bol:${data.bol.sha256 ?? "none"}:${data.bol.confirmed ? "c" : "u"}`}
        loadId={loadId}
        docKind="bol"
        doc={data.bol}
        recipientEmail={null}
        recipientLabel={null}
        setBanner={setBanner}
        onDone={refresh}
      />
      <PaperworkDocForm
        key={`ratecon:${data.rateCon.sha256 ?? "none"}:${data.rateCon.confirmed ? "c" : "u"}`}
        loadId={loadId}
        docKind="rate_con"
        doc={data.rateCon}
        recipientEmail={null}
        recipientLabel={null}
        setBanner={setBanner}
        onDone={refresh}
      />
      <PaperworkDoorLinks loadId={loadId} setBanner={setBanner} />
    </div>
  );
}
