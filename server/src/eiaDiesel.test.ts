import { describe, expect, test } from "bun:test";
import {
combineEiaPages,
eiaIsStale,
eiaRefreshDue,
eiaWeekAgeDays,
eiaWeekLabel,
parseEiaDieselPage,
} from "./eiaDiesel";

/**
 * EIA WEEKLY DIESEL REFRESH (2026-10-30). These tests drive the EXACT
 * pure functions the server refresh runs: getFuelPriceData /
 * refreshEiaDiesel fetch the three official EIA pages, parse each
 * with parseEiaDieselPage, combine with combineEiaPages (which must
 * refuse a week disagreement), and label staleness with
 * eiaIsStale / eiaWeekAgeDays / eiaRefreshDue. The fixture below
 * mirrors the real page structure verified live at build time
 * (Series5 week headers; the diesel row's values ending in the
 * Current2 cell before the series-history link) and the real
 * Oct 26, 2026 values.
 */

function fixturePage(series: string, values: number[]): string {
  const cells = values
    .map((v, i) =>
      i === values.length - 1
        ? `<td width="76" class="Current2">${v.toFixed(3)}</td>`
        : `<td width="76" class="DataB">${v.toFixed(3)}</td>`,
    )
    .join("\n");
  return `
    <table>
      <tr>
        <th class="Series5">09/21/26</th>
        <th class="Series5">10/05/26</th>
        <th class="Series5">10/12/26</th>
        <th class="Series5">10/19/26</th>
        <th class="Series5">10/26/26</th>
      </tr>
      <tr class="DataRow">
        <td width="228" class="DataStub">Gasoline row that must never be read</td>
        <td width="76" class="DataB">4.179</td>
        <td width="76" class="Current2">4.269</td>
        <td width="76" class="DataHist"><a href="./hist/LeafHandler.ashx?n=PET&s=EMM_EPM0_PTE_NUS_DPG&f=W">1993-2026</a></td>
      </tr>
      <tr class="DataRow">
        <td width="228" class="DataStub">Diesel Fuel - All Types</td>
        ${cells}
        <td width="76" class="DataHist"><a href="./hist/LeafHandler.ashx?n=PET&s=${series}&f=W">1994-2026</a></td>
      </tr>
    </table>`;
}

describe("parseEiaDieselPage", () => {
  test("reads the newest week + price for the anchored diesel series", () => {
    const html = fixturePage("EMD_EPD2D_PTE_NUS_DPG", [6.529, 6.382, 6.199, 6.179, 6.276, 6.352]);
    expect(parseEiaDieselPage(html, "EMD_EPD2D_PTE_NUS_DPG")).toEqual({
      weekOf: "2026-10-26",
      price: 6.352,
    });
  });

  test("regional series parse their own rows", () => {
    const gulf = fixturePage("EMD_EPD2D_PTE_R30_DPG", [6.177, 5.955, 5.819, 5.809, 5.903, 5.951]);
    expect(parseEiaDieselPage(gulf, "EMD_EPD2D_PTE_R30_DPG")?.price).toBe(5.951);
    const west = fixturePage("EMD_EPD2D_PTE_R50_DPG", [7.456, 7.357, 7.229, 7.24, 7.394, 7.329]);
    expect(parseEiaDieselPage(west, "EMD_EPD2D_PTE_R50_DPG")?.price).toBe(7.329);
  });

  test("returns null when the series or the week headers are absent", () => {
    expect(parseEiaDieselPage("<html>error page</html>", "EMD_EPD2D_PTE_NUS_DPG")).toBeNull();
    const noSeries = fixturePage("EMD_EPD2D_PTE_R30_DPG", [1, 2, 3]);
    expect(parseEiaDieselPage(noSeries, "EMD_EPD2D_PTE_NUS_DPG")).toBeNull();
  });
});

describe("combineEiaPages", () => {
  test("combines three agreeing pages", () => {
    expect(
      combineEiaPages({
        national: { weekOf: "2026-10-26", price: 6.352 },
        gulfCoast: { weekOf: "2026-10-26", price: 5.951 },
        westCoast: { weekOf: "2026-10-26", price: 7.329 },
      }),
    ).toEqual({ weekOf: "2026-10-26", national: 6.352, gulfCoast: 5.951, westCoast: 7.329 });
  });

  test("refuses a week disagreement — nothing gets stored", () => {
    expect(() =>
      combineEiaPages({
        national: { weekOf: "2026-10-26", price: 6.352 },
        gulfCoast: { weekOf: "2026-10-19", price: 5.903 },
        westCoast: { weekOf: "2026-10-26", price: 7.329 },
      }),
    ).toThrow();
    expect(() =>
      combineEiaPages({ national: null, gulfCoast: { weekOf: "2026-10-26", price: 5.951 }, westCoast: { weekOf: "2026-10-26", price: 7.329 } }),
    ).toThrow();
  });
});

describe("labels + staleness", () => {
  test("week label keeps the app's long-standing wording", () => {
    expect(eiaWeekLabel("2026-10-26")).toBe("week of Oct 26, 2026");
    expect(eiaWeekLabel("2026-10-19")).toBe("week of Oct 19, 2026");
  });

  test("age + stale: a healthy weekly snapshot is never stale", () => {
    const tue = new Date("2026-10-27T12:00:00Z"); // release day for the Oct 26 week
    expect(eiaWeekAgeDays("2026-10-26", tue)).toBe(1);
    expect(eiaIsStale("2026-10-26", tue)).toBe(false);
    expect(eiaIsStale("2026-10-26", new Date("2026-11-05T12:00:00Z"))).toBe(false); // 10 days
    expect(eiaIsStale("2026-10-26", new Date("2026-11-06T12:00:00Z"))).toBe(true); // 11 days — a week was missed
    expect(eiaIsStale("2026-10-19", new Date("2026-10-30T12:00:00Z"))).toBe(true); // the old seed on build day
  });

  test("refresh is due 7 days after the last successful fetch", () => {
    const fetched = new Date("2026-10-27T12:00:00Z");
    expect(eiaRefreshDue(null, fetched)).toBe(true);
    expect(eiaRefreshDue(fetched, new Date("2026-11-03T12:00:00Z"))).toBe(false); // exactly 7d — not yet over
    expect(eiaRefreshDue(fetched, new Date("2026-11-03T12:00:01Z"))).toBe(true);
  });
});
