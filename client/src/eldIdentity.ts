// eldIdentity.ts — ELD driver & truck identity logging (spec §6,
// x 2026-11-01). On ELD connect, the app logs the driver and truck
// information the provider's link reports: driver name, driver ID,
// CDL details the ELD carries, home terminal; truck unit number,
// VIN, make/model/year, plate, odometer. The snapshot is shown in
// the Driver State / truck profile surfaces stamped
// "from ELD — <provider>, <date/time>", and the driver can view
// everything logged.
//
// Pure and framework-free, like stopPlanner.ts, so the shape, the
// stamp, and the merge rules are unit-testable (eldIdentity.test.ts).
// The stored snapshot arrives from the server's getEldIdentity
// action (the eld_identity table); this module only shapes it for
// display. It fabricates NOTHING: every field is nullable, a field
// the ELD didn't carry stays null and is never shown as a value, and
// with no snapshot the manual profile is returned exactly as-is.
//
// NO-TRANSMISSION BOUNDARY (hard rule): this is the driver's own
// data in their own app. Nothing in this module — and no export,
// share, or sync path in the app — sends the ELD identity anywhere.
// Pulled values join trip records only where the app already seals
// driver/truck identity, nowhere new.

/** Driver identity exactly as an ELD reports it. Every field is
 *  nullable: the log holds only what the ELD actually carried. */
export type EldDriverIdentity = {
  name: string | null;
  /** The provider's own driver ID for this driver. */
  driverId: string | null;
  cdlNumber: string | null;
  cdlState: string | null;
  cdlClass: string | null;
  cdlEndorsements: string | null;
  homeTerminal: string | null;
};

/** Truck identity exactly as an ELD reports it. */
export type EldTruckIdentity = {
  unitNumber: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  /** Odometer miles at pull time, as the ELD read them. */
  odometerMi: number | null;
};

/** One identity pull, stamped with the provider it came from and
 *  when it was pulled (ISO timestamp). */
export type EldIdentitySnapshot = {
  /** Adapter key ("motive" | "samsara" | …) — provider-agnostic. */
  provider: string;
  /** Provider display name, named in the stamp. */
  providerName: string;
  /** ISO timestamp of the pull. */
  pulledAt: string;
  driver: EldDriverIdentity;
  truck: EldTruckIdentity;
};

/** The stamp every ELD-logged value carries on screen:
 *  "from ELD — <provider>, <date/time>". */
export function eldIdentityStamp(snap: EldIdentitySnapshot): string {
  const when = new Date(snap.pulledAt);
  const date = Number.isNaN(when.getTime())
    ? snap.pulledAt
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(when);
  return `from ELD — ${snap.providerName}, ${date}`;
}

export type EldIdentityRow = { label: string; value: string };
export type EldIdentitySection = { title: "Driver" | "Truck"; rows: EldIdentityRow[] };

const str = (v: string | null): string | null => (v != null && v.trim() !== "" ? v : null);

/** Everything logged, as display sections. A field the ELD didn't
 *  carry produces NO row — the driver sees exactly what was logged,
 *  nothing padded out. Truck make/model/year combine into one row
 *  from whichever parts arrived. */
export function eldIdentitySections(snap: EldIdentitySnapshot): EldIdentitySection[] {
  const d = snap.driver;
  const t = snap.truck;
  const driverRows: EldIdentityRow[] = [];
  const addD = (label: string, v: string | null) => {
    const s = str(v);
    if (s != null) driverRows.push({ label, value: s });
  };
  addD("Name", d.name);
  addD("Driver ID", d.driverId);
  addD("CDL number", d.cdlNumber);
  addD("CDL state", d.cdlState);
  addD("CDL class", d.cdlClass);
  addD("CDL endorsements", d.cdlEndorsements);
  addD("Home terminal", d.homeTerminal);

  const truckRows: EldIdentityRow[] = [];
  const addT = (label: string, v: string | null) => {
    const s = str(v);
    if (s != null) truckRows.push({ label, value: s });
  };
  addT("Unit number", t.unitNumber);
  addT("VIN", t.vin);
  const ymk = [t.year != null ? String(t.year) : null, str(t.make), str(t.model)].filter((x) => x != null).join(" ");
  if (ymk !== "") truckRows.push({ label: "Truck", value: ymk });
  addT("Plate", t.plate);
  if (t.odometerMi != null && Number.isFinite(t.odometerMi)) {
    truckRows.push({ label: "Odometer at pull", value: `${Math.round(t.odometerMi).toLocaleString()} mi` });
  }
  return [
    { title: "Driver", rows: driverRows },
    { title: "Truck", rows: truckRows },
  ];
}

export type ProfileFieldView = {
  key: string;
  label: string;
  value: string | null;
  /** Where the shown value came from. "eld" values carry the stamp. */
  source: "manual" | "eld";
  /** Present only when source is "eld": the snapshot's stamp. */
  stamp: string | null;
};

/** Merge the ELD identity into a manual-profile field view — the
 *  rule the Driver State / truck profile surfaces render by:
 *  - No snapshot (no ELD linked): every manual value comes back
 *    EXACTLY as entered, source "manual". The ELD log changes
 *    nothing.
 *  - Snapshot present: a non-null ELD field is shown, source "eld",
 *    carrying the stamp; a null ELD field leaves the manual value
 *    in place (an ELD that didn't carry a field never blanks what
 *    the driver entered by hand).
 *  Manual keys are the surfaces' own field keys ("driverName",
 *  "cdlNumber", "truckUnit", …); the ELD side maps by the same keys
 *  listed here. */
export function profileFieldsWithEld(
  manual: { key: string; label: string; value: string | null }[],
  snap: EldIdentitySnapshot | null,
): ProfileFieldView[] {
  if (snap == null) {
    return manual.map((f) => ({ key: f.key, label: f.label, value: f.value, source: "manual" as const, stamp: null }));
  }
  const stamp = eldIdentityStamp(snap);
  const t = snap.truck;
  const eldByKey: Record<string, string | null> = {
    driverName: snap.driver.name,
    driverId: snap.driver.driverId,
    cdlNumber: snap.driver.cdlNumber,
    cdlState: snap.driver.cdlState,
    cdlClass: snap.driver.cdlClass,
    cdlEndorsements: snap.driver.cdlEndorsements,
    homeTerminal: snap.driver.homeTerminal,
    truckUnit: t.unitNumber,
    truckVin: t.vin,
    truckMake: t.make,
    truckModel: t.model,
    truckYear: t.year != null ? String(t.year) : null,
    truckPlate: t.plate,
    truckOdometer: t.odometerMi != null && Number.isFinite(t.odometerMi) ? `${Math.round(t.odometerMi).toLocaleString()} mi` : null,
  };
  return manual.map((f) => {
    const eld = str(eldByKey[f.key] ?? null);
    if (eld != null) return { key: f.key, label: f.label, value: eld, source: "eld" as const, stamp };
    return { key: f.key, label: f.label, value: f.value, source: "manual" as const, stamp: null };
  });
}
