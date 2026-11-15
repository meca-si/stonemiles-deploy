// Pins fleet visibility + outward sharing's homes and the RATE LAW
// on the client (TMS queue item 4):
//
//   (a) the Fleet Board panel lives in its own component and is
//       mounted by BOTH desks (Owner Desk + Dispatch Desk)
//   (b) the Load Board's assign flow carries the deadhead ranking
//   (c) the delivery close-out carries the tracking-share switch,
//       and the driver app wires the share-up publish pipe
//   (d) THE RATE LAW: the outward tracking page (host/track.html)
//       and the fleet surfaces never touch invoicing, and the
//       public track page contains no money language at all —
//       the share shows route/stops/ETA/location, never a price.
//
// Run: bun test client/src/fleetVisibilityPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const fleetBoardSource = readFileSync(`${import.meta.dir}/FleetBoard.tsx`, "utf8");
const ownerDeskSource = readFileSync(`${import.meta.dir}/OwnerDesk.tsx`, "utf8");
const dispatchDeskSource = readFileSync(`${import.meta.dir}/DispatchDesk.tsx`, "utf8");
const loadBoardSource = readFileSync(`${import.meta.dir}/LoadBoard.tsx`, "utf8");
const closeoutSource = readFileSync(`${import.meta.dir}/DeliveryCloseout.tsx`, "utf8");
const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const trackPageSource = readFileSync(`${import.meta.dir}/../../host/track.html`, "utf8");

describe("fleet visibility — surface homes", () => {
  test("the Fleet Board panel reads getFleetBoard and both desks mount it", () => {
    expect(fleetBoardSource).toContain("api.getFleetBoard");
    expect(fleetBoardSource).toContain("export function FleetBoardPanel");
    expect(ownerDeskSource).toContain("<FleetBoardPanel />");
    expect(dispatchDeskSource).toContain("<FleetBoardPanel />");
  });

  test("the Load Board assign flow ranks trucks by deadhead", () => {
    expect(loadBoardSource).toContain("api.getAssignCandidates");
    expect(loadBoardSource).toContain("AssignRanking");
    expect(loadBoardSource).toContain("geocodeCity");
  });

  test("the close-out carries the tracking-share switch; the app wires the publish pipe", () => {
    expect(closeoutSource).toContain("api.getLoadShareLinks");
    expect(closeoutSource).toContain(".createLoadShareLink(");
    expect(closeoutSource).toContain(".revokeLoadShareLink(");
    expect(closeoutSource).toContain("<TrackShareBlock");
    expect(appSource).toContain(".publishFleetStatus(");
  });
});

describe("the rate law — outward surfaces carry no money", () => {
  test("the public track page talks only to getTrackInfo and names no price", () => {
    expect(trackPageSource).toContain("getTrackInfo");
    expect(trackPageSource.toLowerCase()).not.toContain("rate");
    expect(trackPageSource.toLowerCase()).not.toContain("invoice");
    expect(trackPageSource.toLowerCase()).not.toContain("amount");
  });

  test("the fleet board + ranking + share surfaces never reference invoicing", () => {
    for (const src of [fleetBoardSource, loadBoardSource, closeoutSource]) {
      expect(src).not.toContain("createInvoice");
      expect(src).not.toContain("listInvoices");
      expect(src).not.toContain("markInvoicePaid");
    }
    // The fleet payloads are shaped server-side with no money
    // fields; on the client the panel never formats a price.
    expect(fleetBoardSource).not.toContain("money(");
    expect(fleetBoardSource).not.toContain("gross");
  });
});
