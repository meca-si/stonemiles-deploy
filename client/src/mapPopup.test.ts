// Unit tests for the small on-map place popup's see-through
// treatment (client/src/mapPopup.ts + the .sm-map-popup rules in
// theme.css) — driver order 2026-11-03, REPAIR B: the small popup
// ("Weigh station OPEN — reported 9d ago …") loses its solid box;
// the background is fully see-through with at most a hairline
// outline, and the map reads beneath. Legibility in day AND night
// map modes comes from the white text's heavy dark halo.
// Run: bun test client/src/mapPopup.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MAP_POPUP_BACKGROUND,
  MAP_POPUP_BORDER,
  MAP_POPUP_BOX_SHADOW,
  MAP_POPUP_TEXT_COLOR,
  MAP_POPUP_TEXT_SHADOW,
  mapPopupTextStyle,
} from "./mapPopup";

describe("small place popup — see-through, not a solid box (REPAIR B)", () => {
  test("the background is fully transparent", () => {
    expect(MAP_POPUP_BACKGROUND).toBe("transparent");
  });

  test("the outline is at most a hairline: a single 1px border, no fill", () => {
    expect(MAP_POPUP_BORDER.startsWith("1px solid")).toBe(true);
    expect(MAP_POPUP_BORDER).not.toContain("2px");
  });

  test("there is no drop-shadow box behind the text", () => {
    expect(MAP_POPUP_BOX_SHADOW).toBe("none");
  });

  test("legibility rides on the text: white letters with a dark halo for day + night maps", () => {
    expect(MAP_POPUP_TEXT_COLOR).toBe("#ffffff");
    // The halo is layered dark shadow (the day-map contrast source);
    // without it, white text on the pale day basemap would wash out.
    expect(MAP_POPUP_TEXT_SHADOW).toContain("rgba(0, 0, 0");
    expect(MAP_POPUP_TEXT_SHADOW.split(",").length).toBeGreaterThanOrEqual(3);
    const style = mapPopupTextStyle();
    expect(style).toContain(`color:${MAP_POPUP_TEXT_COLOR}`);
    expect(style).toContain(`text-shadow:${MAP_POPUP_TEXT_SHADOW}`);
  });

  test("theme.css mirrors the same see-through treatment for .sm-map-popup (no drift, no solid fill returns)", () => {
    const css = readFileSync(`${import.meta.dir}/theme.css`, "utf8");
    const block = /\.sm-map-popup \.maplibregl-popup-content \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("background: transparent");
    expect(block).toContain("border: 1px solid rgba(246, 196, 83, 0.38)");
    expect(block).toContain("box-shadow: none");
    // The old solid panel must never come back.
    expect(block).not.toContain("rgba(8, 13, 28, 0.95)");
    const tip = /\.sm-map-popup \.maplibregl-popup-tip \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(tip).toContain("transparent");
    expect(tip).not.toContain("rgba(8, 13, 28, 0.95)");
  });
});
