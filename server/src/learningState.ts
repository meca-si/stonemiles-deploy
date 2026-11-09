// AI driver learning — the opt-in state math. Pure and
// framework-free (like si.ts / docCopies.ts) so the exact production
// behavior is unit-testable (see learningState.test.ts); actions.ts
// owns the DB reads and writes.
//
// THE RULE (x's lock, 2026-10-22): AI driver learning is OPT-IN and
// OFF by default. It turns on only when the driver explicitly turns
// it on — setLearningPaused { paused: false }, which is also the
// only path gated on Diamond. Patterns are computed from the
// driver's OWN records only, and nothing here ever switches
// learning on as a side effect of another action.

/** The slice of a learning_state row the opt-in math reads. */
export type LearningStateRowLike = { paused: boolean };

/** Whether AI driver learning is effectively ON for a stored state
 *  row. No row — a fresh install, or an account that has never
 *  touched the switch — means OFF: a personal model is never built
 *  or retained without the driver's explicit opt-in. A row counts
 *  only when it exists AND is not paused, so every writer that
 *  creates a row for any other reason must create it paused (see
 *  learningResetInsertValues). */
export function learningEnabledFromRow(row: LearningStateRowLike | null | undefined): boolean {
  return row != null && !row.paused;
}

/** The row a learning RESET creates when the account has no state
 *  row yet. Reset wipes the model's memory (the resetAt line); it
 *  is not an opt-in, so a fresh reset row is created PAUSED. Before
 *  the 2026-11-02 repair it was created unpaused — and under
 *  learningEnabledFromRow's "row exists and not paused" rule, a
 *  reset on a never-enabled account silently switched learning ON,
 *  skipping the driver's opt-in and the Diamond gate on the real
 *  opt-in path. When a row already exists, reset's upsert touches
 *  only resetAt, so an explicit opt-in (unpaused) or opt-out
 *  (paused) is preserved exactly as the driver left it. */
export function learningResetInsertValues(now: Date): { id: 1; paused: true; resetAt: Date } {
  return { id: 1, paused: true, resetAt: now };
}

/** The reset upsert's conflict set: resetAt only. An existing row's
 *  paused flag — the driver's explicit opt-in or opt-out — is never
 *  part of a reset write. */
export function learningResetConflictSet(now: Date): { resetAt: Date } {
  return { resetAt: now };
}

/** The row values the pause switch (setLearningPaused) writes, and
 *  its conflict set. This is the ONLY producer that can yield an
 *  unpaused row — learningSetPausedValues(false) is the driver's
 *  explicit opt-in — and its only caller is the action that gates
 *  paused:false on Diamond before writing. Every other producer in
 *  this module hard-codes paused: true. */
export function learningSetPausedValues(paused: boolean): { id: 1; paused: boolean } {
  return { id: 1, paused };
}

export function learningSetPausedConflictSet(paused: boolean): { paused: boolean } {
  return { paused };
}

/** The row "delete learned data" (deleteLearnedData) creates when
 *  the account has no state row, and its conflict set. Deleting
 *  learned data also turns learning OFF (a stronger act than
 *  reset), so both the insert AND the conflict path write
 *  paused: true — an existing opt-in does not survive a delete. */
export function learningForgetInsertValues(now: Date): { id: 1; paused: true; resetAt: Date } {
  return { id: 1, paused: true, resetAt: now };
}

export function learningForgetConflictSet(now: Date): { paused: true; resetAt: Date } {
  return { paused: true, resetAt: now };
}
