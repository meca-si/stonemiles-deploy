// Unit tests for the AI driver-learning opt-in math
// (server/src/learningState.ts) — the production logic behind
// getLearning / resetLearning in actions.ts.
// Run: bun test server/src/learningState.test.ts
//
// The rule under test (x's lock, 2026-10-22): AI driver learning is
// OPT-IN, OFF by default. Only the driver's explicit turn-on (an
// unpaused state row, written by the Diamond-gated setLearningPaused)
// enables it — never a fresh install, never a side effect.

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  learningEnabledFromRow,
  learningForgetConflictSet,
  learningForgetInsertValues,
  learningResetConflictSet,
  learningResetInsertValues,
  learningSetPausedConflictSet,
  learningSetPausedValues,
} from "./learningState";
import { learningState } from "./schema";

describe("AI driver learning — opt-in, off by default", () => {
  test("no state row (fresh install / never touched the switch) is OFF", () => {
    expect(learningEnabledFromRow(null)).toBe(false);
    expect(learningEnabledFromRow(undefined)).toBe(false);
  });

  test("a paused row is OFF", () => {
    expect(learningEnabledFromRow({ paused: true })).toBe(false);
  });

  test("an unpaused row — the driver's explicit opt-in — is ON and stays ON", () => {
    expect(learningEnabledFromRow({ paused: false })).toBe(true);
  });

  test("a reset on an account with no row creates a PAUSED row — reset never switches learning on", () => {
    const now = new Date("2026-11-02T00:00:00Z");
    const values = learningResetInsertValues(now);
    expect(values.id).toBe(1);
    expect(values.paused).toBe(true);
    expect(values.resetAt).toBe(now);
    // The created row, read back through the same gate getLearning
    // uses, must read as OFF.
    expect(learningEnabledFromRow(values)).toBe(false);
  });

  test("a reset's conflict set touches ONLY resetAt — it can never flip an existing row's paused flag", () => {
    const now = new Date("2026-11-02T00:00:00Z");
    const set = learningResetConflictSet(now);
    expect(set).toEqual({ resetAt: now });
    expect("paused" in set).toBe(false);
  });
});

describe("every learning_state write path (actions.ts producers)", () => {
  const now = new Date("2026-11-02T00:00:00Z");

  test("the pause switch with paused:true writes an OFF row (opt-out always allowed)", () => {
    expect(learningEnabledFromRow(learningSetPausedValues(true))).toBe(false);
    expect(learningSetPausedConflictSet(true)).toEqual({ paused: true });
  });

  test("the pause switch with paused:false is the ONLY producer that can yield ON — the explicit, Diamond-gated opt-in", () => {
    expect(learningEnabledFromRow(learningSetPausedValues(false))).toBe(true);
    expect(learningSetPausedConflictSet(false)).toEqual({ paused: false });
  });

  test("delete learned data writes OFF on BOTH the insert and the conflict path", () => {
    const insert = learningForgetInsertValues(now);
    expect(insert.paused).toBe(true);
    expect(learningEnabledFromRow(insert)).toBe(false);
    const conflict = learningForgetConflictSet(now);
    expect(conflict.paused).toBe(true);
    expect(conflict.resetAt).toBe(now);
  });

  test("no non-switch producer can yield an ON row, whatever the clock says", () => {
    for (const d of [new Date(0), new Date(), new Date("2030-01-01T00:00:00Z")]) {
      expect(learningEnabledFromRow(learningResetInsertValues(d))).toBe(false);
      expect(learningEnabledFromRow(learningForgetInsertValues(d))).toBe(false);
    }
  });
});

describe("storage default — a row that omits `paused` must read OFF (migration 0091)", () => {
  test("the Drizzle schema default for learning_state.paused is paused (true)", () => {
    // schema.ts is what future migrations are generated from; if
    // this default ever flips back to false, the storage layer
    // re-opens the opt-in bypass this repair closed.
    expect((learningState.paused as unknown as { default: unknown }).default).toBe(true);
  });

  test("migration 0091 flips the DB default to paused and preserves existing rows verbatim", () => {
    const db = new Database(":memory:");
    // The table exactly as migration 0008 created it (default 0).
    db.exec(
      "CREATE TABLE `learning_state` (`id` integer PRIMARY KEY NOT NULL, `paused` integer DEFAULT 0 NOT NULL, `reset_at` integer);",
    );
    // An explicit opt-in already on file before the migration.
    db.exec("INSERT INTO `learning_state` (`id`, `paused`, `reset_at`) VALUES (1, 0, NULL);");
    // The pre-0091 hazard, demonstrated: a writer that omits
    // `paused` silently created an ON row.
    db.exec("INSERT INTO `learning_state` (`id`) VALUES (2);");
    const before = db.query("SELECT `paused` FROM `learning_state` WHERE `id` = 2").get() as { paused: number };
    expect(before.paused).toBe(0);
    db.exec("DELETE FROM `learning_state` WHERE `id` = 2;");

    // Apply the real migration file, statement by statement.
    const sql = readFileSync(
      join(import.meta.dir, "..", "..", "drizzle", "0091_learning_state_paused_default.sql"),
      "utf8",
    );
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) db.exec(s);
    }

    // The recorded opt-in survives untouched — the migration
    // changes the DEFAULT, never the driver's stored choice.
    const kept = db.query("SELECT `paused` FROM `learning_state` WHERE `id` = 1").get() as { paused: number };
    expect(kept.paused).toBe(0);
    expect(learningEnabledFromRow({ paused: kept.paused === 1 })).toBe(true);

    // A post-migration writer that omits `paused` now lands PAUSED.
    db.exec("INSERT INTO `learning_state` (`id`) VALUES (2);");
    const after = db.query("SELECT `paused` FROM `learning_state` WHERE `id` = 2").get() as { paused: number };
    expect(after.paused).toBe(1);
    expect(learningEnabledFromRow({ paused: after.paused === 1 })).toBe(false);

    // Account creation state: an empty table (a fresh install has
    // no row at all) reads OFF through the same gate.
    db.exec("DELETE FROM `learning_state`;");
    const rows = db.query("SELECT `id` FROM `learning_state`").all();
    expect(rows.length).toBe(0);
    expect(learningEnabledFromRow(null)).toBe(false);
    db.close();
  });
});
