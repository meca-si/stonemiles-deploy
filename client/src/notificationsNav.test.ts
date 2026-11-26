// notificationsNav tests — the tap-through target resolver
// (2026-11-25 UX package D). Pins: a saved-load ref lands on the
// load, a board ref on the board, a chat ref on the group,
// credential alerts land on the credentials surface by kind, and
// refs the phone has no door for (broker, dqf, fuel purchases,
// HOS/system rows) resolve to NO target — the tap only marks read.
import { describe, expect, test } from "bun:test";
import { notificationNavFor } from "./NotificationsPanel";

describe("notificationNavFor", () => {
  test("a saved-load ref opens that load", () => {
    expect(notificationNavFor({ kind: "system", refKind: "load", refId: 42 })).toEqual({ kind: "load", id: 42 });
    expect(notificationNavFor({ kind: "load_offer", refKind: "load", refId: 7 })).toEqual({ kind: "load", id: 7 });
  });

  test("a board-load ref opens the board row", () => {
    expect(notificationNavFor({ kind: "load_offer", refKind: "board_load", refId: 9 })).toEqual({ kind: "board_load", id: 9 });
  });

  test("a chat ref opens that group", () => {
    expect(notificationNavFor({ kind: "dm", refKind: "chat", refId: 3 })).toEqual({ kind: "chat", id: 3 });
  });

  test("credential alerts land on credentials even without a usable ref", () => {
    expect(notificationNavFor({ kind: "credential", refKind: "broker", refId: 5 })).toEqual({ kind: "credentials" });
    expect(notificationNavFor({ kind: "credential", refKind: null, refId: null })).toEqual({ kind: "credentials" });
  });

  test("rows with no phone door resolve to no target", () => {
    expect(notificationNavFor({ kind: "hos", refKind: null, refId: null })).toBeNull();
    expect(notificationNavFor({ kind: "system", refKind: "fuel_purchase", refId: 11 })).toBeNull();
    expect(notificationNavFor({ kind: "system", refKind: "load", refId: null })).toBeNull();
    expect(notificationNavFor({ kind: "load_offer", refKind: "broker_submission", refId: 2 })).toBeNull();
  });
});
