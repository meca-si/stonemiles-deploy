// SiPanel.tsx — STONEMILES SI, the Super Intelligent layer
// (driver order 2026-11-01: "we need a super intelligent trucker
// app — SI trucker app", rules set in stone, then "queue the SI
// build", plus "duty status prompt ask" and "standard rules").
//
// The panel is the visible face of the SI layer on the Driver tab:
//  - The 8 SI Rules, in stone, exactly as the driver set them.
//  - The master switch. While off, SI runs nothing on its own.
//  - "Run the sweep" — one autonomous pass: trip sheets prepped
//    state-by-state, paperwork prepped, the fuel plan chased, bad
//    data caught as correction flags (never rewrites), open board
//    loads vetted. The sweep reports counts, not chores.
//  - The decisions inbox — the ONLY things SI asks a human for:
//    flagged vetting checks and flagged records, each with the
//    driver's Resolve / Dismiss, Approve / Hold controls.
//  - A public-records vetting form: broker / shipper / owner /
//    carrier by name + MC / USDOT (the official FMCSA SAFER link
//    is built for the human to confirm), or a load by its lane,
//    rate, miles, weight, and freight. Personal data is refused
//    by the server before anything is stored (Rule 1).
//  - Road healing lives in the Road learning panel right below —
//    SI's self-healing for road matching — and duty status is
//    never touched by SI at all (Rule 7): the prompt asks, the
//    driver answers, SI has no duty controls anywhere.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

type Banner = (s: string | null) => void;

function SiSection({ title, ariaLabel, badge, children }: { title: string; ariaLabel: string; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="glass-panel p-3.5" aria-label={ariaLabel}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${ariaLabel}`}
        onClick={() => setOpen((v) => !v)}
        className="btn-press flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-condensed text-xl font-semibold">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {badge}
          <span aria-hidden className="text-lg font-bold text-[var(--accent)]">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}

const KIND_ICON: Record<string, string> = {
  trip_prep: "🧾",
  fuel_plan: "⛽",
  paperwork: "📁",
  data_correction: "🛠️",
  road_heal: "🛣️",
  vetting: "🔎",
  decision: "⚖️",
  weather: "🌩️",
};

export function SiPanel({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["si-state"], queryFn: () => api.getSiState({}) });
  const [sweeping, setSweeping] = useState(false);
  const [vetType, setVetType] = useState<"broker" | "shipper" | "owner" | "carrier" | "load">("broker");
  const [vetName, setVetName] = useState("");
  const [vetMc, setVetMc] = useState("");
  const [vetDot, setVetDot] = useState("");
  const [vetPickup, setVetPickup] = useState("");
  const [vetDelivery, setVetDelivery] = useState("");
  const [vetRate, setVetRate] = useState("");
  const [vetMiles, setVetMiles] = useState("");
  const [vetWeight, setVetWeight] = useState("");
  const [vetCommodity, setVetCommodity] = useState("");
  const [vetBusy, setVetBusy] = useState(false);

  const data = q.data;
  const pendingEvents = (data?.events ?? []).filter((e) => e.status === "needs_decision");
  const doneEvents = (data?.events ?? []).filter((e) => e.status !== "needs_decision");
  const pendingVetting = (data?.vetting ?? []).filter((v) => v.decision === "pending");
  const pastVetting = (data?.vetting ?? []).filter((v) => v.decision !== "pending");

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["si-state"] });

  const runSweep = async () => {
    setSweeping(true);
    try {
      const r = await api.runSiSweep({});
      if (!r.ok) {
        setBanner(r.error ?? "The SI sweep didn't run.");
        return;
      }
      setBanner(
        `SI sweep done — ${r.prepped} trip sheet${r.prepped === 1 ? "" : "s"} prepped, ${r.paperwork} paperwork item${r.paperwork === 1 ? "" : "s"}, ${r.corrections} data correction${r.corrections === 1 ? "" : "s"} flagged, ${r.vettingChecks} board load${r.vettingChecks === 1 ? "" : "s"} vetted. ${r.decisionsWaiting} decision${r.decisionsWaiting === 1 ? "" : "s"} waiting in the SI inbox below — everything else handled itself.`,
      );
      refresh();
    } finally {
      setSweeping(false);
    }
  };

  const runVet = async () => {
    setVetBusy(true);
    try {
      const num = (s: string) => {
        const n = Number(s);
        return s.trim() && Number.isFinite(n) ? n : null;
      };
      const r = await api.vetSiEntity({
        entityType: vetType,
        name: vetName.trim() ? vetName.trim() : null,
        mcNumber: vetMc.trim() ? vetMc.trim() : null,
        dotNumber: vetDot.trim() ? vetDot.trim() : null,
        shipper: null,
        pickupCity: vetType === "load" && vetPickup.trim() ? vetPickup.trim() : null,
        pickupState: null,
        deliveryCity: vetType === "load" && vetDelivery.trim() ? vetDelivery.trim() : null,
        deliveryState: null,
        rate: vetType === "load" ? num(vetRate) : null,
        loadedMiles: vetType === "load" ? num(vetMiles) : null,
        weightLbs: vetType === "load" ? num(vetWeight) : null,
        commodity: vetType === "load" && vetCommodity.trim() ? vetCommodity.trim() : null,
        hazmat: false,
        equipmentType: null,
      });
      if (!r.ok) {
        setBanner(r.error ?? "That check didn't run.");
        return;
      }
      setBanner(
        r.verdict === "clear"
          ? `Public-record check: CLEAR — ${r.summary ?? ""}`
          : r.verdict === "hold"
            ? `Public-record check: HOLD for your decision — ${r.summary ?? ""} It's in the decisions inbox below.`
            : `Public-record check: postable with notes — ${r.summary ?? ""} It's in the decisions inbox below.`,
      );
      refresh();
    } finally {
      setVetBusy(false);
    }
  };

  const inputCls = "w-full rounded-lg bg-[var(--surface)] px-3 py-2.5 text-sm border border-[var(--border)]";

  return (
    <SiSection
      title="🧠 STONEMILES SI — Super Intelligent"
      ariaLabel="STONEMILES SI — the autonomous layer under the 8 SI rules"
      badge={
        <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">
          {q.isLoading ? "…" : data?.enabled ? `${(data?.pendingDecisions ?? 0) + (data?.pendingVetting ?? 0)} DECISION${(data?.pendingDecisions ?? 0) + (data?.pendingVetting ?? 0) === 1 ? "" : "S"} WAITING` : "OFF"}
        </span>
      }
    >
      <div className="mt-2">
        <div className="flex items-center justify-between rounded-xl bg-[var(--surface2)] px-3 py-2.5">
          <span className="font-semibold">SI autonomous layer — {data?.enabled ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={data?.enabled ?? false}
            aria-label={data?.enabled ? "Turn off the SI autonomous layer" : "Turn on the SI autonomous layer"}
            onClick={async () => {
              const next = !(data?.enabled ?? false);
              const r = await api.setSiEnabled({ enabled: next });
              setBanner(
                r.ok
                  ? next
                    ? "SI is on — it preps, chases, heals, and vets under the 8 rules, and only surfaces decisions. Duty status stays with the prompt and you, always."
                    : "SI is off — it runs no sweep and gates no board post. The rules stay in stone below either way."
                  : (r.error ?? "That didn't save."),
              );
              refresh();
            }}
            className={`h-8 w-14 shrink-0 rounded-full p-1 ${data?.enabled ? "bg-[var(--ok)]" : "bg-[var(--surface)] border border-[var(--border)]"}`}
          >
            <span className={`block h-6 w-6 rounded-full bg-white ${data?.enabled ? "translate-x-6" : ""}`} />
          </button>
        </div>

        <p className="mt-2 text-sm text-[var(--dim)]">
          SI is the back office that runs itself: it preps your trip sheets state by state, preps and chases
          paperwork, chases the fuel plan, catches its own bad data, heals its own road-matching (Road learning,
          below), and vets brokers, shippers, owners, and loads against <strong>public records only</strong> before
          anything posts to a board. It surfaces <strong>decisions only</strong> — never chores. It never reads
          personal data, never touches duty status (the prompt asks; you answer), never edits a sealed record, and
          never moves money.
        </p>

        <button
          type="button"
          className="btn-neon btn-press mt-3 min-h-[52px] w-full rounded-xl px-4 font-condensed text-xl font-bold disabled:opacity-50"
          aria-label="Run the SI sweep now"
          disabled={!data?.enabled || sweeping}
          onClick={() => void runSweep()}
        >
          {sweeping ? "Sweep running…" : "▶ Run the SI sweep now"}
        </button>
        {!data?.enabled && (
          <p className="mt-1.5 text-xs text-[var(--dim)]">Turn SI on above to run the sweep — while off, SI does nothing on its own.</p>
        )}

        {/* Decisions inbox */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
          Decisions inbox — the only things SI asks you {(pendingEvents.length + pendingVetting.length) > 0 ? `(${pendingEvents.length + pendingVetting.length})` : ""}
        </div>
        {pendingEvents.length === 0 && pendingVetting.length === 0 ? (
          <p className="mt-1.5 text-sm text-[var(--dim)]">
            Nothing waiting. When SI flags a record, a document, or a vetting check, it lands here as one clear
            decision — everything else it handles itself and logs below.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {pendingVetting.map((v) => (
              <li key={`v${v.id}`} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                <span className="block text-sm font-bold">
                  🔎 Vetting — {v.entityName ?? v.entityType} · {v.verdict === "hold" ? "HELD" : "REVIEW"}
                </span>
                <span className="mt-0.5 block text-sm text-[var(--dim)]">{v.summary}</span>
                {v.flags.length > 0 && (
                  <span className="mt-1 block text-xs text-[var(--dim)]">{v.flags.map((f) => `• ${f.label}`).join("\n")}</span>
                )}
                {v.saferUrl && (
                  <a href={v.saferUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-bold text-[var(--accent)] underline" aria-label={`Open the official FMCSA SAFER record for ${v.entityName ?? "this carrier"}`}>
                    Official FMCSA SAFER record ↗
                  </a>
                )}
                <span className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn-neon btn-press flex-1 rounded-lg px-3 py-2 text-sm font-bold"
                    aria-label={`Approve vetting check for ${v.entityName ?? v.entityType} to post`}
                    onClick={async () => {
                      const r = await api.decideSiVetting({ id: v.id, decision: "approved" });
                      setBanner(r.ok ? "Approved — that check is cleared to post. Your decision is on the sealed record." : (r.error ?? "That didn't save."));
                      refresh();
                    }}
                  >
                    Approve to post
                  </button>
                  <button
                    type="button"
                    className="btn-press flex-1 rounded-lg border border-[var(--danger)] px-3 py-2 text-sm font-bold text-[var(--danger)]"
                    aria-label={`Hold vetting check for ${v.entityName ?? v.entityType} off the board`}
                    onClick={async () => {
                      const r = await api.decideSiVetting({ id: v.id, decision: "held" });
                      setBanner(r.ok ? "Held — that one stays off the board until the flagged items are fixed and it's checked again." : (r.error ?? "That didn't save."));
                      refresh();
                    }}
                  >
                    Hold it
                  </button>
                </span>
              </li>
            ))}
            {pendingEvents.map((e) => (
              <li key={`e${e.id}`} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                <span className="block text-sm font-bold">{KIND_ICON[e.kind] ?? "⚖️"} {e.title}</span>
                <span className="mt-0.5 block text-sm text-[var(--dim)]">{e.detail}</span>
                <span className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn-neon btn-press flex-1 rounded-lg px-3 py-2 text-sm font-bold"
                    aria-label={`Mark SI decision resolved: ${e.title}`}
                    onClick={async () => {
                      const r = await api.resolveSiEvent({ id: e.id, action: "resolve" });
                      setBanner(r.ok ? "Resolved — your call is recorded. SI goes back to work." : (r.error ?? "That didn't save."));
                      refresh();
                    }}
                  >
                    Resolved — my call
                  </button>
                  <button
                    type="button"
                    className="btn-press flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold"
                    aria-label={`Dismiss SI item: ${e.title}`}
                    onClick={async () => {
                      const r = await api.resolveSiEvent({ id: e.id, action: "dismiss" });
                      setBanner(r.ok ? "Dismissed — SI noted it and moved on. The underlying record is untouched." : (r.error ?? "That didn't save."));
                      refresh();
                    }}
                  >
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Public-records vetting form */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Vet before it posts — public records only</div>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Check a broker, shipper, owner, or carrier by company name + MC / USDOT, or a load by its lane and
          numbers. SI builds the official FMCSA SAFER link and flags what's missing — it never pulls private
          information, and anything that looks like personal data is refused before it's stored.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-xs font-bold text-[var(--dim)]">
            Checking a
            <select aria-label="What are you vetting" value={vetType} onChange={(e) => setVetType(e.target.value as typeof vetType)} className={inputCls}>
              <option value="broker">Broker</option>
              <option value="shipper">Shipper</option>
              <option value="owner">Owner</option>
              <option value="carrier">Carrier</option>
              <option value="load">Load</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-[var(--dim)]">
            Company / broker name
            <input aria-label="Company or broker name to vet" value={vetName} onChange={(e) => setVetName(e.target.value)} placeholder="e.g. Acme Brokerage" className={inputCls} />
          </label>
          {vetType !== "load" ? (
            <>
              <label className="block text-xs font-bold text-[var(--dim)]">
                MC number (public)
                <input aria-label="MC number to vet" value={vetMc} onChange={(e) => setVetMc(e.target.value)} placeholder="MC-______" className={inputCls} />
              </label>
              <label className="block text-xs font-bold text-[var(--dim)]">
                USDOT number (public)
                <input aria-label="USDOT number to vet" value={vetDot} onChange={(e) => setVetDot(e.target.value)} placeholder="Optional" className={inputCls} />
              </label>
            </>
          ) : (
            <>
              <label className="block text-xs font-bold text-[var(--dim)]">
                Pickup city
                <input aria-label="Load pickup city to vet" value={vetPickup} onChange={(e) => setVetPickup(e.target.value)} placeholder="e.g. Mobile" className={inputCls} />
              </label>
              <label className="block text-xs font-bold text-[var(--dim)]">
                Delivery city
                <input aria-label="Load delivery city to vet" value={vetDelivery} onChange={(e) => setVetDelivery(e.target.value)} placeholder="e.g. Dallas" className={inputCls} />
              </label>
              <label className="block text-xs font-bold text-[var(--dim)]">
                Rate $
                <input aria-label="Load rate to vet" value={vetRate} onChange={(e) => setVetRate(e.target.value)} inputMode="decimal" placeholder="e.g. 2400" className={inputCls} />
              </label>
              <label className="block text-xs font-bold text-[var(--dim)]">
                Loaded miles
                <input aria-label="Load loaded miles to vet" value={vetMiles} onChange={(e) => setVetMiles(e.target.value)} inputMode="decimal" placeholder="e.g. 800" className={inputCls} />
              </label>
              <label className="block text-xs font-bold text-[var(--dim)]">
                Weight (lbs)
                <input aria-label="Load weight in pounds to vet" value={vetWeight} onChange={(e) => setVetWeight(e.target.value)} inputMode="numeric" placeholder="e.g. 40000" className={inputCls} />
              </label>
              <label className="block text-xs font-bold text-[var(--dim)]">
                Commodity
                <input aria-label="Load commodity to vet" value={vetCommodity} onChange={(e) => setVetCommodity(e.target.value)} placeholder="e.g. Steel coils" className={inputCls} />
              </label>
            </>
          )}
        </div>
        <button
          type="button"
          className="btn-press mt-2 w-full rounded-xl border border-[var(--accent)] px-4 py-3 text-sm font-bold text-[var(--accent)] disabled:opacity-50"
          aria-label="Run the public-records vetting check"
          disabled={vetBusy}
          onClick={() => void runVet()}
        >
          {vetBusy ? "Checking public records…" : "🔎 Run the public-records check"}
        </button>
        {pastVetting.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {pastVetting.slice(0, 5).map((v) => (
              <li key={v.id} className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm">
                <span className="font-bold">{v.entityType} — {v.entityName ?? "—"}</span>{" "}
                <span className="text-[var(--dim)]">{v.verdict} · {v.decision}</span>
                {v.saferUrl && (
                  <>
                    {" · "}
                    <a href={v.saferUrl} target="_blank" rel="noreferrer" className="font-bold text-[var(--accent)] underline" aria-label={`Open the official FMCSA SAFER record for ${v.entityName ?? "this carrier"}`}>SAFER ↗</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Autonomous work log */}
        {doneEvents.length > 0 && (
          <>
            <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Work SI already did — no action needed</div>
            <ul className="mt-1.5 space-y-2">
              {doneEvents.slice(0, 10).map((e) => (
                <li key={e.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                  <span className="block text-sm font-bold">
                    {KIND_ICON[e.kind] ?? "🧠"} {e.title}
                    <span className="ml-2 text-xs font-normal text-[var(--dim)]">
                      {new Date(e.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {e.status}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-[var(--dim)]">{e.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* The rules, in stone */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">The SI Rules — set in stone {data?.rulesVersion ?? "2026-11-01"}</div>
        <ol className="mt-1.5 space-y-2">
          {(data?.rules ?? []).map((r) => (
            <li key={r.n} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
              <span className="block text-sm font-bold">{r.n}. {r.title}</span>
              <span className="mt-0.5 block text-sm text-[var(--dim)]">{r.text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-[var(--dim)]">
          Safer web checks, by construction: SI's only web-facing check is the official FMCSA SAFER snapshot link
          built from public MC / USDOT numbers — it links the federal record, never scrapes or scores it, and no
          check ever sends personal data anywhere. Road healing runs through Road learning (below): opt-in,
          device-local, and it never edits sealed records.
        </p>
      </div>
    </SiSection>
  );
}
