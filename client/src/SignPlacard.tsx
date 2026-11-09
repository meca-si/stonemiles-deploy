// SignPlacard.tsx — the docked gantry sign board (Rand McNally-
// style sign placards, x's order 2026-11-05).
//
// The board DOCKS to the top edge of the Drive map — it is not a
// floating card: the parent measures this dock and shifts the
// map's camera framing down by its height, so the truck puck and
// the road ahead always render in the unobstructed area below it.
// Slim on the approach (~15% of screen height: EXIT tab, shield,
// destination, distance), full inside the last ~0.3 miles (sign
// at gantry scale + the lane strip when lane data exists), and
// one tap shrinks it to a one-line mini strip until the next
// maneuver. After dark the whole board dims to its night palette
// (placard.ts) — readable, no glare.
//
// Everything on it is data the routing response (or the named
// intel feed) actually returned — placard.ts builds the model and
// returns null when there is no sign data, in which case this
// component never renders and the existing one-line maneuver
// strip stands. The board is visual only: the maneuver's spoken
// prompt fires through the existing guidance voice, untouched.

import { placardPalette, type Placard, type PlacardChip, type PlacardRef, type PlacardStage } from "./placard";

/** A route shield the way it reads on the gantry, from a parsed
 *  branch ref (placard.ts parsePlacardRef). Interstate = red band
 *  over blue; US = white shield; state route = white marker with
 *  the state over the number; anything else = the branch's own
 *  words on a guide-green chip — never dressed up as a numbered
 *  shield it isn't. */
function RefShield({ ref, large }: { ref: PlacardRef; large: boolean }) {
  const w = large ? "w-20" : "w-14";
  if (ref.kind === "interstate") {
    return (
      <div className={`${w} shrink-0 overflow-hidden rounded-b-[45%] rounded-t-lg border-2 border-white/90 text-center shadow-lg`} aria-hidden style={{ background: "#1a3f8f" }}>
        <div className={`${large ? "py-0.5 text-[9px]" : "py-px text-[7px]"} font-bold tracking-[0.16em] text-white`} style={{ background: "#b02a30" }}>
          INTERSTATE
        </div>
        <div className={`${large ? "py-1 text-3xl" : "py-0.5 text-[22px]"} font-condensed font-bold leading-none text-white`}>{ref.number}</div>
        {ref.directionAbbr ? (
          <div className={`${large ? "pb-1.5 text-xs" : "pb-1 text-[10px]"} font-bold tracking-[0.3em] text-white`}>{ref.directionAbbr}</div>
        ) : (
          <div className={large ? "pb-1.5" : "pb-1"} />
        )}
      </div>
    );
  }
  if (ref.kind === "us") {
    return (
      <div className={`${w} shrink-0 rounded-b-[45%] rounded-t-lg border-[3px] border-black bg-white text-center shadow-lg`} aria-hidden>
        <div className={`${large ? "pt-0.5 text-[8px]" : "pt-px text-[7px]"} font-bold tracking-[0.2em] text-black`}>US</div>
        <div className={`${large ? "text-3xl" : "text-[22px]"} font-condensed font-bold leading-none text-black`}>{ref.number}</div>
        {ref.directionAbbr ? (
          <div className={`${large ? "pb-1.5 text-xs" : "pb-1 text-[10px]"} font-bold tracking-[0.3em] text-black`}>{ref.directionAbbr}</div>
        ) : (
          <div className={large ? "pb-1.5" : "pb-1"} />
        )}
      </div>
    );
  }
  if (ref.kind === "state") {
    const stateAbbr = ref.label.split(" ")[0] ?? "";
    return (
      <div className={`${w} shrink-0 rounded-lg border-[3px] border-black bg-white px-0.5 text-center shadow-lg`} aria-hidden>
        <div className={`${large ? "pt-0.5 text-[9px]" : "pt-px text-[7px]"} font-bold tracking-[0.14em] text-black`}>{stateAbbr}</div>
        <div className={`${large ? "pb-1 text-3xl" : "pb-0.5 text-[22px]"} font-condensed font-bold leading-none text-black`}>{ref.number}</div>
        {ref.directionAbbr ? (
          <div className={`${large ? "pb-1 text-[10px]" : "pb-0.5 text-[9px]"} font-bold tracking-[0.24em] text-black`}>{ref.directionAbbr}</div>
        ) : null}
      </div>
    );
  }
  // Highway refs read as a small guide-sign chip; plain text refs
  // carry the branch's own words.
  return (
    <div
      className={`${large ? "min-w-20 px-2 py-2" : "min-w-14 px-1.5 py-1.5"} shrink-0 rounded-lg border-2 border-white/90 text-center shadow-lg`}
      aria-hidden
      style={{ background: "#0b6e3c" }}
    >
      <div className={`${large ? "text-xl" : "text-sm"} font-condensed font-bold leading-tight text-white`}>{ref.label}</div>
    </div>
  );
}

/** The smooth vector exit arrow (x's build note: the preview's
 *  chunky amber arrow was mock-grade) — a clean stroked curve
 *  sweeping up and off, round caps, one filled head. `flip` mirrors
 *  it for a left exit. */
export function ExitArrowSvg({ size = 40, color, flip = false }: { size?: number; color: string; flip?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
      <g transform={flip ? "translate(48 0) scale(-1 1)" : undefined}>
        <path d="M15 44 V23 C15 13 21 8 31 8" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <path d="M24.5 1.5 L38 8 L24.5 14.5 Z" fill={color} />
      </g>
    </svg>
  );
}

/** A clean straight-ahead lane arrow. */
function StraightArrowSvg({ size = 40, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path d="M24 3 L38 19 L29.5 19 L29.5 45 L18.5 45 L18.5 19 L10 19 Z" fill={color} />
    </svg>
  );
}

/** The lane strip: an asphalt bar under the board, one cell per
 *  lane in the maneuver's OWN lane record (placard.ts) — dashed
 *  lane lines between cells, the lane(s) serving the maneuver
 *  highlighted amber with the exit arrow. Rendered ONLY when a
 *  lane record exists; the strip is never synthesized. */
function LaneStrip({ placard, night }: { placard: Placard; night: boolean }) {
  const pal = placardPalette(night);
  const lanes = placard.lanes;
  if (!lanes) return null;
  return (
    <div
      className="mt-1.5 flex overflow-hidden rounded-xl border border-white/25"
      style={{ background: pal.asphalt }}
      aria-hidden
    >
      {lanes.map((lane, i) => {
        const isExit = lane.move === "exit-right" || lane.move === "exit-left";
        const highlighted = lane.active;
        const arrowColor = highlighted ? pal.arrow : "#e8e8e8";
        return (
          <div
            key={i}
            className={`flex flex-1 items-center justify-center py-1.5 ${i > 0 ? "border-l border-dashed border-white/35" : ""}`}
            style={highlighted ? { background: pal.laneCellActiveBg, boxShadow: `inset 0 0 0 1.5px ${pal.arrow}` } : undefined}
          >
            {isExit ? (
              <ExitArrowSvg size={38} color={arrowColor} flip={lane.move === "exit-left"} />
            ) : lane.move === "left" || lane.move === "right" ? (
              <ExitArrowSvg size={38} color={arrowColor} flip={lane.move === "left"} />
            ) : (
              <StraightArrowSvg size={38} color={arrowColor} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChipRow({ chips }: { chips: PlacardChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5" role="status" aria-label={chips.map((c) => c.text).join(". ")}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold text-white"
          style={{
            background: "rgba(10,16,34,0.88)",
            borderColor: chip.tone === "closed" || chip.tone === "short" ? "rgba(255,77,61,0.65)" : "rgba(246,196,83,0.3)",
            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          }}
        >
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: chip.tone === "open" || chip.tone === "clear" ? "#3ddc84" : "#ff4d3d" }}
          />
          {chip.text}
        </span>
      ))}
    </div>
  );
}

/**
 * The docked sign board. The parent positions it (absolute, top of
 * the map) and owns the camera reserve; this component is pure
 * presentation of the placard model + stage.
 *
 * - `permitLine` non-null renders the RED permit variant instead
 *   of the green board (Diamond-gated by the caller, exactly like
 *   the rest of Permit Mode): the maneuver would take the truck
 *   off the filed permit's approved route.
 * - One tap anywhere on the board shrinks it (onShrink) to the
 *   mini strip until the next maneuver.
 */
export function SignPlacard({
  placard,
  stage,
  distLabel,
  etaLabel,
  night,
  permitLine,
  chips,
  onShrink,
}: {
  placard: Placard;
  stage: PlacardStage;
  /** Distance to the maneuver, formatted by the caller ("0.8 mi" / "850 ft"). */
  distLabel: string;
  /** Compact trip readout carried over from the strip the board
   *  replaces ("ETA 4:32 PM"), or null. */
  etaLabel: string | null;
  /** Night dim: after dark (real sun / local clock, the map's own
   *  day-night resolution) the board wears its night palette. */
  night: boolean;
  /** Red permit variant line ("Permit route stays on I-65"), or null. */
  permitLine: string | null;
  /** Smart chips for the approach strip — real data only; the
   *  caller passes [] when neither feed knows anything. */
  chips: PlacardChip[];
  onShrink: () => void;
}) {
  const pal = placardPalette(night);
  const primaryRef = placard.refs[0] ?? null;
  const secondaryRefs = placard.refs.slice(1);
  const destLine = placard.destinations.join(" · ");
  const signWords = [
    placard.exitNumber ? `Exit ${placard.exitNumber}` : null,
    primaryRef ? primaryRef.text : null,
    placard.destinations.length > 0 ? `toward ${placard.destinations.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (stage === "mini") {
    return (
      <div className="px-2 pt-2">
        <div
          className="flex items-center gap-2 rounded-full border px-3.5 py-2"
          role="status"
          aria-label={`Sign board shrunk. ${permitLine ? `Exit not on your approved route. ${permitLine}. ` : ""}${signWords}. ${distLabel} ahead.`}
          style={{
            background: permitLine ? pal.permitBg : pal.boardBg,
            borderColor: pal.boardBorder,
            color: pal.text,
            boxShadow: "0 10px 24px rgba(2,5,16,0.55)",
          }}
        >
          {placard.exitNumber && (
            <span className="shrink-0 rounded px-1.5 py-0.5 font-condensed text-sm font-bold leading-none" style={{ background: pal.exitTabBg, color: pal.exitTabText }}>
              EXIT {placard.exitNumber}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-bold">
            {permitLine ? "EXIT NOT ON YOUR APPROVED ROUTE" : destLine || primaryRef?.label || placard.instruction}
          </span>
          <span className="shrink-0 font-condensed text-base font-bold">{distLabel}</span>
        </div>
      </div>
    );
  }

  const full = stage === "full";
  return (
    <div className="px-2 pt-3">
      <div className="relative">
        {placard.exitNumber && (
          <div
            className="absolute -top-3 right-3 z-10 rounded-md px-2.5 py-1 font-condensed text-lg font-bold leading-none shadow-lg"
            style={{ background: pal.exitTabBg, color: pal.exitTabText }}
            aria-hidden
          >
            EXIT {placard.exitNumber}
          </div>
        )}
        <button
          type="button"
          onClick={onShrink}
          aria-label={
            permitLine
              ? `Warning: this exit is not on your approved permit route. ${permitLine}. ${signWords}. ${distLabel} ahead. Tap to shrink the sign board.`
              : `Road sign ahead: ${signWords}. ${distLabel} ahead. Tap to shrink the sign board.`
          }
          className="btn-press block w-full overflow-hidden rounded-2xl border-2 text-left"
          style={{
            background: permitLine ? pal.permitBg : pal.boardBg,
            borderColor: pal.boardBorder,
            boxShadow: "0 16px 36px rgba(2,5,16,0.6)",
            minHeight: full ? undefined : "15dvh",
          }}
        >
          {permitLine ? (
            <div className={`flex items-center gap-3 px-3.5 ${full ? "py-3.5" : "py-2.5"}`}>
              <svg width={full ? 52 : 40} height={full ? 52 : 40} viewBox="0 0 48 48" aria-hidden focusable="false" className="shrink-0">
                <path d="M24 5 L45 41 L3 41 Z" fill="#ffd21f" stroke="#141414" strokeWidth="2.5" strokeLinejoin="round" />
                <text x="24" y="36" textAnchor="middle" fontSize="24" fontWeight="800" fill="#141414">!</text>
              </svg>
              <div className="min-w-0 flex-1">
                <div className={`${full ? "text-[26px]" : "text-xl"} font-condensed font-bold leading-tight`} style={{ color: pal.text }}>
                  EXIT NOT ON YOUR APPROVED ROUTE
                </div>
                <div className={`${full ? "text-lg" : "text-base"} font-bold leading-snug`} style={{ color: "#ffd97a" }}>
                  {permitLine}
                </div>
                <div className="mt-0.5 truncate text-xs font-semibold" style={{ color: pal.subText }}>
                  {signWords}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`${full ? "text-3xl" : "text-2xl"} font-condensed font-bold leading-none`} style={{ color: pal.text }}>
                  {distLabel}
                </div>
                {etaLabel ? (
                  <div className="mt-1 text-[11px] font-bold" style={{ color: pal.subText }}>{etaLabel}</div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={`flex items-center gap-3 px-3.5 ${full ? "py-3" : "py-2.5"}`}>
              {primaryRef && <RefShield ref={primaryRef} large={full} />}
              <div className="min-w-0 flex-1">
                {placard.directionWord && (
                  <div className={`${full ? "text-base" : "text-sm"} font-bold uppercase leading-none tracking-[0.14em]`} style={{ color: pal.text }}>
                    {placard.directionWord}
                  </div>
                )}
                {placard.destinations.length > 0 ? (
                  placard.destinations.map((d, i) => (
                    <div
                      key={i}
                      className={`${full ? "text-[34px]" : "text-[26px]"} truncate font-condensed font-bold leading-[1.05]`}
                      style={{ color: pal.text }}
                    >
                      {d}
                    </div>
                  ))
                ) : (
                  <div className={`${full ? "text-[30px]" : "text-2xl"} truncate font-condensed font-bold leading-tight`} style={{ color: pal.text }}>
                    {primaryRef?.text ?? placard.instruction}
                  </div>
                )}
                {secondaryRefs.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {secondaryRefs.map((r, i) => (
                      <span
                        key={i}
                        className="rounded border border-white/70 px-1.5 py-px text-[11px] font-bold"
                        style={{ color: pal.text }}
                      >
                        {r.text}
                      </span>
                    ))}
                  </div>
                )}
                {full && (
                  <div className="mt-0.5 truncate text-xs font-semibold" style={{ color: pal.subText }}>
                    {placard.instruction}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className={`${full ? "text-3xl" : "text-2xl"} font-condensed font-bold leading-none`} style={{ color: pal.text }}>
                  {distLabel}
                </div>
                {full ? (
                  placard.side === "left" ? (
                    <ExitArrowSvg size={44} color={pal.arrow} flip />
                  ) : placard.side === "right" ? (
                    <ExitArrowSvg size={44} color={pal.arrow} />
                  ) : (
                    <StraightArrowSvg size={40} color={pal.subText} />
                  )
                ) : etaLabel ? (
                  <div className="text-[11px] font-bold" style={{ color: pal.subText }}>{etaLabel}</div>
                ) : null}
              </div>
            </div>
          )}
        </button>
      </div>
      {full && <LaneStrip placard={placard} night={night} />}
      {full && placard.laneCaption && (
        <div
          className="mt-1 text-center font-condensed text-xl font-bold text-white"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.75), 0 0 12px rgba(0,0,0,0.5)" }}
          role="status"
        >
          {placard.laneCaption}
        </div>
      )}
      {!full && <ChipRow chips={chips} />}
    </div>
  );
}
