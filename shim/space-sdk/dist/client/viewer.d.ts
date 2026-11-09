/** What a person may do in the Space: read it, run its actions, or edit it. */
export type SpaceRole = "view" | "use" | "edit";
export interface SpacePerson {
    /** The person's Muse ID, stable across visits. Matches `ctx.viewer.museId`. */
    readonly id: string;
    readonly name: string | null;
    readonly role: SpaceRole;
    /** The Space's owner. Matches `ctx.viewer.isOwner` in actions. */
    readonly owner: boolean;
}
export interface SpacePresentPerson extends SpacePerson {
    /** When this visit started, in epoch milliseconds. */
    readonly sinceMs: number;
}
export interface SpaceViewer {
    readonly you: SpacePerson;
    /** The owner, also when they are not here. */
    readonly host: SpacePerson;
    /** Everyone with the Space open now, you included, longest here first. */
    readonly present: readonly SpacePresentPerson[];
}
export type SpaceViewerEvent = {
    readonly type: "join";
    readonly person: SpacePresentPerson;
} | {
    readonly type: "leave";
    readonly person: SpacePresentPerson;
}
/**
 * Someone else's action changed the Space's data. `by` is their `id`, or
 * null when no person here acted, such as the Space's agent or a schedule.
 * The SDK already refetches the page's queries.
 */
 | {
    readonly type: "change";
    readonly by: string | null;
    readonly atMs: number;
};
export interface SpaceViewerStoreHooks {
    /** True for an `actionCallId` this page sent or already refreshed for. */
    isKnownCall(callId: string): boolean;
    /** Someone else changed the data: refetch the page's queries. */
    refresh(): void;
}
export interface SpaceViewerStore {
    get(): Promise<SpaceViewer | null>;
    subscribe(listener: (event?: SpaceViewerEvent) => void): () => void;
    current(): SpaceViewer | null;
}
export declare function createSpaceViewerStore(hooks: SpaceViewerStoreHooks): SpaceViewerStore;
/** React binding: the current viewer context, or null until it loads or when the Space has none. */
export declare function useSpaceViewerFrom(store: SpaceViewerStore): SpaceViewer | null;
//# sourceMappingURL=viewer.d.ts.map