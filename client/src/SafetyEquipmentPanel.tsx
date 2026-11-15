// SafetyEquipmentPanel.tsx — video coaching + predictive
// maintenance + smart trailer (Wave 2 item 11).
//
// Driver side (Money tab, beside the DQF and home-time cards):
//   MySafetyCard — three sections:
//     🎥 Coaching: dashcam events from the partner (the partner
//        hosts the video — this shows its reference), the
//        driver's own note on each event, repeat-pattern flags
//        (counts and dates, never scores), the exoneration vault,
//        and the test-event path, labelled simulated everywhere.
//     🔧 Fault codes: record a code off the dash; known codes
//        answer with their plain-language meaning + urgency, a
//        stop-now/service-soon code drafts a maintenance work
//        order, unknown codes record as reported with no invented
//        meaning. Due-soon flags are estimates from the driver's
//        own sealed readings and say so.
//     🚛 Smart trailer: the device pairing, the trailer's last
//        position WITH its age printed (never dressed up as
//        live), and the reefer temperature log per load.
// Desk side (Owner / Dispatch desks):
//   FleetSafetyPanel — the same facts per driver, with the
//   coaching marks (reviewed / coached) the desk can set.
//
// Honesty rules carried through: no partner configured reads as
// exactly that; simulated data is badged SIMULATED wherever it
// appears; nothing here shows a rate or a money figure.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

const SECTION = "mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3";

type DashcamEvent = ApiResponse<typeof api, "getDashcamPanel">["events"][number];
type Fault = ApiResponse<typeof api, "getFaultCodes">["faults"][number];

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

function urgencyChip(urgency: string): string {
  if (urgency === "stop_now") return "bg-red-500/20 text-red-200";
  if (urgency === "service_soon") return "bg-amber-500/15 text-amber-200";
  if (urgency === "watch") return "bg-sky-500/15 text-sky-200";
  return "bg-[var(--surface)] text-[var(--dim)]";
}

function FaultRow({ f }: { f: Fault }) {
  return (
    <li className="rounded-xl bg-[var(--surface)] px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{f.code}</strong>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${urgencyChip(f.urgency)}`}>{f.urgencyLabel}</span>
        <span className="text-xs text-[var(--dim)]">
          {whenLabel(f.occurredAt)} · {f.source === "eld" ? "from the ELD" : "entered by hand"}
          {f.simulated ? " · SIMULATED" : ""}
        </span>
      </div>
      {f.meaning ? (
        <p className="mt-1">{f.meaning}</p>
      ) : (
        <p className="mt-1 text-[var(--dim)]">{f.unknownNote}</p>
      )}
      {f.sourceNote && <p className="mt-0.5 text-xs text-[var(--dim)]">Note: {f.sourceNote}</p>}
      {f.maintenanceEntryId != null && (
        <p className="mt-0.5 text-xs text-[var(--dim)]">
          Work order drafted in your maintenance log (entry #{f.maintenanceEntryId}) — close it there when the work is done.
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------
// Driver card
// ---------------------------------------------------------------------

export function MySafetyCard() {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const dash = useQuery({ queryKey: ["dashcam-panel"], queryFn: () => api.getDashcamPanel({}) });
  const faultsQ = useQuery({ queryKey: ["fault-codes"], queryFn: () => api.getFaultCodes({}) });
  const trailerQ = useQuery({ queryKey: ["trailer-telemetry"], queryFn: () => api.getTrailerTelemetry({}) });

  const [testKind, setTestKind] = useState<"harsh_braking" | "speeding" | "following_distance" | "collision" | "camera_obstruction">("harsh_braking");
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [pinLoads, setPinLoads] = useState<Record<number, string>>({});
  const [connLabel, setConnLabel] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [faultCode, setFaultCode] = useState("");
  const [faultNote, setFaultNote] = useState("");
  const [faultOdo, setFaultOdo] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [deviceRef, setDeviceRef] = useState("");
  const [rangeLoad, setRangeLoad] = useState("");
  const [rangeMin, setRangeMin] = useState("");
  const [rangeMax, setRangeMax] = useState("");
  const [syncLoad, setSyncLoad] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["dashcam-panel"] });
    void queryClient.invalidateQueries({ queryKey: ["fault-codes"] });
    void queryClient.invalidateQueries({ queryKey: ["trailer-telemetry"] });
    void queryClient.invalidateQueries({ queryKey: ["fleet-safety"] });
  };

  const d = dash.data;
  const f = faultsQ.data;
  const t = trailerQ.data;

  return (
    <section className={SECTION} aria-label="Safety and equipment">
      <h3 className="font-condensed text-lg font-semibold">🦺 Safety &amp; equipment</h3>
      {msg && (
        <p className="mt-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs" role="status">
          {msg}
        </p>
      )}

      {/* ---- Coaching ---- */}
      <h4 className="mt-3 font-condensed text-base font-semibold">🎥 Dashcam coaching</h4>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        {d?.partnerConfigured
          ? `Connected to ${d.partnerName ?? "your dashcam partner"} — events it reports land here with the partner's clip reference (the partner hosts the video; STONEMILES keeps the record).`
          : "No dashcam partner is connected yet, so no live events land here. The test event below runs the same record path with simulated data, stamped simulated."}
      </p>
      {d && d.patterns.length > 0 && (
        <ul className="mt-2 space-y-1">
          {d.patterns.map((p) => (
            <li key={p.kind} className="rounded-lg bg-[#2c2207] px-2.5 py-1.5 text-sm text-amber-200">
              Pattern: {p.line} Counts and dates only — what it means is a conversation, not a score.
            </li>
          ))}
        </ul>
      )}
      {d && d.events.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No dashcam events on your record.</p>}
      {d && d.events.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {d.events.map((e: DashcamEvent) => (
            <li key={e.id} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{e.kindLabel}</strong>
                <span className="text-xs text-[var(--dim)]">
                  {whenLabel(e.occurredAt)} · reported severity: {e.severity} · {e.status}
                  {e.simulated ? " · SIMULATED TEST EVENT" : ""}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--dim)]">
                Clip reference (held by the partner): {e.clipRef}
                {e.clipUrl ? (
                  <>
                    {" · "}
                    <a className="underline" href={e.clipUrl} target="_blank" rel="noreferrer">
                      open clip
                    </a>
                  </>
                ) : null}
                {e.loadId != null ? ` · tied to load #${e.loadId}` : ""}
              </p>
              {e.note && <p className="mt-1">Your note: {e.note}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <input
                  className="min-w-40 flex-1 rounded-lg bg-[var(--surface2)] px-2 py-1 text-sm"
                  placeholder="What happened? (your words)"
                  value={noteDrafts[e.id] ?? e.note ?? ""}
                  onChange={(ev) => setNoteDrafts((s) => ({ ...s, [e.id]: ev.target.value }))}
                />
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface2)] px-2.5 py-1 text-sm font-semibold"
                  onClick={() => {
                    void api.noteDashcamEvent({ eventId: e.id, note: noteDrafts[e.id] ?? "" }).then((r) => {
                      setMsg(r.ok ? "Note saved on the event." : (r.error ?? "That didn't save."));
                      if (r.ok) refresh();
                    });
                  }}
                >
                  Save note
                </button>
                <input
                  className="w-24 rounded-lg bg-[var(--surface2)] px-2 py-1 text-sm"
                  placeholder="Load #"
                  inputMode="numeric"
                  value={pinLoads[e.id] ?? (e.loadId != null ? String(e.loadId) : "")}
                  onChange={(ev) => setPinLoads((s) => ({ ...s, [e.id]: ev.target.value }))}
                />
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface2)] px-2.5 py-1 text-sm font-semibold"
                  onClick={() => {
                    const loadId = Number(pinLoads[e.id]);
                    void api
                      .pinExoneration({ eventId: e.id, loadId: Number.isFinite(loadId) && loadId > 0 ? loadId : null })
                      .then((r) => {
                        setMsg(r.ok ? `Pinned to the exoneration vault — packet ${r.packetRef ?? ""}.` : (r.error ?? "That didn't pin."));
                        if (r.ok) refresh();
                      });
                  }}
                >
                  Pin to vault
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          className="rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm"
          value={testKind}
          onChange={(ev) => setTestKind(ev.target.value as typeof testKind)}
          aria-label="Test event kind"
        >
          <option value="harsh_braking">Harsh braking</option>
          <option value="speeding">Speeding</option>
          <option value="following_distance">Following too close</option>
          <option value="collision">Collision</option>
          <option value="camera_obstruction">Camera obstructed</option>
        </select>
        <button
          type="button"
          className="rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm font-semibold"
          onClick={() => {
            void api.runDashcamTestEvent({ kind: testKind }).then((r) => {
              setMsg(r.ok ? "Test event recorded — it's stamped SIMULATED in the record." : (r.error ?? "That didn't run."));
              if (r.ok) refresh();
            });
          }}
        >
          Record a test event (simulated)
        </button>
      </div>
      {d && d.vault.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold">🛡️ Exoneration vault</p>
          <ul className="mt-1 space-y-1">
            {d.vault.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm">
                <span>
                  Packet for event #{v.eventId}
                  {v.loadId != null ? ` · load #${v.loadId}` : ""} · pinned {whenLabel(v.createdAt)}
                  {v.removedAt ? ` · REMOVED ${whenLabel(v.removedAt)}` : ""}
                </span>
                {!v.removedAt && (
                  <>
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--surface2)] px-2 py-0.5 text-xs font-semibold"
                      onClick={() => {
                        void api.getLibraryDocument({ ref: v.packetRef }).then((doc) => {
                          if (doc.ok && doc.dataBase64 && doc.filename) downloadPdf(doc.filename, doc.dataBase64);
                          else setMsg(doc.error ?? "That packet couldn't be built.");
                        });
                      }}
                    >
                      Download packet
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--surface2)] px-2 py-0.5 text-xs font-semibold"
                      onClick={() => {
                        void api.removeExoneration({ entryId: v.id }).then((r) => {
                          setMsg(r.ok ? "Packet removed from the vault." : (r.error ?? "That didn't remove."));
                          if (r.ok) refresh();
                        });
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d?.canManage && (
        <div className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2">
          <p className="text-sm font-semibold">Dashcam connection</p>
          {d.connections.length === 0 && <p className="mt-1 text-sm text-[var(--dim)]">No connection wired yet.</p>}
          {d.connections.map((c) => (
            <p key={c.id} className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span>
                {c.label} · {c.status} · secret …{c.secretLast4 ?? "—"}
              </span>
              {c.status === "active" && (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface2)] px-2 py-0.5 text-xs font-semibold"
                  onClick={() => {
                    void api.revokeDashcamConnection({ connectionId: c.id }).then((r) => {
                      setMsg(r.ok ? "Connection revoked — its secret is wiped." : (r.error ?? "That didn't revoke."));
                      if (r.ok) refresh();
                    });
                  }}
                >
                  Revoke
                </button>
              )}
            </p>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <input
              className="min-w-40 flex-1 rounded-lg bg-[var(--surface2)] px-2 py-1 text-sm"
              placeholder="Connection label (e.g. Cab camera)"
              value={connLabel}
              onChange={(ev) => setConnLabel(ev.target.value)}
            />
            <button
              type="button"
              className="rounded-lg bg-[var(--surface2)] px-2.5 py-1 text-sm font-semibold"
              onClick={() => {
                if (!connLabel.trim()) return;
                void api.createDashcamConnection({ label: connLabel.trim() }).then((r) => {
                  if (r.ok && r.secret) {
                    setNewSecret(r.secret);
                    setMsg("Connection wired. Copy the secret below into the partner's webhook config — it's shown only this once.");
                  } else setMsg(r.error ?? "That didn't wire.");
                  if (r.ok) refresh();
                });
              }}
            >
              Wire connection
            </button>
          </div>
          {newSecret && (
            <p className="mt-2 break-all rounded-lg bg-[#2c2207] px-2.5 py-2 text-xs text-amber-200">
              Webhook secret (shown once): {newSecret}
            </p>
          )}
        </div>
      )}

      {/* ---- Fault codes ---- */}
      <h4 className="mt-4 font-condensed text-base font-semibold">🔧 Fault codes &amp; maintenance outlook</h4>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Type in a code off the dash and it answers in plain language. A stop-now or service-soon code drafts a work
        order in your maintenance log automatically. A code the table doesn&apos;t know is recorded exactly as
        reported — no invented meaning.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          className="w-36 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="Code (e.g. P2463)"
          value={faultCode}
          onChange={(ev) => setFaultCode(ev.target.value)}
        />
        <input
          className="min-w-40 flex-1 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="What did you see? (dash light, shop note…)"
          value={faultNote}
          onChange={(ev) => setFaultNote(ev.target.value)}
        />
        <input
          className="w-32 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="Odometer"
          inputMode="numeric"
          value={faultOdo}
          onChange={(ev) => setFaultOdo(ev.target.value)}
        />
        <button
          type="button"
          className="rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm font-semibold"
          onClick={() => {
            if (!faultCode.trim()) return;
            const odo = Number(faultOdo);
            void api
              .reportFaultCode({
                code: faultCode.trim(),
                sourceNote: faultNote.trim() || null,
                odometer: Number.isFinite(odo) && odo > 0 ? odo : null,
              })
              .then((r) => {
                if (r.ok) {
                  setMsg(
                    r.known
                      ? `${faultCode.trim().toUpperCase()} — ${r.urgencyLabel}: ${r.meaning}${r.draftEntryId != null ? ` Work order #${r.draftEntryId} drafted in your maintenance log.` : ""}`
                      : `${faultCode.trim().toUpperCase()} recorded as reported — no plain-language entry for it yet.`,
                  );
                  setFaultCode("");
                  setFaultNote("");
                  setFaultOdo("");
                  refresh();
                } else setMsg(r.error ?? "That didn't record.");
              });
          }}
        >
          Record code
        </button>
      </div>
      {f && (
        <p className="mt-2 text-xs text-[var(--dim)]">
          {f.currentOdometer != null
            ? `Newest recorded odometer: ${Math.round(f.currentOdometer).toLocaleString("en-US")} mi (from ${f.odometerSource ?? "your records"}).`
            : "No odometer reading recorded yet."}
          {f.latestEngineHours
            ? ` Latest engine hours: ${f.latestEngineHours.value.toLocaleString("en-US")} h (${f.latestEngineHours.source}${f.latestEngineHours.simulated ? ", simulated test sync" : ""}).`
            : ""}
        </p>
      )}
      {f && f.dueFlags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {f.dueFlags.map((df) => (
            <li
              key={df.item}
              className={`rounded-lg px-2.5 py-1.5 text-sm ${df.state === "overdue" ? "bg-red-500/10 text-red-200" : df.state === "due_soon" ? "bg-[#2c2207] text-amber-200" : "bg-[var(--surface)]"}`}
            >
              <strong className="capitalize">{df.item.replace(/_/g, " ")}</strong> — {df.line}
            </li>
          ))}
        </ul>
      )}
      {f && f.faults.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {f.faults.map((row) => (
            <FaultRow key={row.id} f={row} />
          ))}
        </ul>
      )}
      {f && f.faults.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No fault codes recorded yet.</p>}

      {/* ---- Smart trailer ---- */}
      <h4 className="mt-4 font-condensed text-base font-semibold">🚛 Smart trailer</h4>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        {t?.partnerConfigured
          ? `Trailer partner connected (${t.partnerName ?? "partner"}).`
          : "No trailer partner is connected yet — positions and temperatures below can only come from the simulated test path until one is."}{" "}
        {t?.trailerLabel ? `Trailer on file: ${t.trailerLabel}.` : ""} A position here is the last fix the device
        reported, with its age printed — not a live position.
      </p>
      {t?.latestPosition ? (
        <p className="mt-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-sm">
          📍 {t.latestPosition.lat.toFixed(4)}, {t.latestPosition.lon.toFixed(4)} — {t.latestPosition.line}
          {t.latestPosition.source === "simulated" ? " (SIMULATED test reading)" : ""}
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--dim)]">No trailer position reported yet.</p>
      )}
      {t && t.connections.length > 0 && (
        <ul className="mt-2 space-y-1">
          {t.connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm">
              <span>
                {c.label} · {c.status}
                {c.deviceRef ? ` · device ${c.deviceRef}` : ""}
              </span>
              {c.status === "active" && (
                <>
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--surface2)] px-2 py-0.5 text-xs font-semibold"
                    onClick={() => {
                      const loadId = Number(syncLoad);
                      void api
                        .syncTrailerDevice({ connectionId: c.id, loadId: Number.isFinite(loadId) && loadId > 0 ? loadId : null })
                        .then((r) => {
                          setMsg(r.ok ? `Sync: ${r.accepted} reading(s) in, ${r.rejected} rejected, ${r.outOfRange} out of range.` : (r.error ?? "That didn't sync."));
                          if (r.ok) refresh();
                        });
                    }}
                  >
                    Sync now
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--surface2)] px-2 py-0.5 text-xs font-semibold"
                    onClick={() => {
                      void api.revokeTrailerDevice({ connectionId: c.id }).then((r) => {
                        setMsg(r.ok ? "Pairing revoked." : (r.error ?? "That didn't revoke."));
                        if (r.ok) refresh();
                      });
                    }}
                  >
                    Revoke
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          className="min-w-36 flex-1 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="Device label (e.g. Trailer puck)"
          value={deviceLabel}
          onChange={(ev) => setDeviceLabel(ev.target.value)}
        />
        <input
          className="w-36 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="Device id (partner's)"
          value={deviceRef}
          onChange={(ev) => setDeviceRef(ev.target.value)}
        />
        <button
          type="button"
          className="rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm font-semibold"
          onClick={() => {
            if (!deviceLabel.trim()) return;
            void api.connectTrailerDevice({ label: deviceLabel.trim(), deviceRef: deviceRef.trim() || null }).then((r) => {
              setMsg(r.ok ? "Device paired." : (r.error ?? "That didn't pair."));
              if (r.ok) {
                setDeviceLabel("");
                setDeviceRef("");
                refresh();
              }
            });
          }}
        >
          Pair device
        </button>
        <input
          className="w-24 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="Load #"
          inputMode="numeric"
          value={syncLoad}
          onChange={(ev) => setSyncLoad(ev.target.value)}
        />
        <button
          type="button"
          className="rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-sm font-semibold"
          onClick={() => {
            const loadId = Number(syncLoad);
            void api
              .runTrailerTestReadings({ connectionId: null, loadId: Number.isFinite(loadId) && loadId > 0 ? loadId : null })
              .then((r) => {
                setMsg(r.ok ? `Simulated readings in: ${r.lines.join(" · ")}` : (r.error ?? "That didn't run."));
                if (r.ok) refresh();
              });
          }}
        >
          Run simulated readings
        </button>
      </div>
      {t && t.reeferLoads.length > 0 && (
        <div className="mt-3 space-y-2">
          {t.reeferLoads.map((rl) => (
            <div key={rl.loadId} className="rounded-xl bg-[var(--surface)] px-3 py-2">
              <p className="text-sm">
                <strong>Load #{rl.loadId}</strong> — {rl.lane}
                {rl.rangeLabel ? ` · range ${rl.rangeLabel}` : " · no range set — readings logged without judgement"}
              </p>
              <ul className="mt-1 space-y-0.5">
                {rl.readings.map((r) => (
                  <li key={r.id} className={`text-sm ${r.verdict === "out_of_range" ? "text-red-300" : "text-[var(--dim)]"}`}>
                    {whenLabel(r.recordedAt)} — {r.tempF}°F
                    {r.verdict ? (r.verdict === "out_of_range" ? " — OUT OF RANGE" : " — in range") : ""}
                    {r.source === "simulated" ? " · SIMULATED" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {t && t.unattachedTempCount > 0 && (
        <p className="mt-1 text-xs text-[var(--dim)]">
          {t.unattachedTempCount} temperature reading(s) aren&apos;t tied to a load — sync with a load number to file them under that load.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-[var(--dim)]">Set a load&apos;s range:</span>
        <input
          className="w-20 rounded-lg bg-[var(--surface)] px-2 py-1 text-sm"
          placeholder="Load #"
          inputMode="numeric"
          value={rangeLoad}
          onChange={(ev) => setRangeLoad(ev.target.value)}
        />
        <input
          className="w-20 rounded-lg bg-[var(--surface)] px-2 py-1 text-sm"
          placeholder="Low °F"
          inputMode="numeric"
          value={rangeMin}
          onChange={(ev) => setRangeMin(ev.target.value)}
        />
        <input
          className="w-20 rounded-lg bg-[var(--surface)] px-2 py-1 text-sm"
          placeholder="High °F"
          inputMode="numeric"
          value={rangeMax}
          onChange={(ev) => setRangeMax(ev.target.value)}
        />
        <button
          type="button"
          className="rounded-lg bg-[var(--surface)] px-2.5 py-1 text-sm font-semibold"
          onClick={() => {
            const loadId = Number(rangeLoad);
            const min = Number(rangeMin);
            const max = Number(rangeMax);
            if (!Number.isFinite(loadId) || loadId <= 0 || !Number.isFinite(min) || !Number.isFinite(max)) return;
            void api.setLoadReeferRange({ loadId, minF: min, maxF: max }).then((r) => {
              setMsg(r.ok ? `Range set on load #${loadId}: ${min}°F–${max}°F.` : (r.error ?? "That didn't set."));
              if (r.ok) refresh();
            });
          }}
        >
          Set range
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Desk panel
// ---------------------------------------------------------------------

export function FleetSafetyPanel() {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["fleet-safety"], queryFn: () => api.getFleetSafety({}) });
  const data = q.data;
  if (q.isPending) return null;
  if (!data?.ok) return null; // not a desk seat — nothing to show

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["fleet-safety"] });
    void queryClient.invalidateQueries({ queryKey: ["dashcam-panel"] });
  };

  return (
    <section className={SECTION} aria-label="Fleet safety">
      <h3 className="font-condensed text-lg font-semibold">🦺 Safety — coaching, faults, trailers</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        What the trucks reported, per driver: dashcam events and repeat patterns (counts and dates — facts, not
        scores), fault codes with their urgency, exoneration packets, and each trailer&apos;s last reported position
        with its age. Coaching marks are yours to set; the records underneath don&apos;t move.
      </p>
      {msg && (
        <p className="mt-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs" role="status">
          {msg}
        </p>
      )}
      {data.drivers.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No drivers on the roster yet.</p>}
      {data.drivers.map((drv) => (
        <div key={drv.username} className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2">
          <p className="text-sm">
            <strong>@{drv.username}</strong> <span className="text-xs text-[var(--dim)]">({drv.role})</span>
            {drv.trailerPosition
              ? ` · 📍 trailer last seen ${drv.trailerPosition.recordedAt.slice(0, 16).replace("T", " ")} (${drv.trailerPosition.ageMinutes} min ago${drv.trailerPosition.source === "simulated" ? ", simulated" : ""})`
              : " · no trailer position"}
          </p>
          {drv.patterns.map((p) => (
            <p key={p.kind} className="mt-1 rounded-lg bg-[#2c2207] px-2.5 py-1.5 text-sm text-amber-200">
              Pattern: {p.line}
            </p>
          ))}
          {drv.events.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {drv.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    {e.kindLabel} · {whenLabel(e.occurredAt)} · {e.status}
                    {e.simulated ? " · SIMULATED" : ""}
                    {e.note ? ` · note: ${e.note}` : ""}
                  </span>
                  {e.status === "new" && (
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--surface2)] px-2 py-0.5 text-xs font-semibold"
                      onClick={() => {
                        void api.reviewDashcamEvent({ eventId: e.id, status: "reviewed" }).then((r) => {
                          setMsg(r.ok ? "Marked reviewed." : (r.error ?? "That didn't mark."));
                          if (r.ok) refresh();
                        });
                      }}
                    >
                      Mark reviewed
                    </button>
                  )}
                  {e.status !== "coached" && (
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--surface2)] px-2 py-0.5 text-xs font-semibold"
                      onClick={() => {
                        void api.reviewDashcamEvent({ eventId: e.id, status: "coached" }).then((r) => {
                          setMsg(r.ok ? "Marked coached." : (r.error ?? "That didn't mark."));
                          if (r.ok) refresh();
                        });
                      }}
                    >
                      Mark coached
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {drv.faults.length > 0 && (
            <ul className="mt-1.5 space-y-1.5">
              {drv.faults.slice(0, 5).map((row) => (
                <FaultRow key={row.id} f={row} />
              ))}
            </ul>
          )}
          {drv.vault.length > 0 && (
            <p className="mt-1.5 text-sm text-[var(--dim)]">
              🛡️ Vault: {drv.vault.filter((v) => !v.removedAt).length} active packet(s) —{" "}
              {drv.vault
                .filter((v) => !v.removedAt)
                .map((v) => v.packetRef)
                .join(", ")}
            </p>
          )}
          {drv.events.length === 0 && drv.faults.length === 0 && (
            <p className="mt-1 text-sm text-[var(--dim)]">Nothing reported for this driver yet.</p>
          )}
        </div>
      ))}
    </section>
  );
}
