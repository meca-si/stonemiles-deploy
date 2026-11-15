/**
 * FULL RECORDS EXPORT — pure rules module (TMS completion queue
 * item 5, approved by x 2026-11-15).
 *
 * ONE bundle of the driver's own records, audit-ready: loads, HOS
 * daily logs, DVIR inspection reports, the maintenance log, the
 * truck & trailer record, IFTA data, and the credentials on file.
 * It resolves through the standing Library document doors
 * (getLibraryDocument / emailLibraryDocument, ref "records:bundle")
 * as a single structured PDF — the export pattern every other
 * Library document already uses.
 *
 * SCOPE LAW: this bundle is the OWNER'S OWN export, resolved only
 * inside the owner's own Library scope (host-scoped reads, like
 * getMySettlement and the invoice). That is why the load lines can
 * carry the load's pay and the truck section can carry VIN/plate —
 * exactly like the owner's own settlement statements and the
 * truck-record download already do. Nothing here feeds a share
 * link, a receive page, a fleet board, or any public surface.
 *
 * HONESTY RULES:
 *  - a record type with nothing on file says so in plain words —
 *    an empty section is a finding, never a silent gap;
 *  - sections are capped, and a cap that bites says how many more
 *    records exist beyond it;
 *  - IFTA figures are the app's estimates from sealed trips and
 *    fuel — labelled an estimate, never a filing;
 *  - credential lines carry kind, label, expiry, and the last-4
 *    the vault itself stores — a full document number exists
 *    nowhere in the app, so none can appear here;
 *  - the cover carries the sealed chain's head hash and whether
 *    the walk verified intact, so the bundle can be checked
 *    against the chain it was drawn from.
 *
 * Every rule is a pure function of its inputs (the invoicing.ts /
 * settlement.ts pattern) so the rendering is unit-tested without
 * a database. Records only: nothing here moves money.
 */

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-10" from an ISO instant, in UTC — exports never depend
 *  on the reader's timezone. */
export function bundleDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Nov 10, 2026, 6:12 AM" (UTC) for timestamps that carry a time. */
export function bundleDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 === 0 ? 12 : h % 12;
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${bundleDate(iso)}, ${h}:${m} ${ampm} UTC`;
}

// ---------------------------------------------------------------------------
// Inputs — plain shapes the server gatherer fills from the caller's
// own (host-scoped) rows.
// ---------------------------------------------------------------------------

export interface BundleLoadLike {
  id: number;
  shipper: string | null;
  lane: string;
  referenceNumber: string | null;
  commodity: string | null;
  status: string;
  rate: number | null;
  extraCharges: number;
  loadedMiles: number | null;
  sealed: boolean;
  deliveredAtIso: string | null;
  /** Smart-trailer reefer temperature log for this load (Wave 2
   *  item 11): the device readings stored against the load, in
   *  time order, with the range they were judged against. This
   *  is the delivery proof a temperature claim stands on. */
  reeferTemps?: {
    rangeLabel: string | null;
    readings: { atIso: string; tempF: number; source: string; verdict: string | null }[];
  } | null;
}

export interface BundleHosDayLike {
  logDate: string; // YYYY-MM-DD
  status: string; // open | closed | auto_closed
  totalMiles: number | null;
  loadsDelivered: number;
  pretripResult: string | null;
  criticalDefect: boolean;
}

export interface BundleDvirLike {
  inspectedAtIso: string;
  kind: string; // pretrip | posttrip
  status: string; // signed | defects_reported | cleared
  defectCount: number;
  odometer: number | null;
  truckLabel: string | null;
  trailerLabel: string | null;
  signedName: string;
}

export interface BundleMaintenanceLike {
  performedAtIso: string;
  category: string;
  description: string;
  shop: string | null;
  cost: number;
  odometer: number | null;
  status: string; // logged | draft | closed
}

export interface BundleTruckLike {
  truckYear: number | null;
  truckMake: string | null;
  truckModel: string | null;
  truckUnitNumber: string | null;
  truckVin: string | null;
  truckPlate: string | null;
  truckEngine: string | null;
  truckTransmission: string | null;
  heightFt: number | null;
  heightIn: number | null;
  weightLbs: number | null;
  lengthFt: number | null;
  trailerYear: number | null;
  trailerMake: string | null;
  trailerModel: string | null;
  trailerType: string | null;
  trailerVin: string | null;
  trailerPlate: string | null;
}

export interface BundleIftaLike {
  year: number;
  rows: { state: string; miles: number; gallonsBought: number }[];
  totalMiles: number;
  totalGallons: number;
}

export interface BundleCredentialLike {
  /** Display name of the credential ("CDL", "Medical card", "TWIC"…). */
  label: string;
  /** The driver's own label for the document, when the vault has one. */
  detail: string | null;
  expiresIso: string | null;
  /** The vault stores last-4 only — that is all that can print. */
  last4: string | null;
}

export interface RecordsBundleInput {
  driverLabel: string;
  generatedAtIso: string;
  chainHead: string | null;
  chainIntact: boolean | null;
  chainChecked: number | null;
  loads: BundleLoadLike[];
  hosDays: BundleHosDayLike[];
  dvirs: BundleDvirLike[];
  maintenance: BundleMaintenanceLike[];
  truck: BundleTruckLike | null;
  ifta: BundleIftaLike | null;
  credentials: BundleCredentialLike[];
}

export interface RecordsBundle {
  title: string;
  subtitle: string;
  sections: { heading: string; lines: string[] }[];
  counts: { loads: number; hosDays: number; dvirs: number; maintenance: number; credentials: number };
}

/** Section caps — generous, and a cap that bites says so. */
export const BUNDLE_CAPS = { loads: 300, hosDays: 400, dvirs: 200, maintenance: 300 } as const;

function capped<T>(rows: T[], cap: number): { shown: T[]; moreLine: string | null } {
  if (rows.length <= cap) return { shown: rows, moreLine: null };
  return {
    shown: rows.slice(0, cap),
    moreLine: `…and ${rows.length - cap} more on file — this bundle prints the newest ${cap}. The full record stays in the app.`,
  };
}

// ---------------------------------------------------------------------------
// Bundle construction
// ---------------------------------------------------------------------------

export function buildRecordsBundle(input: RecordsBundleInput): RecordsBundle {
  const sections: { heading: string; lines: string[] }[] = [];

  // Cover — what this is, whose it is, and the chain it draws from.
  const cover: string[] = [
    `Driver: ${input.driverLabel}`,
    `Generated: ${bundleDateTime(input.generatedAtIso)}`,
    `Contents: ${input.loads.length} load(s) · ${input.hosDays.length} HOS day(s) · ${input.dvirs.length} inspection report(s) · ${input.maintenance.length} maintenance entr${input.maintenance.length === 1 ? "y" : "ies"} · truck & trailer record · IFTA ${input.ifta ? String(input.ifta.year) : ""} year to date · ${input.credentials.length} credential(s) on file`,
    input.chainHead
      ? `Sealed chain head: ${input.chainHead}${input.chainIntact != null ? ` — chain walk ${input.chainIntact ? `verified intact (${input.chainChecked ?? 0} records checked)` : "DID NOT VERIFY — treat this bundle with care and check the chain in the app"}` : ""}`
      : "Sealed chain head: not available for this bundle.",
    "This bundle is drawn only from your own STONEMILES records. It is a records export for audits, tax prep, and your own files — not a filing and not tax advice.",
  ];
  sections.push({ heading: "About this bundle", lines: cover });

  // Loads — every load on the caller's own record, newest first
  // (the gatherer sorts). Pay prints here because this is the
  // owner's own document (see the scope law in the header).
  {
    const { shown, moreLine } = capped(input.loads, BUNDLE_CAPS.loads);
    const lines: string[] = [];
    if (input.loads.length === 0) {
      lines.push("No loads on file yet — loads you book and run in STONEMILES list here.");
    }
    for (const l of shown) {
      const bits: string[] = [`Load #${l.id} — ${l.lane}`];
      if (l.shipper) bits.push(l.shipper);
      if (l.referenceNumber) bits.push(`Ref ${l.referenceNumber}`);
      if (l.commodity) bits.push(l.commodity);
      bits.push(
        l.sealed
          ? `Delivered — POD sealed${l.deliveredAtIso ? ` ${bundleDate(l.deliveredAtIso)}` : ""}`
          : `Status: ${l.status}`,
      );
      if (l.rate != null) {
        const total = Math.round((l.rate + (l.extraCharges ?? 0)) * 100) / 100;
        bits.push(l.extraCharges ? `${money(total)} (rate ${money(l.rate)} + ${money(l.extraCharges)} additional charges)` : money(total));
      } else {
        bits.push("No rate on file");
      }
      if (l.loadedMiles != null) bits.push(`${Math.round(l.loadedMiles)} loaded mi`);
      lines.push(bits.join(" · "));
      if (l.reeferTemps && l.reeferTemps.readings.length > 0) {
        lines.push(
          `  Reefer temperature log (trailer device readings${l.reeferTemps.rangeLabel ? `, load range ${l.reeferTemps.rangeLabel}` : ", no range set on this load — readings logged without judgement"}):`,
        );
        for (const r of l.reeferTemps.readings) {
          lines.push(
            `    ${bundleDateTime(r.atIso)} — ${r.tempF}°F${r.verdict ? ` (${r.verdict === "out_of_range" ? "OUT OF RANGE" : "in range"})` : ""}${r.source === "simulated" ? " — SIMULATED test reading" : ""}`,
          );
        }
      }
    }
    if (moreLine) lines.push(moreLine);
    sections.push({ heading: "Loads", lines });
  }

  // HOS daily logs.
  {
    const { shown, moreLine } = capped(input.hosDays, BUNDLE_CAPS.hosDays);
    const lines: string[] = [];
    if (input.hosDays.length === 0) {
      lines.push("No HOS daily logs on file yet — days you open in the app list here.");
    }
    for (const d of shown) {
      const bits: string[] = [
        d.logDate,
        d.status === "open" ? "Open" : d.status === "auto_closed" ? "Auto-closed" : "Closed",
        d.totalMiles != null ? `${Math.round(d.totalMiles * 10) / 10} mi` : "Miles not recorded",
        `${d.loadsDelivered} load(s) delivered`,
        `Pre-trip: ${d.pretripResult ?? "not recorded"}`,
      ];
      if (d.criticalDefect) bits.push("CRITICAL DEFECT flagged");
      lines.push(bits.join(" · "));
    }
    if (moreLine) lines.push(moreLine);
    sections.push({ heading: "Hours of service — daily logs", lines });
  }

  // DVIR inspection reports.
  {
    const { shown, moreLine } = capped(input.dvirs, BUNDLE_CAPS.dvirs);
    const lines: string[] = [];
    if (input.dvirs.length === 0) {
      lines.push("No inspection reports on file yet — signed pre-trip and post-trip reports list here.");
    }
    for (const r of shown) {
      const bits: string[] = [
        bundleDateTime(r.inspectedAtIso),
        r.kind === "posttrip" ? "Post-trip" : "Pre-trip",
        r.status === "defects_reported"
          ? `${r.defectCount} defect(s) reported`
          : r.status === "cleared"
            ? "Defects cleared"
            : "Signed — no defects",
        `Signed: ${r.signedName}`,
      ];
      if (r.odometer != null) bits.push(`Odometer ${Math.round(r.odometer).toLocaleString("en-US")}`);
      if (r.truckLabel) bits.push(`Truck: ${r.truckLabel}`);
      if (r.trailerLabel) bits.push(`Trailer: ${r.trailerLabel}`);
      lines.push(bits.join(" · "));
    }
    if (moreLine) lines.push(moreLine);
    sections.push({ heading: "Inspection reports (DVIR)", lines });
  }

  // Truck & trailer record — the same identity the truck-record
  // download carries (owner's own fields, VIN/plate included).
  {
    const t = input.truck;
    const lines: string[] = [];
    const truckLine = t ? [t.truckYear, t.truckMake, t.truckModel].filter(Boolean).join(" ") : "";
    if (!t || (!truckLine && !t.trailerMake && !t.trailerYear)) {
      lines.push("No truck or trailer record on file yet — fill in My Truck / My Trailer in Settings and it prints here.");
    } else {
      if (truckLine) lines.push(`Truck: ${truckLine}`);
      if (t.truckUnitNumber) lines.push(`Unit #: ${t.truckUnitNumber}`);
      if (t.truckVin) lines.push(`Truck VIN: ${t.truckVin}`);
      if (t.truckPlate) lines.push(`Truck plate: ${t.truckPlate}`);
      if (t.truckEngine) lines.push(`Engine: ${t.truckEngine}`);
      if (t.truckTransmission) lines.push(`Transmission: ${t.truckTransmission}`);
      const dims: string[] = [];
      if (t.heightFt != null) dims.push(`Height ${t.heightFt} ft${t.heightIn != null ? ` ${t.heightIn} in` : ""}`);
      if (t.weightLbs != null) dims.push(`Weight ${t.weightLbs.toLocaleString("en-US")} lbs`);
      if (t.lengthFt != null) dims.push(`Length ${t.lengthFt} ft`);
      if (dims.length) lines.push(dims.join(" · "));
      const trailerLine = [t.trailerYear, t.trailerMake, t.trailerModel, t.trailerType].filter(Boolean).join(" ");
      if (trailerLine) lines.push(`Trailer: ${trailerLine}`);
      if (t.trailerVin) lines.push(`Trailer VIN: ${t.trailerVin}`);
      if (t.trailerPlate) lines.push(`Trailer plate: ${t.trailerPlate}`);
    }
    sections.push({ heading: "Truck & trailer record", lines });
  }

  // Maintenance log — every entry with its workflow state (a DVIR
  // draft is unconfirmed work, and the bundle says so rather than
  // dressing it as done).
  {
    const { shown, moreLine } = capped(input.maintenance, BUNDLE_CAPS.maintenance);
    const lines: string[] = [];
    if (input.maintenance.length === 0) {
      lines.push("No maintenance entries on file yet — services and repairs you log list here.");
    }
    let total = 0;
    for (const m of shown) {
      total = Math.round((total + (m.cost ?? 0)) * 100) / 100;
      const bits: string[] = [
        bundleDate(m.performedAtIso),
        m.category,
        m.description,
        m.status === "draft" ? "DRAFT — from a DVIR defect, not yet confirmed" : m.status === "closed" ? "Closed" : "Logged",
        money(m.cost ?? 0),
      ];
      if (m.shop) bits.push(m.shop);
      if (m.odometer != null) bits.push(`at ${Math.round(m.odometer).toLocaleString("en-US")} mi`);
      lines.push(bits.join(" · "));
    }
    if (input.maintenance.length > 0) lines.push(`Total maintenance cost on file: ${money(total)}`);
    if (moreLine) lines.push(moreLine);
    sections.push({ heading: "Maintenance log", lines });
  }

  // IFTA — year to date, state by state, through the one IFTA
  // aggregation the gatherer runs. Estimates, labelled.
  {
    const lines: string[] = [];
    if (!input.ifta || input.ifta.rows.length === 0) {
      lines.push("No IFTA data on file yet — sealed trip miles by state and logged fuel build these lines automatically.");
    } else {
      lines.push(`Year: ${input.ifta.year} (year to date, all four quarters combined)`);
      for (const r of input.ifta.rows) {
        lines.push(`${r.state}: ${Math.round(r.miles * 10) / 10} mi · ${Math.round(r.gallonsBought * 100) / 100} gal bought`);
      }
      lines.push(
        `Totals: ${Math.round(input.ifta.totalMiles * 10) / 10} mi · ${Math.round(input.ifta.totalGallons * 100) / 100} gal bought`,
      );
      lines.push(
        "Miles from sealed trip sheets; fuel from your logged purchases. Estimate for planning and audit support only — not a filing and not tax advice. File from the quarterly IFTA exports in the Library.",
      );
    }
    sections.push({ heading: "IFTA data", lines });
  }

  // Credentials on file — kind, label, expiry, last-4 only.
  {
    const lines: string[] = [];
    if (input.credentials.length === 0) {
      lines.push("No credentials on file yet — add your CDL, medical card, and TWIC in the Document Expiry Wallet and they list here.");
    }
    for (const c of input.credentials) {
      const bits: string[] = [c.label];
      if (c.detail) bits.push(c.detail);
      bits.push(c.expiresIso ? `Expires ${bundleDate(c.expiresIso)}` : "No expiry date on file");
      if (c.last4) bits.push(`Document ····${c.last4}`);
      lines.push(bits.join(" · "));
    }
    sections.push({ heading: "Credentials on file", lines });
  }

  return {
    title: "Full records bundle",
    subtitle: `${input.driverLabel} — loads, HOS logs, inspections, maintenance, truck record, IFTA, credentials`,
    sections,
    counts: {
      loads: input.loads.length,
      hosDays: input.hosDays.length,
      dvirs: input.dvirs.length,
      maintenance: input.maintenance.length,
      credentials: input.credentials.length,
    },
  };
}
