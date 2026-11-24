// Pins Wave 2 item 2's client homes and honesty rules:
//   (a) the ELD test-sync block shows for any manageable connection
//       that isn't revoked — its purpose is proving the sync path
//       BEFORE a real device exists, so gating it on "connected"
//       hid it exactly where it was needed (Step 0 fix);
//   (b) the paperwork block is mounted on the delivery close-out
//       in both delivery states, files/confirms through the
//       paperwork actions, and carries the honest extraction copy;
//   (c) the outward track page renders the paperwork stage.
//
// Run: bun test client/src/paperworkPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const closeoutSource = readFileSync(`${import.meta.dir}/DeliveryCloseout.tsx`, "utf8");
const panelSource = readFileSync(`${import.meta.dir}/PaperworkPanel.tsx`, "utf8");
const trackSource = readFileSync(`${import.meta.dir}/../../host/track.html`, "utf8");

describe("ELD test sync (Step 0) — visible before a real device exists", () => {
  test("the gate is canManage + not revoked, not connected/error only", () => {
    expect(appSource).toContain('hub.canManage && c.status !== "revoked"');
    expect(appSource).not.toContain('hub.canManage && (c.status === "connected" || c.status === "error")');
    expect(appSource).toContain("Run test sync (simulated device)");
    expect(appSource).toContain("For real data, use “Sync now” on a connected ELD.");
  });
});

describe("paperwork-to-pay — client wiring", () => {
  test("the block mounts on the delivery close-out", () => {
    expect(closeoutSource).toContain("LoadPaperworkBlock");
    expect(closeoutSource).toContain('from "./PaperworkPanel"');
  });

  test("intake + confirm go through the paperwork actions", () => {
    expect(panelSource).toContain(".fileLoadPaperwork");
    expect(panelSource).toContain(".confirmPaperwork");
    expect(panelSource).toContain(".getLoadPaperwork");
  });

  test("the panel states the trigger and the unconfirmed-read rule plainly", () => {
    expect(panelSource).toContain("Nothing is ever sent or billed off an unconfirmed read.");
    expect(panelSource).toContain("needs a look");
  });

  test("no money rendering in the panel — the invoice is number + status only", () => {
    expect(panelSource).not.toContain("invoice.amount");
    expect(panelSource).not.toContain("data.amount");
  });
});

describe("paperwork on the outward track page", () => {
  test("the stage renders in both page states", () => {
    expect(trackSource).toContain("paperworkHtml(info)");
    expect(trackSource).toContain("info.paperwork.stageLabel");
  });
});
