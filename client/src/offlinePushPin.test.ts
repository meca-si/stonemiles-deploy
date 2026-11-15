// Pins items 7–9's client homes and honesty rules:
//   (a) offline mode — duty changes and DVIRs capture on-device
//       instead of dead-ending, the HOS clocks merge the pending
//       captures, the active load renders from its snapshot, and
//       the shared badge copy never claims a seal;
//   (b) the notification center — mounted in the More tab, badged
//       on the dock, and email-free by the standing rule;
//   (c) the ELD test sync — offered in the hub with the honest
//       limit in the copy: live sync awaits a real ELD device.
//
// Run: bun test client/src/offlinePushPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const nextSource = readFileSync(`${import.meta.dir}/NextLevel.tsx`, "utf8");
const panelSource = readFileSync(`${import.meta.dir}/NotificationsPanel.tsx`, "utf8");
const offlineSource = readFileSync(`${import.meta.dir}/offlineCapture.ts`, "utf8");
const i18nSource = readFileSync(`${import.meta.dir}/i18n.ts`, "utf8");

describe("offline mode (item 7) — client wiring", () => {
  test("the App flushes captures through the idempotent sync actions", () => {
    expect(appSource).toContain("api.syncDutyCapture");
    expect(appSource).toContain("api.syncDvirCapture");
    expect(appSource).toContain("loadCaptures()");
  });
  test("duty changes capture offline instead of dead-ending", () => {
    expect(appSource).toContain("enqueueCapture");
    expect(appSource).not.toContain("That duty change didn't save");
    expect(appSource).toContain("mergePendingDutyEvents");
  });
  test("the DVIR panel captures offline and badges pending inspections", () => {
    expect(nextSource).toContain("enqueueCapture");
    expect(nextSource).toContain("pendingDvirCaptures");
    expect(nextSource).toContain("NOT sealed yet");
  });
  test("the badge copy is the shared constant and never claims a seal", () => {
    expect(offlineSource).toContain('"Offline — will seal on reconnect"');
    expect(offlineSource).toContain("not sealed yet");
    expect(appSource).toContain("OFFLINE_BADGE");
    expect(nextSource).toContain("OFFLINE_BADGE");
  });
  test("the active load snapshot persists and renders while offline", () => {
    expect(appSource).toContain("saveActiveLoadSnapshot");
    expect(appSource).toContain("loadActiveLoadSnapshot");
    expect(appSource).toContain("offlineLoadCard");
  });
});

describe("notification center (item 9) — client wiring", () => {
  test("the More tab mounts the panel; the dock badges the unread count", () => {
    expect(appSource).toContain("<NotificationsPanel");
    expect(appSource).toContain("unreadCount");
    expect(panelSource).toContain("api.getNotifications");
    expect(panelSource).toContain(".markNotificationsRead(");
  });
  test("the panel's titles are translated", () => {
    expect(i18nSource).toContain('"notifications.title"');
    expect(i18nSource).toContain('"notifications.empty"');
    expect(panelSource).toContain('tt(lang, "notifications.title")');
  });
  test("no email anywhere in the notification surface — the standing rule", () => {
    expect(panelSource).not.toContain("sendAlertEmail");
    expect(panelSource).toContain("ever emailed");
    expect(panelSource).toContain("api.getPushDevices");
  });
});

describe("ELD test sync (item 8) — honest copy", () => {
  test("the hub offers the simulated test sync and states the live limit", () => {
    expect(appSource).toContain(".runEldTestSync(");
    expect(appSource).toContain("Run test sync (simulated device)");
    expect(appSource).toContain("Live sync still awaits a real ELD device");
  });
});
