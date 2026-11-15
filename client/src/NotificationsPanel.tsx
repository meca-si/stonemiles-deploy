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

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function NotificationItem({
  n,
  onRead,
}: {
  n: NotificationRow;
  onRead: (id: number) => void;
}) {
  return (
    <li
      className={`rounded-lg px-3 py-2.5 text-sm ${n.read ? "bg-[var(--surface)]" : "border border-[var(--accent)] bg-[var(--surface)]"}`}
    >
      <button
        type="button"
        className="block w-full text-left"
        aria-label={n.read ? n.title : `${n.title} — unread, tap to mark read`}
        onClick={() => {
          if (!n.read) onRead(n.id);
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
        {!n.read && <span className="mt-1 block text-[11px] font-bold text-[var(--accent)]">● Unread — tap to mark read</span>}
      </button>
    </li>
  );
}

export function NotificationsPanel({ lang = "en" }: { lang?: Lang }) {
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

  const markRead = (ids: number[] | "all") => {
    void api
      .markNotificationsRead(ids === "all" ? { all: true } : { ids })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      })
      .catch(() => undefined);
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
            <NotificationItem key={n.id} n={n} onRead={(id) => markRead([id])} />
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
