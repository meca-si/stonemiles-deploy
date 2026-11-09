import { describe, expect, test } from "bun:test";
import {
ACCOUNT_SHELL_KEYS,
FORBIDDEN_SHELL_KEY_PARTS,
accountMatchesQuery,
boardConflicts,
boardLineageKey,
buildAccountShell,
inviteEmailMatches,
isItemConsentKind,
isTeamInviteCode,
isTeamSeatRole,
isTeamTier,
itemKindLabel,
itemWindowState,
maskInviteEmail,
maskTeamInviteCode,
normalizeTeamInviteCode,
otherCodeFamily,
isTeamContactEmail,
teamActionLabel,
teamContactFooter,
teamInviteState,
TEAM_CONTACT_EMAIL,
TEAM_CONTACT_NAME,
TEAM_INVITE_TTL_MS,
ITEM_CONSENT_WINDOW_MS,
type AccountShellInput,
type BoardRowLite,
} from "./teamPortal";

const base: AccountShellInput = {
  username: "driver1",
  displayName: "Dana Driver",
  email: "dana@example.com",
  accountType: "driver",
  tier: "gold",
  companyName: null,
  trucks: null,
  dispatchSeats: null,
  adminSuspended: false,
  locked: false,
  betaAccess: true,
  signupAt: new Date("2026-10-01T12:00:00.000Z"),
};

describe("Team Portal — account shell whitelist (the wall)", () => {
  test("a shell carries exactly the whitelisted keys, nothing else", () => {
    const shell = buildAccountShell(base);
    expect(Object.keys(shell).sort()).toEqual([...ACCOUNT_SHELL_KEYS].sort());
  });

  test("no shell key names a sensitive domain", () => {
    for (const key of ACCOUNT_SHELL_KEYS) {
      for (const part of FORBIDDEN_SHELL_KEY_PARTS) {
        expect(key.toLowerCase().includes(part)).toBe(false);
      }
    }
  });

  test("sensitive fields stuffed into the input never reach the shell", () => {
    const stuffed = {
      ...base,
      payEntries: [{ gross: 5000 }],
      payBookTotal: 12345,
      passwordHash: "sha256:deadbeef",
      pinHash: "sha256:cafe",
      walletPrivateKey: "0xabc",
      seedPhrase: "word ".repeat(12),
      documentBlobKey: "blob-1",
      chatMessages: ["hi"],
      cardNumber: "4242424242424242",
    } as unknown as AccountShellInput;
    const shell = buildAccountShell(stuffed);
    const json = JSON.stringify(shell);
    expect(Object.keys(shell).sort()).toEqual([...ACCOUNT_SHELL_KEYS].sort());
    expect(json).not.toContain("deadbeef");
    expect(json).not.toContain("seed");
    expect(json).not.toContain("4242");
    expect(json).not.toContain("12345");
  });

  test("status precedence: suspended beats locked beats active", () => {
    expect(buildAccountShell({ ...base, adminSuspended: true, locked: true }).status).toBe("suspended");
    expect(buildAccountShell({ ...base, locked: true }).status).toBe("locked");
    expect(buildAccountShell(base).status).toBe("active");
  });

  test("display name falls back to the username; signup renders ISO or null", () => {
    expect(buildAccountShell({ ...base, displayName: null }).displayName).toBe("driver1");
    expect(buildAccountShell({ ...base, displayName: "  " }).displayName).toBe("driver1");
    expect(buildAccountShell(base).signupAt).toBe("2026-10-01T12:00:00.000Z");
    expect(buildAccountShell({ ...base, signupAt: null }).signupAt).toBeNull();
  });
});

describe("Team Portal — lookup matching", () => {
  const shell = buildAccountShell(base);
  test("matches name, username, or email, case-insensitive", () => {
    expect(accountMatchesQuery(shell, "dana")).toBe(true);
    expect(accountMatchesQuery(shell, "DRIVER1")).toBe(true);
    expect(accountMatchesQuery(shell, "EXAMPLE.COM")).toBe(true);
    expect(accountMatchesQuery(shell, "nobody")).toBe(false);
  });
  test("empty query browses everything", () => {
    expect(accountMatchesQuery(shell, "")).toBe(true);
    expect(accountMatchesQuery(shell, "   ")).toBe(true);
  });
});

describe("Team Portal — double-booking detection across both boards", () => {
  const row = (p: Partial<BoardRowLite>): BoardRowLite => ({
    id: 1,
    boardScope: "fleet",
    status: "open",
    overflowFromBoardLoadId: null,
    brokerPosterLoadId: null,
    loadId: null,
    ...p,
  });

  test("a healthy overflow (fleet row overflowed, open copy open) is NOT a conflict", () => {
    const rows = [
      row({ id: 10, status: "overflowed" }),
      row({ id: 11, boardScope: "open", overflowFromBoardLoadId: 10 }),
    ];
    expect(boardConflicts(rows).size).toBe(0);
    expect(boardLineageKey(rows[1]!)).toBe("fleet:10");
  });

  test("fleet row still open beside its open copy IS a conflict", () => {
    const rows = [
      row({ id: 10, status: "open" }),
      row({ id: 11, boardScope: "open", overflowFromBoardLoadId: 10 }),
    ];
    const c = boardConflicts(rows);
    expect(c.get(10)).toContain("more than one board");
    expect(c.get(11)).toContain("more than one board");
  });

  test("claimed on the fleet board and still open on the open board IS a conflict", () => {
    const rows = [
      row({ id: 10, status: "taken", loadId: 55 }),
      row({ id: 11, boardScope: "open", overflowFromBoardLoadId: 10 }),
    ];
    expect(boardConflicts(rows).get(11)).toContain("still open on another");
  });

  test("claimed twice (both copies taken) IS a conflict", () => {
    const rows = [
      row({ id: 10, status: "taken", loadId: 55 }),
      row({ id: 11, boardScope: "open", status: "taken", overflowFromBoardLoadId: 10, loadId: 56 }),
    ];
    expect(boardConflicts(rows).get(10)).toContain("claimed on more than one board");
  });

  test("the same driver load claimed from two rows IS a conflict even across lineages", () => {
    const rows = [
      row({ id: 20, status: "taken", loadId: 77 }),
      row({ id: 21, boardScope: "open", status: "taken", brokerPosterLoadId: 5, loadId: 77 }),
    ];
    expect(boardConflicts(rows).get(20)).toContain("same driver load");
    expect(boardConflicts(rows).get(21)).toContain("same driver load");
  });

  test("two broker copies of one portal load open at once IS a conflict", () => {
    const rows = [
      row({ id: 30, boardScope: "open", brokerPosterLoadId: 9 }),
      row({ id: 31, boardScope: "open", brokerPosterLoadId: 9 }),
    ];
    expect(boardConflicts(rows).size).toBe(2);
  });

  test("unrelated open loads are clean", () => {
    const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3, boardScope: "open", brokerPosterLoadId: 4 })];
    expect(boardConflicts(rows).size).toBe(0);
  });
});

describe("Team Portal — vocabularies", () => {
  test("tiers and seat roles are closed sets", () => {
    expect(isTeamTier("gold")).toBe(true);
    expect(isTeamTier("owner")).toBe(true);
    expect(isTeamTier("platinum")).toBe(false);
    expect(isTeamSeatRole("developer")).toBe(true);
    expect(isTeamSeatRole("support")).toBe(true);
    expect(isTeamSeatRole("owner")).toBe(false);
  });
  test("audit action labels read plain", () => {
    expect(teamActionLabel("unlock_account")).toBe("Account unlocked");
    expect(teamActionLabel("set_tier")).toBe("Tier changed");
    expect(teamActionLabel("mystery")).toBe("mystery");
  });
});

describe("Team Portal — consent-gated item windows", () => {
  test("item kinds are a closed set with NO password/seed/credential kind", () => {
    expect(isItemConsentKind("pay_entry")).toBe(true);
    expect(isItemConsentKind("pay_stub")).toBe(true);
    expect(isItemConsentKind("document")).toBe(true);
    expect(isItemConsentKind("password")).toBe(false);
    expect(isItemConsentKind("seed_phrase")).toBe(false);
    expect(isItemConsentKind("payment_credentials")).toBe(false);
    expect(isItemConsentKind("messages")).toBe(false);
    expect(itemKindLabel("pay_entry")).toBe("Pay Book entry");
  });
  test("the window is exactly 30 minutes", () => {
    expect(ITEM_CONSENT_WINDOW_MS).toBe(30 * 60 * 1000);
  });
  test("an active window past its expiry reads expired; before it reads active", () => {
    const t0 = 1_000_000;
    expect(itemWindowState({ status: "active", expiresAtMs: t0 + ITEM_CONSENT_WINDOW_MS }, t0 + 1)).toBe("active");
    expect(itemWindowState({ status: "active", expiresAtMs: t0 + ITEM_CONSENT_WINDOW_MS }, t0 + ITEM_CONSENT_WINDOW_MS)).toBe("expired");
    expect(itemWindowState({ status: "active", expiresAtMs: t0 + ITEM_CONSENT_WINDOW_MS }, t0 + ITEM_CONSENT_WINDOW_MS + 1)).toBe("expired");
  });
  test("pending / denied / revoked states pass through untouched by the clock", () => {
    expect(itemWindowState({ status: "pending", expiresAtMs: null }, Date.now())).toBe("pending");
    expect(itemWindowState({ status: "denied", expiresAtMs: null }, Date.now())).toBe("denied");
    expect(itemWindowState({ status: "revoked", expiresAtMs: 1 }, Date.now())).toBe("revoked");
  });
});

describe("Team Portal — team invite codes (the ONLY way a seat is granted)", () => {
  test("the TEAM- format is its own namespace, distinct from every other code family", () => {
    expect(isTeamInviteCode("TEAM-AB3D-EF5H-JK7M")).toBe(true);
    expect(isTeamInviteCode("team-ab3d-ef5h-jk7m")).toBe(true); // case-insensitive after normalize
    expect(normalizeTeamInviteCode("  team-ab3d-ef5h-jk7m ")).toBe("TEAM-AB3D-EF5H-JK7M");
    // Referral, beta/driver, and owner codes are NEVER team invites.
    expect(isTeamInviteCode("MILE-REF-AB3DEF")).toBe(false);
    expect(isTeamInviteCode("MILE-AB3D-EF5H")).toBe(false);
    expect(isTeamInviteCode("MILE-X-OWNER1")).toBe(false);
    // Wrong shapes refuse too: beta length, missing group, bad letters.
    expect(isTeamInviteCode("TEAM-AB3D-EF5H")).toBe(false);
    expect(isTeamInviteCode("TEAM-AB3D-EF5H-JK7")).toBe(false);
    expect(isTeamInviteCode("TEAM-ABID-EF5H-JK7M")).toBe(false); // I is not in the alphabet
    expect(isTeamInviteCode("TEAM-ABLD-EF5H-JK7M")).toBe(false); // neither is L
    expect(isTeamInviteCode("")).toBe(false);
  });

  test("other code families are named so a redemption can refuse them plainly", () => {
    expect(otherCodeFamily("MILE-REF-AB3DEF")).toBe("referral");
    expect(otherCodeFamily("mile-ref-ab3def")).toBe("referral");
    expect(otherCodeFamily("MILE-AB3D-EF5H")).toBe("beta_or_driver");
    expect(otherCodeFamily("MILE-X-OWNER1")).toBe("beta_or_driver");
    expect(otherCodeFamily("TEAM-AB3D-EF5H-JK7M")).toBeNull();
    expect(otherCodeFamily("hello")).toBeNull();
  });

  test("redemption matches the invite email exactly (trim + case only)", () => {
    expect(inviteEmailMatches("Dev@Example.com", "dev@example.com")).toBe(true);
    expect(inviteEmailMatches(" dev@example.com ", "dev@example.com")).toBe(true);
    expect(inviteEmailMatches("dev@example.com", "other@example.com")).toBe(false);
    expect(inviteEmailMatches("dev@example.com", null)).toBe(false);
    expect(inviteEmailMatches("dev@example.com", "")).toBe(false);
    expect(inviteEmailMatches("", "dev@example.com")).toBe(false);
  });

  test("masks hide the full email and the full code", () => {
    expect(maskInviteEmail("dev@example.com")).toBe("d•••@example.com");
    expect(maskInviteEmail("not-an-email")).toBe("a different email address");
    expect(maskTeamInviteCode("TEAM-AB3D-EF5H-JK7M")).toBe("TEAM-••••-••••-JK7M");
    expect(maskTeamInviteCode("TEAM-AB3D-EF5H-JK7M")).not.toContain("AB3D");
  });

  test("invites live 7 days; a pending invite past expiry reads expired", () => {
    expect(TEAM_INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const t0 = 1_000_000;
    expect(teamInviteState({ status: "pending", expiresAtMs: t0 + TEAM_INVITE_TTL_MS }, t0 + 1)).toBe("pending");
    expect(teamInviteState({ status: "pending", expiresAtMs: t0 + TEAM_INVITE_TTL_MS }, t0 + TEAM_INVITE_TTL_MS)).toBe("expired");
    expect(teamInviteState({ status: "redeemed", expiresAtMs: t0 }, t0 + TEAM_INVITE_TTL_MS + 1)).toBe("redeemed");
    expect(teamInviteState({ status: "revoked", expiresAtMs: t0 + TEAM_INVITE_TTL_MS }, t0 + 1)).toBe("revoked");
  });

  test("invite audit actions have plain labels", () => {
    expect(teamActionLabel("invite_issued")).toContain("invite issued");
    expect(teamActionLabel("invite_redeemed")).toContain("redeemed");
    expect(teamActionLabel("invite_revoked")).toContain("revoked");
  });
});

describe("Team Portal — team contact email (stonervisionteam@gmail.com)", () => {
  test("the locked team mailbox is the Stonervision team address, not RUGGS LOGISTICS", () => {
    expect(TEAM_CONTACT_EMAIL).toBe("stonervisionteam@gmail.com");
    expect(TEAM_CONTACT_EMAIL).not.toBe("ruggsllc7@gmail.com");
    expect(TEAM_CONTACT_NAME).toBe("Stonervision Team");
  });
  test("isTeamContactEmail matches only the team mailbox, case-insensitive", () => {
    expect(isTeamContactEmail("stonervisionteam@gmail.com")).toBe(true);
    expect(isTeamContactEmail("  StonerVisionTeam@Gmail.com ")).toBe(true);
    expect(isTeamContactEmail("ruggsllc7@gmail.com")).toBe(false);
    expect(isTeamContactEmail("owner@example.com")).toBe(false);
    expect(isTeamContactEmail(null)).toBe(false);
    expect(isTeamContactEmail(undefined)).toBe(false);
    expect(isTeamContactEmail("")).toBe(false);
  });
  test("the contact footer names the team mailbox", () => {
    expect(teamContactFooter()).toContain("stonervisionteam@gmail.com");
    expect(teamContactFooter()).toContain("Stonervision Team");
  });
});
