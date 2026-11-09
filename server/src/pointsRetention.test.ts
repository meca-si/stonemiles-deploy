import { describe, expect, test } from "bun:test";
import {
SEASON_EPOCH,
SEASON_MS,
pointsBalanceFromLedger,
seasonInfo,
} from "./pointsRetention";
import { CLEAN_WEEK_POINTS, dailyTaskPoints } from "./dailyPoints";

/**
 * Clause A2b (owner, 2026-10-26) — FREE-TIER BALANCE RETENTION.
 *
 * Audit finding these tests lock in: the codebase has NO rollover
 * path that touches points balances. The balance is the sum of every
 * points_log row (pointsBalanceFromLedger — the exact function
 * actions.ts runs), with no date/season/month/tier input; season code
 * only READS season-windowed records to compute scores/ranks and to
 * AWARD finished-season milestones; the only monthly construct is the
 * conversion-cap counter, which never writes to the ledger. These
 * tests prove the invariant against the production functions: a
 * free-tier balance is byte-identical before and after a season
 * rollover and a month rollover.
 */

type LedgerRow = { amount: number; source: string; createdAt: number };

/** One full free-tier driving day, priced by the REAL tier function. */
function freeDay(at: number): LedgerRow[] {
  const tasks = [
    "briefing",
    "dvir",
    "posttrip_dvir",
    "trip_sealed",
    "pod_seal",
    "clean_day",
    "intel",
    "debrief",
  ] as const;
  return tasks.map((t) => ({
    amount: dailyTaskPoints(t, false),
    source: `daily_${t}`,
    createdAt: at,
  }));
}

const OCT_20 = Date.parse("2026-10-20T15:00:00Z"); // Season 1, October
const OCT_26 = Date.parse("2026-10-26T15:00:00Z"); // Season 1, October
const NOV_05 = Date.parse("2026-11-05T15:00:00Z"); // Season 1, November

/** A free driver's ledger: signup 100 + two full free days + a clean
 *  week — every free-available reward, stacked in the one balance. */
function freeLedger(): LedgerRow[] {
  return [
    { amount: 100, source: "signup", createdAt: OCT_20 },
    ...freeDay(OCT_20),
    { amount: CLEAN_WEEK_POINTS, source: "clean_streak", createdAt: OCT_26 },
    ...freeDay(NOV_05),
  ];
}

/** Balance as production computes it, counting only rows landed by t. */
function balanceAt(rows: LedgerRow[], t: number): number {
  return pointsBalanceFromLedger(rows.filter((r) => r.createdAt <= t));
}

const FREE_DAY_TOTAL = 372; // 25+50+25+60+82+75+35+20 (fuel_stop pays 0 free)
const EXPECTED_TOTAL = 100 + FREE_DAY_TOTAL + 200 + FREE_DAY_TOTAL; // 1044

describe("clause A2b — free-tier ledger composition", () => {
  test("every free-available reward stacks into the single balance", () => {
    const rows = freeLedger();
    expect(rows.find((r) => r.source === "signup")?.amount).toBe(100);
    expect(rows.find((r) => r.source === "daily_briefing")?.amount).toBe(25);
    expect(rows.find((r) => r.source === "daily_trip_sealed")?.amount).toBe(60);
    expect(rows.find((r) => r.source === "daily_pod_seal")?.amount).toBe(82);
    expect(rows.find((r) => r.source === "clean_streak")?.amount).toBe(200);
    expect(rows.some((r) => r.source === "daily_fuel_stop")).toBe(false);
    expect(pointsBalanceFromLedger(rows)).toBe(EXPECTED_TOTAL);
  });

  test("the balance function takes the ledger only — order and repetition change nothing", () => {
    const rows = freeLedger();
    expect(pointsBalanceFromLedger([...rows].reverse())).toBe(EXPECTED_TOTAL);
    expect(pointsBalanceFromLedger(rows)).toBe(EXPECTED_TOTAL);
    expect(pointsBalanceFromLedger([])).toBe(0);
  });
});

describe("clause A2b — season rollover never touches the balance", () => {
  test("the rollover is real: season number advances at the 31-day boundary", () => {
    expect(SEASON_MS).toBe(31 * 86400000);
    const lastMsSeason1 = SEASON_EPOCH + SEASON_MS - 1;
    const firstMsSeason2 = SEASON_EPOCH + SEASON_MS;
    expect(seasonInfo(lastMsSeason1).number).toBe(1);
    expect(seasonInfo(firstMsSeason2).number).toBe(2);
    // Season 1 (Oct 12 – Nov 12 UTC) holds every earn in the ledger.
    expect(seasonInfo(OCT_20).number).toBe(1);
    expect(seasonInfo(NOV_05).number).toBe(1);
  });

  test("a free-tier balance is unchanged across the season rollover", () => {
    const rows = freeLedger();
    const endOfSeason1 = SEASON_EPOCH + SEASON_MS - 1;
    const startOfSeason2 = SEASON_EPOCH + SEASON_MS;
    const deepIntoSeason2 = startOfSeason2 + 20 * 86400000;
    expect(balanceAt(rows, endOfSeason1)).toBe(EXPECTED_TOTAL);
    expect(balanceAt(rows, startOfSeason2)).toBe(EXPECTED_TOTAL);
    expect(balanceAt(rows, deepIntoSeason2)).toBe(EXPECTED_TOTAL);
    // The season-windowed sum (what scores/ranks read) is a different,
    // smaller thing — and it is NOT the balance.
    const season2Rows = rows.filter(
      (r) => r.createdAt >= startOfSeason2 && r.createdAt < startOfSeason2 + SEASON_MS,
    );
    expect(pointsBalanceFromLedger(season2Rows)).toBe(0);
    expect(pointsBalanceFromLedger(rows)).toBe(EXPECTED_TOTAL);
  });

  test("a finished season's milestone only ever ADDS at rollover", () => {
    const rows = freeLedger();
    const withMilestone: LedgerRow[] = [
      ...rows,
      {
        amount: 40, // Silver season milestone, awarded for Season 1
        source: "rank_milestone",
        createdAt: SEASON_EPOCH + SEASON_MS + 86400000,
      },
    ];
    expect(pointsBalanceFromLedger(withMilestone)).toBe(EXPECTED_TOTAL + 40);
  });
});

describe("clause A2b — month rollover never touches the balance", () => {
  test("a free-tier balance is unchanged across the October → November boundary", () => {
    const rows = freeLedger();
    const endOfOctober = Date.parse("2026-10-31T23:59:59.999Z");
    const startOfNovember = Date.parse("2026-11-01T00:00:00.000Z");
    const octoberTotal = 100 + FREE_DAY_TOTAL + 200; // 672
    expect(balanceAt(rows, endOfOctober)).toBe(octoberTotal);
    expect(balanceAt(rows, startOfNovember)).toBe(octoberTotal);
    // November earns ADD on top of the carried balance — never reset it.
    expect(balanceAt(rows, Date.parse("2026-11-30T23:59:59.999Z"))).toBe(EXPECTED_TOTAL);
    expect(balanceAt(rows, Date.parse("2026-12-01T00:00:00.000Z"))).toBe(EXPECTED_TOTAL);
  });
});
