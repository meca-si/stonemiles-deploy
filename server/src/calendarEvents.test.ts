// calendarEvents.test.ts — INTEGRATION tests for the driver's OWN
// calendar events (migration 0145; driver report, 2026-11-24: "The
// calendar doesn't let users add or delete or edit anything either.
// I wanted to add my home time but couldn't."), run against the
// REAL action handlers over a throwaway migrated SQLite database:
//
//   (a) a home-time event the driver adds shows on getCalendar as
//       kind "user_event" with its id + type, at EXACTLY the
//       instants he entered (the client sends the device's
//       wall-clock times as ISO instants — no server-side shifting);
//   (b) editing it (saveCalendarEvent with the id) moves it;
//   (c) deleting it takes it off the calendar;
//   (d) bad input is refused in plain words (no title, end before
//       start) and saves nothing;
//   (e) another driver neither sees the event nor can delete it;
//   (f) a load's calendar appointments stay load-owned: their
//       eventId is null and the load id is set.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-calevents-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");

const privStub = async () => ({
  ok: false,
  status: "not_configured",
  notConfigured: true,
  providerId: null,
  errorMessage: null,
  detail: "test stub",
  id: null,
});

const db = getDb();

async function seedUser(username: string, plan: string) {
  const email = `${username}@test.local`;
  const acct = await db
    .insert(schema.accounts)
    .values({ email, passwordHash: null, status: "active" })
    .returning({ id: schema.accounts.id });
  // No explicit profile id: in a full-suite run the database is
  // shared with other suites that claim low id ranges — let the
  // sequence assign one instead of colliding with theirs.
  const prof = await db
    .insert(schema.profile)
    .values({
      accountId: acct[0]!.id,
      socialUsername: username,
      plan,
      heightFt: 6,
      heightIn: 1,
      weightLbs: 200,
      lengthFt: 13,
      mpg: 6.5,
      dieselPrice: 3.65,
      tankRangeMi: 800,
    })
    .returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: { accountId: number; profileId: number; username: string; email: string }): Ctx {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: {
      accountId: u.accountId,
      profileId: u.profileId,
      username: u.username,
      email: u.email,
      isOwner: true,
      status: "active",
      totpPending: false,
      hasTeamSeat: false,
      sessionId: 1,
    },
  }).ctx as unknown as Ctx;
}

// A driver on Central time enters home time as wall clock Fri
// 2027-01-15 6:00 PM → Sun 2027-01-17 8:00 AM; his device sends
// the instants 2027-01-16T00:00:00Z → 2027-01-17T14:00:00Z.
const HOME_START = "2027-01-16T00:00:00.000Z";
const HOME_END = "2027-01-17T14:00:00.000Z";
const WINDOW = { fromIso: "2027-01-11T00:00:00.000Z", toIso: "2027-01-25T00:00:00.000Z" };

async function myUserEvents(ctx: Ctx) {
  const cal = await Actions.getCalendar.handler(ctx, { ...WINDOW, utcOffsetMinutes: 300 } as never);
  return cal.events.filter((e) => e.kind === "user_event");
}

describe("driver calendar events", () => {
  test("(a) add home time — it lands on the calendar at the entered instants", async () => {
    const u = await seedUser("cevadd", "owner");
    const ctx = ctxFor(u);
    const saved = await Actions.saveCalendarEvent.handler(ctx, {
      id: null,
      title: "Home time — back Sunday",
      type: "home_time",
      startsAtIso: HOME_START,
      endsAtIso: HOME_END,
      note: "Kids' weekend",
    } as never);
    expect(saved.ok).toBe(true);
    expect(saved.id).toBeGreaterThan(0);

    const mine = await myUserEvents(ctx);
    expect(mine.length).toBe(1);
    expect(mine[0]!.eventId).toBe(saved.id);
    expect(mine[0]!.eventType).toBe("home_time");
    expect(mine[0]!.title).toBe("Home time — back Sunday");
    expect(mine[0]!.at).toBe(HOME_START);
    expect(mine[0]!.endAt).toBe(HOME_END);
    expect(mine[0]!.detail).toBe("Kids' weekend");
    expect(mine[0]!.loadId).toBeNull();
  });

  test("(b) edit moves the event; (c) delete removes it", async () => {
    const u = await seedUser("cevedit", "owner");
    const ctx = ctxFor(u);
    const saved = await Actions.saveCalendarEvent.handler(ctx, {
      id: null,
      title: "Dentist",
      type: "appointment",
      startsAtIso: HOME_START,
      endsAtIso: HOME_END,
      note: null,
    } as never);
    expect(saved.ok).toBe(true);

    const edited = await Actions.saveCalendarEvent.handler(ctx, {
      id: saved.id,
      title: "Dentist — moved",
      type: "appointment",
      startsAtIso: "2027-01-18T15:00:00.000Z",
      endsAtIso: "2027-01-18T16:00:00.000Z",
      note: "Bring the card",
    } as never);
    expect(edited.ok).toBe(true);
    expect(edited.id).toBe(saved.id);

    let mine = await myUserEvents(ctx);
    expect(mine.length).toBe(1);
    expect(mine[0]!.title).toBe("Dentist — moved");
    expect(mine[0]!.at).toBe("2027-01-18T15:00:00.000Z");
    expect(mine[0]!.detail).toBe("Bring the card");

    const del = await Actions.deleteCalendarEvent.handler(ctx, { id: saved.id } as never);
    expect(del.ok).toBe(true);
    mine = await myUserEvents(ctx);
    expect(mine.length).toBe(0);
  });

  test("(d) bad input is refused and saves nothing", async () => {
    const u = await seedUser("cevbad", "owner");
    const ctx = ctxFor(u);
    const noTitle = await Actions.saveCalendarEvent.handler(ctx, {
      id: null, title: "   ", type: "personal", startsAtIso: HOME_START, endsAtIso: HOME_END, note: null,
    } as never);
    expect(noTitle.ok).toBe(false);
    expect(noTitle.error).toContain("title");
    const backwards = await Actions.saveCalendarEvent.handler(ctx, {
      id: null, title: "Backwards", type: "personal", startsAtIso: HOME_END, endsAtIso: HOME_START, note: null,
    } as never);
    expect(backwards.ok).toBe(false);
    expect(backwards.error).toContain("after the start");
    expect((await myUserEvents(ctx)).length).toBe(0);
  });

  test("(e) another driver neither sees nor can delete my event", async () => {
    const a = await seedUser("cevowner", "owner");
    const b = await seedUser("cevother", "owner");
    const ctxA = ctxFor(a);
    const ctxB = ctxFor(b);
    const saved = await Actions.saveCalendarEvent.handler(ctxA, {
      id: null, title: "Home time", type: "home_time", startsAtIso: HOME_START, endsAtIso: HOME_END, note: null,
    } as never);
    expect(saved.ok).toBe(true);
    expect((await myUserEvents(ctxB)).length).toBe(0);
    const del = await Actions.deleteCalendarEvent.handler(ctxB, { id: saved.id } as never);
    expect(del.ok).toBe(false);
    const edit = await Actions.saveCalendarEvent.handler(ctxB, {
      id: saved.id, title: "Hijacked", type: "other", startsAtIso: HOME_START, endsAtIso: HOME_END, note: null,
    } as never);
    expect(edit.ok).toBe(false);
    const mine = await myUserEvents(ctxA);
    expect(mine.length).toBe(1);
    expect(mine[0]!.title).toBe("Home time");
  });

  test("(f) a load's appointments stay load-owned (eventId null)", async () => {
    const u = await seedUser("cevload", "owner");
    const ctx = ctxFor(u);
    const saved = await Actions.saveLoad.handler(ctx, {
      id: null,
      shipper: "BRWY",
      pickupCity: "Jacksonville",
      pickupState: "FL",
      deliveryCity: "Montgomery",
      deliveryState: "AL",
      pickupText: "1/16/2027 9:00 AM",
      deliveryText: "1/17/2027 7:00 AM",
      rate: 600,
      extraCharges: 0,
      weightLbs: null,
      commodity: null,
      hazmat: false,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(saved.id).toBeGreaterThan(0);
    const cal = await Actions.getCalendar.handler(ctx, { ...WINDOW, utcOffsetMinutes: 300 } as never);
    const loadEvents = cal.events.filter((e) => e.kind === "load" && e.loadId === saved.id);
    expect(loadEvents.length).toBeGreaterThan(0);
    for (const e of loadEvents) {
      expect(e.eventId).toBeNull();
      expect(e.eventType).toBeNull();
    }
  });
});
