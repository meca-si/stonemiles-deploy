// Pins the Rewards Layer 2 birthday editor's HOME: the My social
// profile edit screen (Settings → My social profile).
//
// The Layer 2 ship defect (found live, 2026-11-15): the month/day
// selects were rendered inside the Settings → Truck fold, bound to
// the saveProfile settings draft — the profile edit screen had no
// birthday fields at all, and its load/save path (getUserProfile /
// updateMyProfile) carried none either, so a driver could never set
// a birthday from the profile editor and the +100 birthday drop
// could never fire from UI input. The fix moved the selects into
// the social profile form. These source pins keep them there.
//
// Run: bun test client/src/birthdayProfile.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const actionsSource = readFileSync(`${import.meta.dir}/../../server/src/actions.ts`, "utf8");

// The My social profile editor: from its section anchor to the
// next Settings section (Automation) that follows it — the whole
// form, its SAVE PROFILE button, and the save call inside it.
const socialStart = appSource.indexOf('id="settings-social"');
const socialEnd = appSource.indexOf("AI runs it — automation", socialStart);
const socialSection = appSource.slice(socialStart, socialEnd);

describe("birthday editor — My social profile", () => {
  test("the social profile section exists and is sliceable", () => {
    expect(socialStart).toBeGreaterThan(-1);
    expect(socialEnd).toBeGreaterThan(socialStart);
    expect(socialSection).toContain("My social profile");
  });

  test("the month and day selects render inside the social profile form", () => {
    expect(socialSection).toContain('id="sp-birth-month"');
    expect(socialSection).toContain('id="sp-birth-day"');
    expect(socialSection).toContain('aria-label="Birth month"');
    expect(socialSection).toContain('aria-label="Birth day"');
    expect(socialSection).toContain("Birthday — month and day only");
    // Bound to the social form state, not the settings draft.
    expect(socialSection).toContain("value={socialForm.birthMonth ?? \"\"}");
    expect(socialSection).toContain("value={socialForm.birthDay ?? \"\"}");
  });

  test("the form loads the saved values from getUserProfile", () => {
    expect(appSource).toContain("birthMonth: p.birthMonth ?? null");
    expect(appSource).toContain("birthDay: p.birthDay ?? null");
  });

  test("SAVE PROFILE sends the birthday through updateMyProfile", () => {
    expect(socialSection).toContain("updateMyProfile({");
    expect(socialSection).toContain("birthMonth: socialForm.birthMonth");
    expect(socialSection).toContain("birthDay: socialForm.birthDay");
  });

  test("the misplaced Truck-fold copy is gone — one editor, one home", () => {
    expect(appSource).not.toContain("set-birth-month");
    expect(appSource).not.toContain("set-birth-day");
  });

  test("no birth-year field exists anywhere — month and day only", () => {
    expect(appSource).not.toMatch(/\bbirthYear\b/);
    expect(appSource).not.toContain("birth_year");
    expect(actionsSource).not.toMatch(/\bbirthYear\b/);
    expect(actionsSource).not.toContain("birth_year");
  });
});
