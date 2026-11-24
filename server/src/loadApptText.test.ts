// loadApptText.test.ts — the appointment-text reader behind the
// Schedule calendar's pickup/delivery events for hand-added loads.
import { describe, expect, test } from "bun:test";
import { parseLoadApptText } from "./loadApptText";

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

describe("parseLoadApptText", () => {
  test("date-only US format lands at noon UTC on the printed day", () => {
    expect(iso(parseLoadApptText("11/24/2026"))).toBe("2026-11-24T12:00:00.000Z");
    expect(iso(parseLoadApptText("11/25/2026"))).toBe("2026-11-25T12:00:00.000Z");
  });

  test("date + time reads the printed wall time", () => {
    expect(iso(parseLoadApptText("11/24/2026 9:00 PM"))).toBe("2026-11-24T21:00:00.000Z");
    expect(iso(parseLoadApptText("Tue 11/24/26 9PM"))).toBe("2026-11-24T21:00:00.000Z");
    expect(iso(parseLoadApptText("11/25/2026 7AM"))).toBe("2026-11-25T07:00:00.000Z");
    expect(iso(parseLoadApptText("11/24/2026 21:00"))).toBe("2026-11-24T21:00:00.000Z");
  });

  test("month-name and ISO formats", () => {
    expect(iso(parseLoadApptText("Nov 25, 2026 7:00 AM"))).toBe("2026-11-25T07:00:00.000Z");
    expect(iso(parseLoadApptText("November 24, 2026"))).toBe("2026-11-24T12:00:00.000Z");
    expect(iso(parseLoadApptText("2026-11-24"))).toBe("2026-11-24T12:00:00.000Z");
    expect(iso(parseLoadApptText("2026-11-25T07:00:00.000Z"))).toBe("2026-11-25T07:00:00.000Z");
  });

  test("no usable date → null, nothing invented", () => {
    expect(parseLoadApptText(null)).toBeNull();
    expect(parseLoadApptText("")).toBeNull();
    expect(parseLoadApptText("9PM")).toBeNull();
    expect(parseLoadApptText("FCFS")).toBeNull();
    expect(parseLoadApptText("when loaded")).toBeNull();
    expect(parseLoadApptText("13/40/2026")).toBeNull();
    expect(parseLoadApptText("2/31/2026")).toBeNull();
  });
});
