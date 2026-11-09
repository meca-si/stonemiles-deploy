// Academy overlay integrity: the pt/ru/uk overlay must stay index-aligned
// with the built-in COURSES data — same courses, same lesson counts,
// same quiz counts, and the SAME number of options per question in the
// same order (grading is by option index on the server, so a drifted
// overlay would silently grade the wrong answer).
import { describe, expect, test } from "bun:test";
import { ACADEMY_I18N, academyOverlayLang } from "./academyI18n";
import { COURSES } from "./SafetyAcademy";

const LANGS = ["pt", "ru", "uk"] as const;

describe("academy i18n overlay", () => {
  test("covers every course exactly once", () => {
    expect(Object.keys(ACADEMY_I18N).sort()).toEqual(COURSES.map((c) => c.id).sort());
  });

  test("lessons and quiz stay index-aligned with the English source", () => {
    for (const course of COURSES) {
      const overlay = ACADEMY_I18N[course.id];
      if (!overlay) throw new Error(`missing overlay for ${course.id}`);
      expect(overlay.lessons.length).toBe(course.lessons.length);
      expect(overlay.quiz.length).toBe(course.quiz.length);
      course.quiz.forEach((q, qi) => {
        const oq = overlay.quiz[qi];
        if (!oq) throw new Error(`missing quiz overlay ${course.id}#${qi}`);
        for (const lang of LANGS) {
          expect(oq.opts[lang].length).toBe(q.optsEn.length);
          expect(oq.q[lang].length).toBeGreaterThan(0);
          expect(oq.opts[lang].every((o) => o.length > 0)).toBe(true);
        }
      });
      course.lessons.forEach((_, li) => {
        const ol = overlay.lessons[li];
        if (!ol) throw new Error(`missing lesson overlay ${course.id}#${li}`);
        for (const lang of LANGS) {
          expect(ol.title[lang].length).toBeGreaterThan(0);
          expect(ol.body[lang].length).toBeGreaterThan(0);
        }
      });
      for (const lang of LANGS) {
        expect(overlay.title[lang].length).toBeGreaterThan(0);
        expect(overlay.blurb[lang].length).toBeGreaterThan(0);
      }
    }
  });

  test("overlay language gate: only pt/ru/uk use the overlay", () => {
    expect(academyOverlayLang("pt")).toBe("pt");
    expect(academyOverlayLang("ru")).toBe("ru");
    expect(academyOverlayLang("uk")).toBe("uk");
    expect(academyOverlayLang("en")).toBeNull();
    expect(academyOverlayLang("es")).toBeNull();
  });
});
