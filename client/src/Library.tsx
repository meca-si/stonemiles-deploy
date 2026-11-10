// Library.tsx — the User Library panel (owner scope extension,
// 2026-11-10): one records home per user. The library is an organized
// VIEW over the records that already exist — sealed Load Tracker
// records, settlements/pay entries, IFTA data, filed exports, uploaded
// documents — assembled server-side by getLibrary with the same
// scoping as the assignment flow (driver: his own; fleet owner /
// dispatcher seats: their fleet's, built from shared board rows).
//
// Every item carries the three output actions (Print / Download /
// Email) wired to getLibraryDocument / emailLibraryDocument: Download
// saves the real server-rendered PDF (or the original uploaded file),
// Print opens that same document in a clean viewer tab (no app
// chrome — the PDF IS the print view), Email sends it as a PDF
// attachment from the app's mail identity with Reply-To set to the
// sender, audit-logged server-side. Nothing here renders or stores a
// second copy of any record.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type Library = ApiResponse<typeof api, "getLibrary">;
type SealedEntry = Library["sealedFiles"][number];

const btn =
  "btn-press rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50";
const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm";

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function saveBlob(filename: string, mime: string, dataBase64: string) {
  const blob = new Blob([bytesFromBase64(dataBase64)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function openBlob(mime: string, dataBase64: string) {
  const blob = new Blob([bytesFromBase64(dataBase64)], { type: mime });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ChainChip({ status }: { status: SealedEntry["status"] }) {
  if (status === "verified")
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
        ✓ Chain-verified
      </span>
    );
  if (status === "broken")
    return (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-400">
        ⚠ Chain break at this record
      </span>
    );
  return (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400">
      Not chain-verified
    </span>
  );
}

/** Print / Download / Email for one library document ref. */
function DocActions({
  docRef,
  title,
  defaultEmail,
  setBanner,
}: {
  docRef: string;
  title: string;
  defaultEmail: string;
  setBanner: (s: string | null) => void;
}) {
  const [busy, setBusy] = useState<"" | "download" | "print" | "email">("");
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState(defaultEmail);

  async function fetchDoc(mode: "download" | "print") {
    setBusy(mode);
    try {
      const r = await api.getLibraryDocument({ ref: docRef });
      if (!r.ok || !r.dataBase64 || !r.filename || !r.mime) {
        setBanner(r.error ?? "That document couldn't be built.");
        return;
      }
      if (mode === "download") {
        saveBlob(r.filename, r.mime, r.dataBase64);
        setBanner(`${title} downloaded as ${r.filename}.`);
      } else {
        openBlob(r.mime, r.dataBase64);
        setBanner(`${title} opened — print or save it from the viewer. Nothing but the document is on that page.`);
      }
    } catch {
      setBanner("The document could not be built — try again in a moment.");
    } finally {
      setBusy("");
    }
  }

  async function sendEmail() {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setBanner("Enter a valid email address for the recipient.");
      return;
    }
    setBusy("email");
    try {
      const r = await api.emailLibraryDocument({ ref: docRef, toEmail: to });
      if (!r.ok) {
        setBanner(r.error);
        return;
      }
      setShowEmail(false);
      if (r.status === "sent") setBanner(`${title} emailed to ${to}. Replies come back to your own email.`);
      else if (r.status === "queued")
        setBanner(
          `Mail is not switched on for the app yet — your send of ${title} to ${to} is queued and logged, and goes out the moment mail is turned on. Nothing was lost.`,
        );
      else setBanner(r.error ?? "That send did not go through.");
    } catch {
      setBanner("The email could not be sent — try again in a moment.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy !== ""} onClick={() => void fetchDoc("print")} aria-label={`Print ${title}`}>
          🖨 Print
        </button>
        <button type="button" className={btn} disabled={busy !== ""} onClick={() => void fetchDoc("download")} aria-label={`Download ${title}`}>
          ⬇ Download
        </button>
        <button type="button" className={btn} disabled={busy !== ""} onClick={() => setShowEmail((v) => !v)} aria-label={`Email ${title}`}>
          ✉ Email
        </button>
      </div>
      {showEmail && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} min-w-[220px] flex-1`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="recipient@email.com"
            aria-label={`Recipient email for ${title}`}
          />
          <button type="button" className={btn} disabled={busy !== ""} onClick={() => void sendEmail()}>
            {busy === "email" ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="font-condensed text-xl font-bold">
        <span aria-hidden>{icon}</span> {title}
      </h3>
      {children}
    </section>
  );
}

const rowCls = "space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3";

export function LibraryPanel({ setBanner }: { setBanner: (s: string | null) => void }) {
  const lib = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary({}) });
  const data = lib.data;
  const defaultEmail = data?.viewer.email ?? "";

  // Statements grouped by period, first-seen order (server sorts newest first).
  const statementGroups: { key: string; label: string; rows: Library["statements"] }[] = [];
  for (const s of data?.statements ?? []) {
    let g = statementGroups.find((x) => x.key === s.periodKey);
    if (!g) {
      g = { key: s.periodKey, label: s.periodLabel, rows: [] };
      statementGroups.push(g);
    }
    g.rows.push(s);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-condensed text-2xl font-bold">📚 Library</h2>
        <p className="text-sm text-[var(--dim)]">
          Every record in one home — delivered loads, statements, fuel tax by state, filings, your documents, and the
          sealed files behind them. This is a view over the same sealed records the rest of the app keeps; nothing here
          is a second copy.
        </p>
        {data && (
          <p className="mt-1 text-xs text-[var(--dim)]">
            {data.viewer.mode === "fleet"
              ? `Fleet library${data.viewer.companyName ? ` — ${data.viewer.companyName}` : ""}: your fleet's delivered loads and sealed records, plus your own statements, fuel tax, filings, and documents.`
              : "Your own records."}{" "}
            {data.chain.intact ? (
              <span className="font-bold text-emerald-400">
                ✓ Sealed chain intact — {data.chain.checked} records checked.
              </span>
            ) : (
              <span className="font-bold text-red-400">
                ⚠ Sealed chain break found — records after the break are marked unverified below.
              </span>
            )}
          </p>
        )}
      </div>

      {lib.isPending && <p className="text-sm text-[var(--dim)]">Gathering your records…</p>}
      {lib.isError && (
        <p className="text-sm text-red-400">The library could not be gathered — pull to retry in a moment.</p>
      )}

      {data && (
        <>
          <Section icon="🚚" title="Loads delivered">
            {data.deliveredLoads.length === 0 && (
              <p className="text-sm text-[var(--dim)]">
                Nothing delivered yet — when a load is delivered and its proof of delivery is sealed, it lands here
                automatically with its packet and sealed record.
              </p>
            )}
            <div className="space-y-2">
              {data.deliveredLoads.map((l) => (
                <div key={l.loadId} className={rowCls}>
                  <p className="text-sm font-bold">
                    {l.lane}
                    {l.referenceNumber ? <span className="text-[var(--dim)]"> · Ref {l.referenceNumber}</span> : null}
                  </p>
                  <p className="text-xs text-[var(--dim)]">
                    {l.shipper ? `${l.shipper} · ` : ""}Delivered{" "}
                    {l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString() : "—"}
                    {l.totalWithExtras != null ? ` · $${l.totalWithExtras.toLocaleString()}` : ""}
                    {l.sealGrade ? ` · Seal: ${l.sealGrade === "proof_grade" ? "Proof grade" : "Release grade"}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-bold text-[var(--dim)]">Packet:</span>
                    <DocActions docRef={`packet:${l.loadId}`} title={`Delivered load packet — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />

                    <DocActions docRef={`bol:${l.loadId}`} title={`Bill of lading — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />

                    <DocActions docRef={`pod:${l.loadId}`} title={`Signed POD — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-bold text-[var(--dim)]">Sealed record:</span>
                    <DocActions docRef={`sealed:${l.loadId}`} title={`Sealed load record — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section icon="🧾" title="Statements">
            {statementGroups.length === 0 && (
              <p className="text-sm text-[var(--dim)]">No statements yet — settlements and pay entries land here, grouped by period.</p>
            )}
            {statementGroups.map((g) => (
              <div key={g.key} className="space-y-2">
                <h4 className="text-sm font-bold text-[var(--dim)]">{g.label}</h4>
                {g.rows.map((s) => (
                  <div key={s.ref} className={rowCls}>
                    <p className="text-sm font-bold">{s.title}</p>
                    <p className="text-xs text-[var(--dim)]">
                      {s.kind === "settlement"
                        ? `Gross ${s.gross != null ? `$${s.gross.toLocaleString()}` : "—"} · Net ${s.net != null ? `$${s.net.toLocaleString()}` : "—"}`
                        : `Net ${s.net != null ? `$${s.net.toLocaleString()}` : "—"}`}{" "}
                      · {new Date(s.createdAt).toLocaleDateString()}
                    </p>
                    <DocActions docRef={s.ref} title={s.title} defaultEmail={defaultEmail} setBanner={setBanner} />
                  </div>
                ))}
              </div>
            ))}
          </Section>

          <Section icon="⛽" title="Fuel tax — state by state">
            {data.fuelTax.length === 0 && (
              <p className="text-sm text-[var(--dim)]">
                No quarters yet — sealed trip miles by state and your logged fuel build these lines automatically.
              </p>
            )}
            <div className="space-y-2">
              {data.fuelTax.map((q) => (
                <div key={`${q.year}-${q.quarter}`} className={rowCls}>
                  <p className="text-sm font-bold">
                    Q{q.quarter} {q.year} · {q.totalMiles.toLocaleString()} mi · {q.totalGallonsBought} gal bought
                  </p>
                  <div className="space-y-0.5">
                    {q.rows.map((st) => (
                      <p key={st.state} className="text-xs text-[var(--dim)]">
                        {st.state}: {st.miles.toLocaleString()} mi · {st.gallonsBought} gal bought
                        {st.gallonsUsed != null ? ` · ${st.gallonsUsed} gal used` : ""}
                      </p>
                    ))}
                  </div>
                  <DocActions docRef={`ifta:${q.year}:${q.quarter}`} title={`IFTA Q${q.quarter} ${q.year} — state lines`} defaultEmail={defaultEmail} setBanner={setBanner} />
                </div>
              ))}
            </div>
          </Section>

          <Section icon="🗂" title="Filings">
            {data.filings.length === 0 && (
              <p className="text-sm text-[var(--dim)]">
                No filings yet — generate an IFTA export or a tax-year summary and it files itself here with its period
                and date.
              </p>
            )}
            <div className="space-y-2">
              {data.filings.map((f) => (
                <div key={f.ref} className={rowCls}>
                  <p className="text-sm font-bold">{f.title}</p>
                  <p className="text-xs text-[var(--dim)]">
                    {f.periodLabel} · Generated {new Date(f.generatedAt).toLocaleString()}
                  </p>
                  <DocActions docRef={f.ref} title={f.title} defaultEmail={defaultEmail} setBanner={setBanner} />
                </div>
              ))}
            </div>
          </Section>

          <Section icon="📎" title="Uploads">
            {data.uploads.length === 0 && (
              <p className="text-sm text-[var(--dim)]">
                No documents yet — PODs, BOLs, scale tickets, receipts, and personal documents you file land here.
              </p>
            )}
            <div className="space-y-2">
              {data.uploads.map((u) => (
                <div key={u.ref} className={rowCls}>
                  <p className="text-sm font-bold">
                    {u.label} <span className="text-xs font-normal text-[var(--dim)]">· {u.kind}</span>
                  </p>
                  <p className="text-xs text-[var(--dim)]">
                    {new Date(u.createdAt).toLocaleDateString()}
                    {u.loadId != null ? ` · Load #${u.loadId}` : ""}
                    {u.sha256 ? ` · SHA-256 ${u.sha256.slice(0, 12)}…` : ""}
                  </p>
                  {u.hasFile ? (
                    <DocActions docRef={u.ref} title={u.label} defaultEmail={defaultEmail} setBanner={setBanner} />
                  ) : (
                    <p className="text-xs text-[var(--dim)]">Fingerprint on file — the original file is not stored in the app.</p>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section icon="🔗" title="Sealed files">
            {data.sealedFiles.length === 0 && (
              <p className="text-sm text-[var(--dim)]">No sealed records yet — booked loads and trips seal themselves here.</p>
            )}
            <div className="space-y-2">
              {data.sealedFiles.map((s) => (
                <div key={`${s.recordKind}-${s.recordId}`} className={rowCls}>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {s.title} <ChainChip status={s.status} />
                  </p>
                  <p className="text-xs text-[var(--dim)]">
                    {s.eventCount} sealed event{s.eventCount === 1 ? "" : "s"}
                    {s.lastEventAt ? ` · last ${new Date(s.lastEventAt).toLocaleString()}` : ""}
                    {s.headHash ? ` · record hash ${s.headHash.slice(0, 12)}…` : ""}
                  </p>
                  {s.ref ? (
                    <DocActions docRef={s.ref} title={`Sealed record certificate — ${s.title}`} defaultEmail={defaultEmail} setBanner={setBanner} />
                  ) : (
                    <p className="text-xs text-[var(--dim)]">Trip record — its certificate rides with its load's sealed record.</p>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {data.fleet && (
            <Section icon="🏢" title={`Fleet library${data.fleet.companyName ? ` — ${data.fleet.companyName}` : ""}`}>
              <p className="text-xs text-[var(--dim)]">
                Built from your fleet's shared board records — every driver's delivered loads and their sealed records.
                Drivers' private statements, fuel, and documents stay theirs.
              </p>
              {data.fleet.deliveredLoads.length === 0 && (
                <p className="text-sm text-[var(--dim)]">No fleet deliveries yet.</p>
              )}
              <div className="space-y-2">
                {data.fleet.deliveredLoads.map((l) => (
                  <div key={l.loadId} className={rowCls}>
                    <p className="text-sm font-bold">
                      {l.lane}
                      {l.referenceNumber ? <span className="text-[var(--dim)]"> · Ref {l.referenceNumber}</span> : null}
                    </p>
                    <p className="text-xs text-[var(--dim)]">
                      Driver: @{l.driverUsername} · Delivered {l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString() : "—"}
                      {l.totalWithExtras != null ? ` · $${l.totalWithExtras.toLocaleString()}` : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-bold text-[var(--dim)]">Packet:</span>
                      <DocActions docRef={`packet:${l.loadId}`} title={`Delivered load packet — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />

                      <DocActions docRef={`bol:${l.loadId}`} title={`Bill of lading — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />

                      <DocActions docRef={`pod:${l.loadId}`} title={`Signed POD — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-bold text-[var(--dim)]">Sealed record:</span>
                      <DocActions docRef={`sealed:${l.loadId}`} title={`Sealed load record — ${l.lane}`} defaultEmail={defaultEmail} setBanner={setBanner} />
                    </div>
                  </div>
                ))}
                {data.fleet.sealedFiles.map((s) => (
                  <div key={`fleet-${s.recordId}`} className={rowCls}>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      {s.title} <ChainChip status={s.status} />
                    </p>
                    <p className="text-xs text-[var(--dim)]">
                      {s.eventCount} sealed event{s.eventCount === 1 ? "" : "s"}
                      {s.lastEventAt ? ` · last ${new Date(s.lastEventAt).toLocaleString()}` : ""}
                    </p>
                    {s.ref && (
                      <DocActions docRef={s.ref} title={`Sealed record certificate — ${s.title}`} defaultEmail={defaultEmail} setBanner={setBanner} />
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
