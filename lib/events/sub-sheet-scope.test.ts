import { describe, expect, it } from "vitest";

/**
 * EVENTS EMPTY MODAL -- a sub-sheet must not outlive the Event that opened it.
 *
 * Owner and an independent developer both reproduced: interaction on Events ->
 * backdrop appears -> a modal IS present -> its body is EMPTY.
 *
 * The Events page has three sub-sheets hanging off the detail sheet -- Updates,
 * Event admins, and Meet people. Each was set open on the way in, and NOTHING
 * on any path ever set it closed again. Selecting a different Event cleared
 * that Event's data (`updates` back to [], `linkrState` to null) but left the
 * sheet's own open flag standing, so the new Event's detail sheet appeared
 * with the previous Event's sub-sheet still flagged open on top of it.
 *
 * Updates and Meet people are `hideTitle`, so their only visible content comes
 * from the body. That is why the symptom reads as "a panel with nothing in it"
 * rather than an obvious error.
 *
 * This models the open flags as the page holds them, so the leak is pinned
 * without needing a browser.
 */
type SheetState = {
  selectedId: string | null;
  updatesOpen: boolean;
  adminsOpen: boolean;
  meetPeopleOpen: boolean;
  updates: string[];
  linkrState: { consented: boolean } | null;
};

const fresh = (): SheetState => ({
  selectedId: null,
  updatesOpen: false,
  adminsOpen: false,
  meetPeopleOpen: false,
  updates: [],
  linkrState: null
});

/** openDetails, as the page implements it after the fix. */
function openDetails(state: SheetState, eventId: string): SheetState {
  return {
    ...state,
    selectedId: eventId,
    updates: [],
    linkrState: null,
    updatesOpen: false,
    adminsOpen: false,
    meetPeopleOpen: false
  };
}

/** The version that shipped: the open flags survive the Event change. */
function openDetailsBeforeFix(state: SheetState, eventId: string): SheetState {
  return { ...state, selectedId: eventId, updates: [], linkrState: null };
}

/** Whether any sub-sheet would render with nothing meaningful inside it. */
function emptySheets(state: SheetState): string[] {
  const empty: string[] = [];
  // Updates: open when flagged AND an Event is selected, body driven by data
  // that the Event change has just cleared.
  if (state.updatesOpen && state.selectedId && state.updates.length === 0) empty.push("updates");
  // Meet people: only renders at all when linkrState is loaded, so a null one
  // with the flag still set is an open flag with no surface behind it.
  if (state.meetPeopleOpen && !state.linkrState) empty.push("meet-people");
  return empty;
}

describe("an Events sub-sheet is scoped to one Event", () => {
  it("REGRESSION: the shipped version left Updates open over cleared data", () => {
    let state = openDetailsBeforeFix(fresh(), "event-a");
    state = { ...state, updates: ["first update"], updatesOpen: true };
    // The person closes the detail sheet and opens a different Event.
    state = openDetailsBeforeFix(state, "event-b");
    expect(state.updatesOpen).toBe(true);
    expect(state.updates).toEqual([]);
    expect(emptySheets(state)).toContain("updates");
  });

  it("closes Updates when a different Event is chosen", () => {
    let state = openDetails(fresh(), "event-a");
    state = { ...state, updates: ["first update"], updatesOpen: true };
    state = openDetails(state, "event-b");
    expect(state.updatesOpen).toBe(false);
    expect(emptySheets(state)).toEqual([]);
  });

  it("closes Meet people, whose surface unmounts with linkrState", () => {
    let state = openDetails(fresh(), "event-a");
    state = { ...state, linkrState: { consented: true }, meetPeopleOpen: true };
    state = openDetails(state, "event-b");
    expect(state.meetPeopleOpen).toBe(false);
    expect(emptySheets(state)).toEqual([]);
  });

  it("closes Event admins, so a host sheet cannot follow a non-hosted Event", () => {
    let state = openDetails(fresh(), "event-a");
    state = { ...state, adminsOpen: true };
    state = openDetails(state, "event-b");
    expect(state.adminsOpen).toBe(false);
  });

  it("leaves no sub-sheet open after ANY Event change", () => {
    let state = openDetails(fresh(), "event-a");
    state = {
      ...state,
      updatesOpen: true, adminsOpen: true, meetPeopleOpen: true,
      updates: ["u"], linkrState: { consented: false }
    };
    state = openDetails(state, "event-b");
    expect([state.updatesOpen, state.adminsOpen, state.meetPeopleOpen]).toEqual([false, false, false]);
    expect(emptySheets(state)).toEqual([]);
  });

  it("reopening the SAME Event still starts from a closed sub-sheet", () => {
    let state = openDetails(fresh(), "event-a");
    state = { ...state, updatesOpen: true, updates: ["u"] };
    state = openDetails(state, "event-a");
    expect(state.updatesOpen).toBe(false);
    expect(emptySheets(state)).toEqual([]);
  });
});
