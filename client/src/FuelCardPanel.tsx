// FuelCardPanel.tsx — fuel-card geofence checks (Wave 2 item 8).
//
// Mounted in the IFTA panel under the fuel log: every logged fuel
// purchase is checked against the truck's recorded position near
// its time (the server runs the evaluation — this panel renders
// states, it never computes them). A purchase far from the truck
// flags as a POSSIBLE mismatch into the exception queue with its
// evidence; the copy says "check it", never accuses, and nothing
// is declined or blocked by a flag. A purchase that can't be checked
// (no station location on file, no truck position near the time)
// says so — it is never shown as a pass.
//
// With no fuel-card partner connected, the checks run on the
// driver's logged purchases alone and the panel says exactly
// that; a connected partner's transactions run through the same
// check on the server.

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function FuelCardChecksPanel() {
  const q = useQuery({ queryKey: ["fuel-card-checks"], queryFn: () => api.getFuelCardChecks({}) });
  const data = q.data;

  return (
    <div className="mt-4 rounded-xl bg-[var(--surface2)] px-3 py-3">
      <h3 className="font-condensed text-lg font-semibold">💳 Fuel-card checks — purchases vs the truck</h3>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Each fuel purchase is compared with where the truck actually was at that time. One landing more than{" "}
        {data ? data.thresholdMi : 25} mi from the truck&apos;s recorded position flags as a{" "}
        <strong className="text-[var(--text)]">possible mismatch — check it</strong>: a station&apos;s pinned location or
        a position reading can be off, so a flag is a question, not a verdict. Nothing is ever declined, blocked, or
        changed because of one — the flag lands in your exception queue with the evidence attached.
      </p>
      {q.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">Checking your fuel purchases…</p>}
      {q.isError && (
        <p className="mt-2 text-sm text-red-300" role="alert">
          The checks didn&apos;t run — try again in a moment.
        </p>
      )}
      {data && (
        <>
          <p className="mt-2 text-xs text-[var(--dim)]">
            {data.partnerConfigured
              ? `Fuel-card partner connected (${data.partnerName ?? "card partner"}) — its transactions are checked alongside your logged purchases.`
              : "No fuel-card partner connected — checks run on your logged purchases. When a card partner is connected, its transactions run through the same check."}
            {data.partnerError ? ` The partner didn't answer just now: ${data.partnerError}` : ""}
          </p>
          {data.checks.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--dim)]">
              No fuel purchases in the last 90 days — log fuel above and the checks run here.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm">
                {data.checks.filter((c) => c.status === "match").length} checked out ·{" "}
                {data.checks.filter((c) => c.status === "not_checked").length} couldn&apos;t be checked ·{" "}
                <strong>{data.flaggedCount} flagged to check</strong>
              </p>
              <ul className="mt-2 space-y-1.5">
                {data.checks
                  .filter((c) => c.status !== "match")
                  .map((c, i) => (
                    <li
                      key={`${c.purchaseId ?? c.partnerRef ?? i}`}
                      className={`rounded-xl px-3 py-2 text-sm ${c.status === "mismatch" ? "bg-[#2c2207] text-amber-200" : "bg-[var(--surface)]"}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">
                          {c.status === "mismatch" ? "⚠ Possible mismatch — check it" : "Not checked"}
                          {c.station ? ` · ${c.station}` : ""}
                          {c.state ? `, ${c.state}` : ""}
                        </span>
                        <span className="text-xs text-[var(--dim)]">{whenLabel(c.purchasedAt)}</span>
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed">
                        {c.reason}
                        {c.gallons != null ? ` · ${c.gallons} gal` : ""}
                        {c.source === "card_partner" ? " · from your fuel-card partner" : ""}
                      </div>
                    </li>
                  ))}
              </ul>
              {data.checks.some((c) => c.status === "match") && (
                <p className="mt-2 text-xs text-[var(--dim)]">
                  Purchases that checked out aren&apos;t listed one by one — their count is above. A purchase with no
                  station location on file, or no truck position within {Math.round(data.positionMaxAgeMin / 60)} hours
                  of it, shows as “not checked” with the reason — never as a silent pass.
                </p>
              )}
            </>
          )}
          <p className="mt-2 text-xs text-[var(--dim)]">
            The check line is {data.thresholdMi} mi, against the truck&apos;s recorded position nearest the purchase
            time. Nothing here is shared with the station or the card company — the check runs on your own records,
            inside your own account.
          </p>
        </>
      )}
    </div>
  );
}
