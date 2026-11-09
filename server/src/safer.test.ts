import { describe, expect, test } from "bun:test";
import {
authorityDigits,
endorsementLabel,
endorsementsToStored,
parseEndorsements,
saferUrlFor,
saferUrlForDot,
saferUrlForMc,
} from "./safer";

describe("SAFER Web auto-link", () => {
  test("USDOT link matches the live SAFER snapshot URL shape", () => {
    expect(saferUrlForDot("293351")).toBe(
      "https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=293351",
    );
  });

  test("MC link uses the MC_MX query param, digits only", () => {
    expect(saferUrlForMc("MC-812024")).toBe(
      "https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=812024",
    );
    expect(saferUrlForMc("812024")).toBe(saferUrlForMc("MC 812024"));
  });

  test("prefixed / spaced DOT entries link by their digits", () => {
    expect(authorityDigits("USDOT 3 933 51")).toBe("393351");
    expect(saferUrlForDot("DOT #1234567")).toContain("query_string=1234567");
  });

  test("no digits, no link — never a dead or invented URL", () => {
    expect(saferUrlForDot(null)).toBeNull();
    expect(saferUrlForDot("")).toBeNull();
    expect(saferUrlForDot("not filed")).toBeNull();
    expect(saferUrlForMc(undefined)).toBeNull();
    expect(saferUrlFor({ dotNumber: null, mcNumber: null })).toBeNull();
  });

  test("DOT wins when both numbers are on file; MC is the fallback", () => {
    expect(saferUrlFor({ dotNumber: "293351", mcNumber: "812024" })).toContain("query_param=USDOT");
    expect(saferUrlFor({ dotNumber: null, mcNumber: "812024" })).toContain("query_param=MC_MX");
    expect(saferUrlFor({ dotNumber: "  ", mcNumber: "812024" })).toContain("query_param=MC_MX");
  });
});

describe("CDL endorsements", () => {
  test("round-trips the full federal set in catalog order", () => {
    const all = ["school_bus", "hazmat", "passenger", "tanker", "hazmat_tanker", "doubles_triples"];
    const stored = endorsementsToStored(all);
    expect(stored).toBe("hazmat,tanker,doubles_triples,hazmat_tanker,passenger,school_bus");
    expect(parseEndorsements(stored)).toEqual([
      "hazmat",
      "tanker",
      "doubles_triples",
      "hazmat_tanker",
      "passenger",
      "school_bus",
    ]);
  });

  test("unknown keys are dropped on write and on read — never invented", () => {
    expect(endorsementsToStored(["hazmat", "rocket_ship"])).toBe("hazmat");
    expect(parseEndorsements("hazmat,rocket_ship,, tanker ")).toEqual(["hazmat", "tanker"]);
    expect(parseEndorsements(null)).toEqual([]);
    expect(parseEndorsements("")).toEqual([]);
  });

  test("duplicates collapse", () => {
    expect(endorsementsToStored(["tanker", "tanker"])).toBe("tanker");
    expect(parseEndorsements("tanker,tanker")).toEqual(["tanker"]);
  });

  test("labels carry the license letter", () => {
    expect(endorsementLabel("hazmat")).toBe("Hazmat (H)");
    expect(endorsementLabel("hazmat_tanker")).toBe("Hazmat + Tanker (X)");
  });
});
