// SignCheckPrompt.tsx — Split-sign prompts (driver order
// 2026-11-01, corrected by the driver the same night).
//
// While driving, when the route's next maneuver is a highway split
// inside 2 miles, the prompt pops: the ACTUAL ROAD SIGN — an
// Interstate/US shield drawn the way the gantry sign reads
// ("I-10 WEST") — plus the lane the routing data calls for
// ("Right lane") and the countdown. The driver matches the sign on
// the screen to the sign over the road instead of reasoning about
// compass headings on a bend (the road may point east for a stretch
// of a westbound run — the SIGN is the truth, not the heading).
//
// The shield and lane come only from the route's own routing data
// (signCheck.ts): no complete sign in the data → no prompt, and a
// maneuver with no side in the data claims no lane. The parked
// panel below the prompt's home in the Drive panel shows the next
// split sign ahead on the active route (any distance), and — with
// no signed split on the route — says so plainly and shows ONE
// labelled example shield (the driver's own I-10 West case) so the
// format is learnable while parked. The example is an illustration
// of the format, never presented as a live instruction.

import type { ManeuverCard, RoadSign, SignPrompt } from "./signCheck";
import { promptCardBg, type DriveGlassLevel } from "./driveScreen";

/** A road shield drawn the way the real sign reads: Interstate =
 *  red band over blue with the number big; US = white shield with
 *  black border and number; plain highway = green guide-sign chip.
 *  Pure presentation of a RoadSign parsed from routing data. */
export function RoadSignShield({ sign, large = false }: { sign: RoadSign; large?: boolean }) {
  const w = large ? "w-24" : "w-16";
  if (sign.kind === "interstate") {
    return (
      <div
        className={`${w} shrink-0 overflow-hidden rounded-b-[45%] rounded-t-xl border-2 border-white/90 text-center shadow-lg`}
        aria-hidden
        style={{ background: "#1a3f8f" }}
      >
        <div className={`${large ? "py-1 text-[10px]" : "py-0.5 text-[8px]"} font-bold tracking-[0.18em] text-white`} style={{ background: "#b02a30" }}>
          INTERSTATE
        </div>
        <div className={`${large ? "py-1.5 text-4xl" : "py-1 text-2xl"} font-condensed font-bold leading-none text-white`}>{sign.number}</div>
        <div className={`${large ? "pb-2 text-sm" : "pb-1.5 text-[11px]"} font-bold tracking-[0.3em] text-white`}>{sign.directionAbbr}</div>
      </div>
    );
  }
  if (sign.kind === "us") {
    return (
      <div
        className={`${w} shrink-0 rounded-b-[45%] rounded-t-xl border-[3px] border-black bg-white text-center shadow-lg`}
        aria-hidden
      >
        <div className={`${large ? "pt-1 text-[9px]" : "pt-0.5 text-[7px]"} font-bold tracking-[0.2em] text-black`}>US</div>
        <div className={`${large ? "pb-2 text-4xl" : "pb-1.5 text-2xl"} font-condensed font-bold leading-none text-black`}>{sign.number}</div>
        <div className={`${large ? "pb-2 text-sm" : "pb-1.5 text-[11px]"} font-bold tracking-[0.3em] text-black`}>{sign.directionAbbr}</div>
      </div>
    );
  }
  return (
    <div
      className={`${w} shrink-0 rounded-xl border-2 border-white/90 px-1 text-center shadow-lg`}
      aria-hidden
      style={{ background: "#0b6e3c" }}
    >
      <div className={`${large ? "pt-1.5 text-[9px]" : "pt-1 text-[7px]"} font-bold tracking-[0.18em] text-white`}>HIGHWAY</div>
      <div className={`${large ? "text-4xl" : "text-2xl"} font-condensed font-bold leading-none text-white`}>{sign.number}</div>
      <div className={`${large ? "pb-2 text-sm" : "pb-1.5 text-[11px]"} font-bold tracking-[0.3em] text-white`}>{sign.directionAbbr}</div>
    </div>
  );
}

function distText(mi: number): string {
  if (mi <= 0.15) return "At the split";
  if (mi < 0.1) return `${Math.max(0, Math.round(mi * 5280))} ft to the split`;
  return `${(Math.round(mi * 10) / 10).toFixed(1)} mi to the split`;
}

/** The driving prompt itself: shield + the sign's words big + the
 *  lane + the countdown. Rendered on the Drive Mode (rolling)
 *  screen and in the Drive panel's guidance area whenever
 *  signCheck.ts says the next maneuver is a signed split inside
 *  the window. */
export function SignCheckPrompt({ prompt, big = false, glassLevel = "med" }: { prompt: SignPrompt; big?: boolean; glassLevel?: DriveGlassLevel }) {
  const { sign } = prompt;
  return (
    <section
      className="overflow-hidden rounded-2xl border-2 px-4 py-3.5"
      style={{ background: promptCardBg(glassLevel, "11, 61, 36"), borderColor: "rgba(255,255,255,0.55)", boxShadow: "0 14px 34px rgba(2,5,16,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}
      role="alert"
      aria-label={`Road sign ahead: follow ${sign.spokenLabel}${prompt.laneLabel ? `, ${prompt.laneLabel.toLowerCase()}` : ""}. ${distText(prompt.atMi)}.`}
    >
      <div className="flex items-center gap-4">
        <RoadSignShield sign={sign} large={big} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-200">
            🛣️ Follow this sign{prompt.exitLine ? ` · ${prompt.exitLine}` : ""}
          </div>
          <div className={`${big ? "text-5xl" : "text-4xl"} mt-0.5 font-condensed font-bold leading-none tracking-wide text-white`}>
            {sign.fullLabel}
          </div>
          {prompt.laneLabel ? (
            <div className={`${big ? "text-3xl" : "text-2xl"} mt-1 font-condensed font-bold leading-none`} style={{ color: "#ffd97a" }}>
              {prompt.laneLabel.toUpperCase()}
            </div>
          ) : (
            <div className="mt-1 text-base font-semibold text-emerald-100">Follow the signed branch</div>
          )}
          <div className="mt-1 text-sm font-semibold text-emerald-100">
            {distText(prompt.atMi)} — match this sign at the split, whatever your compass says on the bend.
          </div>
        </div>
      </div>
      <p className="mt-2 truncate text-xs font-medium text-emerald-200/90">{prompt.instruction}</p>
    </section>
  );
}

/** The exit / turn prompt card (field fix 2026-11-01): the card
 *  the driver asked for at exits and ordinary turns, where before
 *  only the thin top banner spoke. An EXIT card reads like the
 *  green guide sign — exit number big, branch/toward under it. A
 *  TURN card puts the named road at sign scale with the turn
 *  arrow. Every word comes from the maneuver's own routing fields
 *  (signCheck.ts evaluateManeuverCard); a maneuver with no exit
 *  data and no named road never reaches this component. */
export function ManeuverCardPrompt({
  card,
  arrow,
  big = false,
  glassLevel = "med",
}: {
  card: ManeuverCard;
  /** Direction arrow for the maneuver (App's maneuverArrow). */
  arrow: string;
  big?: boolean;
  /** The driver's see-through level (Repair 5) — the card's fill
   *  follows it; colors, blur, and halo never change. */
  glassLevel?: DriveGlassLevel;
}) {
  const isExit = card.kind === "exit";
  return (
    <section
      className="overflow-hidden rounded-2xl border-2 px-4 py-3.5"
      style={
        isExit
          ? { background: promptCardBg(glassLevel, "11, 61, 36"), borderColor: "rgba(255,255,255,0.55)", boxShadow: "0 14px 34px rgba(2,5,16,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", textShadow: "0 1px 3px rgba(0,0,0,0.6)" }
          : { background: promptCardBg(glassLevel, "8, 13, 28"), borderColor: "var(--glass-border)", boxShadow: "0 14px 34px rgba(2,5,16,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", textShadow: "0 1px 3px rgba(0,0,0,0.6)" }
      }
      role="alert"
      aria-label={
        isExit
          ? `Exit ahead: ${card.exitLine ?? card.title}. ${distText(card.atMi).replace("to the split", "to the exit")}.`
          : `Turn ahead onto ${card.title}. ${card.instruction}. ${distText(card.atMi).replace("to the split", "to the turn")}.`
      }
    >
      <div className="flex items-center gap-4">
        <span className={`${big ? "text-7xl" : "text-6xl"} shrink-0 leading-none`} aria-hidden>
          {arrow}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={`text-[11px] font-bold uppercase tracking-[0.22em] ${isExit ? "text-emerald-200" : "text-[var(--dim)]"}`}
          >
            {isExit ? "🛣️ Exit ahead" : "↪️ Turn ahead"}
          </div>
          <div className={`${big ? "text-5xl" : "text-4xl"} mt-0.5 truncate font-condensed font-bold leading-none tracking-wide text-white`}>
            {card.title}
          </div>
          {isExit && card.exitLine ? (
            <div className="mt-1 truncate text-base font-semibold text-emerald-100">{card.exitLine}</div>
          ) : null}
          {!isExit ? (
            <div className="mt-1 truncate text-base font-semibold text-[var(--text)]">{card.instruction}</div>
          ) : null}
          <div className={`mt-1 text-sm font-semibold ${isExit ? "text-emerald-100" : "text-[var(--dim)]"}`}>
            {distText(card.atMi).replace("to the split", isExit ? "to the exit" : "to the turn")}
          </div>
        </div>
      </div>
      {isExit ? <p className="mt-2 truncate text-xs font-medium text-emerald-200/90">{card.instruction}</p> : null}
    </section>
  );
}

/** The driver's own example, labelled as an example: the shield the
 *  prompt draws for the I-10 West split he described. */
const EXAMPLE_SIGN: RoadSign = {
  kind: "interstate",
  number: "10",
  direction: "West",
  directionAbbr: "W",
  label: "I-10",
  fullLabel: "I-10 WEST",
  spokenLabel: "I-10 West",
};

/** Parked panel (Drive panel, under Route weather): the next split
 *  sign ahead on the active route, or the honest no-signed-split
 *  state with the labelled example. */
export function SignCheckPanel({ next, hasRoute }: { next: SignPrompt | null; hasRoute: boolean }) {
  return (
    <section className="glass-panel p-3.5" aria-label="Sign-check — road sign prompts at highway splits">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-condensed text-xl font-semibold">🛣️ Sign-check</h2>
        <span className="shrink-0 rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">
          POPS UP WITHIN 2 MI OF A SPLIT
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--dim)]">
        When your route splits ahead — one branch east, one west — the actual road sign pops up on the driving screen
        with the lane to take, and speaks: the shield the way it reads on the gantry, so you match sign to sign instead
        of guessing on a bend. Exits get their own card on the driving screen too: the exit number
        and branch at sign scale within 2 miles of an exit. Inside the last mile, that sign becomes the docked
        gantry board at the top of the map — EXIT tab, shield, destination towns — slim on the approach, full size
        inside the last ~0.3 miles, with the map re-framed below it so the road ahead is never under the board;
        one tap shrinks it to a one-line strip until the next maneuver, and after dark it dims on its own. Every big prompt — this sign, an exit card, the
        weigh station OPEN/CLOSED prompt — shows for 5 seconds, then disappears on its own and doesn't pop
        again for the same sign on the same pass. Ordinary turns ride the slim top instruction bar
        alone — the giant TURN AHEAD card that used to cover the map was removed on the driver's verdict
        (2026-11-03). The sign, lane, exit, and street come
        only from your route's routing data — a split whose data carries no complete sign (route + direction) never
        prompts, and no lane is ever claimed the data doesn't call for.
      </p>
      {next ? (
        <div className="mt-2.5 flex items-center gap-3.5 rounded-2xl px-3.5 py-3" style={{ background: "#0b3d24" }}>
          <RoadSignShield sign={next.sign} />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-200">
              Next split sign on this route{next.exitLine ? ` · ${next.exitLine}` : ""}
            </div>
            <div className="font-condensed text-3xl font-bold leading-tight text-white">
              {next.sign.fullLabel}
              {next.laneLabel ? <span style={{ color: "#ffd97a" }}> · {next.laneLabel.toUpperCase()}</span> : ""}
            </div>
            <div className="text-sm font-semibold text-emerald-100">
              {next.atMi <= 0.15 ? "You're at this split now." : `In ${(Math.round(next.atMi * 10) / 10).toFixed(1)} mi — the prompt pops on its own inside 2 miles and speaks it.`}
            </div>
            <div className="mt-0.5 truncate text-xs text-emerald-200/90">{next.instruction}</div>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-3.5 rounded-2xl bg-[var(--surface2)] px-3.5 py-3">
          <RoadSignShield sign={EXAMPLE_SIGN} />
          <div className="min-w-0">
            <div className="text-sm font-bold">
              {hasRoute ? "No signed split ahead on this route's data." : "No route set — nothing to check yet."}
            </div>
            <p className="mt-0.5 text-xs text-[var(--dim)]">
              {hasRoute
                ? "When a split with a complete sign is ahead, it shows here first, then pops while you drive. "
                : "Plan a route and the next signed split ahead shows here. "}
              <strong className="text-[var(--text)]">Example — how the prompt reads:</strong> this shield with “I-10 WEST ·
              RIGHT LANE” and the voice line “Sign ahead — follow the sign for I-10 West, right lane.”
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
