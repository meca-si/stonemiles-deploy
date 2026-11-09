// GPS fix filter — the single gate every raw watchPosition fix passes
// through before anything in the app (trip totals, by-state miles,
// seals, points checks, guidance, overspeed) is allowed to see it.
//
// Pure and framework-free on purpose: no DOM, no React, no clock reads
// (timestamps arrive with the fix), so the exact production logic is
// unit-testable with synthetic fix streams (see gpsFilter.test.ts).
//
// What it guarantees:
//  - Coarse fixes (accuracy radius worse than ACCURACY_LIMIT_M, or no
//    accuracy reported at all) never move the recorded position and
//    never add distance. A run of rejections raises `weakSignal` so
//    the UI can say so plainly instead of silently drifting.
//  - Teleports / impossible movement are rejected against the last
//    ACCEPTED fix (elapsed time + both accuracy radii accounted for).
//    A rejected fix never re-anchors the chain — the filter holds the
//    last good fix and recovers when sane fixes resume.
//  - Distance accumulates only between accepted fixes, and only as
//    real displacement: while parked, jitter inside a deadband around
//    the parked anchor adds nothing and cannot re-anchor; leaving the
//    deadband takes two consecutive fixes clustered away from the
//    anchor (a departure), so a jitter cloud can never random-walk
//    phantom miles onto a trip sheet or break a clean day.
//  - Speed is smoothed (rolling median over recent accepted samples),
//    preferring the fix's own reported speed; when a fix carries no
//    speed, the sample derives from credited movement — the same
//    movement that added distance, never from raw jitter.

export type LatLon = { lat: number; lon: number };

export type RawFix = {
  lat: number;
  lon: number;
  /** Accuracy radius in meters; null when the platform reports none. */
  accuracyM: number | null;
  /** Platform-reported speed in m/s; null when unavailable. */
  speedMps: number | null;
  /** Fix timestamp (GeolocationPosition.timestamp), ms epoch. */
  timestampMs: number;
};

export type FixRejection = "accuracy" | "jump" | "time";

export type FilteredFix = {
  accepted: boolean;
  rejection: FixRejection | null;
  /** Last accepted position — held unchanged while fixes are rejected. */
  position: LatLon | null;
  /** Smoothed position for DISPLAY only (road test #3, 2026-10-30:
   *  the truck marker drew the raw fix and sat off the side of the
   *  road — raw accepted fixes scatter by their whole accuracy
   *  radius). While parked this is the parked anchor; while rolling
   *  it trails the raw fix through a short exponential blend so
   *  scatter averages toward the road the truck is actually on,
   *  and it jumps straight to the raw fix when the truck has
   *  genuinely moved >60 m from it (no lag after a gap). It NEVER
   *  feeds distance, speed, seals, or any record — `position` and
   *  `segmentMiles` remain the honest raw chain. */
  displayPosition: LatLon | null;
  /** Distance credited by this fix, miles. 0 unless the fix was
   *  accepted AND confirmed real displacement from the anchor.
   *  Callers recording a tracking gap simply decline to add this
   *  segment; the anchor has already advanced past it, so no
   *  catch-up distance can leak in on later fixes. */
  segmentMiles: number;
  /** Smoothed speed in mph after this fix (null until a sample exists). */
  speedMph: number | null;
  /** True while recent fixes are being rejected in a run — the signal
   *  is too weak/glitchy to trust; position and miles are on hold. */
  weakSignal: boolean;
  /** The most recent rejection kind, for honest UI copy. */
  lastRejection: FixRejection | null;
  /** Accuracy radius of the most recent raw fix (accepted or not). */
  lastAccuracyM: number | null;
  /** Elapsed ms between the previously accepted fix and this one
   *  (null on the first accepted fix). Gap logic keys off this. */
  msSincePrevAccepted: number | null;
};

/** Fixes coarser than this never move the track or add distance. */
export const GPS_ACCURACY_LIMIT_M = 65;
/** Implied speed above this (after accuracy slack) is a teleport. */
export const GPS_MAX_PLAUSIBLE_MPH = 120;
/** While rolling, steps under this from the anchor are jitter: they
 *  add no distance and do not move the anchor. */
export const GPS_NOISE_FLOOR_M = 8;
/** While parked, displacement under this from the parked anchor is
 *  the jitter cloud: no distance, no re-anchor, no departure. The
 *  effective deadband grows with a fix's own accuracy radius. */
export const GPS_DEPART_M = 45;

const M_PER_MI = 1609.344;
const MPS_TO_MPH = 2.23694;
const SPEED_WINDOW = 5;
const SPEED_SAMPLE_MAX_AGE_MS = 15000;
/** Derived speed samples only from brisk anchor movement — a segment
 *  credited after a long parked dwell says nothing about speed. */
const DERIVED_SPEED_MAX_ELAPSED_MS = 30000;
/** Consecutive rejections before the signal is declared weak. A single
 *  bad fix is normal GPS weather; a run of them is a state the driver
 *  should see. */
const WEAK_AFTER_REJECTS = 2;
/** Rolling re-parks when this much fix history spans less than the
 *  depart deadband — the truck is demonstrably not going anywhere. */
const REPARK_WINDOW_MS = 30000;
const REPARK_MIN_SPAN_MS = 20000;

function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function distM(a: LatLon, b: LatLon): number {
  return haversineMi(a, b) * M_PER_MI;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

type AcceptedFix = LatLon & { timestampMs: number; accuracyM: number };

export class GpsFixFilter {
  private lastAccepted: AcceptedFix | null = null;
  // Distance anchor: credited distance is measured from here. While
  // parked it is the parked position and jitter cannot move it; while
  // rolling it advances only on steps past the noise floor.
  private anchor: (LatLon & { timestampMs: number }) | null = null;
  private mode: "parked" | "rolling" = "parked";
  // First fix seen beyond the parked deadband. A departure is only
  // confirmed when the NEXT accepted fix clusters with this candidate
  // (closer to it than to the anchor) — jitter never does that twice.
  private departCandidate: AcceptedFix | null = null;
  private rollingWindow: AcceptedFix[] = [];
  private speedSamples: { mph: number; timestampMs: number }[] = [];
  private consecutiveRejects = 0;
  private lastAccuracyM: number | null = null;
  private displayPos: LatLon | null = null;

  reset(): void {
    this.lastAccepted = null;
    this.anchor = null;
    this.mode = "parked";
    this.departCandidate = null;
    this.rollingWindow = [];
    this.speedSamples = [];
    this.consecutiveRejects = 0;
    this.lastAccuracyM = null;
    this.displayPos = null;
  }

  private smoothedSpeed(nowMs: number): number | null {
    this.speedSamples = this.speedSamples.filter(
      (s) => nowMs - s.timestampMs <= SPEED_SAMPLE_MAX_AGE_MS,
    );
    const recent = this.speedSamples.slice(-SPEED_WINDOW);
    return median(recent.map((s) => s.mph));
  }

  private reject(kind: FixRejection, nowMs: number): FilteredFix {
    this.consecutiveRejects += 1;
    return {
      accepted: false,
      rejection: kind,
      position: this.lastAccepted
        ? { lat: this.lastAccepted.lat, lon: this.lastAccepted.lon }
        : null,
      displayPosition: this.displayPos ? { ...this.displayPos } : null,
      segmentMiles: 0,
      speedMph: this.smoothedSpeed(nowMs),
      weakSignal: this.consecutiveRejects >= WEAK_AFTER_REJECTS,
      lastRejection: kind,
      lastAccuracyM: this.lastAccuracyM,
      msSincePrevAccepted: null,
    };
  }

  push(fix: RawFix): FilteredFix {
    this.lastAccuracyM = fix.accuracyM;
    const p: LatLon = { lat: fix.lat, lon: fix.lon };

    // 1) Accuracy gate. No accuracy reported is treated as coarse —
    //    an unknown-radius fix is not evidence of position.
    if (
      fix.accuracyM == null ||
      !Number.isFinite(fix.accuracyM) ||
      fix.accuracyM > GPS_ACCURACY_LIMIT_M
    ) {
      return this.reject("accuracy", fix.timestampMs);
    }
    const acc = fix.accuracyM;
    const acceptedFix: AcceptedFix = { ...p, timestampMs: fix.timestampMs, accuracyM: acc };

    const prev = this.lastAccepted;
    let msSincePrevAccepted: number | null = null;
    if (prev) {
      const elapsedMs = fix.timestampMs - prev.timestampMs;
      const dFromPrevM = distM(prev, p);
      if (elapsedMs <= 0) {
        // Out-of-order / duplicate timestamp: a fix inside the noise
        // floor is a harmless refresh; anything further is movement
        // with no elapsed time to explain it.
        if (dFromPrevM >= GPS_NOISE_FLOOR_M) {
          return this.reject("time", fix.timestampMs);
        }
      } else {
        // 2) Plausibility gate: implied speed from the last ACCEPTED
        //    fix, with both accuracy radii credited as slack so two
        //    honest-but-fuzzy fixes are never mistaken for a jump.
        const slackMi = (prev.accuracyM + acc) / M_PER_MI;
        const effDistMi = Math.max(0, dFromPrevM / M_PER_MI - slackMi);
        const impliedMph = effDistMi / (elapsedMs / 3600000);
        if (impliedMph > GPS_MAX_PLAUSIBLE_MPH) {
          return this.reject("jump", fix.timestampMs);
        }
        msSincePrevAccepted = elapsedMs;
      }
    }

    // Accepted — rejections clear, weak-signal state clears.
    this.consecutiveRejects = 0;

    // 3) Distance: only confirmed displacement from the anchor.
    let segmentMiles = 0;
    let derivedSpeedMph: number | null = null;
    // Stationary evidence: this fix landed inside the parked deadband
    // (or, while rolling, inside the noise floor). The truck is
    // demonstrably not moving, so a missing platform speed means
    // 0 mph — never "unknown" (see the speed sample below).
    let stationary = false;
    if (!this.anchor) {
      this.anchor = { ...p, timestampMs: fix.timestampMs };
    } else if (this.mode === "parked") {
      const deadbandM = Math.max(GPS_DEPART_M, acc);
      const dFromAnchorM = distM(this.anchor, p);
      if (dFromAnchorM < deadbandM) {
        stationary = true;
        this.departCandidate = null;
      } else if (
        this.departCandidate &&
        distM(this.departCandidate, p) < dFromAnchorM
      ) {
        // Departure confirmed: two consecutive fixes clustered away
        // from the parked anchor. Credit the full displacement.
        segmentMiles = dFromAnchorM / M_PER_MI;
        const elapsedMs = fix.timestampMs - this.anchor.timestampMs;
        if (elapsedMs > 0 && elapsedMs <= DERIVED_SPEED_MAX_ELAPSED_MS) {
          derivedSpeedMph = segmentMiles / (elapsedMs / 3600000);
        }
        this.anchor = { ...p, timestampMs: fix.timestampMs };
        this.departCandidate = null;
        this.mode = "rolling";
        this.rollingWindow = [acceptedFix];
      } else {
        this.departCandidate = acceptedFix;
      }
    } else {
      // Rolling: credit steps past the noise floor; the anchor follows.
      const dFromAnchorM = distM(this.anchor, p);
      if (dFromAnchorM < GPS_NOISE_FLOOR_M) stationary = true;
      if (dFromAnchorM >= GPS_NOISE_FLOOR_M) {
        segmentMiles = dFromAnchorM / M_PER_MI;
        const elapsedMs = fix.timestampMs - this.anchor.timestampMs;
        if (elapsedMs > 0 && elapsedMs <= DERIVED_SPEED_MAX_ELAPSED_MS) {
          derivedSpeedMph = segmentMiles / (elapsedMs / 3600000);
        }
        this.anchor = { ...p, timestampMs: fix.timestampMs };
      }
      // Re-park check: a full window of fixes that spans nowhere near
      // the depart deadband means the truck has stopped, whatever the
      // jitter claims. Already-credited distance is NOT clawed back —
      // it was real displacement when it was sealed.
      this.rollingWindow.push(acceptedFix);
      this.rollingWindow = this.rollingWindow.filter(
        (f) => fix.timestampMs - f.timestampMs <= REPARK_WINDOW_MS,
      );
      const first = this.rollingWindow[0];
      if (first && fix.timestampMs - first.timestampMs >= REPARK_MIN_SPAN_MS) {
        let maxDispM = 0;
        for (const a of this.rollingWindow) {
          for (const b of this.rollingWindow) {
            const d = distM(a, b);
            if (d > maxDispM) maxDispM = d;
          }
        }
        const spd = this.smoothedSpeed(fix.timestampMs);
        if (maxDispM < GPS_DEPART_M && (spd == null || spd < 3)) {
          this.mode = "parked";
          this.anchor = { ...p, timestampMs: fix.timestampMs };
          this.departCandidate = null;
          this.rollingWindow = [];
        }
      }
    }

    // 4) Speed sample: the fix's own speed when it carries a sane one,
    //    else the speed derived from the credited movement above.
    let sample: number | null = null;
    if (fix.speedMps != null && Number.isFinite(fix.speedMps) && fix.speedMps >= 0) {
      const mph = fix.speedMps * MPS_TO_MPH;
      if (mph <= GPS_MAX_PLAUSIBLE_MPH) sample = mph;
    }
    if (sample == null && derivedSpeedMph != null && derivedSpeedMph <= GPS_MAX_PLAUSIBLE_MPH) {
      sample = derivedSpeedMph;
    }
    // Stationary evidence is a speed reading too: a truck sitting in
    // its deadband is going 0 mph. Without this, platforms that report
    // no speed while stopped (iOS reports null / -1 at a standstill)
    // left the speed readout on "––" forever while parked — GPS
    // working, position live, and the cab display claiming otherwise.
    if (sample == null && stationary) {
      sample = 0;
    }
    if (sample != null) {
      this.speedSamples.push({ mph: sample, timestampMs: fix.timestampMs });
    }

    // Display position (see FilteredFix.displayPosition): parked →
    // the anchor (the jitter cloud never moves the marker); rolling
    // → a 0.7 blend toward the raw fix so scatter averages out,
    // with a straight jump when the raw fix lands >60 m away (real
    // movement after a silence must not drag a long lag behind it).
    if (stationary && this.anchor) {
      this.displayPos = { lat: this.anchor.lat, lon: this.anchor.lon };
    } else if (!this.displayPos) {
      this.displayPos = { ...p };
    } else if (distM(this.displayPos, p) > 60) {
      this.displayPos = { ...p };
    } else {
      this.displayPos = {
        lat: this.displayPos.lat + 0.7 * (p.lat - this.displayPos.lat),
        lon: this.displayPos.lon + 0.7 * (p.lon - this.displayPos.lon),
      };
    }

    this.lastAccepted = acceptedFix;
    return {
      accepted: true,
      rejection: null,
      position: p,
      displayPosition: this.displayPos ? { ...this.displayPos } : null,
      segmentMiles,
      speedMph: this.smoothedSpeed(fix.timestampMs),
      weakSignal: false,
      lastRejection: null,
      lastAccuracyM: this.lastAccuracyM,
      msSincePrevAccepted,
    };
  }
}

export function createGpsFixFilter(): GpsFixFilter {
  return new GpsFixFilter();
}
