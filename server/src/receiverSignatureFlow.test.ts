// receiverSignatureFlow.test.ts — INTEGRATION tests for the
// receiver signature pad on the public delivery-confirmation link
// (owner-approved 2026-11-15), run against the REAL action handlers
// over a throwaway migrated SQLite database:
//
//   (a) drawn signature + printed name seals with the drawn marker;
//       the signature lands in its own blob (the dock photo keeps
//       the doc slot) and BOTH images ride the signed POD PDF
//   (b) a drawn signature alone (no typed name) still signs — the
//       seal records a null name, never an empty string
//   (c) the typed path is unchanged: method "typed", no signature
//       fields, no image in the PDF
//   (d) neither name nor drawing is refused and seals nothing
//   (e) a claimed drawing that isn't a real JPEG (or is oversized)
//       fails closed even with a valid name
//   (f) the driver phone-signature path is untouched: its
//       delivery_confirmed payload carries no signatureMethod field
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-recvsig-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT, blobs } = await import("../../host/ctx");
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

async function seedUser(username: string): Promise<SeededUser> {
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
      chatName: username,
      plan: "diamond",
      heightFt: 6,
      heightIn: 1,
      weightLbs: 200,
      lengthFt: 13,
      mpg: 7,
      dieselPrice: 4,
      tankRangeMi: 800,
    })
    .returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser | null): CtxT {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: u
      ? {
          accountId: u.accountId,
          profileId: u.profileId,
          username: u.username,
          email: u.email,
          isOwner: false,
          status: "active",
          totpPending: false,
          hasTeamSeat: false,
          sessionId: 1,
        }
      : null,
  }).ctx as unknown as CtxT;
}

const driver = await seedUser("sigdriver");
const driverCtx = ctxFor(driver);
const anonCtx = ctxFor(null);

// The drawn signature: synthetic JPEG framing (SOI + APP0 + SOF0
// 600x200 + EOI) — sniffable, dimension-parseable, tiny.
const SIG_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0),
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);
const SIG_B64 = SIG_JPEG.toString("base64");
const SIG_SHA = createHash("sha256").update(SIG_JPEG).digest("hex");
// The dock photo: a DIFFERENT synthetic JPEG (APP1, 660x220) so the
// PDF assertions can tell the two images apart.
const PHOTO_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, ...new Array(14).fill(0),
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xdc, 0x02, 0x94, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);
const PHOTO_B64 = PHOTO_JPEG.toString("base64");

async function makeLoadWithLink(): Promise<{ loadId: number; token: string }> {
  const db = getDb();
  const ins = await db
    .insert(schema.loads)
    .values({
      profileId: driver.profileId,
      shipper: "Acme Steel",
      commodity: "steel coils",
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
    })
    .returning({ id: schema.loads.id });
  const loadId = ins[0]!.id;
  const token = `rcv_${randomBytes(16).toString("hex")}`;
  await db.insert(schema.receiveLinks).values({
    loadId,
    token,
    kind: "action",
    status: "active",
    createdBy: driver.username,
  });
  return { loadId, token };
}

async function confirmedPayload(loadId: number): Promise<Record<string, unknown> | null> {
  const rows = await getDb().select().from(schema.chainLog);
  const hit = rows.filter((r) => r.refKind === "load" && r.refId === loadId && r.event === "delivery_confirmed");
  if (!hit[0]) return null;
  return JSON.parse(hit[0].payload) as Record<string, unknown>;
}

async function podPdfBytes(token: string): Promise<Buffer> {
  const doc = await Actions.getPodCopyDocument.handler(anonCtx, { token } as never);
  expect(doc.ok).toBe(true);
  return Buffer.from(doc.dataBase64!, "base64");
}

describe("receiver signature pad — receive link", () => {
  test("(a) drawn signature + name + dock photo: seals drawn, signature in its own blob, both images in the PDF", async () => {
    const { loadId, token } = await makeLoadWithLink();
    const r = await Actions.confirmReceive.handler(anonCtx, {
      token,
      receiverName: "Sam Receiver",
      exceptionNotes: null,
      photoDataBase64: PHOTO_B64,
      photoMime: "image/jpeg",
      signatureDataBase64: SIG_B64,
      signatureMime: "image/jpeg",
    } as never);
    expect(r.ok).toBe(true);
    expect(r.alreadyConfirmed).toBe(false);

    const p = await confirmedPayload(loadId);
    expect(p).not.toBeNull();
    expect(p!.signatureMethod).toBe("drawn");
    expect(p!.receiverName).toBe("Sam Receiver");
    expect(p!.signatureMime).toBe("image/jpeg");
    expect(p!.signatureSha256).toBe(SIG_SHA);
    expect(p!.signatureBlobKey).toBe(`delivery-signature-${loadId}-${SIG_SHA.slice(0, 16)}`);
    // The dock photo kept the doc slot — the signature did not eat it.
    expect(typeof p!.docBlobKey).toBe("string");
    expect(String(p!.docBlobKey)).toStartWith(`delivery-doc-${loadId}-`);
    expect(p!.docBlobKey).not.toBe(p!.signatureBlobKey);

    // The signature blob holds exactly the drawn bytes, server-side.
    const stored = await blobs.read(String(p!.signatureBlobKey));
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!.bytes).equals(SIG_JPEG)).toBe(true);
    expect(stored!.contentType).toBe("image/jpeg");

    // The signed POD PDF (the receiver's own copy — same builder)
    // carries BOTH images and the printed name.
    const pdf = await podPdfBytes(token);
    expect(pdf.includes(SIG_JPEG)).toBe(true);
    expect(pdf.includes(PHOTO_JPEG)).toBe(true);
    const text = pdf.toString("latin1");
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
    expect(text).toContain("/Width 600 /Height 200"); // the signature's own frame
    expect(text).toContain("Sam Receiver");
    expect(text).toContain("Signature: drawn on the delivery link.");
    expect(text).toContain(`Signature image SHA-256: ${SIG_SHA}`);

    const info = await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    expect(info.status).toBe("confirmed");
    expect(info.signatureMethod).toBe("drawn");
    expect(info.receiverName).toBe("Sam Receiver");
  });

  test("(b) drawn signature alone signs: null name on the seal, drawn marker everywhere", async () => {
    const { loadId, token } = await makeLoadWithLink();
    const r = await Actions.confirmReceive.handler(anonCtx, {
      token,
      receiverName: "",
      exceptionNotes: null,
      photoDataBase64: null,
      photoMime: null,
      signatureDataBase64: SIG_B64,
      signatureMime: "image/jpeg",
    } as never);
    expect(r.ok).toBe(true);

    const p = await confirmedPayload(loadId);
    expect(p!.signatureMethod).toBe("drawn");
    expect(p!.receiverName).toBeNull();

    const info = await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    expect(info.status).toBe("confirmed");
    expect(info.signatureMethod).toBe("drawn");
    expect(info.receiverName).toBeNull();

    const pdf = await podPdfBytes(token);
    expect(pdf.includes(SIG_JPEG)).toBe(true);
    expect(pdf.toString("latin1")).toContain("drawn signature above");
  });

  test("(c) typed path unchanged: method typed, no signature fields, no image in the PDF", async () => {
    const { loadId, token } = await makeLoadWithLink();
    const r = await Actions.confirmReceive.handler(anonCtx, {
      token,
      receiverName: "Tina Typed",
      exceptionNotes: null,
      photoDataBase64: null,
      photoMime: null,
      signatureDataBase64: null,
      signatureMime: null,
    } as never);
    expect(r.ok).toBe(true);

    const p = await confirmedPayload(loadId);
    expect(p!.signatureMethod).toBe("typed");
    expect(p!.signatureBlobKey).toBeNull();
    expect(p!.signatureMime).toBeNull();
    expect(p!.signatureSha256).toBeNull();
    expect(p!.receiverName).toBe("Tina Typed");

    const pdf = await podPdfBytes(token);
    const text = pdf.toString("latin1");
    expect(text).toContain("Tina Typed");
    expect(text).not.toContain("/Subtype /Image");
    expect(text).not.toContain("Signature image SHA-256");
  });

  test("(d) neither name nor drawing is refused and seals nothing", async () => {
    const { loadId, token } = await makeLoadWithLink();
    const r = await Actions.confirmReceive.handler(anonCtx, {
      token,
      receiverName: "",
      exceptionNotes: null,
      photoDataBase64: null,
      photoMime: null,
      signatureDataBase64: null,
      signatureMime: null,
    } as never);
    expect(r.ok).toBe(false);
    expect(await confirmedPayload(loadId)).toBeNull();
    const info = await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    expect(info.canConfirm).toBe(true); // the link is still live for a real signature
    expect(info.status).toBe("awaiting");
  });

  test("(e) a claimed drawing that is not a JPEG — or is oversized — fails closed even with a name", async () => {
    const a = await makeLoadWithLink();
    const notImage = await Actions.confirmReceive.handler(anonCtx, {
      token: a["token"],
      receiverName: "Sam Receiver",
      exceptionNotes: null,
      photoDataBase64: null,
      photoMime: null,
      signatureDataBase64: Buffer.from("this is not an image at all, just text bytes").toString("base64"),
      signatureMime: "image/jpeg",
    } as never);
    expect(notImage.ok).toBe(false);
    expect(await confirmedPayload(a.loadId)).toBeNull();

    const b = await makeLoadWithLink();
    const oversized = Buffer.concat([SIG_JPEG.subarray(0, SIG_JPEG.length - 2), Buffer.alloc(1_600_000, 7), Buffer.from([0xff, 0xd9])]);
    const tooBig = await Actions.confirmReceive.handler(anonCtx, {
      token: b["token"],
      receiverName: "Sam Receiver",
      exceptionNotes: null,
      photoDataBase64: null,
      photoMime: null,
      signatureDataBase64: oversized.toString("base64"),
      signatureMime: "image/jpeg",
    } as never);
    expect(tooBig.ok).toBe(false);
    expect(await confirmedPayload(b.loadId)).toBeNull();
  });

  test("(f) the driver phone-signature path is untouched: no signatureMethod on its seal", async () => {
    const { loadId } = await makeLoadWithLink();
    const r = await Actions.signDeliveryOnPhone.handler(driverCtx, {
      loadId,
      receiverName: "Pat Dockside",
      exceptionNotes: null,
      signatureDataBase64: SIG_B64,
      signatureMime: "image/jpeg",
    } as never);
    expect(r.ok).toBe(true);
    const p = await confirmedPayload(loadId);
    expect(p!.path).toBe("phone_signature");
    expect(String(p!.docBlobKey)).toStartWith(`delivery-doc-${loadId}-`);
    expect("signatureMethod" in p!).toBe(false);
    expect("signatureBlobKey" in p!).toBe(false);
  });
});
