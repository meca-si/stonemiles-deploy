// Shared $/mi display + board ranking control (x's order,
// 2026-10-31: automatic $/mi on loads; boards rank by it with the
// total price alongside). Every load-bearing surface renders the
// figure through here so the wording — and the honesty rules — are
// identical everywhere: a stored-miles figure is stated plainly, a
// lane estimate is always labelled "est.", and when neither exists
// nothing renders (the $/mi is blank, never invented).

import { displayPerMile, fmtPerMile, laneEstimateFor, BOARD_SORT_OPTIONS, type BoardSortKey, type LoadMoneyLike } from "./loadRate";

/** The $/mi line for one load card: "$2.34/mi · 512 mi" from the
 *  load's own miles, or "~$2.31/mi · ~518 mi est." from the lane
 *  estimate. Renders nothing when no figure can honestly be shown. */
export function PerMileLine({
  load,
  estMiles,
  className = "text-sm font-bold text-[var(--accent)]",
}: {
  load: LoadMoneyLike;
  estMiles: number | null;
  className?: string;
}) {
  const d = displayPerMile(load, laneEstimateFor(load, estMiles));
  if (!d) return null;
  return (
    <span className={className} aria-label={d.estimated ? `Estimated rate per mile ${fmtPerMile(d.perMile)} over about ${Math.round(d.miles)} estimated miles` : `Rate per mile ${fmtPerMile(d.perMile)} over ${Math.round(d.miles)} loaded miles`}>
      {d.estimated ? "~" : ""}
      {fmtPerMile(d.perMile)}
      <span className="font-semibold text-[var(--dim)]">
        {" "}· {d.estimated ? "~" : ""}{Math.round(d.miles).toLocaleString()} mi{d.estimated ? " est." : ""}
      </span>
    </span>
  );
}

/** Board ranking control: Best $/mi (default) / Highest total /
 *  Newest. The board states what the ranking means right beside it —
 *  ranked by the same $/mi printed on each card, totals alongside. */
export function BoardSortControl({
  value,
  onChange,
  id,
}: {
  value: BoardSortKey;
  onChange: (v: BoardSortKey) => void;
  id: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]" htmlFor={id}>
        Rank by
      </label>
      <select
        id={id}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm font-semibold"
        value={value}
        onChange={(e) => onChange(e.target.value as BoardSortKey)}
        aria-label="How board loads are ranked"
      >
        {BOARD_SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {value === "perMile" && (
        <span className="text-xs text-[var(--dim)]">Highest $/mi first — total pay on every card. Loads with no $/mi yet sit at the end.</span>
      )}
      {value === "total" && <span className="text-xs text-[var(--dim)]">Biggest total pay first — $/mi on every card.</span>}
    </div>
  );
}
