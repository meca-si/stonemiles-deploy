// The Space's viewer context in the browser: who is looking at the Space,
// who else has it open, and when someone changes its data.
//
// It is read from the Muse that serves the Space (`./_viewer`), the owner's
// own Muse or, for a connection, the owner's Muse through theirs, so every
// page sees the same people. Identity comes from that Muse's authentication,
// never from this page. Pages that use it poll while visible; that also keeps
// this viewer present for the others.
import { useSyncExternalStore } from "react";
const POLL_MS = 15_000;
const MAX_IDLE_POLL_MS = 300_000;
const UNAVAILABLE_STATUSES = new Set([401, 403, 404]);
export function createSpaceViewerStore(hooks) {
    let snapshot = null;
    let unavailable = false;
    let idlePollMs = null;
    let cursor = null;
    let loaded = false;
    let recovering = false;
    let inFlight = null;
    let timer = null;
    const listeners = new Set();
    const emit = (event) => {
        for (const listener of [...listeners]) {
            listener(event);
        }
    };
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const schedule = () => {
        if (timer != null) {
            clearTimeout(timer);
            timer = null;
        }
        if (unavailable || listeners.size === 0 || !visible()) {
            return;
        }
        timer = setTimeout(() => {
            timer = null;
            void read().finally(schedule);
        }, idlePollMs ?? POLL_MS);
    };
    const apply = (wire) => {
        idlePollMs = null;
        loaded = true;
        const present = wire.present.map(({ since_ms, ...person }) => ({ ...person, sinceMs: since_ms }));
        const next = { you: wire.you, host: wire.host, present };
        const previous = snapshot;
        const same = previous != null && JSON.stringify(previous) === JSON.stringify(next);
        if (!same) {
            snapshot = next;
        }
        cursor = wire.cursor;
        const events = [];
        if (previous != null) {
            const before = new Map(previous.present.map((person) => [person.id, person]));
            const after = new Map(present.map((person) => [person.id, person]));
            for (const person of present) {
                if (!before.has(person.id))
                    events.push({ type: "join", person });
            }
            for (const person of previous.present) {
                if (!after.has(person.id))
                    events.push({ type: "leave", person });
            }
        }
        let changed = wire.resync === true || recovering;
        recovering = false;
        for (const change of wire.changes) {
            if (change.call_id != null && hooks.isKnownCall(change.call_id)) {
                continue;
            }
            changed = true;
            events.push({ type: "change", by: change.by, atMs: change.at_ms });
        }
        if (changed) {
            hooks.refresh();
        }
        if (events.length === 0 && !same) {
            emit();
        }
        for (const event of events) {
            emit(event);
        }
    };
    const markUnavailable = () => {
        unavailable = true;
        snapshot = null;
        emit();
        return null;
    };
    const pause = () => {
        idlePollMs = Math.min((idlePollMs ?? POLL_MS) * 2, MAX_IDLE_POLL_MS);
        cursor = null;
        recovering = loaded;
        if (snapshot != null) {
            snapshot = null;
            emit();
        }
        return null;
    };
    const fetchViewer = async () => {
        const base = new URL(globalThis.location?.href ?? "https://hatch.invalid/");
        base.hash = "";
        base.search = "";
        const url = new URL(cursor == null ? "./_viewer" : `./_viewer/${encodeURIComponent(cursor)}`, base);
        let response;
        try {
            response = await globalThis.fetch(url.toString(), {
                headers: { accept: "application/json" },
            });
        }
        catch {
            return snapshot;
        }
        const body = (await response.json().catch(() => null));
        if (response.ok && body?.ok !== true) {
            return markUnavailable();
        }
        if (!response.ok) {
            const code = body?.error?.code;
            if (typeof code !== "string") {
                return snapshot;
            }
            if (UNAVAILABLE_STATUSES.has(response.status)) {
                return loaded ? pause() : markUnavailable();
            }
            if (code === "peer_operation_unavailable") {
                return pause();
            }
            return snapshot;
        }
        apply(body?.result);
        return snapshot;
    };
    const read = () => {
        if (unavailable) {
            return Promise.resolve(null);
        }
        inFlight ??= fetchViewer()
            .catch(() => snapshot)
            .finally(() => {
            inFlight = null;
        });
        return inFlight;
    };
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
            if (listeners.size > 0 && visible()) {
                void read().finally(schedule);
            }
            else {
                schedule();
            }
        });
    }
    return {
        get: read,
        current: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                void read().finally(schedule);
            }
            return () => {
                listeners.delete(listener);
                schedule();
            };
        },
    };
}
/** React binding: the current viewer context, or null until it loads or when the Space has none. */
export function useSpaceViewerFrom(store) {
    return useSyncExternalStore((onChange) => store.subscribe(() => onChange()), store.current, () => null);
}
