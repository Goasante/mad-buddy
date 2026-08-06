import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowsServerActions,
  announcesState,
  offersRetry,
  resolveSocializeState,
  showsPeople,
  socializeStateCopy,
  type SocializeDisplayState,
  type SocializeStateInput
} from "@/lib/social/socialize-state";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Working normally, with people on screen. */
const base: SocializeStateInput = {
  isActive: true,
  justExpired: false,
  activating: false,
  loading: false,
  failed: false,
  offline: false,
  permissionDenied: false,
  peopleCount: 3
};

const resolve = (overrides: Partial<SocializeStateInput> = {}) =>
  resolveSocializeState({ ...base, ...overrides });

const ALL_STATES: SocializeDisplayState[] = [
  "inactive",
  "activating",
  "loading",
  "populated",
  "empty",
  "refreshing",
  "failed",
  "offline",
  "permission",
  "expired"
];

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

describe("state resolution", () => {
  it("resolves each required state", () => {
    expect(resolve({ isActive: false })).toBe("inactive");
    expect(resolve({ activating: true })).toBe("activating");
    expect(resolve({ peopleCount: 0, loading: true })).toBe("loading");
    expect(resolve()).toBe("populated");
    expect(resolve({ peopleCount: 0 })).toBe("empty");
    expect(resolve({ loading: true })).toBe("refreshing");
    expect(resolve({ peopleCount: 0, failed: true })).toBe("failed");
    expect(resolve({ offline: true })).toBe("offline");
    expect(resolve({ permissionDenied: true })).toBe("permission");
    expect(resolve({ justExpired: true })).toBe("expired");
  });

  it("always returns exactly one state", () => {
    // Every combination of the boolean inputs resolves; none can produce two
    // answers, because the resolver returns a single value.
    for (let mask = 0; mask < 64; mask += 1) {
      for (const peopleCount of [0, 5]) {
        const state = resolveSocializeState({
          isActive: Boolean(mask & 1),
          justExpired: Boolean(mask & 2),
          activating: Boolean(mask & 4),
          loading: Boolean(mask & 8),
          failed: Boolean(mask & 16),
          offline: Boolean(mask & 32),
          permissionDenied: Boolean(mask & 64),
          peopleCount
        });
        expect(ALL_STATES, `unknown state ${state}`).toContain(state);
      }
    }
  });

  it("is pure and deterministic", () => {
    expect(resolve({ loading: true })).toBe(resolve({ loading: true }));
    const source = stripComments(read("lib/social/socialize-state.ts"));
    for (const banned of ["Math.random", "Date.now", "useState", "fetch("]) {
      expect(source, `resolver must not use ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

describe("precedence", () => {
  it("reports expiry above everything else", () => {
    // The user must be told their session ended rather than silently dropped
    // back to "off".
    expect(resolve({ justExpired: true, isActive: false, offline: true, failed: true })).toBe("expired");
  });

  it("puts a missing permission above activation and loading", () => {
    expect(resolve({ permissionDenied: true, activating: true })).toBe("permission");
    expect(resolve({ permissionDenied: true, loading: true })).toBe("permission");
  });

  it("prefers offline over a generic failure", () => {
    // "You're offline" is both more useful and more honest.
    expect(resolve({ offline: true, failed: true, peopleCount: 0 })).toBe("offline");
  });

  it("never reports failure as empty", () => {
    // The distinction the brief cares about most.
    expect(resolve({ peopleCount: 0, failed: true })).toBe("failed");
    expect(resolve({ peopleCount: 0, failed: false })).toBe("empty");
  });

  it("keeps people on screen through a refresh and through a failed refresh", () => {
    expect(resolve({ loading: true })).toBe("refreshing");
    // A failed background refresh must not blank a radar that has people.
    expect(resolve({ failed: true })).toBe("populated");
  });
});

// ---------------------------------------------------------------------------
// Derived behaviour
// ---------------------------------------------------------------------------

describe("derived behaviour", () => {
  it("shows people only where people exist", () => {
    expect(showsPeople("populated")).toBe(true);
    expect(showsPeople("refreshing")).toBe(true);
    for (const state of ["inactive", "activating", "loading", "empty", "failed", "offline", "permission", "expired"] as const) {
      expect(showsPeople(state), `${state} must not render people`).toBe(false);
    }
  });

  it("disables server actions where the server cannot be reached", () => {
    expect(allowsServerActions("offline")).toBe(false);
    expect(allowsServerActions("permission")).toBe(false);
    expect(allowsServerActions("expired")).toBe(false);
    expect(allowsServerActions("populated")).toBe(true);
  });

  it("offers a retry only where retrying can help", () => {
    expect(offersRetry("failed")).toBe(true);
    // Offline retries are pointless until connectivity returns.
    expect(offersRetry("offline")).toBe(false);
    expect(offersRetry("empty")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe("copy", () => {
  it("uses the approved wording", () => {
    expect(socializeStateCopy("inactive").message).toBe("Socialize is off.");
    expect(socializeStateCopy("inactive").detail).toBe("Turn it on to meet people nearby.");
    expect(socializeStateCopy("activating").message).toBe("Getting Socialize ready…");
    expect(socializeStateCopy("empty").message).toBe("No one nearby right now.");
    expect(socializeStateCopy("empty").detail).toBe("Keep Socializing on and check again soon.");
    expect(socializeStateCopy("failed").message).toBe("We couldn’t refresh nearby people.");
    expect(socializeStateCopy("failed").action).toBe("Try again");
    expect(socializeStateCopy("offline").message).toBe("You’re offline.");
    expect(socializeStateCopy("permission").message).toBe("Location access is needed for Socialize.");
    expect(socializeStateCopy("permission").action).toBe("Review settings");
    expect(socializeStateCopy("expired").message).toBe("Your Socialize session ended.");
    expect(socializeStateCopy("expired").action).toBe("Start again");
  });

  it("says nothing extra when the people are the content", () => {
    expect(socializeStateCopy("populated").message).toBeNull();
    expect(socializeStateCopy("refreshing").message).toBeNull();
  });

  it("never implies location is broken when nobody is simply around", () => {
    const empty = socializeStateCopy("empty");
    const text = `${empty.message} ${empty.detail}`.toLowerCase();
    for (const banned of ["error", "permission", "location", "failed", "problem"]) {
      expect(text, `empty state must not say ${banned}`).not.toContain(banned);
    }
  });

  it("explains proximity without implying an exact location is shared", () => {
    const permission = socializeStateCopy("permission");
    expect(permission.detail).toContain("never your exact location");
    const text = `${permission.message} ${permission.detail}`;
    // No OS or browser permission wording.
    for (const banned of ["NotAllowedError", "PERMISSION_DENIED", "navigator", "Settings app"]) {
      expect(text, `must not surface ${banned}`).not.toContain(banned);
    }
  });

  it("exposes no raw server errors anywhere", () => {
    const source = stripComments(read("lib/social/socialize-state.ts"));
    for (const banned of ["error.message", "JSON.stringify", "stack"]) {
      expect(source).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

describe("announcements", () => {
  it("announces the states a user needs to know about", () => {
    for (const state of ["failed", "offline", "permission", "expired"] as const) {
      expect(announcesState(state), `${state} should be announced`).toBe(true);
    }
  });

  it("stays quiet during frequent background refreshes", () => {
    // Announcing every refresh would make the screen unusable with a screen
    // reader.
    expect(announcesState("refreshing")).toBe(false);
    expect(announcesState("populated")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------

describe("page wiring", () => {
  const page = read("components/socialize/socialize-page.tsx");
  const sheet = read("components/socialize/people-nearby-sheet.tsx");
  const css = read("app/globals.css");
  const stateCss = stripComments(css.slice(css.indexOf("/* Socialize state messages")));

  it("resolves the state once and renders from that", () => {
    expect(page).toContain("const displayState = resolveSocializeState({");
    expect(page).toContain("const stateCopy = socializeStateCopy(displayState);");
  });

  it("holds no competing booleans for the same question", () => {
    // The old ad-hoc empty check is gone; everything reads displayState.
    expect(page).not.toContain("No one nearby yet.");
    expect(page).toContain("{stateCopy.message ?");
  });

  it("gives the radar and the list the SAME resolved state", () => {
    // "Radar says empty while list says error" is unrepresentable.
    expect(page).toContain('loading={displayState === "loading"}');
    expect(page).toContain('error={displayState === "failed"}');
    expect(page).toContain('offline={displayState === "offline"}');
  });

  it("renders nodes only when the state says people exist", () => {
    expect(page).toContain("{showsPeople(displayState) ? field.nodes.map(");
  });

  it("reads connectivity from the browser rather than inferring it", () => {
    expect(page).toContain("setOffline(!navigator.onLine)");
    expect(page).toContain('window.addEventListener("online", sync)');
    expect(page).toContain('window.addEventListener("offline", sync)');
  });

  it("refreshes on reconnect instead of reloading", () => {
    expect(page).toContain("if (wasOffline && !offline && isActive) refresh();");
    expect(page).not.toContain("location.reload");
  });

  it("treats an unsupported permission query as unknown, never denied", () => {
    expect(page).toContain('setPermissionDenied(status.state === "denied")');
    expect(page).toContain(".catch(() => {});");
  });

  it("clears everything derived from an expired session", () => {
    const cleanup = page.slice(page.indexOf("const hadSessionRef"), page.indexOf("}, [isActive]);"));
    expect(cleanup).toContain("setJustExpired(true);");
    expect(cleanup).toContain("setPeople([]);");
    expect(cleanup).toContain("setPreviewPerson(null);");
    expect(cleanup).toContain("setListOpen(false);");
  });

  it("does not navigate away when a session expires", () => {
    const cleanup = page.slice(page.indexOf("const hadSessionRef"), page.indexOf("}, [isActive]);"));
    expect(cleanup).not.toContain("router.push");
    expect(cleanup).not.toContain("router.back");
  });

  it("clears the expiry notice when Socialize is turned on again", () => {
    expect(page).toContain("setJustExpired(false);");
  });

  it("disables Wave in the list while offline", () => {
    expect(page).toContain('offline={displayState === "offline"}');
    expect(sheet).toContain("pending={pending || offline}");
  });

  it("gives the list its own offline state rather than an empty one", () => {
    expect(sheet).toContain("You&rsquo;re offline.");
    expect(sheet).toContain("Nearby people will refresh when you reconnect.");
  });

  it("keeps every state action at a 44px target", () => {
    expect(page).toContain('className="mt-3 min-h-[44px]"');
  });

  it("announces only the states worth interrupting for", () => {
    expect(page).toContain("role={announcesState(displayState) ? \"status\" : undefined}");
    expect(page).toContain('aria-live={announcesState(displayState) ? "polite" : "off"}');
  });

  it("crossfades between states without flashing", () => {
    expect(stateCss).toContain("@keyframes socialize-state-in");
    expect(stateCss).not.toContain("bounce");
    expect(stateCss).not.toContain("infinite");
  });

  it("respects reduced motion", () => {
    const reduced = stateCss.slice(stateCss.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
  });

  it("keeps the retry on the existing refresh path", () => {
    expect(page).toContain("refresh();");
    expect(page).toContain("discoverSocializePeopleAction()");
  });
});
