// Pins the anchor-reveal registry the UI cleanup pass (2026-11-15)
// hangs its tab/fold deep links on: a jump names an anchor, the
// section that owns it opens, then the scroll lands.
// Run: bun test client/src/anchorReveal.test.ts
import { describe, expect, test } from "bun:test";
import { onAnchorReveal, revealAnchor } from "./anchorReveal";

describe("anchor reveal registry", () => {
  test("an unregistered anchor reveals nothing", () => {
    expect(revealAnchor("no-such-anchor")).toBe(0);
  });

  test("a registered opener runs on reveal", () => {
    let opened = 0;
    const off = onAnchorReveal("doc-expiry", () => { opened++; });
    expect(revealAnchor("doc-expiry")).toBe(1);
    expect(opened).toBe(1);
    off();
  });

  test("an unregistered opener no longer runs", () => {
    let opened = 0;
    const off = onAnchorReveal("owed-board", () => { opened++; });
    off();
    expect(revealAnchor("owed-board")).toBe(0);
    expect(opened).toBe(0);
  });

  test("multiple owners of one anchor all run (fold inside a tab)", () => {
    const seen: string[] = [];
    const offA = onAnchorReveal("tax-records", () => { seen.push("tab"); });
    const offB = onAnchorReveal("tax-records", () => { seen.push("fold"); });
    expect(revealAnchor("tax-records")).toBe(2);
    expect(seen).toEqual(["tab", "fold"]);
    offA();
    offB();
  });

  test("revealing one anchor does not open another's section", () => {
    let opened = 0;
    const off = onAnchorReveal("permits", () => { opened++; });
    revealAnchor("dvir-checklists");
    expect(opened).toBe(0);
    off();
  });

  test("a section registering just after its reveal still opens (the jump mounted it)", () => {
    // The jump fires the reveal in the same tick it switches tabs —
    // the target section registers a moment later and must still open.
    expect(revealAnchor("late-fold")).toBe(0);
    let opened = 0;
    const off = onAnchorReveal("late-fold", () => { opened++; });
    expect(opened).toBe(1);
    off();
  });
});
