// exploreDeadlinePin.test.ts — source pins for the Explore chips'
// overall load deadline (Parking pins hang, verified live
// 2026-11-16: the Parking chip sat on "Loading pins from the map
// data…" indefinitely). The two-rung ladder's rungs are capped
// individually (server race ~45 s; direct chain up to 4 × 20 s)
// but the stack had NO total budget and NO timeout state, and
// Parking's query is the heaviest of the chips — so a sick
// Overpass night stacked ~2 minutes of busy note. These pins lock
// the fix: both rungs inside one load promise raced against a
// single deadline (the speed-limit ladder's raceDeadline, whose
// resolve-null-on-timeout behavior is unit-tested in
// speedLimit.test.ts), an honest timeout state on the null
// branch, and the busy flag cleared in the finally on every exit
// path — success, empty, error, and timeout alike.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(import.meta.dir, rel), "utf8");

const app = read("App.tsx");

describe("Explore chip load — one overall deadline, honest timeout state", () => {
  test("both rungs live inside the one load promise the deadline races", () => {
    expect(app).toContain("const loadElements = async (): Promise<PoiElement[]> => {");
    expect(app).toContain("const res = await api.getExplorePois({ lat: c.lat, lon: c.lon, category: cat });");
    expect(app).toContain("const data = (await overpass(q, 35000)) as { elements?: PoiElement[] };");
    expect(app).toContain("const EXPLORE_LOAD_DEADLINE_MS = 55_000;");
    expect(app).toContain("const elements = await raceDeadline(loadElements(), EXPLORE_LOAD_DEADLINE_MS);");
  });

  test("a deadline run-out (null) lands the honest taking-too-long note, distinct from the failure note", () => {
    expect(app).toContain("if (elements === null) {");
    expect(app).toContain("pins are taking too long to load from the map data — tap the chip again to retry.");
    expect(app).toContain("Couldn't load places from the map data — check your connection and tap the chip again.");
  });

  test("the busy flag clears in the finally, so no exit path can leave the spinner up", () => {
    expect(app).toContain("if (seq === exploreSeqRef.current) setExploreBusy(false);");
  });
});
