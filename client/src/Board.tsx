// STONEMILES Board (Pass 4) — ONE fixed board for every driver.
//
// Owner's design law: the board has NO customization at all. The areas
// below are the fixed set (mirrored server-side in actions.ts BOARD_AREAS
// — the server rejects any other area), the layout is the same for every
// user, and there are no board settings, themes, or custom fields
// anywhere. Drivers read to improve, post their own structured writes,
// and update their own posts (marked "updated"); nobody edits another
// driver's post.
//
// Posts are structured, thesis-style: title, body, area, date/time
// (auto-stamped + sealed server-side), location as CITY + STATE only
// (driver-entered, or GPS-derived and labelled — never a precise
// address, never raw coordinates), plus the area's detail fields
// (miles reached on Milestones posts, one detail line on any post).
//
// Referral levels (locked 2026-10-25): authors carry their referral
// level on every post — Dispatcher (🎧, 5+ active referrals), Fleet
// Builder (🏗️, 15+), and Road Captain (👑, 40+) each show their OWN
// distinct badge; Spotter (entry level) shows none. Road Captains also
// hold the featured profile slot rendered above the posts.
//
// Reader actions: like (one per driver, removable), share (the app's
// share pattern, state-level info only), and Gift $STONER — present
// and honestly labelled "when available", performing NO transfer. It
// activates only when $STONER is live and the owner gives the separate
// on-chain go-live word (same gate as the swap). Points are never
// giftable.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { US_STATES } from "./NextLevel";
import { referralBadgeFor } from "./referralLevels";

export const BOARD_AREAS = [
  "STONEMILES",
  "Safety Lessons",
  "Fuel & Money Tips",
  "Road Stories",
  "Shout-Outs",
] as const;
type BoardArea = (typeof BOARD_AREAS)[number];

type BoardPost = ApiResponse<typeof api, "listBoardPosts">["posts"][number];

const AREA_HINTS: Record<BoardArea, string> = {
  STONEMILES: "A number you hit — miles, years, safe streaks. Put the miles in the Miles reached field.",
  "Safety Lessons": "Something the road taught you that could keep another driver safe.",
  "Fuel & Money Tips": "A fuel, toll, or money move that actually saved you something — with the detail.",
  "Road Stories": "The run, the weather, the save — tell it straight, city and state on it.",
  "Shout-Outs": "Credit where it's due — a driver, a dispatcher, a shop that did right by you.",
};

const INPUT =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-3 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";

type PostDraft = {
  title: string;
  body: string;
  area: BoardArea;
  city: string;
  state: string;
  locationSource: "driver_entered" | "gps_derived";
  milesReached: string;
  detailText: string;
};

const EMPTY_DRAFT: PostDraft = {
  title: "",
  body: "",
  area: "STONEMILES",
  city: "",
  state: "",
  locationSource: "driver_entered",
  milesReached: "",
  detailText: "",
};

function draftFromPost(p: BoardPost): PostDraft {
  return {
    title: p.title,
    body: p.body,
    // Posts stored before the rename carry the legacy "Milestones" area;
    // anything unrecognized defaults to the renamed STONEMILES area.
    area: (BOARD_AREAS as readonly string[]).includes(p.area) ? (p.area as BoardArea) : "STONEMILES",
    city: p.city,
    state: p.state,
    locationSource: p.locationSource === "gps_derived" ? "gps_derived" : "driver_entered",
    milesReached: p.milesReached != null ? String(p.milesReached) : "",
    detailText: p.detailText ?? "",
  };
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Share text for a post — state-level info only, same privacy rule as
 *  Verify-Anywhere: no precise location, no wallet data, ever. */
function shareTextFor(p: BoardPost): string {
  const lines = [
    `🏆 STONEMILES board — ${p.area}`,
    `${p.title}`,
    `by ${p.displayName} (@${p.username})`,
    `${p.city}, ${p.state} · ${fmtWhen(p.createdAt)}${p.edited ? ` · updated ${fmtWhen(p.updatedAt)}` : ""}`,
  ];
  if (p.milesReached != null) lines.push(`Miles reached: ${p.milesReached.toLocaleString()} mi`);
  if (p.detailText) lines.push(p.detailText);
  lines.push("", p.body);
  return lines.join("\n");
}

async function shareOut(title: string, text: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, text });
      return "shared";
    }
  } catch {
    return "failed"; // user cancelled the share sheet
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

function PostForm({
  draft,
  setDraft,
  pos,
  setBanner,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  draft: PostDraft;
  setDraft: (d: PostDraft) => void;
  pos: { lat: number; lon: number } | null;
  setBanner: (s: string | null) => void;
  submitLabel: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const [gpsBusy, setGpsBusy] = useState(false);
  const useGps = () => {
    if (!pos) {
      setBanner("No GPS fix yet — GPS is automatic; wait for a fix, or type the city and state.");
      return;
    }
    setGpsBusy(true);
    void fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pos.lat.toFixed(5)}&lon=${pos.lon.toFixed(5)}`,
      { headers: { Accept: "application/json" } },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const addr = (data as { address?: Record<string, string> } | null)?.address ?? {};
        const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? "";
        const state = addr.state ?? "";
        if (city && state) {
          setDraft({ ...draft, city, state, locationSource: "gps_derived" });
          setBanner(`Location set from your GPS fix: ${city}, ${state} — city and state only, nothing more precise is stored.`);
        } else {
          setBanner("GPS found you, but the map data there has no city/state — type them in instead.");
        }
      })
      .catch(() => setBanner("Couldn't read a city/state from GPS — type them in instead."))
      .finally(() => setGpsBusy(false));
  };
  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL} htmlFor="board-title">Title</label>
        <input
          id="board-title"
          className={INPUT}
          value={draft.title}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="e.g. 500,000 safe miles"
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="board-area">Area</label>
        <select
          id="board-area"
          className={INPUT}
          value={draft.area}
          onChange={(e) => setDraft({ ...draft, area: e.target.value as BoardArea })}
        >
          {BOARD_AREAS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--dim)]">{AREA_HINTS[draft.area]}</p>
      </div>
      <div>
        <label className={LABEL} htmlFor="board-body">Your write</label>
        <textarea
          id="board-body"
          className={INPUT}
          rows={4}
          maxLength={2000}
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder="What happened, what you learned, what it took — the details that help the next driver."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="board-city">City</label>
          <input
            id="board-city"
            className={INPUT}
            value={draft.city}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, city: e.target.value, locationSource: "driver_entered" })}
            placeholder="e.g. Mobile"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="board-state">State</label>
          <select
            id="board-state"
            className={INPUT}
            value={draft.state}
            onChange={(e) => setDraft({ ...draft, state: e.target.value, locationSource: draft.locationSource === "gps_derived" ? "gps_derived" : "driver_entered" })}
          >
            <option value="">Pick a state…</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2 text-sm font-bold disabled:opacity-50"
          aria-label="Use my GPS position for the city and state"
          disabled={gpsBusy}
          onClick={useGps}
        >
          {gpsBusy ? "Finding…" : "📍 Use my GPS city/state"}
        </button>
        <span className="text-xs text-[var(--dim)]">
          {draft.locationSource === "gps_derived"
            ? "Location source: GPS-derived (city + state only)."
            : "Location source: entered by you. City + state only — never a street address."}
        </span>
      </div>
      {draft.area === "STONEMILES" && (
        <div>
          <label className={LABEL} htmlFor="board-miles">Miles reached</label>
          <input
            id="board-miles"
            className={INPUT}
            inputMode="numeric"
            value={draft.milesReached}
            onChange={(e) => setDraft({ ...draft, milesReached: e.target.value })}
            placeholder="e.g. 500000"
          />
        </div>
      )}
      <div>
        <label className={LABEL} htmlFor="board-detail">Detail (optional)</label>
        <input
          id="board-detail"
          className={INPUT}
          maxLength={200}
          value={draft.detailText}
          onChange={(e) => setDraft({ ...draft, detailText: e.target.value })}
          placeholder={
            draft.area === "Safety Lessons"
              ? "e.g. The lesson: check the fifth wheel twice in the rain"
              : draft.area === "Fuel & Money Tips"
                ? "e.g. Saved $41 skipping the interstate stop in Georgia"
                : draft.area === "Shout-Outs"
                  ? "e.g. To: Dana at the Mobile yard — thank you"
                  : "e.g. No at-fault accidents, no tickets"
          }
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-neon flex-1 rounded-xl py-3 font-bold text-black disabled:opacity-50"
          aria-label={submitLabel}
          disabled={busy}
          onClick={onSubmit}
        >
          {busy ? "Posting…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-4 py-3 font-bold"
            aria-label="Cancel editing this post"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function MilestonesBoardPanel({
  setBanner,
  pos,
  onViewProfile,
}: {
  setBanner: (s: string | null) => void;
  pos: { lat: number; lon: number } | null;
  onViewProfile: (username: string) => void;
}) {
  const queryClient = useQueryClient();
  const [areaFilter, setAreaFilter] = useState<BoardArea | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<PostDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<PostDraft>(EMPTY_DRAFT);

  const postsQuery = useQuery({
    queryKey: ["board-posts", areaFilter],
    queryFn: () => api.listBoardPosts({ area: areaFilter, limit: 50 }),
  });
  const posts = postsQuery.data?.posts ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["board-posts"] });

  const createMut = useMutation({
    mutationFn: (d: PostDraft) =>
      api.createBoardPost({
        title: d.title.trim(),
        body: d.body.trim(),
        area: d.area,
        city: d.city.trim(),
        state: d.state.trim(),
        locationSource: d.locationSource,
        milesReached: d.milesReached.trim() ? Number(d.milesReached.replace(/[^0-9.]/g, "")) || null : null,
        detailText: d.detailText.trim() || null,
      }),
    onSuccess: () => {
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      invalidate();
      setBanner("Posted to the STONEMILES Board — stamped and sealed into the records.");
    },
    onError: () => setBanner("Couldn't post that — check the title, write, city, and state, then try again."),
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: number; d: PostDraft }) =>
      api.updateBoardPost({
        id: args.id,
        title: args.d.title.trim(),
        body: args.d.body.trim(),
        area: args.d.area,
        city: args.d.city.trim(),
        state: args.d.state.trim(),
        locationSource: args.d.locationSource,
        milesReached: args.d.milesReached.trim() ? Number(args.d.milesReached.replace(/[^0-9.]/g, "")) || null : null,
        detailText: args.d.detailText.trim() || null,
      }),
    onSuccess: (r) => {
      if (r.ok) {
        setEditingId(null);
        invalidate();
        setBanner("Post updated — the board shows it marked “updated” with the new time.");
      } else {
        setBanner(r.error ?? "Couldn't update that post.");
      }
    },
    onError: () => setBanner("Couldn't update that post — try again."),
  });

  const likeMut = useMutation({
    mutationFn: (args: { postId: number; like: boolean }) => api.toggleBoardLike(args),
    onSuccess: (r) => {
      if (!r.ok) setBanner(r.error ?? "Couldn't save that like.");
      invalidate();
    },
    onError: () => setBanner("Couldn't save that like — try again."),
  });

  const validDraft = (d: PostDraft) =>
    d.title.trim().length > 0 && d.body.trim().length > 0 && d.city.trim().length > 0 && d.state.trim().length > 0;

  return (
    <section className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4" aria-label="STONEMILES Board">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-condensed text-2xl font-bold">🏆 STONEMILES Board</h3>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Every driver reads and posts here. Read to improve, post your own writes, update your own posts.
          </p>
        </div>
        <button
          type="button"
          className="btn-neon shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-black"
          aria-label={showForm ? "Close the new post form" : "Write a new board post"}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "✕ Close" : "✍️ Post"}
        </button>
      </div>

      <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--dim)]">
        One fixed board for everybody — same areas, same layout, no customization, no settings. Posts are
        structured on purpose: a title, your write, the area, the date &amp; time (stamped and sealed when you
        post), and the city + state it happened in.
      </p>
      <p className="mt-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs leading-relaxed" role="note">
        🔒 <strong>Your DMs are yours — nobody else can read them.</strong>{" "}
        <span className="text-[var(--dim)]">
          Not owners, not admins, not other drivers. Personal DMs are between the two drivers only. Company
          chats are company business and company-visible by design — DMs never are.
        </span>
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Board areas">
        <button
          type="button"
          aria-label="Show posts from all areas"
          aria-pressed={areaFilter == null}
          onClick={() => setAreaFilter(null)}
          className={`rounded-full px-3 py-2 text-xs font-bold ${areaFilter == null ? "bg-[var(--accent)] text-black" : "bg-[var(--surface2)] border border-[var(--border)]"}`}
        >
          All areas
        </button>
        {BOARD_AREAS.map((a) => (
          <button
            key={a}
            type="button"
            aria-label={`Show posts in ${a}`}
            aria-pressed={areaFilter === a}
            onClick={() => setAreaFilter(areaFilter === a ? null : a)}
            className={`rounded-full px-3 py-2 text-xs font-bold ${areaFilter === a ? "bg-[var(--accent)] text-black" : "bg-[var(--surface2)] border border-[var(--border)]"}`}
          >
            {a}
          </button>
        ))}
      </div>

      {(postsQuery.data?.featuredCaptains?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-2xl border border-[var(--accent)] bg-[var(--surface2)] px-3.5 py-3" aria-label="Featured Road Captains">
          <div className="font-condensed text-lg font-bold">👑 Featured — Road Captains</div>
          <p className="mt-0.5 text-xs text-[var(--dim)]">
            The featured profile slot is earned at 40+ active referrals — the top referral level. Uncapped: every Road Captain is featured.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {postsQuery.data!.featuredCaptains.map((c) => (
              <button
                key={c.username}
                type="button"
                className="rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-bold text-black"
                aria-label={`View featured Road Captain profile of ${c.username}`}
                onClick={() => onViewProfile(c.username)}
              >
                👑 {c.displayName} @{c.username} · {c.activeReferrals} active referrals
              </button>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="mt-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--surface)] p-3">
          <div className="mb-2 font-condensed text-lg font-bold">New post</div>
          <PostForm
            draft={draft}
            setDraft={setDraft}
            pos={pos}
            setBanner={setBanner}
            submitLabel="POST TO THE BOARD"
            busy={createMut.isPending}
            onSubmit={() => {
              if (!validDraft(draft)) {
                setBanner("Every post needs a title, your write, a city, and a state — that's the board's structure.");
                return;
              }
              createMut.mutate(draft);
            }}
          />
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        {postsQuery.isPending && <p className="text-sm text-[var(--dim)]">Loading the board…</p>}
        {!postsQuery.isPending && posts.length === 0 && (
          <p className="rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">
            {areaFilter
              ? `No posts in ${areaFilter} yet. The board starts empty — be the first to write one.`
              : "No posts yet — the board starts empty, with nothing made up on it. Be the first to post a milestone, beautiful stoner — the family board lights up from here."}
          </p>
        )}
        {posts.map((p) => (
          <article key={p.id} className="rounded-2xl bg-[var(--surface2)] border border-[var(--border)] px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]">
                {p.area}
              </span>
              <span className="text-right text-[11px] text-[var(--dim)]">
                {fmtWhen(p.createdAt)}
                {p.edited && <span className="block font-semibold text-[var(--text)]">updated {fmtWhen(p.updatedAt)}</span>}
              </span>
            </div>
            <h4 className="mt-2 font-condensed text-xl font-bold leading-tight">{p.title}</h4>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="text-sm font-bold"
                aria-label={`View profile of ${p.username}`}
                onClick={() => onViewProfile(p.username)}
              >
                {p.displayName} <span className="font-normal text-[var(--dim)]">@{p.username}</span>
              </button>
              {(() => {
                const b = referralBadgeFor(p.referralLevelKey);
                return b ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${b.className}`}>
                    {b.emoji} {b.label}
                  </span>
                ) : null; // Spotter authors carry no badge
              })()}
            </div>
            <div className="mt-1 text-xs text-[var(--dim)]">
              📍 {p.city}, {p.state}
              {p.locationSource === "gps_derived" ? " · location from GPS (city/state only)" : " · location entered by the driver"}
            </div>
            {p.milesReached != null && (
              <div className="mt-1.5 text-sm font-bold">🛣️ Miles reached: {p.milesReached.toLocaleString()} mi</div>
            )}
            {p.detailText && <div className="mt-1 text-sm">{p.detailText}</div>}
            <p className="mt-1.5 whitespace-pre-line text-[15px] leading-snug">{p.body}</p>
            {p.chainHash && (
              <div className="mt-1.5 break-all font-mono text-[10px] text-[var(--dim)]">sealed · {p.chainHash.slice(0, 16)}…</div>
            )}

            {editingId === p.id ? (
              <div className="mt-3 rounded-xl bg-[var(--surface)] p-3">
                <div className="mb-2 font-condensed text-lg font-bold">Update your post</div>
                <PostForm
                  draft={editDraft}
                  setDraft={setEditDraft}
                  pos={pos}
                  setBanner={setBanner}
                  submitLabel="SAVE UPDATE"
                  busy={updateMut.isPending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={() => {
                    if (!validDraft(editDraft)) {
                      setBanner("Every post needs a title, your write, a city, and a state — that's the board's structure.");
                      return;
                    }
                    updateMut.mutate({ id: p.id, d: editDraft });
                  }}
                />
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 text-xs font-bold ${p.iLiked ? "bg-[var(--accent)] text-black" : "bg-[var(--surface)] border border-[var(--border)]"}`}
                  aria-label={p.iLiked ? `Remove your like from post ${p.id}` : `Like post ${p.id}`}
                  aria-pressed={p.iLiked}
                  onClick={() => likeMut.mutate({ postId: p.id, like: !p.iLiked })}
                >
                  ❤️ {p.likeCount} {p.likeCount === 1 ? "like" : "likes"}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                  aria-label={`Share post ${p.id}`}
                  onClick={() => {
                    void shareOut(`STONEMILES board — ${p.title}`, shareTextFor(p)).then((r) => {
                      if (r === "shared") setBanner("Shared — city and state only, like everything the app sends out.");
                      else if (r === "copied") setBanner("Post copied — paste it anywhere. City and state only.");
                    });
                  }}
                >
                  📤 Share
                </button>
                <button
                  type="button"
                  disabled
                  className="rounded-lg bg-[var(--surface)] border border-dashed border-[var(--border)] px-3 py-2 text-xs font-bold opacity-70"
                  aria-label={`Gift $STONER for post ${p.id} — when available`}
                  title="Gifting activates when $STONER is live — no transfer happens today."
                >
                  🎁 Gift $STONER — when available
                </button>
                {p.isMine && (
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold"
                    aria-label={`Update my post ${p.id}`}
                    onClick={() => {
                      setEditingId(p.id);
                      setEditDraft(draftFromPost(p));
                    }}
                  >
                    ✏️ Update my post
                  </button>
                )}
              </div>
            )}
            <p className="mt-2 text-[11px] text-[var(--dim)]">
              Gifting turns on when $STONER is live and the owner gives the go-live word — today the button
              moves nothing, and Points are never giftable.
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
