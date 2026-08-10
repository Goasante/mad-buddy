import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { DEMO_CONTACTS, demoContactsAvailable } from "@/lib/contacts/demo-contacts";
import {
  findMuddiesReducer,
  INITIAL_STATE,
  mayOpenPicker,
  showsBack,
  type ContactMatchView,
  type FindMuddiesEvent,
  type FindMuddiesState
} from "@/lib/contacts/find-muddies-machine";

/**
 * The seven Find Your Muddies journeys, end to end.
 *
 * WHY THESE EXIST: every piece of this feature had a passing unit test while
 * the feature itself did not work. The capability layer was correct, the
 * endpoint was correct, the sheet rendered -- and tapping "Search Muddies"
 * closed the sheet and did nothing, because it was a link to the route the
 * sheet was already on. Component-level tests cannot see that. These walk the
 * whole path a person actually takes and assert on where they end up.
 *
 * Journeys 1-3, 6 and 7 run the real reducer, so the transitions are executed
 * rather than described. Journeys 4 and 5 are settings screens whose behaviour
 * lives in server actions already covered elsewhere; here they are checked for
 * reachability and for the masking guarantee, which is what was actually
 * reported missing.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const sheet = stripComments(read("components/contacts/find-muddies-sheet.tsx"));
const settings = stripComments(read("components/settings/contact-discovery-page.tsx"));
const privacy = stripComments(read("components/settings/account-privacy-page.tsx"));
const muddiesPage = stripComments(read("components/friends/friends-page.tsx"));
const card = stripComments(read("components/contacts/contact-reminder-card.tsx"));

/** Drives the reducer through a sequence, returning the final state. */
function walk(events: readonly FindMuddiesEvent[], from: FindMuddiesState = INITIAL_STATE) {
  return events.reduce(findMuddiesReducer, from);
}

function match(overrides: Partial<ContactMatchView> = {}): ContactMatchView {
  return {
    userId: "u1",
    displayName: "Kofi Mensah",
    username: "kofi",
    avatarUrl: null,
    isVerifiedAccount: false,
    trustedSince: null,
    plan: "free",
    relationship: "none",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// JOURNEY 1 -- supported: open, explain, choose, match, results, add
// ---------------------------------------------------------------------------

describe("journey 1: a supported device reaches results and can add someone", () => {
  it("walks intro to results without a dead step", () => {
    const state = walk([
      { type: "open" },
      { type: "begin", supported: true },
      { type: "choose" },
      { type: "selected" },
      { type: "matched", matches: [match(), match({ userId: "u2", username: "ama" })] }
    ]);

    expect(state.name).toBe("RESULTS");
    expect(state.name === "RESULTS" && state.matches).toHaveLength(2);
  });

  it("passes through an explanation before the picker every time", () => {
    // The step that stops an unexplained OS permission dialog.
    const afterBegin = walk([{ type: "begin", supported: true }]);
    expect(afterBegin.name).toBe("SUPPORTED_READY");

    const afterChoose = findMuddiesReducer(afterBegin, { type: "choose" });
    expect(afterChoose.name).toBe("SELECTING");
  });

  it("shows a loading state between selection and results", () => {
    const matching = walk([
      { type: "begin", supported: true },
      { type: "choose" },
      { type: "selected" }
    ]);
    expect(matching.name).toBe("MATCHING");
    // And it says something a person understands.
    expect(sheet).toContain("Finding your Muddies…");
    expect(sheet).not.toContain("Hashing");
    expect(sheet).not.toContain("Normalis");
  });

  it("adds a Muddy through the canonical action and shows Requested", () => {
    expect(sheet).toContain("sendFriendRequestAction(person.userId)");
    expect(sheet).toContain("setRequested((current) => ({ ...current, [person.userId]: true }))");
    expect(sheet).toContain("Requested");
    // One tap per person. There is no bulk add.
    expect(sheet).not.toContain("addAll");
  });

  it("renders the canonical marks rather than inventing any", () => {
    for (const mark of ["PremiumPlanBadge", "VerifiedAccountMark", "TrustedMemberMark"]) {
      expect(sheet, `${mark} must come from the shared component`).toContain(mark);
    }
    // Fed from the server projection, never derived from the match itself.
    expect(sheet).toContain("person.isVerifiedAccount");
    expect(sheet).toContain("person.trustedSince");
  });
});

// ---------------------------------------------------------------------------
// JOURNEY 2 -- unsupported: Search Muddies closes and focuses the real field
// ---------------------------------------------------------------------------

describe("journey 2: unsupported leads to a working search, not a closed sheet", () => {
  it("routes an unsupported device to its own screen", () => {
    expect(walk([{ type: "begin", supported: false }]).name).toBe("UNSUPPORTED");
  });

  it("closes the sheet AND focuses the existing field", () => {
    // THE ORIGINAL BUG. <Link href="/friends"> inside a sheet already on
    // /friends is the same route: Next.js no-ops it, the sheet closes, and
    // nothing happens. Both halves are now asserted.
    const handler = sheet.slice(sheet.indexOf("function searchMuddies"));
    expect(handler.slice(0, 400)).toContain("close();");
    expect(handler.slice(0, 400)).toContain("onSearchMuddies?.()");
    expect(sheet).not.toContain('href="/friends"');
  });

  it("is wired to the real input on the page underneath", () => {
    expect(muddiesPage).toContain("onSearchMuddies={focusMuddiesSearch}");
    expect(muddiesPage).toContain("ref={searchInputRef}");
    const focus = muddiesPage.slice(muddiesPage.indexOf("const focusMuddiesSearch"));
    expect(focus.slice(0, 500)).toContain("field.focus()");
    // Deferred a frame: a dialog restores focus to its opener on close, so a
    // synchronous focus would be undone and look exactly like the old bug.
    expect(focus.slice(0, 500)).toContain("window.requestAnimationFrame");
  });

  it("creates no second search screen", () => {
    // The existing architecture already has one.
    expect(sheet).not.toContain("SearchResults");
    expect(sheet).not.toContain("searchUsersAction");
  });
});

// ---------------------------------------------------------------------------
// JOURNEY 3 -- invite goes through the canonical share
// ---------------------------------------------------------------------------

describe("journey 3: invite performs a real action", () => {
  it("calls the shared helper rather than its own share", () => {
    expect(sheet).toContain("shareInvite()");
    expect(sheet).not.toContain("navigator.share");
  });

  it("reports every outcome, including the clipboard fallback", () => {
    const invite = stripComments(read("lib/device/invite-share.ts"));
    for (const outcome of ['"shared"', '"copied"', '"unavailable"']) {
      expect(invite).toContain(outcome);
    }
    expect(sheet).toContain("Invite link copied.");
    expect(sheet).toContain("Couldn't open sharing on this device.");
  });

  it("addresses the invite to nobody", () => {
    // No SMS, no mass messaging, and nothing aimed at an unmatched number.
    const invite = stripComments(read("lib/device/invite-share.ts"));
    expect(invite).not.toContain("sms:");
    expect(invite).not.toContain("phoneNumber");
  });
});

// ---------------------------------------------------------------------------
// JOURNEY 4 -- settings: reachable, and both controls work
// ---------------------------------------------------------------------------

describe("journey 4: contact discovery is findable and controllable in settings", () => {
  it("is one tap from Privacy", () => {
    expect(privacy).toContain('href: "/settings/contact-discovery"');
    expect(privacy).toContain('title: "Contact discovery"');
  });

  it("carries the phone control and the toggle on one screen", () => {
    expect(settings).toContain("Phone number");
    expect(settings).toContain("Allow people who have my number to find me");
    expect(settings).toContain('role="switch"');
  });

  it("routes both directions of the toggle through the server", () => {
    expect(settings).toContain("setContactDiscoveryAction(next)");
    // Local state follows the server's answer rather than leading it.
    const toggle = settings.slice(settings.indexOf("function toggleDiscovery"));
    expect(toggle.slice(0, 400)).toContain("if (result.ok)");
    expect(toggle.slice(0, 400)).toContain("setDiscoveryEnabled(next)");
  });

  it("refuses discovery without a number", () => {
    expect(settings).toContain("disabled={isPending || !hasPhone}");
    expect(settings).toContain("Add a phone number first.");
  });

  it("names the two directions as separate choices", () => {
    // Turning the toggle on does not go and find anybody, and checking
    // contacts does not make the user findable. The screen says so.
    expect(settings).toContain("Find people you know");
    expect(settings).toContain("Separate from the setting above");
    expect(settings).toContain("/friends?find=contacts");
  });
});

// ---------------------------------------------------------------------------
// JOURNEY 5 -- no phone, then a masked number
// ---------------------------------------------------------------------------

describe("journey 5: adding a number shows it back masked", () => {
  it("offers Add when there is no number and Change when there is", () => {
    expect(settings).toContain('{hasPhone ? "Change number" : "Add number"}');
  });

  it("shows only the last digits, never the number", () => {
    // A full number on screen is a full number in a screenshot.
    expect(settings).toContain("Ending ${hint}");
    const actions = stripComments(read("app/(app)/contact-actions.ts"));
    expect(actions).not.toContain("phoneE164:");
  });

  it("says added, never verified", () => {
    // There is no OTP, so no number here is proven to belong to its owner.
    expect(settings.toLowerCase()).not.toContain("verified");
  });

  it("explains what adding a number does not do", () => {
    expect(settings).toContain("does not make you findable on its own");
  });
});

// ---------------------------------------------------------------------------
// JOURNEY 6 -- the reminder leads to the explanation, never to a permission
// ---------------------------------------------------------------------------

describe("journey 6: a reminder can never produce an OS contact prompt", () => {
  it("touches no capability itself", () => {
    for (const forbidden of ["navigator.contacts", "selectContacts", "detectContactCapability"]) {
      expect(card, `the reminder must not reach ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("opens the sheet at the explanation, three taps from the picker", () => {
    expect(card).toContain("onOpenSetup()");
    expect(muddiesPage).toContain("setFindMuddiesOpen(true)");
    // And the sheet always starts at INTRO regardless of how it was opened.
    expect(walk([{ type: "open" }]).name).toBe("INTRO");
  });

  it("sends someone with no number to the screen that takes one", () => {
    // Offering a contact check to somebody who cannot be found by it is the
    // dead end this avoids.
    const handler = muddiesPage.slice(muddiesPage.indexOf("onOpenSetup={() => {"));
    expect(handler.slice(0, 600)).toContain('reminderKind === "add_phone"');
    expect(handler.slice(0, 600)).toContain("/settings/contact-discovery");
  });

  it("keeps Maybe later and Don't ask again as reminder preferences only", () => {
    expect(card).toContain("dismissContactReminderAction()");
    expect(card).toContain("stopContactRemindersAction()");
    // Neither removes a number nor changes discovery.
    expect(card).not.toContain("setContactDiscoveryAction");
    expect(card).not.toContain("removePhoneNumberAction");
    expect(card).toContain("You can always find people from your contacts later in Settings.");
  });
});

// ---------------------------------------------------------------------------
// JOURNEY 7 -- the development fixture
// ---------------------------------------------------------------------------

describe("journey 7: the demo fixture exercises the supported UI on a desktop", () => {
  it("is available in development and impossible in production", () => {
    // The literal comparison is what the bundler folds, so a production build
    // drops the fixture entirely rather than shipping it behind a flag.
    const demo = stripComments(read("lib/contacts/demo-contacts.ts"));
    expect(demo).toContain('process.env.NODE_ENV !== "production"');
    // No runtime switch of any kind could turn this on in a deployed build.
    for (const escape of ["localStorage", "sessionStorage", "searchParams", "headers", "cookie"]) {
      expect(demo, `no runtime escape hatch: ${escape}`).not.toContain(escape);
    }
    // Under vitest NODE_ENV is "test", so this is the development answer.
    expect(demoContactsAvailable()).toBe(true);
  });

  it("clears the batch floor, so the whole path can be walked", () => {
    // Read from the source rather than imported: contact-matching.ts is
    // "server-only" and importing it here would fail at module load.
    const matching = read("lib/contacts/contact-matching.ts");
    const floor = Number(matching.match(/MIN_CONTACT_BATCH = (\d+)/)?.[1]);
    expect(Number.isFinite(floor)).toBe(true);
    expect(DEMO_CONTACTS.length).toBeGreaterThan(floor);
  });

  it("uses numbers that cannot reach a real person", () => {
    // +1 555 01xx is the range reserved for fiction.
    for (const contact of DEMO_CONTACTS) {
      expect(contact.phoneNumber, `${contact.name} must use a reserved number`).toMatch(/^\+155501\d{2}$/);
    }
  });

  it("stands in for the picker and nothing else", () => {
    // It still posts to the real endpoint, which still applies every rule.
    const choose = sheet.slice(sheet.indexOf("async function choose"));
    expect(choose.slice(0, 900)).toContain("runMatch(DEMO_CONTACTS.map");
    expect(sheet).toContain('fetch("/api/contacts/match"');
    // No client-side matching sneaks in with it.
    for (const forbidden of ["createHmac", "match_hmac", "normalisePhoneNumbers"]) {
      expect(sheet).not.toContain(forbidden);
    }
  });

  it("is only reached where there is genuinely no picker", () => {
    const choose = sheet.slice(sheet.indexOf("async function choose"));
    expect(choose.slice(0, 900)).toContain('detectContactCapability() === "unsupported" && demoContactsAvailable()');
  });

  it("is labelled on screen so it cannot be mistaken for the real picker", () => {
    expect(sheet).toContain("Development build:");
  });
});

// ---------------------------------------------------------------------------
// No state strands anyone
// ---------------------------------------------------------------------------

describe("every screen has a way out", () => {
  const reachable: FindMuddiesState[] = [
    { name: "SUPPORTED_READY" },
    { name: "UNSUPPORTED" },
    { name: "RESULTS", matches: [match()] },
    { name: "NO_RESULTS" },
    { name: "ERROR", message: "x", retry: "match" }
  ];

  it("returns to the explanation from anywhere", () => {
    for (const state of reachable) {
      expect(findMuddiesReducer(state, { type: "back" }).name, `${state.name} must have a Back`).toBe("INTRO");
    }
  });

  it("offers Back on every screen that is not mid-task", () => {
    for (const state of reachable) {
      expect(showsBack(state), `${state.name} shows Back`).toBe(true);
    }
    // Not while waiting: there is nothing to go back to yet, and cancelling a
    // picker is the OS's own gesture.
    expect(showsBack({ name: "SELECTING" })).toBe(false);
    expect(showsBack({ name: "MATCHING" })).toBe(false);
    // INTRO closes instead, which is the sheet's own dismiss.
    expect(showsBack(INITIAL_STATE)).toBe(false);
  });

  it("returns a cancelled picker to the screen that opened it", () => {
    const state = walk([
      { type: "begin", supported: true },
      { type: "choose" },
      { type: "cancelled" }
    ]);
    // Not an error, and above all not a second permission prompt.
    expect(state.name).toBe("SUPPORTED_READY");
  });

  it("retries at the step that failed, not from the top", () => {
    const failed = walk([
      { type: "begin", supported: true },
      { type: "choose" },
      { type: "selected" },
      { type: "failed", message: "Couldn't check your contacts.", retry: "match" }
    ]);
    expect(failed.name).toBe("ERROR");
    expect(findMuddiesReducer(failed, { type: "retry" }).name).toBe("SUPPORTED_READY");
  });

  it("offers no retry where another tap cannot help", () => {
    const limited = walk([
      { type: "begin", supported: true },
      { type: "choose" },
      { type: "selected" },
      { type: "failed", message: "Try again tomorrow.", retry: null }
    ]);
    expect(limited.name === "ERROR" && limited.retry).toBeNull();
    // Retrying is inert rather than looping back into a call that will fail.
    expect(findMuddiesReducer(limited, { type: "retry" }).name).toBe("ERROR");
  });

  it("treats an empty match list as its own screen", () => {
    // Not an empty results list: the words and the actions are different.
    const state = walk([
      { type: "begin", supported: true },
      { type: "choose" },
      { type: "selected" },
      { type: "matched", matches: [] }
    ]);
    expect(state.name).toBe("NO_RESULTS");
    expect(sheet).toContain("No Muddies found yet");
  });
});

// ---------------------------------------------------------------------------
// The ordering guarantee, stated as a property
// ---------------------------------------------------------------------------

describe("the OS picker is unreachable except from one state", () => {
  const everyState: FindMuddiesState[] = [
    INITIAL_STATE,
    { name: "SUPPORTED_READY" },
    { name: "UNSUPPORTED" },
    { name: "SELECTING" },
    { name: "MATCHING" },
    { name: "RESULTS", matches: [] },
    { name: "NO_RESULTS" },
    { name: "ERROR", message: "x", retry: null }
  ];

  it("permits a picker call from SUPPORTED_READY alone", () => {
    for (const state of everyState) {
      expect(mayOpenPicker(state, { type: "choose" }), `choose from ${state.name}`).toBe(
        state.name === "SUPPORTED_READY"
      );
    }
  });

  it("permits it for no other event", () => {
    for (const event of [
      { type: "open" },
      { type: "begin", supported: true },
      { type: "selected" },
      { type: "back" }
    ] as FindMuddiesEvent[]) {
      expect(mayOpenPicker({ name: "SUPPORTED_READY" }, event), `${event.type} must not open the picker`).toBe(false);
    }
  });

  it("cannot ENTER SELECTING from anywhere else", () => {
    // Entering is what matters, so a state that was already SELECTING and
    // ignored a duplicate tap is not a violation -- it stayed put, which is
    // exactly the behaviour a late second tap should get.
    for (const state of everyState) {
      if (state.name === "SUPPORTED_READY" || state.name === "SELECTING") continue;
      expect(findMuddiesReducer(state, { type: "choose" }).name, `choose from ${state.name}`).not.toBe("SELECTING");
    }
    // And a duplicate tap while already selecting changes nothing.
    expect(findMuddiesReducer({ name: "SELECTING" }, { type: "choose" })).toEqual({ name: "SELECTING" });
  });

  it("ignores a duplicate or late event rather than throwing", () => {
    // A second tap, or a response arriving after the user moved on.
    const results = walk([
      { type: "begin", supported: true },
      { type: "choose" },
      { type: "selected" },
      { type: "matched", matches: [match()] }
    ]);
    expect(findMuddiesReducer(results, { type: "matched", matches: [] }).name).toBe("RESULTS");
    expect(findMuddiesReducer(results, { type: "cancelled" }).name).toBe("RESULTS");
  });
});
