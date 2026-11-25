// loadApptText.ts — read an appointment moment out of a hand load's
// free-text pickup / delivery fields ("11/24/2026", "Tue 11/24/26
// 9:00 PM", "Nov 25, 2026 7AM", ISO strings) so the driver's own
// loads can sit on the Schedule calendar at their APPOINTMENT times
// instead of only at the moment the load was typed in.
//
// Honesty rules: a string with no recognizable date yields null —
// nothing is invented. A date with no time lands at 12:00 wall time
// so it stays on the same calendar day in the reader's timezone. A
// stated time is the WALL time the driver typed / the document
// printed, in the reader's own timezone: the caller hands in the
// device's UTC offset (the getInspectionPacket utcOffsetMinutes
// pattern) and the instant is built from it. (Before 2026-11-24 the
// wall time was built as UTC, so a 9:00 PM pickup showed on the
// Schedule at 4:00 PM Eastern — five hours early.) The offset is
// the one in force when the calendar is read; an appointment that
// straddles a DST change can sit an hour off, which is still the
// entered day and near the entered hour — never five hours early.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Extract a "HH:MM" / "9PM" / "0900" style time from text.
 *  Returns { h, m } in 24h wall time, or null when no time is
 *  stated (or the stated time is impossible). */
function timeIn(text: string): { h: number; m: number } | null {
  const t = text.replace(/,/g, " ");
  // 9:00 PM / 9:00PM / 21:00 / 9:00
  let m = /(?<!\d)(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\b/.exec(t) ?? /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/.exec(t);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3]?.toLowerCase();
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h, m: min };
  }
  // 9PM / 9 PM / 7AM — the 1–12 check runs on the PRINTED hour,
  // before the PM adjustment (an adjusted 21 is a fine hour).
  m = /\b(\d{1,2})\s*([AaPp])\.?[Mm]\b/.exec(t);
  if (m) {
    const raw = Number(m[1]);
    if (raw < 1 || raw > 12) return null;
    let h = raw;
    const ap = m[2]?.toLowerCase();
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    return { h, m: 0 };
  }
  // 0900 / 2100 military, only as a standalone token — and never a
  // 4-digit year (the "2026" in a date is a year, not 20:26), so
  // year tokens are blanked before this pattern runs.
  const noYears = t.replace(/\b(?:19|20|21)\d{2}\b/g, " ");
  m = /(?<![\d/:.\-])([01]\d|2[0-3])([0-5]\d)(?![\d/:.\-])/.exec(noYears);
  if (m) return { h: Number(m[1]), m: Number(m[2]) };
  return null;
}

function buildMs(year: number, month: number, day: number, time: { h: number; m: number } | null, utcOffsetMinutes: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  // The wall time is built as if UTC, then shifted by the reader's
  // offset (Date.getTimezoneOffset semantics: minutes to add to the
  // wall time to reach UTC — +300 for Eastern standard).
  const ms = Date.UTC(year, month - 1, day, time ? time.h : 12, time ? time.m : 0) + utcOffsetMinutes * 60_000;
  // Reject rollovers (e.g. Feb 31 → Mar 3) — checked on the wall
  // clock, i.e. the unshifted UTC fields.
  const d = new Date(ms - utcOffsetMinutes * 60_000);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ms;
}

/** Parse an appointment date (+ optional time) out of free text.
 *  Epoch ms, or null when the text carries no usable date.
 *  `utcOffsetMinutes` is the reading device's offset in
 *  Date.getTimezoneOffset() semantics (default 0 = the pre-fix UTC
 *  reading, kept for callers that have no device to ask). */
export function parseLoadApptText(text: string | null | undefined, utcOffsetMinutes = 0): number | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  const off = Number.isFinite(utcOffsetMinutes) ? Math.max(-840, Math.min(840, Math.round(utcOffsetMinutes))) : 0;

  // ISO: 2026-11-24 (optionally with a T/space time after it — the
  // T is a word character, so the guard is "not a digit", not \b).
  let m = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(t);
  if (m) return buildMs(Number(m[1]), Number(m[2]), Number(m[3]), timeIn(t), off);

  // US numeric: 11/24/2026, 11/24/26, 11-24-2026.
  m = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?!\d)/.exec(t);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return buildMs(year, Number(m[1]), Number(m[2]), timeIn(t), off);
  }

  // Month name: Nov 24, 2026 / November 24 2026 / 24 Nov 2026.
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/i.exec(t);
  if (m) return buildMs(Number(m[3]), MONTHS[m[1]!.toLowerCase()]!, Number(m[2]), timeIn(t), off);
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})\b/i.exec(t);
  if (m) return buildMs(Number(m[3]), MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), timeIn(t), off);

  return null;
}
