// Pins the Wave 2 item 9 client wiring (home-time guarantee +
// retention):
//
//   - LoadBoard claim / assign / accept / reassign all run
//     through actHt and pass homeTimeOverride to the server —
//     the override box (warning math + reason field + "Override
//     & bind it") renders per row from htBox state.
//   - OpenBoard's claim passes homeTimeOverride (null first, the
//     reason on override) and renders its own warning box.
//   - HomeTimePanel carries the driver's card, the fleet board,
//     and the pulse block; the fleet surface NEVER renders a
//     driver's pulse note or answers (the server doesn't send
//     them there — this pins that the panel doesn't reach for
//     them either).
//   - Mounts: MyHomeTimeCard in MoneyFlow after MyDqfCard;
//     FleetHomeTimePanel in OwnerDesk + DispatchDesk after
//     FleetDqfPanel.
//
// Run: bun test client/src/homeTimePin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const loadBoard = readFileSync(`${import.meta.dir}/LoadBoard.tsx`, "utf8");
const openBoard = readFileSync(`${import.meta.dir}/OpenBoard.tsx`, "utf8");
const panel = readFileSync(`${import.meta.dir}/HomeTimePanel.tsx`, "utf8");
const money = readFileSync(`${import.meta.dir}/MoneyFlow.tsx`, "utf8");
const ownerDesk = readFileSync(`${import.meta.dir}/OwnerDesk.tsx`, "utf8");
const dispatchDesk = readFileSync(`${import.meta.dir}/DispatchDesk.tsx`, "utf8");

describe("LoadBoard home-time override wiring", () => {
  test("all four binding paths pass homeTimeOverride through actHt", () => {
    expect(loadBoard).toContain("homeTimeOverride: ov");
    expect(loadBoard).toContain("api.claimBoardLoad({ id: r.id, homeTimeOverride: ov })");
    expect(loadBoard).toContain("api.acceptAssignedLoad({ id: r.id, homeTimeOverride: ov })");
    expect(loadBoard.split("api.assignBoardLoad({ id: r.id, targetUsername: pick, homeTimeOverride: ov })").length - 1).toBe(2);
  });

  test("the warning state opens the override box and binds nothing itself", () => {
    expect(loadBoard).toContain("res.homeTimeWarning");
    expect(loadBoard).toContain("setHtBox({");
    expect(loadBoard).toContain("Home-time warning — this load is NOT bound");
    expect(loadBoard).toContain("Override &amp; bind it");
    expect(loadBoard).toContain("htBox.retry(htBox.reason.trim())");
  });
});

describe("OpenBoard home-time override wiring", () => {
  test("claim passes the override (null first) and renders the box", () => {
    expect(openBoard).toContain("claimOpenBoardLoad({ id: r.id, homeTimeOverride: null })");
    expect(openBoard).toContain("homeTimeOverride: { reason: htBox.reason.trim() }");
    expect(openBoard).toContain("Home-time warning — this load is NOT claimed");
    expect(openBoard).toContain("Override &amp; claim it");
  });
});

describe("HomeTimePanel surfaces", () => {
  test("the three surfaces exist over the real actions", () => {
    expect(panel).toContain("export function MyHomeTimeCard()");
    expect(panel).toContain("export function FleetHomeTimePanel()");
    expect(panel).toContain("api.getHomeTime(");
    expect(panel).toContain("api.getFleetHomeTime(");
    expect(panel).toContain("api.setHomeTimeCommitment(");
    expect(panel).toContain(".voidHomeTimeCommitment(");
    expect(panel).toContain(".answerPulse(");
    expect(panel).toContain(".dismissPulse(");
  });

  test("hit-rate copy is counts from sealed records — never a percentage", () => {
    expect(panel).toContain("from sealed records");
    expect(panel).toContain("kept {hr.kept}");
    expect(panel).not.toContain("%");
  });

  test("the fleet aggregate hides averages below the respondent floor", () => {
    expect(panel).toContain("Averages stay hidden until");
    expect(panel).toContain("data.pulse.averages == null");
    expect(panel).toContain("data.pulse.averages != null");
  });

  test("pulse answers render only in the driver's own block", () => {
    // myAnswers is read exactly once — inside PulseBlock, which
    // MyHomeTimeCard renders with the SELF view's data. The
    // fleet components never touch myAnswers / myNote at all.
    expect(panel.split("myAnswers").length - 1).toBe(1);
    const fleetIdx = panel.indexOf("export function FleetHomeTimePanel()");
    const fleetBody = panel.slice(fleetIdx);
    expect(fleetBody).not.toContain("myAnswers");
    expect(fleetBody).not.toContain("myNote");
    const viewIdx = panel.indexOf("function DriverHomeTimeView");
    const viewBody = panel.slice(viewIdx, fleetIdx);
    expect(viewBody).not.toContain("myAnswers");
    expect(viewBody).not.toContain("myNote");
  });
});

describe("mounts", () => {
  test("MoneyFlow mounts the driver's card after the DQF card", () => {
    expect(money).toContain('import { MyHomeTimeCard } from "./HomeTimePanel";');
    expect(money.indexOf("<MyDqfCard />")).toBeGreaterThan(-1);
    expect(money.indexOf("<MyHomeTimeCard />")).toBeGreaterThan(money.indexOf("<MyDqfCard />"));
  });

  test("both desks mount the fleet panel after the DQF panel", () => {
    for (const src of [ownerDesk, dispatchDesk]) {
      expect(src).toContain('import { FleetHomeTimePanel } from "./HomeTimePanel";');
      expect(src.indexOf("<FleetDqfPanel />")).toBeGreaterThan(-1);
      expect(src.indexOf("<FleetHomeTimePanel />")).toBeGreaterThan(src.indexOf("<FleetDqfPanel />"));
    }
  });
});
