import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { detectContactCapability, registerNativeContactBridge, selectContacts } from "@/lib/contacts/contact-capability";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const capability = stripComments(read("lib/contacts/contact-capability.ts"));
const sheet = stripComments(read("components/contacts/find-muddies-sheet.tsx"));
const settings = stripComments(read("components/settings/contact-discovery-page.tsx"));
const actions = stripComments(read("app/(app)/contact-actions.ts"));
const muddiesPage = stripComments(read("components/friends/friends-page.tsx"));

const originalNavigator = globalThis.navigator;

afterEach(() => {
  // Cleared every time: a leaked bridge makes every later test report
  // "native" and silently skip the web picker path entirely.
  registerNativeContactBridge(null);
  vi.unstubAllGlobals();
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
});

/**
 * Stands up a browser-like global for detection.
 *
 * `window` as well as `navigator`: detectContactCapability returns "unknown"
 * without a window, because on the server nothing can be detected yet -- and
 * the default test environment is Node, which has neither.
 */
function stubContacts(manager: unknown) {
  vi.stubGlobal("window", {});
  Object.defineProperty(globalThis, "navigator", {
    value: { ...originalNavigator, contacts: manager },
    configurable: true
  });
}

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

describe("contact capability is detected in one place", () => {
  it("reports the picker when the browser genuinely has one", () => {
    stubContacts({ select: () => Promise.resolve([]), getProperties: () => Promise.resolve(["tel"]) });
    expect(detectContactCapability()).toBe("picker");
  });

  it("reports unsupported on platforms without contact access", () => {
    // iOS Safari and every installed iOS PWA land here. There is no
    // permission to grant, so the UI must not offer one.
    stubContacts(undefined);
    expect(detectContactCapability()).toBe("unsupported");
  });

  it("ignores a stub that cannot actually select", () => {
    // Some engines expose the object without the method.
    stubContacts({});
    expect(detectContactCapability()).toBe("unsupported");
  });

  it("detects without prompting for anything", () => {
    // Detection runs during render, so it must never invoke the picker.
    expect(capability).toContain("export function detectContactCapability");
    const detect = capability.slice(capability.indexOf("export function detectContactCapability"));
    expect(detect.slice(0, 300)).not.toContain(".select(");
  });

  it("leaves room for the native app without coupling to the web picker", () => {
    expect(capability).toContain("registerNativeContactBridge");
    expect(capability).toContain('"native"');
  });

  it("prefers a registered native bridge over the web picker", async () => {
    // A browser-like global is still needed: detection returns "unknown"
    // without a window regardless of what else is registered.
    stubContacts(undefined);
    registerNativeContactBridge({ requestContacts: () => Promise.resolve(["+233241234567"]) });
    expect(detectContactCapability()).toBe("native");
    const result = await selectContacts();
    expect(result.ok && result.phoneNumbers).toEqual(["+233241234567"]);
  });
});

describe("the picker asks for as little as possible", () => {
  it("requests phone numbers and nothing else", async () => {
    // No names, emails, addresses or avatars: matching needs numbers, and
    // every extra field is one the user has to trust us with.
    const select = vi.fn().mockResolvedValue([{ tel: ["024 123 4567"] }]);
    stubContacts({ select, getProperties: () => Promise.resolve(["tel", "name", "email"]) });

    await selectContacts();
    expect(select).toHaveBeenCalledWith(["tel"], { multiple: true });
  });

  it("treats a dismissed picker as a normal choice", async () => {
    stubContacts({ select: () => Promise.resolve([]), getProperties: () => Promise.resolve(["tel"]) });
    const result = await selectContacts();
    expect(result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("treats contacts with no numbers as a cancellation, not a failure", async () => {
    // Email-only entries are a real case and not a permission problem.
    stubContacts({ select: () => Promise.resolve([{ tel: [] }]), getProperties: () => Promise.resolve(["tel"]) });
    expect((await selectContacts()).ok).toBe(false);
  });

  it("reports denial without throwing", async () => {
    stubContacts({
      select: () => Promise.reject(new Error("denied")),
      getProperties: () => Promise.resolve(["tel"])
    });
    expect(await selectContacts()).toEqual({ ok: false, reason: "denied" });
  });

  it("reports unsupported when tel is not on offer", async () => {
    stubContacts({ select: vi.fn(), getProperties: () => Promise.resolve(["name"]) });
    expect(await selectContacts()).toEqual({ ok: false, reason: "unsupported" });
  });

  it("returns numbers raw, leaving normalisation to the server", async () => {
    stubContacts({
      select: () => Promise.resolve([{ tel: ["024 123 4567"] }]),
      getProperties: () => Promise.resolve(["tel"])
    });
    const result = await selectContacts();
    // Not normalised here: a client that normalised first would be deciding
    // what matches.
    expect(result.ok && result.phoneNumbers).toEqual(["024 123 4567"]);
  });
});

// ---------------------------------------------------------------------------
// Permission ordering
// ---------------------------------------------------------------------------

describe("no permission prompt appears unrequested", () => {
  it("shows the explanation before touching any capability", () => {
    // Opening the sheet renders copy. selectContacts runs only inside the
    // handler for the explicit action.
    expect(sheet).toContain('useState<Stage>("explain")');
    const handler = sheet.slice(sheet.indexOf("async function findMuddies"));
    expect(handler).toContain("selectContacts()");
    // The explanation branch itself invokes nothing.
    const explain = sheet.slice(sheet.indexOf('stage === "explain"'));
    expect(explain.slice(0, 900)).not.toContain("selectContacts(");
  });

  it("does not reopen the picker after a cancellation", () => {
    // Re-prompting is how a browser starts refusing permanently.
    const cancelled = sheet.slice(sheet.indexOf('selection.reason === "cancelled"'));
    expect(cancelled.slice(0, 200)).toContain("return;");
    expect(cancelled.slice(0, 200)).not.toContain("selectContacts(");
  });

  it("offers no retry button on an unsupported platform", () => {
    // There is nothing to retry: the capability does not exist.
    const unsupported = sheet.slice(sheet.indexOf('stage === "unsupported"'));
    expect(unsupported.slice(0, 1200)).not.toContain("findMuddies");
    expect(unsupported.slice(0, 1200)).toContain("Search Muddies");
    expect(unsupported.slice(0, 1200)).toContain("Share Mad Buddy");
  });
});

// ---------------------------------------------------------------------------
// Matching integration
// ---------------------------------------------------------------------------

describe("the UI uses the canonical batched endpoint", () => {
  it("posts one batch, never one request per number", () => {
    expect(sheet).toContain('fetch("/api/contacts/match"');
    expect(sheet).toContain('method: "POST"');
    expect(sheet).toContain("phoneNumbers: selection.phoneNumbers");
    // One fetch call in the whole component.
    expect((sheet.match(/fetch\("\/api\/contacts\/match"/g) ?? []).length).toBe(1);
  });

  it("implements no client-side matching", () => {
    for (const forbidden of ["createHmac", "deriveMatchIdentifier", "match_hmac", "normalisePhoneNumbers"]) {
      expect(sheet, `matching must stay server-side: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("explains a small batch without naming the security reason", () => {
    // "Minimum 5 to prevent enumeration" is an implementation detail.
    expect(sheet).toContain("at least ${MIN_USABLE} contacts");
    expect(sheet.toLowerCase()).not.toContain("enumeration");
  });

  it("handles rate limiting and network failure distinctly", () => {
    expect(sheet).toContain("response.status === 429");
    expect(sheet).toContain("Couldn't reach Mad Buddy");
  });
});

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

describe("results use the canonical friendship system", () => {
  it("sends requests through the existing action", () => {
    expect(sheet).toContain("sendFriendRequestAction(person.userId)");
    // No contacts-specific relationship table or action.
    expect(sheet).not.toContain("contactFriend");
  });

  it("never sends a request automatically", () => {
    // Adding is one deliberate tap per person; there is no "add all".
    expect(sheet).toContain("onClick={() => addMuddy(person)}");
    expect(sheet).not.toContain("addAll");
    const results = sheet.slice(sheet.indexOf('stage === "results"'));
    expect(results).not.toContain("forEach(addMuddy");
  });

  it("moves to Requested after a successful add", () => {
    expect(sheet).toContain("setRequested((current) => ({ ...current, [person.userId]: true }))");
    expect(sheet).toContain("Requested");
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("nothing sensitive reaches or leaves the client", () => {
  it("renders no phone number in results", () => {
    const results = sheet.slice(sheet.indexOf('stage === "results"'));
    expect(results).not.toContain("phone");
    expect(results).not.toContain("tel");
  });

  it("never handles identifiers or key versions", () => {
    for (const source of [sheet, settings, actions]) {
      expect(source).not.toContain("match_hmac");
      expect(source).not.toContain("match_key_version");
      expect(source).not.toContain("HMAC_SECRET");
    }
  });

  it("shows the owner a hint rather than their full number", () => {
    // A full number on screen is a full number in a screenshot.
    expect(actions).toContain("hint: identity?.hint ?? \"\"");
    expect(actions).not.toContain("phoneE164:");
    expect(settings).toContain("Ending ${hint}");
  });

  it("does not surface verification state that does not exist", () => {
    // phone_verified_at is always null; sending it invites a client to render
    // a verification that was never performed.
    expect(actions).not.toContain("verifiedAt");
    expect(settings.toLowerCase()).not.toContain("verified");
  });

  it("persists no address book", () => {
    // Selected numbers exist for the life of the request only.
    expect(sheet).not.toContain("localStorage");
    expect(sheet).not.toContain("sessionStorage");
  });

  it("shares a general link, never a per-contact message", () => {
    // No automatic SMS, no mass messaging, and nothing addressed to a specific
    // unmatched number.
    expect(sheet).toContain("navigator.share");
    expect(sheet).toContain("Join me on Mad Buddy");
    expect(sheet).not.toContain("sms:");
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("phone and discovery are separate decisions", () => {
  it("keeps discovery off until deliberately enabled", () => {
    expect(settings).toContain("useState(false)");
    expect(settings).toContain('aria-checked={discoveryEnabled}');
  });

  it("cannot enable discovery without a number", () => {
    expect(settings).toContain("disabled={isPending || !hasPhone}");
    expect(settings).toContain("Add a phone number first.");
  });

  it("routes every change through the server", () => {
    // The client is never authoritative about discovery state.
    expect(settings).toContain("setContactDiscoveryAction(next)");
    expect(settings).toContain("savePhoneNumberAction({");
    expect(settings).toContain("removePhoneNumberAction()");
  });

  it("takes the user from the session, never from the client", () => {
    expect(actions).toContain("const user = await getCurrentUser()");
    expect(actions).not.toContain("input.userId");
  });

  it("says added, not verified", () => {
    expect(actions).toContain('message: "Phone number added."');
  });

  it("confirms removal and states its scope", () => {
    expect(settings).toContain("confirmRemove");
    expect(settings).toContain("Your account, Muddies, messages and everything else stay");
  });

  it("supports more than one country", () => {
    expect(settings).toContain('code: "GB"');
    expect(settings).toContain('code: "US"');
    expect(settings).toContain("international number starting with +");
  });

  it("is reachable from privacy settings", () => {
    const privacy = stripComments(read("components/settings/account-privacy-page.tsx"));
    expect(privacy).toContain('href: "/settings/contact-discovery"');
  });
});

// ---------------------------------------------------------------------------
// Entry point, accessibility and cost
// ---------------------------------------------------------------------------

describe("the entry point is present without dominating the page", () => {
  it("appears once on Muddies", () => {
    expect(muddiesPage).toContain("Find Your Muddies");
    expect((muddiesPage.match(/Find Your Muddies/g) ?? []).length).toBe(1);
  });

  it("loads the sheet lazily", () => {
    // Most visits never open it, so it stays out of the initial bundle.
    expect(muddiesPage).toContain("LazyFindMuddiesSheet");
    expect(muddiesPage).toContain('import("@/components/contacts/find-muddies-sheet")');
  });

  it("mounts the sheet only when opened", () => {
    expect(muddiesPage).toContain("{findMuddiesOpen ? (");
  });

  it("does not replace existing search", () => {
    expect(muddiesPage).toContain("Search Muddies");
  });
});

describe("the flow is usable without sight or a mouse", () => {
  it("labels each add action with the person it applies to", () => {
    expect(sheet).toContain("aria-label={`Add ${person.displayName} as a Muddy`}");
  });

  it("announces loading and errors", () => {
    expect(sheet).toContain('role="status"');
    expect(sheet).toContain('role="alert"');
  });

  it("does not rely on colour alone for errors", () => {
    expect(settings).toContain('isError ? "Couldn\'t save: " : ""');
  });

  it("uses real switch semantics for the toggle", () => {
    expect(settings).toContain('role="switch"');
    expect(settings).toContain("aria-labelledby=\"contact-discovery-label\"");
  });

  it("respects reduced motion", () => {
    expect(settings).toContain("motion-reduce:transition-none");
  });

  it("uses the shared haptics abstraction rather than raw vibration", () => {
    expect(sheet).toContain('haptic("tick")');
    expect(sheet).toContain('haptic("select")');
    expect(sheet).not.toContain("navigator.vibrate");
    expect(settings).not.toContain("navigator.vibrate");
  });
});
