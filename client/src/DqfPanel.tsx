// DqfPanel.tsx — driver qualification files (Wave 2 item 6).
//
// The 49 CFR 391 file, three surfaces over the same server rules
// (dqf.ts — the panel renders verdicts, it never computes them):
//
//   FleetDqfPanel — Owner / Dispatch desks: every company driver
//     with their qualification status, the recorded reasons when
//     they're not qualified, and the expiry alerts (CDL, medical,
//     MVR review due) with per-threshold dismissals.
//   DqfFileView — one driver's file: the 391 checks, the
//     medical verification status (a paper certificate reads "on
//     file" until a verification source actually answers — the
//     panel says which, plainly), every recorded entry with its
//     document, the add-entry form, and the as-of-date audit
//     packet through the Library doors.
//   MyDqfCard — the driver's own file, in the Money tab beside
//     the credential wallet.
//
// Dispatch holds are enforced server-side at claim / assign /
// accept; this panel is where the file gets fixed. Plain wording
// throughout; no percentages, no money numbers.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type DqfFileData = ApiResponse<typeof api, "getDqfFile">;
type DqfEntry = DqfFileData["entries"][number];
type FleetData = ApiResponse<typeof api, "getFleetDqf">;
type FleetDriver = FleetData["drivers"][number];

const BTN = "rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50";
const BTN_PRIMARY = "rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50";
const INPUT = "w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2 py-2 text-xs";
const SECTION = "mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3";

const ENTRY_KINDS: { kind: string; label: string }[] = [
  { kind: "application", label: "Driver application" },
  { kind: "employment_history", label: "Employment history" },
  { kind: "cdl", label: "CDL record" },
  { kind: "medical", label: "Medical certificate" },
  { kind: "road_test", label: "Road test certificate" },
  { kind: "mvr_review", label: "MVR review" },
  { kind: "clearinghouse_query", label: "Clearinghouse query" },
  { kind: "violation_record", label: "Violations record" },
  { kind: "training", label: "Training record" },
];

function readFileBase64(f: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve({ base64: s.slice(s.indexOf(",") + 1), mime: f.type || "application/pdf" });
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(f);
  });
}

function downloadPdf(filename: string, dataBase64: string) {
  const bin = atob(dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function statusChip(status: string) {
  if (status === "ok") return "bg-emerald-500/15 text-emerald-300";
  if (status === "prohibited") return "bg-red-500/20 text-red-200";
  if (status === "expired" || status === "overdue") return "bg-red-500/15 text-red-300";
  return "bg-amber-500/15 text-amber-200";
}

function payloadLines(payload: Record<string, unknown>): string[] {
  return Object.entries(payload)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
}

// ---------------------------------------------------------------------------
// One driver's file.
// ---------------------------------------------------------------------------

export function DqfFileView({ driverUsername, onMsg }: { driverUsername: string | null; onMsg: (m: string) => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["dqf-file", driverUsername ?? "me"],
    queryFn: () => api.getDqfFile({ driverUsername }),
  });
  const [kind, setKind] = useState("cdl");
  const [entryDate, setEntryDate] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<{ base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  const data = q.data;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["dqf-file"] });
    void queryClient.invalidateQueries({ queryKey: ["fleet-dqf"] });
    void queryClient.invalidateQueries({ queryKey: ["exception-queue"] });
  };

  const setField = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveEntry = () => {
    if (!data?.driverUsername) return;
    if (!entryDate) {
      onMsg("Pick the date the entry is about — the certificate's issue date, the review date, the query date.");
      return;
    }
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (v.trim() !== "") payload[k] = v.trim();
    setBusy(true);
    void api
      .saveDqfEntry({
        driverUsername: data.driverUsername,
        kind: kind as never,
        entryDate,
        expiresOn: expiresOn ? expiresOn : null,
        payloadJson: JSON.stringify(payload),
        dataBase64: doc?.base64 ?? null,
        mime: doc?.mime ?? null,
      })
      .then((r) => {
        if (r.ok) {
          onMsg("Entry recorded on the sealed file.");
          setFields({});
          setDoc(null);
          refresh();
        } else onMsg(r.error ?? "Couldn't record that entry.");
      })
      .finally(() => setBusy(false));
  };

  const viewDoc = (e: DqfEntry) => {
    void api.getDqfEntryDoc({ entryId: e.id }).then((r) => {
      if (r.url) window.open(r.url, "_blank");
      else onMsg("That document isn't available.");
    });
  };

  const voidEntry = (e: DqfEntry) => {
    setBusy(true);
    void api
      .voidDqfEntry({ entryId: e.id })
      .then((r) => {
        if (r.ok) {
          onMsg("Entry voided — it stays on the record, marked void, and no longer counts. Record the corrected entry alongside it.");
          refresh();
        } else onMsg(r.error ?? "Couldn't void that entry.");
      })
      .finally(() => setBusy(false));
  };

  const verifyMedical = () => {
    if (!data?.driverUsername) return;
    setBusy(true);
    void api
      .verifyDqfMedical({ driverUsername: data.driverUsername })
      .then((r) => {
        onMsg(r.error ?? r.label);
        refresh();
      })
      .finally(() => setBusy(false));
  };

  const dismissAlert = (itemKey: string, threshold: number) => {
    if (!data?.driverUsername) return;
    void api
      .dismissDqfAlert({ driverUsername: data.driverUsername, itemKey: itemKey as "cdl" | "medical" | "mvr_review" | "clearinghouse" | "violations", threshold })
      .then((r) => {
        if (r.ok) {
          onMsg("Alert dismissed for this round — the next mark still fires, and a renewal restarts the watch.");
          refresh();
        } else onMsg(r.error ?? "Couldn't dismiss that alert.");
      });
  };

  const downloadPacket = () => {
    if (!data?.fileId) return;
    void api.getLibraryDocument({ ref: `dqf:${data.fileId}:${asOf}` }).then((d) => {
      if (d.ok && d.dataBase64 && d.filename) downloadPdf(d.filename, d.dataBase64);
      else onMsg(d.error ?? "That packet couldn't be built.");
    });
  };

  if (q.isPending) return <p className="mt-2 text-sm text-[var(--dim)]">Opening the qualification file…</p>;
  if (!data?.ok) return <p className="mt-2 text-sm text-[var(--dim)]">{data?.error ?? "The qualification file isn't available."}</p>;

  const activeAlerts = data.alerts.filter((a) => a.threshold != null && !a.dismissed);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${data.qualified ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
          {data.qualified ? "✓ Qualified" : "✕ Not qualified"}
        </span>
        <span className="text-xs text-[var(--dim)]">{data.companyName}</span>
      </div>
      {!data.qualified && (
        <ul className="mt-2 space-y-1">
          {data.reasons.map((r) => (
            <li key={r.code} className="text-sm text-red-200">
              • {r.detail}
            </li>
          ))}
        </ul>
      )}

      {/* The 391 checks */}
      <ul className="mt-3 space-y-1.5">
        {data.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-2">
            <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusChip(c.status)}`}>
              {c.status === "ok" ? "ON FILE" : c.status.toUpperCase().replace("_", " ")}
            </span>
            <span className="text-xs leading-relaxed">
              <strong>{c.label}.</strong> {c.detail}
            </span>
          </li>
        ))}
      </ul>

      {/* Medical verification — the paper card is not proof */}
      <div className="mt-3 rounded-lg bg-[var(--surface)] px-2.5 py-2">
        <p className="text-xs leading-relaxed">
          <strong>Medical verification:</strong> {data.medicalVerification.label}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
          A paper medical card isn't proof on its own anymore — the electronic record is. This file shows the
          certificate's dates and its verification state for what they are.
        </p>
        <button type="button" className={`${BTN} mt-2`} disabled={busy} onClick={verifyMedical}>
          Check medical status
        </button>
      </div>

      {/* Fleet expiry alerts for this driver */}
      {activeAlerts.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {activeAlerts.map((a) => (
            <li key={a.itemKey} className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2">
              <span className="text-xs leading-relaxed">
                <strong>{a.label}</strong> — {a.threshold === 0 ? `past due (${a.expiresOn})` : `${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left (${a.expiresOn})`}
              </span>
              <button type="button" className={BTN} onClick={() => dismissAlert(a.itemKey, a.threshold ?? 0)}>
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Entries on the record */}
      <h4 className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">On the record</h4>
      {data.entries.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--dim)]">Nothing recorded yet — the file opens with the first entry below.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {[...data.entries].reverse().map((e) => (
            <li key={e.id} className={`rounded-lg bg-[var(--surface)] px-2.5 py-2 ${e.voided ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs leading-relaxed">
                  <strong>{e.kindLabel}</strong> — {e.entryDate}
                  {e.expiresOn ? ` · expires ${e.expiresOn}` : ""}
                  {e.voided ? " · VOIDED" : ""}
                  {payloadLines(e.payload).length > 0 && (
                    <>
                      <br />
                      {payloadLines(e.payload).join(" · ")}
                    </>
                  )}
                  <br />
                  <span className="text-[var(--dim)]">
                    Recorded by @{e.recordedBy}
                    {e.hasDoc ? " · document attached" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {e.hasDoc && (
                    <button type="button" className={BTN} onClick={() => viewDoc(e)}>
                      View doc
                    </button>
                  )}
                  {!e.voided && (
                    <button type="button" className={BTN} disabled={busy} onClick={() => voidEntry(e)}>
                      Void
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add an entry */}
      <h4 className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Record an entry</h4>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select className={INPUT} value={kind} onChange={(ev) => setKind(ev.target.value)} aria-label="Entry kind">
          {ENTRY_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <input className={INPUT} type="date" value={entryDate} onChange={(ev) => setEntryDate(ev.target.value)} aria-label="Entry date" />
      </div>
      {(kind === "cdl" || kind === "medical") && (
        <input className={`${INPUT} mt-2`} type="date" value={expiresOn} onChange={(ev) => setExpiresOn(ev.target.value)} aria-label="Expiry date" />
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {kind === "cdl" && (
          <>
            <input className={INPUT} placeholder="State (e.g. AL)" value={fields.state ?? ""} onChange={(ev) => setField("state", ev.target.value)} />
            <input className={INPUT} placeholder="Class (e.g. A)" value={fields.licenseClass ?? ""} onChange={(ev) => setField("licenseClass", ev.target.value)} />
            <input className={INPUT} placeholder="Endorsements" value={fields.endorsements ?? ""} onChange={(ev) => setField("endorsements", ev.target.value)} />
            <input className={INPUT} placeholder="Number (last 4)" value={fields.numberLast4 ?? ""} onChange={(ev) => setField("numberLast4", ev.target.value)} />
          </>
        )}
        {kind === "medical" && (
          <>
            <input className={INPUT} placeholder="Examiner name" value={fields.examinerName ?? ""} onChange={(ev) => setField("examinerName", ev.target.value)} />
            <input className={INPUT} placeholder="National Registry #" value={fields.registryNumber ?? ""} onChange={(ev) => setField("registryNumber", ev.target.value)} />
          </>
        )}
        {kind === "employment_history" && (
          <>
            <input className={INPUT} placeholder="Employer" value={fields.employer ?? ""} onChange={(ev) => setField("employer", ev.target.value)} />
            <input className={INPUT} placeholder="Role" value={fields.role ?? ""} onChange={(ev) => setField("role", ev.target.value)} />
            <input className={INPUT} placeholder="From (YYYY-MM-DD)" value={fields.fromOn ?? ""} onChange={(ev) => setField("fromOn", ev.target.value)} />
            <input className={INPUT} placeholder="To (YYYY-MM-DD)" value={fields.toOn ?? ""} onChange={(ev) => setField("toOn", ev.target.value)} />
          </>
        )}
        {kind === "road_test" && (
          <input className={INPUT} placeholder="Examiner / certifier" value={fields.examinerName ?? ""} onChange={(ev) => setField("examinerName", ev.target.value)} />
        )}
        {kind === "mvr_review" && (
          <>
            <select className={INPUT} value={fields.outcome ?? "acceptable"} onChange={(ev) => setField("outcome", ev.target.value)} aria-label="Review outcome">
              <option value="acceptable">Acceptable</option>
              <option value="violations_noted">Violations noted</option>
            </select>
            <input className={INPUT} placeholder="Reviewed by" value={fields.reviewer ?? ""} onChange={(ev) => setField("reviewer", ev.target.value)} />
          </>
        )}
        {kind === "clearinghouse_query" && (
          <>
            <select className={INPUT} value={fields.queryType ?? "pre_employment"} onChange={(ev) => setField("queryType", ev.target.value)} aria-label="Query type">
              <option value="pre_employment">Pre-employment</option>
              <option value="annual">Annual</option>
              <option value="limited">Limited</option>
              <option value="full">Full</option>
            </select>
            <select className={INPUT} value={fields.result ?? "clear"} onChange={(ev) => setField("result", ev.target.value)} aria-label="Query result">
              <option value="clear">Clear</option>
              <option value="prohibited">Prohibited</option>
              <option value="no_record">No record found</option>
            </select>
            <input className={INPUT} placeholder="Run by" value={fields.runBy ?? ""} onChange={(ev) => setField("runBy", ev.target.value)} />
          </>
        )}
        {kind === "violation_record" && (
          <input className={INPUT} placeholder="What the record shows" value={fields.description ?? ""} onChange={(ev) => setField("description", ev.target.value)} />
        )}
        {kind === "training" && (
          <>
            <input className={INPUT} placeholder="Topic" value={fields.topic ?? ""} onChange={(ev) => setField("topic", ev.target.value)} />
            <input className={INPUT} placeholder="Provider" value={fields.provider ?? ""} onChange={(ev) => setField("provider", ev.target.value)} />
          </>
        )}
      </div>
      {kind === "clearinghouse_query" && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
          Record the result of a query your fleet actually ran in the FMCSA Clearinghouse — this is your record of
          that run, labelled as such. The app never looks a driver up itself.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className={BTN}>
          {doc ? "Document attached ✓" : "Attach document"}
          <input
            type="file"
            className="hidden"
            accept="image/*,application/pdf"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              if (f) void readFileBase64(f).then(setDoc).catch(() => onMsg("Couldn't read that file."));
            }}
          />
        </label>
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={saveEntry}>
          Record entry
        </button>
      </div>

      {/* Audit packet */}
      {data.fileId != null && (
        <div className="mt-4 rounded-lg bg-[var(--surface)] px-2.5 py-2">
          <p className="text-xs leading-relaxed">
            <strong>Audit packet</strong> — the whole file as it stood on a date: what was on file and valid then.
            That's the roadside answer.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={`${INPUT} max-w-[170px]`} type="date" value={asOf} onChange={(ev) => setAsOf(ev.target.value)} aria-label="As-of date" />
            <button type="button" className={BTN} onClick={downloadPacket}>
              Download packet (PDF)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The fleet board — Owner / Dispatch desks.
// ---------------------------------------------------------------------------

export function FleetDqfPanel() {
  const q = useQuery({ queryKey: ["fleet-dqf"], queryFn: () => api.getFleetDqf({}) });
  const [openDriver, setOpenDriver] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const data = q.data;
  if (q.isPending) return null;
  if (!data?.ok) return null; // drivers don't get the board — their own file lives in the Money tab

  return (
    <section className={SECTION} aria-label="Driver qualification files">
      <h3 className="font-condensed text-lg font-semibold">🪪 Driver qualification files</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        The 49 CFR 391 file for every driver. Dispatch holds a driver whose file doesn't check out — expired CDL or
        medical, an overdue MVR review, a prohibited Clearinghouse record, or no file at all — and the hold names
        the reason. Fix the file and the hold clears itself.
      </p>
      {msg && (
        <p className="mt-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs" role="status">
          {msg}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {data.drivers.map((d: FleetDriver) => {
          const active = d.alerts.filter((a) => a.threshold != null && !a.dismissed);
          const open = openDriver === d.username;
          return (
            <li key={d.username} className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <strong>@{d.username}</strong>{" "}
                  <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${d.qualified ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                    {d.qualified ? "QUALIFIED" : "NOT QUALIFIED"}
                  </span>
                  {active.length > 0 && (
                    <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                      {active.length} expiry alert{active.length === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
                <button type="button" className={BTN} onClick={() => setOpenDriver(open ? null : d.username)}>
                  {open ? "Close file" : "Open file"}
                </button>
              </div>
              {!d.qualified && (
                <p className="mt-1 text-xs leading-relaxed text-red-200">{d.reasons.map((r) => r.detail).join(" ")}</p>
              )}
              <p className="mt-1 text-xs text-[var(--dim)]">{d.medicalVerificationLabel}</p>
              {open && <DqfFileView driverUsername={d.username} onMsg={setMsg} />}
            </li>
          );
        })}
      </ul>
      {data.drivers.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No drivers on the roster yet.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The driver's own file — Money tab, beside the credential wallet.
// ---------------------------------------------------------------------------

export function MyDqfCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["dqf-file", "me"], queryFn: () => api.getDqfFile({ driverUsername: null }) });
  if (q.isPending) return null;
  if (!q.data?.ok) return null; // not in a company — no fleet file to show

  return (
    <section className={SECTION} aria-label="My qualification file">
      <h3 className="font-condensed text-lg font-semibold">🪪 My qualification file</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Your 49 CFR 391 file with your fleet — the record dispatch checks before a load can be handed to you. If a
        load is ever held over this file, the reason names what's missing or lapsed; fix it here and the hold
        clears itself.
      </p>
      {msg && (
        <p className="mt-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs" role="status">
          {msg}
        </p>
      )}
      <DqfFileView driverUsername={null} onMsg={setMsg} />
    </section>
  );
}
