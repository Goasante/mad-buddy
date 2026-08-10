import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  EMPTY_REMINDER_STATE,
  MAX_REMINDER_DISMISSALS,
  PRIVACY_CHANGE_QUIET_DAYS,
  REMINDER_COOLDOWN_DAYS,
  afterDismissal,
  afterPermanentDismissal,
  afterPrivacyChange,
  afterSetupComplete,
  isBusy,
  isExcludedSurface,
  shouldContactDiscoveryReminderShow,
  staggerOffsetHours,
  type ContactReminderState
} from "@/lib/contacts/reminder-eligibility";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const card = stripComments(read("components/contacts/contact-reminder-card.tsx"));
const store = stripComments(read("lib/contacts/reminder-store.ts"));
const actions = stripComments(read("app/(app)/contact-actions.ts"));
const friendsPage = stripComments(read("app/(app)/friends/page.tsx"));
const sheet = stripComments(read("components/contacts/find-muddies-sheet.tsx"));

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const OLD_ACCOUNT = "2026-01-01T00:00:00.000Z";

function decide(overrides: Partial<Parameters<typeof shouldContactDiscoveryReminderShow>[0]> = {}) {
  return shouldContactDiscoveryReminderShow({
    hasPhone: false,
    discoveryEnabled: false,
    state: EMPTY_REMINDER_STATE,
    pathname: "/friends",
    accountCreatedAt: OLD_ACCOUNT,
    nowMs: NOW,
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

describe("who is offered contact discovery", () => {
  it("offers an established account that has never set it up", () => {
    expect(decide()).toEqual({ show: true, kind: "add_phone" });
  });

  it("asks for a number first when there is none", () => {
    // Connecting contacts before having a number would be out of order --
    // there would be nothing to be discoverable by.
    expect(decide({ hasPhone: false })).toEqual({ show: true, kind: "add_phone" });
  });

  it("asks about contacts once a number exists", () => {
    expect(decide({ hasPhone: true })).toEqual({ show: true, kind: "find_muddies" });
  });

  it("leaves a brand-new account alone", () => {
    // Onboarding already asks a lot; a prompt on day zero competes with
    // learning what the product is.
    const decision = decide({ accountCreatedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() });
    expect(decision).toEqual({ show: false, reason: "too_new" });
  });

  it("stops once setup is complete", () => {
    const state: ContactReminderState = { ...EMPTY_REMINDER_STATE, setupCompletedAt: OLD_ACCOUNT };
    expect(decide({ state })).toEqual({ show: false, reason: "setup_complete" });
  });

  it("treats a saved number as NOT setup complete", () => {
    // Someone may add a number and never come near their contacts; the second
    // prompt exists for exactly that gap.
    expect(decide({ hasPhone: true, discoveryEnabled: true }).show).toBe(true);
  });

  it("never prompts after a permanent dismissal", () => {
    const state = afterPermanentDismissal(EMPTY_REMINDER_STATE);
    expect(decide({ state })).toEqual({ show: false, reason: "permanently_dismissed" });
  });

  it("is deterministic", () => {
    // Same inputs, same answer -- so behaviour can be tested without mounting
    // anything or waiting on a clock.
    expect(decide()).toEqual(decide());
  });
});

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

describe("the cadence escalates and then stops", () => {
  it("waits three days after the first Maybe later", () => {
    const next = afterDismissal(EMPTY_REMINDER_STATE, NOW);
    expect(next.dismissCount).toBe(1);
    expect(Date.parse(next.suppressedUntil!)).toBe(NOW + 3 * DAY);
  });

  it("waits seven days after the second", () => {
    const next = afterDismissal(afterDismissal(EMPTY_REMINDER_STATE, NOW), NOW);
    expect(Date.parse(next.suppressedUntil!)).toBe(NOW + 7 * DAY);
  });

  it("waits fourteen days after the third", () => {
    let state = EMPTY_REMINDER_STATE;
    for (let index = 0; index < 3; index += 1) state = afterDismissal(state, NOW);
    expect(Date.parse(state.suppressedUntil!)).toBe(NOW + 14 * DAY);
  });

  it("stops entirely after enough dismissals", () => {
    // Three declines is a decision. The feature stays reachable by hand.
    let state = EMPTY_REMINDER_STATE;
    for (let index = 0; index < MAX_REMINDER_DISMISSALS; index += 1) state = afterDismissal(state, NOW);
    expect(decide({ state })).toEqual({ show: false, reason: "dismissed_enough" });
  });

  it("stays quiet while cooling down", () => {
    const state = afterDismissal(EMPTY_REMINDER_STATE, NOW);
    expect(decide({ state, nowMs: NOW + DAY })).toEqual({ show: false, reason: "cooling_down" });
  });

  it("becomes eligible again once the cooldown passes", () => {
    const state = afterDismissal(EMPTY_REMINDER_STATE, NOW);
    expect(decide({ state, nowMs: NOW + 4 * DAY }).show).toBe(true);
  });

  it("keeps the intervals in one place", () => {
    // Scattered timings are how a cadence drifts without anyone noticing.
    expect(REMINDER_COOLDOWN_DAYS).toEqual([3, 7, 14]);
  });
});

// ---------------------------------------------------------------------------
// Deliberate privacy choices
// ---------------------------------------------------------------------------

describe("a privacy decision is respected, not argued with", () => {
  it("goes quiet for a month after one", () => {
    const state = afterPrivacyChange(EMPTY_REMINDER_STATE, NOW);
    expect(Date.parse(state.suppressedUntil!)).toBe(NOW + PRIVACY_CHANGE_QUIET_DAYS * DAY);
    expect(decide({ state, nowMs: NOW + 7 * DAY }).show).toBe(false);
  });

  it("does not count as a dismissal", () => {
    // Declining a prompt and changing a setting are different acts; treating
    // them alike would burn a dismissal nobody made.
    expect(afterPrivacyChange(EMPTY_REMINDER_STATE, NOW).dismissCount).toBe(0);
  });

  it("is triggered by removing a number", () => {
    const remove = actions.slice(actions.indexOf("removePhoneNumberAction"));
    expect(remove.slice(0, 900)).toContain("recordPrivacyChange(admin, user.id)");
  });

  it("is triggered by switching discovery off, but not on", () => {
    // Turning it on needs no quiet period.
    expect(actions).toContain("if (result.ok && !enabled)");
  });
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

describe("prompts stay off focused surfaces", () => {
  it("never interrupts a task surface", () => {
    for (const path of [
      "/scan",
      "/safe-arrival",
      "/messages/abc",
      "/plans/123",
      "/events/456",
      "/settings",
      "/settings/contact-discovery",
      "/onboarding",
      "/login",
      "/signup",
      "/billing",
      "/upgrade",
      "/profile"
    ]) {
      expect(isExcludedSurface(path), `${path} must be excluded`).toBe(true);
    }
  });

  it("allows the contextual surfaces", () => {
    expect(isExcludedSurface("/friends")).toBe(false);
    expect(isExcludedSurface("/dashboard")).toBe(false);
  });

  it("treats an unknown path as excluded", () => {
    // Fails closed: better a missed prompt than one over something unknown.
    expect(isExcludedSurface(null)).toBe(true);
    expect(isExcludedSurface(undefined)).toBe(true);
  });

  it("suppresses while the person is mid-task", () => {
    for (const activity of [
      { cameraOpen: true },
      { editingMedia: true },
      { recording: true },
      { inCall: true },
      { composerActive: true },
      { hasUnsavedWork: true },
      { overlayOpen: true }
    ]) {
      expect(isBusy(activity), JSON.stringify(activity)).toBe(true);
      expect(decide({ activity })).toEqual({ show: false, reason: "busy" });
    }
  });

  it("uses one rule rather than per-page checks", () => {
    expect(read("lib/contacts/reminder-eligibility.ts")).toContain("REMINDER_EXCLUDED_PREFIXES");
  });
});

// ---------------------------------------------------------------------------
// §19 -- OS permission safety
// ---------------------------------------------------------------------------

describe("a reminder can never reach the contact picker", () => {
  it("does not touch contacts at all", () => {
    // THE RULE THIS FEATURE MOST NEEDS. A reminder that produced an OS
    // permission dialog would be its worst possible form.
    for (const forbidden of [
      "navigator.contacts",
      "selectContacts",
      "detectContactCapability",
      "getProperties",
      ".select([",
      "permissions.query"
    ]) {
      expect(card, `the reminder must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("hands off to the existing setup flow instead", () => {
    // The only route to contact access remains the Slice 3 explanation, which
    // asks again before invoking anything.
    expect(card).toContain("onOpenSetup()");
    expect(friendsPage.length).toBeGreaterThan(0);
    const page = stripComments(read("components/friends/friends-page.tsx"));
    expect(page).toContain("setFindMuddiesOpen(true)");
  });

  it("keeps the picker behind a second deliberate action", () => {
    // Now THREE taps from the reminder, not two: the card opens the sheet at
    // INTRO, "Find my Muddies" moves to SUPPORTED_READY, and only "Choose
    // contacts" reaches the picker. The machine enforces that ordering --
    // SELECTING is reachable from SUPPORTED_READY and nowhere else.
    const handler = sheet.slice(sheet.indexOf("async function choose"));
    expect(handler).toContain("selectContacts()");
    expect(sheet).toContain("useReducer(findMuddiesReducer, INITIAL_STATE)");

    const machine = stripComments(read("lib/contacts/find-muddies-machine.ts"));
    const chooseCase = machine.slice(machine.indexOf('case "choose":'));
    expect(chooseCase.slice(0, 250)).toContain('state.name !== "SUPPORTED_READY"');
  });

  it("requests nothing when dismissed", () => {
    const dismiss = card.slice(card.indexOf("function dismiss()"));
    expect(dismiss.slice(0, 400)).toContain("dismissContactReminderAction()");
    expect(dismiss.slice(0, 400)).not.toContain("selectContacts");
  });

  it("changes no privacy state of its own", () => {
    for (const forbidden of ["setContactDiscovery", "savePhoneNumber", "sendFriendRequest"]) {
      expect(card, `the reminder must not call ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Manual access
// ---------------------------------------------------------------------------

describe("suppression never removes the feature", () => {
  it("says so in the copy", () => {
    expect(card).toContain("You can always find people from your contacts later in Settings.");
  });

  it("leaves the entry point and settings untouched", () => {
    // Neither is gated on reminder state.
    const page = stripComments(read("components/friends/friends-page.tsx"));
    expect(page).toContain("Find Your Muddies");
    const privacy = stripComments(read("components/settings/account-privacy-page.tsx"));
    expect(privacy).toContain('href: "/settings/contact-discovery"');
  });

  it("does not disable discovery or remove a number", () => {
    const stop = actions.slice(actions.indexOf("stopContactRemindersAction"));
    expect(stop.slice(0, 900)).toContain("recordPermanentDismissal");
    expect(stop.slice(0, 900)).not.toContain("removePhoneNumber");
    expect(stop.slice(0, 900)).not.toContain("setContactDiscovery");
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe("reminder state is account level and needs no migration", () => {
  it("reuses an existing preferences column", () => {
    expect(store).toContain('from("user_preferences")');
    expect(store).toContain("communication_preferences");
  });

  it("preserves everything else in that column", () => {
    // It also holds messaging preferences; clobbering those to record a
    // dismissal would be a bad trade.
    expect(store).toContain("...existing,");
  });

  it("does not rely on localStorage for cooldowns", () => {
    // Dismissing on a phone must not produce a prompt on a laptop.
    expect(store).not.toContain("localStorage");
    expect(card).not.toContain("localStorage");
  });

  it("stores no contact data", () => {
    // Checked against what is actually WRITTEN, not the whole file -- the
    // module legitimately imports from @/lib/contacts, and matching on that
    // path would fail for the wrong reason.
    const written = store.slice(store.indexOf("async function saveReminderState"));
    for (const forbidden of ["phone_e164", "match_hmac", "phoneNumber", "contactName"]) {
      expect(written, `reminder state must not hold ${forbidden}`).not.toContain(forbidden);
    }
    // And the shape itself carries only reminder fields.
    expect(store).toContain("lastPromptedAt");
    expect(store).not.toContain("phone_e164");
  });

  it("is purged with the account", () => {
    // user_preferences is already in the deletion path, so no orphan survives.
    const deletion = stripComments(read("lib/account/deletion.ts"));
    expect(deletion).toContain('"user_preferences"');
  });

  it("tolerates a malformed stored value", () => {
    // A read failure should behave like a new account, never break the page.
    expect(store).toContain('typeof stored.dismissCount === "number"');
    expect(store).toContain("stored.permanentlyDismissed === true");
  });
});

// ---------------------------------------------------------------------------
// Existing users
// ---------------------------------------------------------------------------

describe("a release does not prompt everyone at once", () => {
  it("spreads accounts deterministically", () => {
    const offset = staggerOffsetHours("a-user-id");
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(72);
    // Same id, same offset -- no stored value and no write required.
    expect(staggerOffsetHours("a-user-id")).toBe(offset);
  });

  it("gives different accounts different offsets", () => {
    const offsets = new Set(
      ["alpha", "bravo", "charlie", "delta", "echo"].map((id) => staggerOffsetHours(id))
    );
    expect(offsets.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

describe("finishing setup ends the prompting", () => {
  it("records completion when matching finishes", () => {
    expect(sheet).toContain("completeContactSetupAction()");
  });

  it("records it on reaching results, matches or not", () => {
    // Someone with no matches has still completed the flow. One dispatch
    // covers both outcomes -- the machine routes an empty list to NO_RESULTS
    // -- so completion is recorded immediately after it, unconditionally.
    const matched = sheet.slice(sheet.indexOf('dispatch({ type: "matched"'));
    expect(matched.slice(0, 400)).toContain("completeContactSetupAction");

    const machine = stripComments(read("lib/contacts/find-muddies-machine.ts"));
    const matchedCase = machine.slice(machine.indexOf('case "matched":'));
    expect(matchedCase.slice(0, 300)).toContain('name: "NO_RESULTS"');
  });

  it("marks the state so eligibility stops", () => {
    const state = afterSetupComplete(EMPTY_REMINDER_STATE, NOW);
    expect(state.setupCompletedAt).toBe(new Date(NOW).toISOString());
    expect(decide({ state }).show).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Accessibility and form
// ---------------------------------------------------------------------------

describe("the prompt is a card, not a demand", () => {
  it("is a labelled region rather than a dialog", () => {
    expect(card).toContain('aria-labelledby="contact-reminder-heading"');
    expect(card).not.toContain('role="dialog"');
    expect(card).not.toContain("window.alert");
  });

  it("labels the quiet dismiss", () => {
    expect(card).toContain('aria-label="Dismiss this suggestion"');
  });

  it("offers both actions in words", () => {
    expect(card).toContain("Maybe later");
    expect(card).toContain("Don&rsquo;t ask again");
  });

  it("claims nothing about verification", () => {
    // No OTP exists; implying otherwise would be a false statement.
    for (const forbidden of ["verified", "secure identity", "phone login"]) {
      expect(card.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("uses the shared haptics abstraction, and not on appearance", () => {
    // Vibrating because a card rendered would be startling.
    expect(card).toContain('haptic("close")');
    expect(card).toContain('haptic("tick")');
    expect(card).not.toContain("navigator.vibrate");
  });
});
