// truckPhotos.test.ts — INTEGRATION tests for truck + trailer
// photos and the My Trailer identity (migration 0120), run against
// the REAL action handlers over a throwaway migrated SQLite database:
//
//   (a) trailer identity round-trips through saveProfile / getProfile
//   (b) per-set round-trip: truck photos and trailer photos are two
//       independent sets on the avatar blob path
//   (c) per-set caps: the 6th photo in either set is rejected with a
//       clear error and the set stays at 5
//   (d) removing one photo frees a slot in its own set only; replace
//       swaps the file in place
//   (e) profile display: with the show-truck toggle ON, getUserProfile
//       carries both photo sets and both public lines — and neither
//       vehicle's VIN or plate appears anywhere in the output
//   (f) toggle OFF: no photos in getUserProfile output at all
//   (g) ownership: another account sees none of it and cannot delete
//       or replace photos it does not own
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-truckphotos-"));
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

const alice = await seedUser("photoalice", "Alice A");
const bob = await seedUser("photobob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

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
  trailerVin: "1GR1A9629NK654321",
  trailerPlate: "TR-5521",
} as const;

// A tiny stand-in image payload — the blob path stores bytes + mime
// exactly like the avatar upload; contents are never inspected.
const imgB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString("base64");
const img2B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]).toString("base64");

type PhotoItem = { id: number; url: string | null; mime: string | null };
type PhotoSets = { truck: PhotoItem[]; trailer: PhotoItem[] };

async function listPhotos(ctx: CtxT): Promise<PhotoSets> {
  return (await Actions.listVehiclePhotos.handler(ctx, {} as never)) as PhotoSets;
}

async function addPhoto(ctx: CtxT, kind: "truck" | "trailer"): Promise<{ id: number; error: string | null }> {
  return (await Actions.addVehiclePhoto.handler(ctx, {
    kind,
    dataBase64: imgB64,
    mime: "image/png",
  } as never)) as { id: number; error: string | null };
}

describe("My Trailer identity (migration 0120)", () => {
  test("(a) trailer identity round-trips through saveProfile / getProfile", async () => {
    await Actions.saveProfile.handler(aliceCtx, { ...fullProfile } as never);
    const r = (await Actions.getProfile.handler(aliceCtx, {} as never)) as { profile: Record<string, unknown> | null };
    expect(r.profile?.trailerYear).toBe(2022);
    expect(r.profile?.trailerMake).toBe("Great Dane");
    expect(r.profile?.trailerVin).toBe("1GR1A9629NK654321");
    expect(r.profile?.trailerPlate).toBe("TR-5521");
    // Truck identity still intact beside it.
    expect(r.profile?.truckMake).toBe("Kenworth");
    // Bob never set his — all null, not Alice's.
    const rb = (await Actions.getProfile.handler(bobCtx, {} as never)) as { profile: Record<string, unknown> | null };
    expect(rb.profile?.trailerMake ?? null).toBeNull();
    expect(rb.profile?.trailerVin ?? null).toBeNull();
  });
});

describe("vehicle photo sets", () => {
  test("(b) per-set round-trip: two independent sets", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await addPhoto(aliceCtx, "truck");
      expect(r.error).toBeNull();
      expect(r.id).toBeGreaterThan(0);
    }
    for (let i = 0; i < 2; i++) {
      const r = await addPhoto(aliceCtx, "trailer");
      expect(r.error).toBeNull();
    }
    const sets = await listPhotos(aliceCtx);
    expect(sets.truck.length).toBe(3);
    expect(sets.trailer.length).toBe(2);
    expect(sets.truck.every((p) => p.url)).toBe(true);
    expect(sets.trailer.every((p) => p.url)).toBe(true);
    // Saved order is stable (insertion order).
    const ids = sets.truck.map((p) => p.id);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    // Bob's sets are empty — none of Alice's photos leak.
    const bobSets = await listPhotos(bobCtx);
    expect(bobSets.truck.length).toBe(0);
    expect(bobSets.trailer.length).toBe(0);
  });

  test("(c) per-set caps: the 6th photo in either set is rejected", async () => {
    await addPhoto(aliceCtx, "truck");
    await addPhoto(aliceCtx, "truck");
    const sixthTruck = await addPhoto(aliceCtx, "truck");
    expect(sixthTruck.id).toBe(0);
    expect(sixthTruck.error).toContain("5 truck photos");
    await addPhoto(aliceCtx, "trailer");
    await addPhoto(aliceCtx, "trailer");
    await addPhoto(aliceCtx, "trailer");
    const sixthTrailer = await addPhoto(aliceCtx, "trailer");
    expect(sixthTrailer.id).toBe(0);
    expect(sixthTrailer.error).toContain("5 trailer photos");
    const sets = await listPhotos(aliceCtx);
    expect(sets.truck.length).toBe(5);
    expect(sets.trailer.length).toBe(5);
  });

  test("(d) removing frees a slot in its own set only; replace swaps in place", async () => {
    const before = await listPhotos(aliceCtx);
    const victim = before.truck[0]!;
    await Actions.deleteVehiclePhoto.handler(aliceCtx, { id: victim.id } as never);
    let sets = await listPhotos(aliceCtx);
    expect(sets.truck.length).toBe(4);
    expect(sets.trailer.length).toBe(5);
    // The freed slot takes a new photo; the full trailer set is untouched.
    const refill = await addPhoto(aliceCtx, "truck");
    expect(refill.error).toBeNull();
    sets = await listPhotos(aliceCtx);
    expect(sets.truck.length).toBe(5);
    expect(sets.trailer.length).toBe(5);
    // Replace: same row, new file (mime flips png -> jpeg), count unchanged.
    const target = sets.trailer[0]!;
    const rep = (await Actions.replaceVehiclePhoto.handler(aliceCtx, {
      id: target.id,
      dataBase64: img2B64,
      mime: "image/jpeg",
    } as never)) as { ok: boolean; error: string | null };
    expect(rep.ok).toBe(true);
    expect(rep.error).toBeNull();
    sets = await listPhotos(aliceCtx);
    expect(sets.trailer.length).toBe(5);
    expect(sets.trailer.find((p) => p.id === target.id)?.mime).toBe("image/jpeg");
  });

  test("(g) ownership: Bob cannot delete or replace Alice's photos", async () => {
    const aliceSets = await listPhotos(aliceCtx);
    const target = aliceSets.truck[0]!;
    await Actions.deleteVehiclePhoto.handler(bobCtx, { id: target.id } as never);
    const rep = (await Actions.replaceVehiclePhoto.handler(bobCtx, {
      id: target.id,
      dataBase64: img2B64,
      mime: "image/jpeg",
    } as never)) as { ok: boolean; error: string | null };
    expect(rep.ok).toBe(false);
    expect(rep.error).toBeTruthy();
    const after = await listPhotos(aliceCtx);
    expect(after.truck.length).toBe(5);
    expect(after.truck.some((p) => p.id === target.id)).toBe(true);
    expect(after.truck.find((p) => p.id === target.id)?.mime).toBe("image/png");
  });
});

describe("vehicle photos + lines on the social profile", () => {
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

  type ProfileOut = {
    showTruck: boolean;
    truckLine: string | null;
    trailerLine: string | null;
    truckPhotos: { url: string }[];
    trailerPhotos: { url: string }[];
  };

  test("(e) toggle ON: both sets + both lines show; no VIN or plate of either vehicle anywhere", async () => {
    await Actions.updateMyProfile.handler(aliceCtx, socialArgs(true) as never);
    const mine = (await Actions.getUserProfile.handler(aliceCtx, { username: "photoalice" } as never)) as ProfileOut;
    expect(mine.showTruck).toBe(true);
    expect(mine.truckLine).toBe("2021 Kenworth W900 · Step Deck");
    expect(mine.trailerLine).toBe("2022 Great Dane · Step Deck");
    expect(mine.truckPhotos.length).toBe(5);
    expect(mine.trailerPhotos.length).toBe(5);
    expect(mine.truckPhotos.every((p) => p.url)).toBe(true);
    expect(mine.trailerPhotos.every((p) => p.url)).toBe(true);
    const raw = JSON.stringify(mine);
    expect(raw).not.toContain("1XKWD49X7MJ123456"); // truck VIN
    expect(raw).not.toContain("AL-8842"); // truck plate
    expect(raw).not.toContain("1GR1A9629NK654321"); // trailer VIN
    expect(raw).not.toContain("TR-5521"); // trailer plate
    // Another driver's view: photos live on Alice's device in this
    // staging build (same rule as the lines) — empty, never invented.
    const bobs = (await Actions.getUserProfile.handler(bobCtx, { username: "photoalice" } as never)) as ProfileOut;
    expect(bobs.truckPhotos.length).toBe(0);
    expect(bobs.trailerPhotos.length).toBe(0);
  });

  test("(f) toggle OFF: no photos in the profile output at all", async () => {
    await Actions.updateMyProfile.handler(aliceCtx, socialArgs(false) as never);
    const mine = (await Actions.getUserProfile.handler(aliceCtx, { username: "photoalice" } as never)) as ProfileOut;
    expect(mine.showTruck).toBe(false);
    expect(mine.truckPhotos.length).toBe(0);
    expect(mine.trailerPhotos.length).toBe(0);
    const bobs = (await Actions.getUserProfile.handler(bobCtx, { username: "photoalice" } as never)) as ProfileOut;
    expect(bobs.truckPhotos.length).toBe(0);
    expect(bobs.trailerPhotos.length).toBe(0);
    expect(bobs.truckLine).toBeNull();
    expect(bobs.trailerLine).toBeNull();
    // The photos themselves are NOT deleted — the owner's own list
    // still holds both full sets; only the profile display hides.
    const sets = await listPhotos(aliceCtx);
    expect(sets.truck.length).toBe(5);
    expect(sets.trailer.length).toBe(5);
  });
});
