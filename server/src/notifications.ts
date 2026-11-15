/**
 * NOTIFICATION CENTER — pure rules module (TMS completion queue
 * item 9, approved by x 2026-11-15).
 *
 * The notification center's rows are recorded by the event producers
 * themselves (chat send, broker send-door submission, credential
 * evaluation, sealed HOS warnings) through recordNotification in
 * actions.ts. Everything that can be decided without a database
 * lives here: the kinds, the per-kind dedupe policy, the title/body
 * copy, and the device-push state machine.
 *
 * STANDING RULES baked in:
 * - NO email for notifications — in-app center + future phone push
 *   only (owner decision, 2026-11-14: DM email alerts were removed;
 *   the send-door load-offer EMAIL to the fleet owner is a separate
 *   pre-existing path and is not part of this module).
 * - A load-offer notification NEVER carries the rate: the builders
 *   below are never even handed it.
 * - Device push (FCM) wires in with the Android build (see
 *   push-notifications-queue.md). Until a real sender exists in
 *   this file, push state resolves honestly to "no_devices" or
 *   "not_configured" — never "sent".
 *
 * Pure functions only. Unit-tested in notifications.test.ts.
 */

export type NotificationKind = "dm" | "load_offer" | "credential" | "hos" | "system";

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "dm",
  "load_offer",
  "credential",
  "hos",
  "system",
];

/** How a kind collapses repeat events onto existing rows:
 * - "until_read": one UNREAD row per dedupe key; repeats bump its
 *   count and refresh its copy (a burst of chat messages is one
 *   alert until the driver reads it — the same rule the old chat
 *   email alerts used).
 * - "ever": one row per dedupe key, read or not (a credential
 *   threshold nags once per card — the dismissal semantics of the
 *   credential alert engine, applied to the center).
 * - "unique": every event is its own row (each load offer is a
 *   distinct thing the desk must see). */
export type DedupePolicy = "until_read" | "ever" | "unique";

export function dedupePolicyFor(kind: NotificationKind): DedupePolicy {
  switch (kind) {
    case "dm":
    case "hos":
      return "until_read";
    case "credential":
      return "ever";
    case "load_offer":
    case "system":
      return "unique";
  }
}

/** A message preview for a notification body: whitespace-collapsed
 * and cut at a word boundary with an ellipsis, so a notification
 * never carries a whole conversation or a wall of text. */
export function previewText(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface BuiltNotification {
  title: string;
  body: string;
}

/** DM / dispatch-message notification. For a DM the title is the
 * sender; for a group the title is the group and the sender leads
 * the body. The body is a preview, never the full message. */
export function dmNotification(args: {
  senderName: string;
  groupLabel: string | null; // null = a 1:1 DM
  body: string;
  kind: string; // chat message kind: text | load | route | location
}): BuiltNotification {
  const preview =
    args.kind === "text" || args.kind === ""
      ? previewText(args.body)
      : args.kind === "load"
        ? "Shared a load"
        : args.kind === "route"
          ? "Shared a route"
          : args.kind === "location"
            ? "Shared a location"
            : previewText(args.body);
  if (args.groupLabel == null) {
    return { title: args.senderName, body: preview };
  }
  return { title: args.groupLabel, body: `${args.senderName}: ${preview}` };
}

/** Load-offer notification for the fleet owner's center. The lane
 * and the sender only — the rate is never a parameter here, so it
 * can never leak into the center (it lives in the desk, and on the
 * invoice, nowhere else). */
export function loadOfferNotification(args: {
  brokerName: string | null;
  brokerCompany: string | null;
  pickupLabel: string | null;
  deliveryLabel: string | null;
  viaDoor: boolean;
}): BuiltNotification {
  const who =
    args.brokerName || args.brokerCompany
      ? `${args.brokerName ?? ""}${args.brokerCompany ? `${args.brokerName ? " · " : ""}${args.brokerCompany}` : ""}`
      : "A broker / shipper";
  const lane =
    args.pickupLabel || args.deliveryLabel
      ? `${args.pickupLabel ?? "—"} → ${args.deliveryLabel ?? "—"}`
      : "Lane details in the desk";
  return {
    title: "New load offer in your desk inbox",
    body: `${who} — ${lane}. Open the desk to review it.`,
  };
}

/** Credential expiry notification — mirrors the credential alert
 * engine's thresholds (60 / 30 / 7 days, 0 = expired). */
export function credentialNotification(args: {
  label: string;
  threshold: number;
  daysLeft: number | null;
  expiresOn: string | null;
}): BuiltNotification {
  if (args.threshold === 0) {
    return {
      title: `${args.label} expired`,
      body: `Your ${args.label} expired${args.expiresOn ? ` on ${args.expiresOn}` : ""} — renew it before you roll; an expired credential can park the truck.`,
    };
  }
  const days = args.daysLeft ?? args.threshold;
  return {
    title: `${args.label} expires in ${days} day${days === 1 ? "" : "s"}`,
    body: `Your ${args.label} expires${args.expiresOn ? ` on ${args.expiresOn}` : ""} — ${days} day${days === 1 ? "" : "s"} left. Renew early so it never lapses on the road.`,
  };
}

const HOS_CLOCK_LABELS: Record<string, string> = {
  drive: "drive clock",
  window: "shift window",
  cycle: "cycle clock",
  break: "rest-break clock",
};

/** HOS warning notification — the same words the Drive screen's
 * warning uses, recorded into the center when the warning seals. */
export function hosNotification(args: { clock: string; thresholdMin: number }): BuiltNotification {
  const label = HOS_CLOCK_LABELS[args.clock] ?? "hours-of-service clock";
  if (args.thresholdMin <= 0) {
    return {
      title: "Hours of service — at your limit",
      body: `You are AT your ${label}. Stop as soon as it is safe.`,
    };
  }
  return {
    title: "Hours of service warning",
    body: `${args.thresholdMin} minutes left before your ${label}.`,
  };
}

// ---- Device push (FCM) — plumbing only in this build ---------------

export type PushState = "no_devices" | "not_configured" | "sent" | "failed";

export interface PushMessage {
  title: string;
  body: string;
  kind: NotificationKind;
}

/** A device-push sender. The Android build's FCM wiring provides
 * the real one; this build ships none. */
export interface PushSender {
  send(tokens: string[], msg: PushMessage): Promise<{ ok: boolean; detail: string }>;
}

/** The sender factory — THE seam the Android build fills in. It
 * returns null today even when an FCM credential is present in the
 * environment: credentials alone do not send anything, and this
 * module never claims a configured sender it does not have. When
 * the native build lands, the FCM HTTP sender is constructed here
 * from FCM_SERVICE_ACCOUNT_JSON and every state below starts
 * resolving for real. */
export function pushSenderFromEnv(_env: Record<string, string | undefined>): PushSender | null {
  return null;
}

/** The honest push outcome for a notification, given how many
 * enabled devices the user has and whether a sender exists. A
 * caller that attempted a send passes sendOk to land on
 * "sent"/"failed"; with no sender the outcome is "not_configured"
 * whenever the user HAS devices (the devices are ready; the
 * sender is what's missing), and "no_devices" when they don't. */
export function pushStateFor(args: {
  enabledDeviceCount: number;
  senderConfigured: boolean;
  sendOk?: boolean | null;
}): PushState {
  if (args.enabledDeviceCount === 0) return "no_devices";
  if (!args.senderConfigured) return "not_configured";
  if (args.sendOk == null) return "not_configured";
  return args.sendOk ? "sent" : "failed";
}

/** The one line the notification center shows about phone push —
 * written from the user's own device/push state, never aspirational. */
export function pushStatusLine(args: { enabledDeviceCount: number; senderConfigured: boolean }): string {
  if (args.senderConfigured) {
    return args.enabledDeviceCount > 0
      ? `Phone push is on for ${args.enabledDeviceCount} device${args.enabledDeviceCount === 1 ? "" : "s"}.`
      : "Phone push is ready — no device has registered yet. Devices register from the Android app.";
  }
  return args.enabledDeviceCount > 0
    ? "Phone push arrives with the Android app — your registered device(s) will start receiving these alerts then. Until then, everything lands here in the app."
    : "Phone push arrives with the Android app. Until then, every alert lands here in the app — nothing is emailed.";
}
