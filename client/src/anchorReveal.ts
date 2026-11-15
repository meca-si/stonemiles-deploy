// anchorReveal.ts — the reveal registry behind the UI cleanup pass
// (x's order, 2026-11-15: long pages become tabs / collapsible
// sections, and any tool stays reachable in a couple of taps).
//
// When a surface's content lives behind a tab or a fold, a deep-link
// jump (Ask Meca's "Take me there", the tool directory, an alert
// strip) names an anchor id whose element only exists once the right
// section is open. The section that owns an anchor registers an
// opener here; scrollToAnchor fires revealAnchor(id) BEFORE its
// delayed scroll, so the section opens first and the scroll lands.
//
// Reveals are briefly sticky: a jump usually mounts the target tab
// or sheet in the same tick it fires the reveal, so the section may
// register a moment AFTER the reveal fired. A registration that
// lands within REVEAL_MEMORY_MS of a reveal for its anchor opens
// immediately — the jump still lands.
//
// Pure registry — no DOM, no React — so it unit-tests directly.

type Opener = () => void;

const REVEAL_MEMORY_MS = 2000;

const openers = new Map<string, Set<Opener>>();
const lastRevealAt = new Map<string, number>();

/** Register an opener for an anchor id. If a reveal for this anchor
 *  fired moments ago (the jump that mounted this section), the
 *  opener runs immediately. Returns the unregister fn. */
export function onAnchorReveal(id: string, open: Opener): () => void {
  let set = openers.get(id);
  if (!set) {
    set = new Set();
    openers.set(id, set);
  }
  set.add(open);
  const at = lastRevealAt.get(id);
  if (at !== undefined && Date.now() - at <= REVEAL_MEMORY_MS) open();
  return () => {
    set.delete(open);
    if (set.size === 0) openers.delete(id);
  };
}

/** Fire every opener registered for an anchor id, and remember the
 *  reveal so a section registering just after still opens. Returns
 *  how many openers ran immediately (0 = the anchor lives on an
 *  always-rendered surface, or its section has not mounted yet). */
export function revealAnchor(id: string): number {
  lastRevealAt.set(id, Date.now());
  const set = openers.get(id);
  if (!set) return 0;
  let ran = 0;
  for (const open of [...set]) {
    open();
    ran++;
  }
  return ran;
}
