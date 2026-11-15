// trailerModel.test.ts — INTEGRATION tests for the My Trailer
// MODEL field (migration 0123), run against the REAL action handlers
// over a throwaway migrated SQLite database:
//
//   (a) settings round-trip: trailerModel saves and reads back
//       through saveProfile / getProfile, clears back to null, and
//       never leaks into another account
//   (b) profile line: with a model the public trailer line is
//       "2022 Great Dane Everest · Step Deck"; without one it stays
//       "2022 Fontaine · Step Deck" — and neither the trailer VIN
//       nor the trailer plate appears anywhere in getUserProfile
//       output (owner-only rule, pinned)
//   (c) DVIR identity snapshot: a signed DVIR seals the trailer
//       label WITH the model; the truck label keeps its model too
//   (d) truck-record download: CSV + printable text carry the
//       trailer name (year/make/model), trailer VIN and plate
//       beside the truck identity (this is the owner's own record,
//       so VIN/plate belong here) — and none of it leaks into
//       another account's export
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-trailermodel-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");

type CtxT = Ctx;

const privStub = async () => ({ ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null });

interface SeededUser {
  accountId: number;
  profileId: number;
  username: string;
  email: string;
}

async function seedUser(username: string, chatName: string): Promise<SeededUser> {
  const db = getDb();
  const email = `${username}@test.local`;
  const acct = await db
    .insert(schema.accounts)
    .values({ email, passwordHash: null, status: "active" })
    .returning({ id: schema.accounts.id });
  const prof = await db
    .insert(schema.profile)
    .values({
      accountId: acct[0]!.id,
      socialUsername: username,
      chatName,
      plan: "diamond",
      heightFt: 13,
      heightIn: 6,
      weightLbs: 80000,
      lengthFt: 53,
      mpg: 6.5,
      dieselPrice: 3.89,
      tankRangeMi: 1000,
    })
    .returning({ id: schema.profile.id });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser): CtxT {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: {
      accountId: u.accountId,
      profileId: u.profileId,
      username: u.username,
      email: u.email,
      isOwner: false,
      status: "active",
      totpPending: false,
      hasTeamSeat: false,
      sessionId: 1,
    },
  }).ctx as unknown as CtxT;
}

const alice = await seedUser("modelalice", "Alice A");
const bob = await seedUser("modelbob", "Bob B");
const carl = await seedUser("modelcarl", "Carl C");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);
const carlCtx = ctxFor(carl);

const fullProfile = {
  heightFt: 13,
  heightIn: 6,
  weightLbs: 80000,
  lengthFt: 53,
  mpg: 6.5,
  dieselPrice: 3.89,
  tankRangeMi: 1000,
  lovesOff: false,
  pilotOff: false,
  brandOffs: [],
  autoRoute: true,
  autoTrip: true,
  autoAlerts: true,
  autoFuel: true,
  autoSeal: true,
  priority1: "safety",
  priority2: "net",
  priority3: "time",
  chatName: "Alice A",
  hazmat: false,
  hazmatClass: null,
  companyName: null,
  driverCpm: null,
  payBasis: "cpm",
  driverPayPct: null,
  factoringPct: 0,
  dispatcherPct: 0,
  trailerType: "step_deck",
  truckYear: 2021,
  truckMake: "Kenworth",
  truckModel: "W900",
  truckUnitNumber: "12",
  truckVin: "1XKWD49X7MJ123456",
  truckPlate: "AL-8842",
  truckEngine: "Cummins X15",
  truckTransmission: "18-speed",
  trailerYear: 2022,
  trailerMake: "Great Dane",
  trailerModel: "Everest",
  trailerVin: "1GR1A9629NK654321",
  trailerPlate: "TR-5521",
} as const;

const socialArgs = (showTruck: boolean) => ({
  displayName: "Alice A",
  bio: null,
  company: null,
  truckInfo: null,
  homeCity: null,
  homeState: null,
  contactPhone: null,
  contactEmail: null,
  mcNumber: null,
  dotNumber: null,
  twicHas: false,
  twicExpires: null,
  endorsements: [],
  dmPolicy: "everyone" as const,
  groupPolicy: "everyone" as const,
  showReputation: false,
  showMilesPanel: true,
  showTruck,
  featuredBadge: null,
  avatarDataBase64: null,
  avatarMime: null,
});

describe("trailer model (migration 0123)", () => {
  test("(a) trailerModel round-trips through saveProfile / getProfile", async () => {
    await Actions.saveProfile.handler(aliceCtx, { ...fullProfile } as never);
    const r = (await Actions.getProfile.handler(aliceCtx, {} as never)) as { profile: Record<string, unknown> | null };
    expect(r.profile?.trailerModel).toBe("Everest");
    // The rest of the trailer identity still intact beside it.
    expect(r.profile?.trailerYear).toBe(2022);
    expect(r.profile?.trailerMake).toBe("Great Dane");
    expect(r.profile?.trailerVin).toBe("1GR1A9629NK654321");
    expect(r.profile?.trailerPlate).toBe("TR-5521");
    // Bob never set his — null, not Alice's.
    const rb = (await Actions.getProfile.handler(bobCtx, {} as never)) as { profile: Record<string, unknown> | null };
    expect(rb.profile?.trailerModel ?? null).toBeNull();
    // Clearing the field round-trips back to null.
    await Actions.saveProfile.handler(aliceCtx, { ...fullProfile, trailerModel: null } as never);
    const rc = (await Actions.getProfile.handler(aliceCtx, {} as never)) as { profile: Record<string, unknown> | null };
    expect(rc.profile?.trailerModel ?? null).toBeNull();
    // Restore for the tests below.
    await Actions.saveProfile.handler(aliceCtx, { ...fullProfile } as never);
  });

  test("(b) profile trailer line carries the model; VIN and plate never surface", async () => {
    await Actions.updateMyProfile.handler(aliceCtx, socialArgs(true) as never);
    const mine = (await Actions.getUserProfile.handler(aliceCtx, { username: "modelalice" } as never)) as { trailerLine: string | null };
    expect(mine.trailerLine).toBe("2022 Great Dane Everest · Step Deck");
    // Owner-only rule pinned: the trailer VIN and plate appear
    // NOWHERE in the profile output, for any viewer.
    const raw = JSON.stringify(await Actions.getUserProfile.handler(aliceCtx, { username: "modelalice" } as never));
    expect(raw).not.toContain("1GR1A9629NK654321");
    expect(raw).not.toContain("TR-5521");
    const rawBob = JSON.stringify(await Actions.getUserProfile.handler(bobCtx, { username: "modelalice" } as never));
    expect(rawBob).not.toContain("1GR1A9629NK654321");
    expect(rawBob).not.toContain("TR-5521");

    // Carl has a trailer identity but NO model — his line is the
    // pre-0123 shape, unchanged.
    await Actions.saveProfile.handler(carlCtx, { ...fullProfile, chatName: "Carl C", trailerMake: "Fontaine", trailerModel: null, trailerVin: null, trailerPlate: null } as never);
    const carls = (await Actions.getUserProfile.handler(carlCtx, { username: "modelcarl" } as never)) as { trailerLine: string | null };
    expect(carls.trailerLine).toBe("2022 Fontaine · Step Deck");
  });

  test("(c) DVIR identity snapshot seals truck model + trailer model", async () => {
    const res = await Actions.saveDvir.handler(aliceCtx, {
      kind: "pretrip",
      items: [{ item: "Brakes", ok: true }, { item: "Tires & wheels", ok: true }],
      defects: [],
      signedName: "Alice A",
      odometer: 320000,
      lat: 30.69,
      lon: -88.04,
      safeToOperate: true,
    });
    const list = await Actions.listDvirs.handler(aliceCtx, { limit: 5 });
    const r = list.reports.find((x) => x.id === res.id)!;
    expect(r.truckLabel).toBe("2021 Kenworth W900 · Unit 12");
    expect(r.trailerLabel).toBe("2022 Great Dane Everest · step deck");
  });

  test("(d) truck-record download carries the trailer identity incl. model", async () => {
    const r = (await Actions.exportTruckRecord.handler(aliceCtx, {} as never)) as { csv: string; text: string; entryCount: number; totalCost: number };
    // Truck identity (with its model) heads the record, as before.
    expect(r.csv).toContain("Truck,2021 Kenworth W900");
    expect(r.text).toContain("Truck: 2021 Kenworth W900");
    // Trailer identity now rides the record too — name with model,
    // plus the owner-only VIN and plate (this download IS the
    // owner's own record, like the truck's VIN/plate above it).
    expect(r.csv).toContain("Trailer,2022 Great Dane Everest");
    expect(r.csv).toContain("Trailer VIN,1GR1A9629NK654321");
    expect(r.csv).toContain("Trailer plate,TR-5521");
    expect(r.text).toContain("Trailer: 2022 Great Dane Everest");
    expect(r.text).toContain("Trailer VIN: 1GR1A9629NK654321");
    expect(r.text).toContain("Trailer plate: TR-5521");
    // Bob's export is his own empty record — none of Alice's rig.
    const rb = (await Actions.exportTruckRecord.handler(bobCtx, {} as never)) as { csv: string; text: string };
    expect(rb.csv).not.toContain("Great Dane");
    expect(rb.csv).not.toContain("Everest");
    expect(rb.text).not.toContain("Everest");
  });
});
