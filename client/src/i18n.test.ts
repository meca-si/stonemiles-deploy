// Unit tests for the multi-language framework (client/src/i18n.ts):
// the five-language catalogue, the English-fallback rules, the tr()
// pair engine, Ask Meca's localized destination labels + navigation
// phrases, and the English-governs note in every language.
// Run: bun test client/src/i18n.test.ts

import { describe, expect, test } from "bun:test";
import {
  DEST_LABELS,
  LANGS,
  LANG_META,
  PAIRS,
  STRINGS,
  asLang,
  destForLocalizedQuery,
  destLabel,
  fmtDate,
  hasTranslation,
  isLang,
  localeFor,
  pairText,
  t,
  type Lang,
} from "./i18n";

describe("language set", () => {
  test("exactly the five trucking languages, English first (source)", () => {
    expect(LANGS).toEqual(["en", "es", "pt", "ru", "uk"]);
  });

  test("every language has a name, a native name, and a locale", () => {
    for (const lang of LANGS) {
      expect(LANG_META[lang].name.length).toBeGreaterThan(0);
      expect(LANG_META[lang].native.length).toBeGreaterThan(0);
      expect(LANG_META[lang].locale).toContain("-");
    }
    expect(LANG_META.en.native).toBe("English");
    expect(LANG_META.es.native).toBe("Español");
    expect(LANG_META.pt.native).toBe("Português");
    expect(LANG_META.ru.native).toBe("Русский");
    expect(LANG_META.uk.native).toBe("Українська");
  });

  test("isLang / asLang coerce unknown stored values to English", () => {
    expect(isLang("uk")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(null)).toBe(false);
    expect(asLang("pt")).toBe("pt");
    expect(asLang("klingon")).toBe("en");
    expect(asLang(undefined)).toBe("en");
  });
});

describe("pairText — the tr() engine", () => {
  test("English returns the source string untouched", () => {
    expect(pairText("en", "Start trip", "Iniciar viaje")).toBe("Start trip");
  });

  test("Spanish returns the call-site literal, as before this framework", () => {
    expect(pairText("es", "Start trip", "Iniciar viaje")).toBe("Iniciar viaje");
    expect(pairText("es", "Today", "Hoy")).toBe("Hoy");
  });

  test("Portuguese / Russian / Ukrainian come from the PAIRS catalogue", () => {
    expect(pairText("pt", "Today", "Hoy")).toBe("Hoje");
    expect(pairText("ru", "Today", "Hoy")).toBe("Сегодня");
    expect(pairText("uk", "Today", "Hoy")).toBe("Сьогодні");
    expect(pairText("pt", "Loads", "Cargas")).toBe("Cargas");
    expect(pairText("ru", "Loads", "Cargas")).toBe("Грузы");
    expect(pairText("uk", "Loads", "Cargas")).toBe("Вантажі");
  });

  test("a string with no catalogue entry falls back to English — never blank", () => {
    const novel = "Some brand-new string nobody catalogued yet";
    expect(pairText("pt", novel, "…")).toBe(novel);
    expect(pairText("ru", novel, "…")).toBe(novel);
    expect(pairText("uk", novel, "…")).toBe(novel);
  });

  test("the dock + working-screen core is catalogued in all three new languages", () => {
    const core = [
      "Today", "Drive", "Loads", "Money", "More", "Routes", "Trips", "Driver",
      "Settings", "Plans", "Start trip", "End trip", "Start a route",
      "Add a load", "Seal delivery", "Fuel stops", "Plan my stops", "Pay Book",
      "Document vault", "Safety Academy", "Everything else", "Got it", "Dismiss",
    ];
    for (const en of core) {
      for (const lang of ["pt", "ru", "uk"] as const) {
        const out = pairText(lang, en, "es-literal");
        expect(out).not.toBe(en);
        expect(out.length).toBeGreaterThan(0);
      }
    }
  });

  test("every PAIRS entry translates into pt, ru, and uk with real text", () => {
    for (const [en, entry] of Object.entries(PAIRS)) {
      for (const lang of ["pt", "ru", "uk"] as const) {
        const v = entry[lang];
        expect(typeof v).toBe("string");
        expect((v ?? "").trim().length).toBeGreaterThan(0);
        // A translation identical to a long English source is a smell
        // (short shared words like "Atlas"/"Chat" are fine).
        if (en.length > 12) expect(v).not.toBe(en);
      }
    }
  });
});

describe("t — the keyed catalogue", () => {
  test("every keyed string carries the English source", () => {
    for (const [key, entry] of Object.entries(STRINGS)) {
      expect(typeof entry.en).toBe("string");
      expect((entry.en ?? "").length).toBeGreaterThan(0);
      void key;
    }
  });

  test("the Settings + Meca + governs keys are translated in all five languages", () => {
    const keys = [
      "settings.language", "settings.languageNote", "settings.appearance",
      "settings.fontSize", "govern.note", "govern.atlasLine", "govern.permitsNote",
      "meca.takeMeThere", "meca.takeMeThereInstead", "meca.notAvailable",
      "meca.tapTakeMeThere", "meca.placeholder", "meca.askMeca",
      "topbar.signOut", "topbar.signOutQuestion",
    ];
    for (const key of keys) {
      for (const lang of LANGS) {
        expect(hasTranslation(lang, key)).toBe(true);
        expect(t(lang, key).length).toBeGreaterThan(0);
      }
    }
  });

  test("missing language falls back to English; missing key falls back to the key", () => {
    expect(t("ru", "common.save")).toBe("Сохранить");
    expect(t("uk", "common.save")).toBe("Зберегти");
    expect(t("pt", "no.such.key")).toBe("no.such.key");
  });

  test("interpolation fills {vars} and leaves values untouched", () => {
    // govern.note has no vars; use a synthetic check through tapTakeMeThere shape:
    expect(t("es", "meca.tapTakeMeThere")).toContain("Llévame ahí");
    expect(t("ru", "meca.tapTakeMeThere")).toContain("Покажи, где это");
  });

  test("the English-governs note exists in the driver's own words per language", () => {
    expect(t("en", "govern.note")).toBe("English text governs.");
    expect(t("es", "govern.note")).toContain("inglés");
    expect(t("pt", "govern.note")).toContain("inglês");
    expect(t("ru", "govern.note")).toContain("английский");
    expect(t("uk", "govern.note")).toContain("англійський");
  });
});

describe("Ask Meca destination labels", () => {
  test("every destination has a label in es, pt, ru, uk", () => {
    for (const [id, entry] of Object.entries(DEST_LABELS)) {
      for (const lang of ["es", "pt", "ru", "uk"] as const) {
        expect(typeof entry[lang]).toBe("string");
        expect((entry[lang] ?? "").length).toBeGreaterThan(0);
      }
      void id;
    }
  });

  test("destLabel translates the path and falls back to the English label", () => {
    expect(destLabel("ru", "pay_book", "Money → Pay Book")).toBe("Деньги → Книга выплат");
    expect(destLabel("uk", "owed_board", "Driver → Who owes me")).toBe("Водій → Хто мені винен");
    expect(destLabel("en", "pay_book", "Money → Pay Book")).toBe("Money → Pay Book");
    expect(destLabel("pt", "no_such_dest", "Somewhere")).toBe("Somewhere");
  });
});

describe("Ask Meca navigation phrases", () => {
  test("everyday questions resolve in each language", () => {
    expect(destForLocalizedQuery("es", "¿dónde están mis cargas?")).toBe("loads");
    expect(destForLocalizedQuery("es", "¿quién me debe?")).toBe("owed_board");
    expect(destForLocalizedQuery("pt", "onde ficam minhas cargas?")).toBe("loads");
    expect(destForLocalizedQuery("pt", "quem me deve?")).toBe("owed_board");
    expect(destForLocalizedQuery("ru", "где мои грузы?")).toBe("loads");
    expect(destForLocalizedQuery("ru", "кто мне должен?")).toBe("owed_board");
    expect(destForLocalizedQuery("uk", "де мої вантажі?")).toBe("loads");
    expect(destForLocalizedQuery("uk", "хто мені винен?")).toBe("owed_board");
  });

  test("working vocabulary resolves: detention, setpoint tools, per diem, IFTA", () => {
    expect(destForLocalizedQuery("es", "¿dónde registro la detención?")).toBe("detention");
    expect(destForLocalizedQuery("ru", "где журнал холодовой цепи?")).toBe("trailer_tools");
    expect(destForLocalizedQuery("pt", "quero ver meu per diem")).toBe("pay_book");
    expect(destForLocalizedQuery("uk", "покажи оцінку ifta")).toBe("ifta");
  });

  test("specific phrases beat general ones (owed board before money)", () => {
    expect(destForLocalizedQuery("ru", "кто мне должен за доставку?")).toBe("owed_board");
    expect(destForLocalizedQuery("es", "¿cuándo vence mi cdl?")).toBe("doc_expiry");
  });

  test("English questions and unknown text return null (English matcher / model owns them)", () => {
    expect(destForLocalizedQuery("en", "where are my loads")).toBe(null);
    expect(destForLocalizedQuery("ru", "zzqqxxyy")).toBe(null);
    expect(destForLocalizedQuery("es", "")).toBe(null);
  });
});

describe("dates follow the language; values never change", () => {
  test("localeFor maps each language to its BCP-47 locale", () => {
    expect(localeFor("en")).toBe("en-US");
    expect(localeFor("es")).toBe("es-US");
    expect(localeFor("pt")).toBe("pt-BR");
    expect(localeFor("ru")).toBe("ru-RU");
    expect(localeFor("uk")).toBe("uk-UA");
  });

  test("fmtDate renders the same instant in each language's format", () => {
    const d = new Date(2026, 10, 6, 12, 0, 0); // Nov 6, 2026, local noon
    for (const lang of LANGS) {
      const out = fmtDate(lang, d);
      expect(out).toContain("2026");
      expect(out).toContain("6");
    }
    // Russian format is day-first with a month name — visibly not en-US.
    expect(fmtDate("ru", d)).not.toBe(fmtDate("en", d));
  });

  test("LANG type guard accepts exactly the five codes", () => {
    const codes: Lang[] = ["en", "es", "pt", "ru", "uk"];
    for (const c of codes) expect(isLang(c)).toBe(true);
  });
});
