// GlobalSearch.tsx — one search box for the caller's own world
// (Alvys-grab build): type a name, a city, a reference, or a load
// number and get the loads, drivers, and paperwork it touches —
// grouped, capped per group (the cap says so on screen), and
// carrying identity facts only. The server scopes everything to
// the caller (globalSearch action): a driver sees only their own
// records, a desk only its fleet, a broker only its own loads.
// Tapping a result routes through the host surface's own jump
// machinery (the callbacks below) — this component navigates
// nowhere by itself.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type SearchData = ApiResponse<typeof api, "globalSearch">;
type SearchResult = SearchData["groups"][number]["results"][number];

export function GlobalSearch({
  onOpenLoad,
  onOpenBoardLoad,
  onOpenDriver,
  placeholder,
}: {
  /** A load in the caller's own library (driver side). */
  onOpenLoad?: (loadId: number) => void;
  /** A board row (desk / broker side; also the fallback for loads). */
  onOpenBoardLoad?: (boardLoadId: number | null, loadId: number | null) => void;
  /** A driver in the caller's fleet (desk side). */
  onOpenDriver?: (username: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const searchQuery = useQuery({
    queryKey: ["global-search", query],
    queryFn: () => api.globalSearch({ query }),
    enabled: query.length >= 2,
  });
  const data = searchQuery.data;
  const open = (r: SearchResult) => {
    if (r.kind === "driver" && r.username) {
      onOpenDriver?.(r.username);
      return;
    }
    if (r.kind === "board_load") {
      onOpenBoardLoad?.(r.boardLoadId, r.loadId);
      return;
    }
    // load + document results land on the load itself.
    if (r.loadId != null) {
      if (onOpenLoad) onOpenLoad(r.loadId);
      else onOpenBoardLoad?.(r.boardLoadId, r.loadId);
    }
  };
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3">
      <label className="block">
        <span className="text-xs font-bold text-[var(--dim)]">🔎 SEARCH — your loads, drivers &amp; paperwork</span>
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? "Driver name, city, shipper, reference, or load #"}
          className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
        />
      </label>
      {query.length >= 2 && (
        <div className="mt-2">
          {searchQuery.isPending ? (
            <p className="text-xs text-[var(--dim)]">Searching your records…</p>
          ) : data && !data.ok ? (
            <p className="text-xs text-[var(--dim)]">{data.error}</p>
          ) : data && data.groups.length === 0 ? (
            <p className="text-xs text-[var(--dim)]">Nothing in your records matches “{query}”.</p>
          ) : (
            data?.groups.map((g) => (
              <div key={g.kind} className="mt-2">
                <div className="text-xs font-bold text-[var(--dim)]">
                  {g.label.toUpperCase()}
                  {g.capped && <span className="font-normal"> · showing the first {g.results.length} of {g.total}</span>}
                </div>
                <ul className="mt-1 space-y-1">
                  {g.results.map((r, i) => (
                    <li key={`${r.kind}:${r.loadId ?? ""}:${r.boardLoadId ?? ""}:${r.username ?? ""}:${i}`}>
                      <button
                        type="button"
                        className="w-full rounded-lg bg-[var(--surface)] px-3 py-2 text-left"
                        onClick={() => open(r)}
                      >
                        <span className="block text-sm font-semibold">{r.title}</span>
                        {r.detail && <span className="block text-xs text-[var(--dim)]">{r.detail}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
