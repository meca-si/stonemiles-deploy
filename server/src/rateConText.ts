// rateConText — the deterministic read of a rate confirmation's
// PRINTED TEXT (x's build, 2026-11-17: "Whatever we need add it").
//
// Digital rate-con PDFs carry a real text layer. When the client can
// pull that text out of the file (pdfDoc.ts extractPdfText), this
// parser reads it with labels and patterns only — no model, no
// guessing: a field is filled only when the document prints it next
// to a label this parser knows, and anything ambiguous stays null
// for the driver to type. The result shape mirrors extractLoad's
// response so the load form's review flow treats both reads the
// same; the reads differ only in how they got the fields (printed
// text here, Meca's vision read for photos / scanned pages).
//
// Honest limits, by design:
// - Scanned/image PDFs have no text layer — the client never calls
//   this with real content for those; they take the vision path.
// - Layout is flattened to lines, so a value is trusted only when
//   it sits on a labelled line (or the line right after a section
//   label). Free-floating numbers are never promoted to fields.
// - City/state comes from "City, ST 12345" shapes inside the
//   pickup / delivery sections; with no sections, the first two
//   such shapes in document order (origin prints before destination
//   on every rate con this parser targets).

export interface RateConTextFields {
  found: boolean;
  docKind: "rate_con" | "bol" | "load_sheet" | "other" | null;
  shipper: string | null;
  brokerCompany: string | null;
  brokerName: string | null;
  brokerMc: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  pickupAddress: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  deliveryAddress: string | null;
  pickupText: string | null;
  deliveryText: string | null;
  rate: number | null;
  miles: number | null;
  weightLbs: number | null;
  commodity: string | null;
  pieces: number | null;
  sealNumber: string | null;
  loadNumber: string | null;
  poNumber: string | null;
  proNumber: string | null;
  chargesFuelSurcharge: number | null;
  chargesDetention: number | null;
  chargesLumper: number | null;
  chargesOther: number | null;
  chargesTotal: number | null;
  totalPay: number | null;
}

export const EMPTY_RATE_CON_TEXT_FIELDS: RateConTextFields = {
  found: false,
  docKind: null,
  shipper: null,
  brokerCompany: null,
  brokerName: null,
  brokerMc: null,
  pickupCity: null,
  pickupState: null,
  pickupAddress: null,
  deliveryCity: null,
  deliveryState: null,
  deliveryAddress: null,
  pickupText: null,
  deliveryText: null,
  rate: null,
  miles: null,
  weightLbs: null,
  commodity: null,
  pieces: null,
  sealNumber: null,
  loadNumber: null,
  poNumber: null,
  proNumber: null,
  chargesFuelSurcharge: null,
  chargesDetention: null,
  chargesLumper: null,
  chargesOther: null,
  chargesTotal: null,
  totalPay: null,
};

const MONEY = /\$\s?([\d,]+(?:\.\d{1,2})?)/;
const BARE_MONEY = /([\d,]+\.\d{2}|[\d,]+)/;
const DATE =
  /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i;
const TIME = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i;
const CITY_STATE_ZIP = /([A-Za-z][A-Za-z .'-]*?),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/;

function moneyOn(line: string): number | null {
  const m = MONEY.exec(line) ?? BARE_MONEY.exec(line.replace(/,/g, " ").replace(/\s+/g, " ")) ;
  if (!m) return null;
  const v = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** The labelled value on a line: text after the label's colon (or the
 *  rest of the line when the label carries no colon). */
function afterLabel(line: string, label: RegExp): string | null {
  const m = label.exec(line);
  if (!m) return null;
  const rest = line.slice(m.index + m[0].length).replace(/^[:#\s]+/, "").trim();
  return rest || null;
}

function firstMoney(lines: string[], label: RegExp): number | null {
  for (const line of lines) {
    if (label.test(line)) {
      const v = moneyOn(line);
      if (v != null) return v;
    }
  }
  return null;
}

function firstText(lines: string[], label: RegExp): string | null {
  for (const line of lines) {
    const v = afterLabel(line, label);
    if (v) return v;
  }
  return null;
}

function dateNear(lines: string[], label: RegExp): string | null {
  const withTime = (line: string): string | null => {
    const d = DATE.exec(line);
    if (!d) return null;
    const t = TIME.exec(line);
    return t && !d[0].includes(t[0]) ? `${d[0]} ${t[0]}` : d[0];
  };
  // First pass: a line that names the side AND carries a date
  // ("Delivery Date: 11/22/2026 14:00") — wherever it sits.
  for (const line of lines) {
    if (label.test(line)) {
      const v = withTime(line);
      if (v) return v;
    }
  }
  // Second pass: the date under a section heading ("Pickup" then a
  // "Date: …" line beneath it).
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    if (head === undefined || !label.test(head)) continue;
    for (let j = i; j < Math.min(i + 5, lines.length); j++) {
      const lj = lines[j];
      if (lj === undefined) continue;
      const v = withTime(lj);
      if (v) return v;
    }
    return null;
  }
  return null;
}

interface Section {
  city: string | null;
  state: string | null;
  address: string | null;
}

/** City/state (and the street line just above it, when it looks like
 *  a street address) inside one section's lines. */
function sectionPlace(lines: string[]): Section {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = CITY_STATE_ZIP.exec(line);
    if (m) {
      let address: string | null = null;
      if (i > 0) {
        const prev = lines[i - 1];
        // A street line: starts with a number and is not itself a
        // labelled field or a company name line we already used.
        if (prev !== undefined && /^\d+\s+\S/.test(prev) && !/:/.test(prev)) address = prev;
      }
      const inline = line.slice(0, m.index).trim();
      if (!address && /^\d+\s+\S/.test(inline)) address = inline;
      return { city: m[1]!.trim(), state: m[2]!, address };
    }
  }
  return { city: null, state: null, address: null };
}

/** Split the document into pickup / delivery sections by their
 *  heading labels. Returns null sections when no headings exist. */
function splitSections(lines: string[]): { pickup: string[] | null; delivery: string[] | null } {
  const pickupHead = /^(pickup|pick up|shipper|origin|load at|collect)\b/i;
  const deliveryHead = /^(delivery|deliver to|consignee|destination|unload|drop)\b/i;
  let pStart = -1;
  let dStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (pStart < 0 && pickupHead.test(line)) pStart = i;
    if (dStart < 0 && deliveryHead.test(line)) dStart = i;
  }
  if (pStart < 0 && dStart < 0) return { pickup: null, delivery: null };
  const pickup = pStart >= 0 ? lines.slice(pStart, dStart > pStart ? dStart : undefined) : null;
  const delivery = dStart >= 0 ? lines.slice(dStart, pStart > dStart ? pStart : undefined) : null;
  return { pickup, delivery };
}

export function parseRateConText(rawText: string): RateConTextFields {
  const out: RateConTextFields = { ...EMPTY_RATE_CON_TEXT_FIELDS };
  const text = (rawText ?? "").replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return out;
  const whole = lines.join("\n");

  // Document kind from its own header words.
  if (/rate confirmation/i.test(whole)) out.docKind = "rate_con";
  else if (/bill of lading/i.test(whole)) out.docKind = "bol";
  else if (/load (tender|sheet|offer)/i.test(whole)) out.docKind = "load_sheet";

  // Reference numbers — labelled only.
  out.loadNumber =
    firstText(lines, /\b(load|order|shipment|trip|ref(?:erence)?)\s*(#|no\.?|number|id)\b/i) ??
    firstText(lines, /\b(load|order|shipment)\s*#/i);
  out.poNumber = firstText(lines, /\b(p\.?o\.?|purchase order)\s*(#|no\.?|number)?\b/i);
  out.proNumber = firstText(lines, /\bpro\s*(#|no\.?|number)\b/i);
  const mc = /\bMC\s*#?\s*:?\s*(\d{5,8})\b/.exec(whole);
  out.brokerMc = mc?.[1] ?? null;

  // Money — rate / total / itemized charges, all label-led.
  out.chargesFuelSurcharge = firstMoney(lines, /fuel surcharge/i);
  out.chargesDetention = firstMoney(lines, /detention/i);
  out.chargesLumper = firstMoney(lines, /lumper/i);
  out.chargesOther = firstMoney(lines, /(other charges|accessorial(?!.*total))/i);
  out.chargesTotal = firstMoney(lines, /(total (accessorial|additional|charges)|accessorial total)/i);
  out.totalPay = firstMoney(lines, /(grand total|total pay|total amount|total rate|total due|total:)/i);
  out.rate =
    firstMoney(lines, /(linehaul|flat rate|load rate|rate\s*\/|rate:)/i) ??
    firstMoney(lines, /^(rate|amount)\b/i);
  const anyCharges =
    out.chargesFuelSurcharge != null || out.chargesDetention != null || out.chargesLumper != null || out.chargesOther != null || out.chargesTotal != null;
  // (rate fallback runs after the freight fields are read — see
  // below, just before `found` is decided.)

  // Miles — labelled first; a lone "NNN miles" anywhere is a fallback
  // only when exactly one such figure exists in the whole document.
  out.miles = firstMoney(lines, /(loaded miles|total miles|distance|miles:)/i);
  if (out.miles == null) {
    const all = [...whole.matchAll(/([\d,]+(?:\.\d+)?)\s*(?:miles|mi)\b/gi)]
      .map((m) => Number((m[1] ?? "").replace(/,/g, "")))
      .filter((v) => Number.isFinite(v) && v >= 50 && v <= 5000);
    const unique = [...new Set(all)];
    if (unique.length === 1) out.miles = unique[0]!;
  }

  // Weight / pieces / commodity — labelled lines.
  for (const line of lines) {
    if (out.weightLbs == null && /weight/i.test(line)) {
      const w = /([\d,]+)\s*(lbs?|pounds?)\b/i.exec(line);
      if (w) {
        const v = Number(w[1]!.replace(/,/g, ""));
        if (Number.isFinite(v) && v > 0) out.weightLbs = Math.round(v);
      }
    }
    if (out.pieces == null && /\b(pieces|pallets|skids|units|count)\b/i.test(line)) {
      const p = afterLabel(line, /\b(pieces|pallets|skids|units|count)\b/i);
      const v = p ? Number(p.replace(/[^0-9]/g, "")) : NaN;
      if (Number.isFinite(v) && v > 0) out.pieces = Math.round(v);
    }
  }
  out.commodity =
    firstText(lines, /\b(commodity|freight|product|description of goods|goods)\s*:/i) ??
    firstText(lines, /\b(commodity|freight)\b/i);

  // Seal — never from anything but its own label.
  out.sealNumber = firstText(lines, /\bseal\s*(#|no\.?|number)\b/i);

  // Parties — the line after a "Broker:" / "Carrier:" style label is
  // the brokerage on most cons; the shipper name rides the pickup
  // section's first non-address line when it isn't the city line.
  out.brokerCompany =
    firstText(lines, /\bbroker\s*:/i) ?? firstText(lines, /\bbroker company\b/i);
  out.brokerName = firstText(lines, /\b(broker contact|dispatcher|agent)\s*:/i);

  const { pickup, delivery } = splitSections(lines);
  if (pickup) {
    const s = sectionPlace(pickup);
    out.pickupCity = s.city;
    out.pickupState = s.state;
    out.pickupAddress = s.address;
    // Shipper name: the first section line after the heading that is
    // not the street/city line and not a labelled field.
    for (const line of pickup.slice(1)) {
      if (CITY_STATE_ZIP.test(line)) break;
      if (/^\d+\s+\S/.test(line)) continue;
      if (/:/.test(line)) continue;
      if (line.length >= 3) {
        out.shipper = line;
        break;
      }
    }
  }
  if (delivery) {
    const s = sectionPlace(delivery);
    out.deliveryCity = s.city;
    out.deliveryState = s.state;
    out.deliveryAddress = s.address;
  }
  if (!pickup && !delivery) {
    // No sections: first two city/state shapes in order.
    const places: Section[] = [];
    for (const line of lines) {
      const m = CITY_STATE_ZIP.exec(line);
      if (m) places.push({ city: m[1]!.trim(), state: m[2]!, address: null });
      if (places.length === 2) break;
    }
    if (places[0]) {
      out.pickupCity = places[0].city;
      out.pickupState = places[0].state;
    }
    if (places[1]) {
      out.deliveryCity = places[1].city;
      out.deliveryState = places[1].state;
    }
  }

  // Dates — next to their labels, else the first two dates in order.
  out.pickupText = dateNear(lines, /\b(pickup|pick up|ship date|load date|origin)\b/i);
  out.deliveryText = dateNear(lines, /\b(delivery|deliver|due|appointment|destination)\b/i);
  if (!out.pickupText && !out.deliveryText) {
    const dates = [...whole.matchAll(new RegExp(DATE.source, "gi"))].map((m) => m[0]);
    if (dates[0]) out.pickupText = dates[0];
    if (dates[1]) out.deliveryText = dates[1];
  }

  // A single printed total with no itemized charges IS the rate on
  // most flat-rate cons — but only when the document carries freight
  // context (a lane, a weight, a load number, a rate-con header).
  // Without that context a bare "Total:" is just a total (an office
  // invoice has one too) and promotes to nothing.
  const hasFreightContext =
    out.loadNumber != null ||
    out.weightLbs != null ||
    out.miles != null ||
    out.commodity != null ||
    (out.pickupCity != null && out.deliveryCity != null) ||
    out.docKind === "rate_con" ||
    out.docKind === "load_sheet";
  if (out.rate == null && out.totalPay != null && !anyCharges && hasFreightContext) {
    out.rate = out.totalPay;
  }

  // "Found" needs a load signal, not just any money: a bare printed
  // total on an unrelated document (an office-supplies invoice has
  // one) is not a load. A total counts only alongside freight facts.
  const totalWithFreight =
    out.totalPay != null &&
    (out.miles != null || out.weightLbs != null || out.commodity != null || out.docKind === "rate_con");
  out.found =
    out.rate != null ||
    totalWithFreight ||
    out.loadNumber != null ||
    (out.pickupCity != null && out.deliveryCity != null);
  if (out.found && out.docKind == null) out.docKind = "other";
  return out;
}
