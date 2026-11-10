// pdfDoc — a small, dependency-free PDF writer for Library documents
// (x, 2026-11-10: every Library item prints / downloads / emails as a
// real document). The codebase's export machinery returns a file body
// + filename from a server action (see exportIftaReport); this module
// is the PDF half of that machinery — US Letter, business-clean, text
// only, no app chrome. Deterministic: the same input always produces
// the same bytes (no clock, no random ids), so a filing regenerated
// from sealed data matches the filing that was listed.
//
// Layout: Helvetica / Helvetica-Bold, 54pt margins (504pt text width),
// title block, optional subtitle, headed sections of wrapped lines,
// and a footer with the document footer text + page numbers.

// Helvetica averages ~0.5em per glyph; these char budgets keep wrapped
// lines inside the 504pt text width at each size.
const BODY_CHARS = 96; // 10pt body
const HEADING_CHARS = 84; // 11pt bold
const TITLE_CHARS = 56; // 15pt bold

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const TOP_Y = PAGE_H - 58; // first baseline on a fresh page
const BOTTOM_Y = 74; // stop before the footer zone

/** PDF literal-string escaping + WinAnsi-safe text: anything outside
 *  printable ASCII is mapped to a close cousin or dropped — document
 *  text in this app is plain-words by house rule anyway. */
export function pdfText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/•/g, "-")
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "");
}

/** Word-wrap one logical line to at most maxChars per visual line.
 *  A single token longer than the budget is hard-split. */
export function wrapPdfText(text: string, maxChars: number): string[] {
  const budget = Math.max(8, maxChars);
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) {
      out.push("");
      continue;
    }
    let rest = line;
    while (rest.length > budget) {
      let cut = rest.lastIndexOf(" ", budget);
      if (cut <= 0) cut = budget;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export interface PdfSection {
  heading?: string;
  lines: string[];
}

export interface PdfDocInput {
  title: string;
  subtitle?: string | null;
  sections: PdfSection[];
  footer: string;
}

type Placed =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "rule" }
  | { kind: "heading"; text: string }
  | { kind: "line"; text: string }
  | { kind: "gap"; size: number };

function layout(input: PdfDocInput): Placed[][] {
  const items: Placed[] = [];
  for (const t of wrapPdfText(input.title, TITLE_CHARS)) items.push({ kind: "title", text: t });
  if (input.subtitle) {
    items.push({ kind: "gap", size: 2 });
    for (const t of wrapPdfText(input.subtitle, BODY_CHARS)) items.push({ kind: "subtitle", text: t });
  }
  items.push({ kind: "gap", size: 4 });
  items.push({ kind: "rule" });
  items.push({ kind: "gap", size: 8 });
  input.sections.forEach((sec, i) => {
    if (i > 0) items.push({ kind: "gap", size: 8 });
    if (sec.heading) {
      for (const t of wrapPdfText(sec.heading, HEADING_CHARS)) items.push({ kind: "heading", text: t });
      items.push({ kind: "gap", size: 2 });
    }
    for (const line of sec.lines) {
      for (const t of wrapPdfText(line, BODY_CHARS)) items.push({ kind: "line", text: t });
    }
  });

  // Flow into pages by each item's height.
  const height = (it: Placed): number =>
    it.kind === "title" ? 19 :
    it.kind === "heading" ? 15 :
    it.kind === "rule" ? 2 :
    it.kind === "gap" ? it.size :
    13.5;
  const pages: Placed[][] = [];
  let page: Placed[] = [];
  let y = TOP_Y;
  for (const it of items) {
    const h = height(it);
    if (y - h < BOTTOM_Y && page.length > 0) {
      pages.push(page);
      page = [];
      y = TOP_Y;
    }
    page.push(it);
    y -= h;
  }
  if (page.length > 0 || pages.length === 0) pages.push(page);
  return pages;
}

function contentStream(page: Placed[], footer: string, pageNo: number, pageCount: number): string {
  const ops: string[] = [];
  let y = TOP_Y;
  const text = (font: "F1" | "F2", size: number, gray: number, x: number, baseline: number, s: string) => {
    ops.push(`BT /${font} ${size} Tf ${gray} g 1 0 0 1 ${x} ${baseline} Tm (${pdfText(s)}) Tj ET`);
  };
  for (const it of page) {
    if (it.kind === "title") {
      text("F2", 15, 0, MARGIN, y - 12, it.text);
      y -= 19;
    } else if (it.kind === "subtitle") {
      text("F1", 9.5, 0.35, MARGIN, y - 9, it.text);
      y -= 13.5;
    } else if (it.kind === "heading") {
      text("F2", 11, 0, MARGIN, y - 10, it.text);
      y -= 15;
    } else if (it.kind === "line") {
      text("F1", 10, 0.08, MARGIN, y - 9, it.text);
      y -= 13.5;
    } else if (it.kind === "rule") {
      ops.push(`0.75 g 0.75 w ${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);
      y -= 2;
    } else {
      y -= it.size;
    }
  }
  // Footer: document footer left, page numbers right — no app chrome.
  ops.push(`0.75 g 0.5 w ${MARGIN} 52 m ${PAGE_W - MARGIN} 52 l S`);
  text("F1", 8, 0.45, MARGIN, 40, footer);
  const pg = `Page ${pageNo} of ${pageCount}`;
  text("F1", 8, 0.45, PAGE_W - MARGIN - pg.length * 4.0, 40, pg);
  return ops.join("\n");
}

/** Render the document to PDF bytes (US Letter). */
export function buildPdf(input: PdfDocInput): Uint8Array {
  const pages = layout(input);
  const objects: string[] = [];
  // 1: catalog, 2: pages, 3/4: fonts; then per page: page + content.
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  pages.forEach((page, i) => {
    const content = contentStream(page, input.footer, i + 1, pages.length);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(out);
}
