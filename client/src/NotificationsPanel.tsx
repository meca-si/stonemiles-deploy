// STONEMILES Notification Center (TMS completion queue item 9,
// x 2026-11-15) — the in-app home for the alerts that matter:
// messages (DMs + dispatch), load offers landing in the desk inbox,
// credential expiry alerts, and HOS warnings. Rows are recorded by
// the events themselves on the server (getNotifications); this
// panel is the read side — newest first, unread badged, tap to mark
// read, one button to clear the pile.
//
// STANDING RULES kept here: notifications are IN-APP plus future
// phone push ONLY — no email is ever sent for them (owner decision,
// 2026-11-14). Device push (FCM) wires in with the Android build;
// until a real sender exists the panel prints the server's honest
// push status line verbatim — it never claims push works today.
// Mounted at the top of the More tab; the dock's More button
// carries the unread badge.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { t as tt, type Lang } from "./i18n";

type NotificationsData = ApiResponse<typeof api, "getNotifications">;
type NotificationRow = NotificationsData["notifications"][number];
type PushDevicesData = ApiResponse<typeof api, "getPushDevices">;

const KIND_ICON: Record<string, string> = {
  dm: "💬",
  load_offer: "📦",
  credential: "🪪",
  hos: "⏱️",
  system: "🔔",
};

/** Where a tap on this notification should land, when its payload
 *  names a target (2026-11-25 UX package D). The server stamps
 *  every row with refKind/refId at record time: "load" = one of
 *  the driver's saved loads, "board_load" = a board row,
 *  "chat" = a chat group id; credential alerts carry no ref and
 *  land on the credential surface by kind. Anything else (HOS,
 *  system notes, broker/dqf refs the phone has no door for) has
 *  no target — the tap just marks it read, as before. Pure and
 *  exported for its test. */
export type NotificationNav =
  | { kind: "load"; id: number }
  | { kind: "board_load"; id: number }
  | { kind: "chat"; id: number }
  | { kind: "credentials" };

export function notificationNavFor(n: Pick<NotificationRow, "kind" | "refKind" | "refId">): NotificationNav | null {
  if (n.refId != null && n.refKind === "load") return { kind: "load", id: n.refId };
  if (n.refId != null && n.refKind === "board_load") return { kind: "board_load", id: n.refId };
  if (n.refId != null && n.refKind === "chat") return { kind: "chat", id: n.refId };
  if (n.kind === "credential") return { kind: "credentials" };
  return null;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function NotificationItem({
  n,
  onRead,
  onNavigate,
}: {
  n: NotificationRow;
  onRead: (id: number) => void;
  /** Fires with the row's nav target when the host wired a door
   *  for it; null when this row names nothing tappable-through. */
  onNavigate: (nav: NotificationNav) => void;
}) {
  const nav = notificationNavFor(n);
  return (
    <li
      className={`rounded-lg px-3 py-2.5 text-sm ${n.read ? "bg-[var(--surface)]" : "border border-[var(--accent)] bg-[var(--surface)]"}`}
    >
      <button
        type="button"
        className="block w-full text-left"
        aria-label={nav ? `${n.title} — tap to open` : n.read ? n.title : `${n.title} — unread, tap to mark read`}
        onClick={() => {
          if (!n.read) onRead(n.id);
          if (nav) onNavigate(nav);
        }}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">
            <span aria-hidden>{KIND_ICON[n.kind] ?? "🔔"}</span> {n.title}
            {n.count > 1 && (
              <span className="ml-1.5 rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[11px] font-bold text-[var(--accent)]">
                ×{n.count}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--dim)]">{timeLabel(n.updatedAt)}</span>
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--dim)]">{n.body}</span>
        {!n.read && (
          <span className="mt-1 block text-[11px] font-bold text-[var(--accent)]">
            {nav ? "● Unread — tap to open" : "● Unread — tap to mark read"}
          </span>
        )}
        {n.read && nav && <span className="mt-1 block text-[11px] font-bold text-[var(--dim)]">Tap to open →</span>}
      </button>
    </li>
  );
}

export function NotificationsPanel({
  lang = "en",
  onOpenLoad,
  onOpenBoardLoad,
  onOpenChat,
  onOpenCredentials,
}: {
  lang?: Lang;
  /** A notification naming one of the driver's saved loads. */
  onOpenLoad?: (loadId: number) => void;
  /** A notification naming a board row (an assigned load offer). */
  onOpenBoardLoad?: (boardLoadId: number) => void;
  /** A DM / chat notification — the chat group it names. */
  onOpenChat?: (groupId: number) => void;
  /** A credential-expiry alert — lands on the credentials surface. */
  onOpenCredentials?: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.getNotifications({ limit: 50 }),
    refetchInterval: 60_000,
  });
  const devicesQuery = useQuery({
    queryKey: ["push-devices"],
    queryFn: () => api.getPushDevices({}),
  });
  const data = query.data;
  const unread = data?.unreadCount ?? 0;
  // A failed mark-read used to be swallowed whole — the row just
  // stayed unread with no word (2026-11-25 UX package E). Now the
  // failure shows as a line under the header.
  const [readError, setReadError] = useState("");

  const markRead = (ids: number[] | "all") => {
    void api
      .markNotificationsRead(ids === "all" ? { all: true } : { ids })
      .then(() => {
        setReadError("");
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      })
      .catch(() => setReadError("Couldn't mark that read — check your connection and tap again."));
  };

  const navigate = (nav: NotificationNav) => {
    if (nav.kind === "load") onOpenLoad?.(nav.id);
    else if (nav.kind === "board_load") onOpenBoardLoad?.(nav.id);
    else if (nav.kind === "chat") onOpenChat?.(nav.id);
    else onOpenCredentials?.();
  };

  // The registered-device list below is informational: the server
  // only ever returns a token's last 4, and unregistering needs the
  // full token — which only the registering device itself holds
  // (that control ships with the Android build's registration flow).

  return (
    <section aria-label="Notification center" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-condensed text-xl font-bold">
          {tt(lang, "notifications.title")}
          {unread > 0 && (
            <span className="ml-2 rounded-full bg-[var(--danger)] px-2 py-0.5 align-middle text-xs font-bold text-white" aria-label={`${unread} unread`}>
              {unread}
            </span>
          )}
        </h2>
        <button
          type="button"
          disabled={unread === 0}
          className="btn-press rounded-full bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          aria-label="Mark all notifications read"
          onClick={() => markRead("all")}
        >
          Mark all read
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Messages, load offers, credential alerts, and hours-of-service warnings land here. Nothing here is
        ever emailed — this center (and phone push, when it arrives) is the alert.
      </p>
      {readError && (
        <p role="alert" className="mt-2 text-sm font-semibold text-[var(--danger)]">{readError}</p>
      )}

      {query.isLoading && <p className="mt-2 text-sm text-[var(--dim)]">Loading your alerts…</p>}
      {query.isError && (
        <p className="mt-2 text-sm font-semibold text-[var(--danger)]">
          Couldn't load your alerts — nothing was changed. Reopen this tab to retry.
        </p>
      )}

      {data && data.notifications.length === 0 && (
        <p className="mt-2 rounded-lg bg-[var(--surface2)] px-3 py-2.5 text-sm text-[var(--dim)]">
          {tt(lang, "notifications.empty")}
        </p>
      )}
      {data && data.notifications.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {data.notifications.map((n) => (
            <NotificationItem key={n.id} n={n} onRead={(id) => markRead([id])} onNavigate={navigate} />
          ))}
        </ul>
      )}

      {data && (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">📱 Phone push</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]" role="status">
            {data.push.statusLine}
          </p>
          {devicesQuery.data && devicesQuery.data.devices.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-xs text-[var(--dim)]">
              {devicesQuery.data.devices.map((d: PushDevicesData["devices"][number], i: number) => (
                <li key={i}>
                  {d.platform === "android" ? "🤖" : "🍎"} {d.platform} device ····{d.tokenLast4} ·{" "}
                  {d.enabled ? "alerts on" : "alerts off"}
                  {d.lastSeenAt ? ` · last seen ${timeLabel(d.lastSeenAt)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
