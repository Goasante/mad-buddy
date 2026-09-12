import { describe, expect, it } from "vitest";
import {
  MOBILE_ROUTES_NOT_BUILT,
  isBuiltForMobile,
  toMobilePath,
  urlObjectToPath
} from "./routes.mobile";

/**
 * The web→mobile route table is the one piece of the platform adapter with
 * real logic rather than a re-export, and a wrong answer here is a silently
 * dead link on a device rather than a build error. So it is tested directly.
 */

describe("paths that differ between the two apps", () => {
  it("maps the home surface", () => {
    expect(toMobilePath("/dashboard")).toBe("/home");
  });

  it("maps friends to the Muddies screen", () => {
    expect(toMobilePath("/friends")).toBe("/muddies");
  });

  it("maps Access/billing to the subscription screen", () => {
    expect(toMobilePath("/settings/access")).toBe("/subscription");
  });

  it("maps Safe Arrival, whose mobile screen is routed at /safety", () => {
    // SafetyScreen.tsx is titled "Safe Arrival" and calls /api/safe-arrival --
    // the same feature, a different path. That is what qualifies it.
    expect(toMobilePath("/safe-arrival")).toBe("/safety");
  });

  it("maps meeting pings", () => {
    expect(toMobilePath("/meeting-pings")).toBe("/pings");
  });
});

/**
 * REGRESSION: a missing feature must never be substituted with a different one.
 *
 * An earlier draft sent /linkr, /discover and /hangout-mode to /socialize, and
 * /safety-center to /safety, reasoning that the closest equivalent beat a dead
 * route. It does not. Someone tapping "Linkr" and landing in Socialize does
 * not get Linkr -- they learn that Linkr looks like Socialize -- and the gap
 * becomes invisible to us too, which is the opposite of what this adapter is
 * for. Unmapped is honest; substituted is not.
 */
describe("features that do not exist on mobile are never substituted", () => {
  it.each(MOBILE_ROUTES_NOT_BUILT)("leaves %s unmapped", (path) => {
    expect(toMobilePath(path)).toBe(path);
  });

  it("specifically never redirects Linkr or Discover into Socialize", () => {
    expect(toMobilePath("/linkr")).not.toBe("/socialize");
    expect(toMobilePath("/discover")).not.toBe("/socialize");
  });

  it("specifically never redirects UpFor into Socialize", () => {
    expect(toMobilePath("/hangout-mode")).not.toBe("/socialize");
  });

  it("never redirects Safety Center into Safe Arrival", () => {
    // Two different web pages: safety-center-page.tsx vs safe-arrival-page.tsx.
    expect(toMobilePath("/safety-center")).not.toBe("/safety");
    expect(toMobilePath("/safety-center")).toBe("/safety-center");
  });

  it("never redirects profile-lab into the plain profile screen", () => {
    expect(toMobilePath("/profile-lab")).toBe("/profile-lab");
    expect(toMobilePath("/profile-lab/edit")).toBe("/profile-lab/edit");
  });
});

describe("paths that are the same on both", () => {
  it.each(["/messages", "/plans", "/events", "/groups", "/moments", "/profile", "/settings", "/help"])(
    "passes %s through unchanged",
    (path) => {
      expect(toMobilePath(path)).toBe(path);
    }
  );
});

describe("an unmapped path is passed through, not guessed at", () => {
  it("leaves a web-only route alone so it reaches the SPA catch-all", () => {
    // Rewriting this to something plausible would hide the gap; the "*" route
    // is the honest destination.
    expect(toMobilePath("/drops")).toBe("/drops");
    expect(toMobilePath("/chats-lab")).toBe("/chats-lab");
  });
});

describe("dynamic segments", () => {
  it("maps a person's profile onto the mobile user route", () => {
    expect(toMobilePath("/friends/ama")).toBe("/u/ama");
  });

  it("prefers the more specific prefix over the exact parent", () => {
    // Both "/friends" (exact) and "/friends/" (prefix) could match; the
    // segment form must not collapse to the list screen.
    expect(toMobilePath("/friends/kojo")).toBe("/u/kojo");
    expect(toMobilePath("/friends")).toBe("/muddies");
  });

  it("keeps ids on routes that are otherwise identical", () => {
    expect(toMobilePath("/messages/abc-123")).toBe("/messages/abc-123");
    expect(toMobilePath("/groups/xyz")).toBe("/groups/xyz");
  });
});

describe("query strings and hashes survive translation", () => {
  it("preserves a query on a mapped path", () => {
    expect(toMobilePath("/friends?tab=requests")).toBe("/muddies?tab=requests");
  });

  it("preserves a query on an unmapped path", () => {
    expect(toMobilePath("/messages?conversation=abc")).toBe("/messages?conversation=abc");
  });

  it("preserves a hash", () => {
    expect(toMobilePath("/dashboard#near")).toBe("/home#near");
  });

  it("preserves both", () => {
    expect(toMobilePath("/friends/ama?from=search#top")).toBe("/u/ama?from=search#top");
  });
});

/**
 * The migration guard. A shared surface must not RENDER a link to a route the
 * mobile app does not have: the SPA catch-all is
 * `<Navigate to="/home" replace />`, so an unbuilt destination silently
 * bounces to Home and `replace` removes the way back. Hidden or disabled is
 * honest; falling through is not.
 */
describe("isBuiltForMobile gates links during migration", () => {
  it.each(MOBILE_ROUTES_NOT_BUILT)("reports %s as not built", (path) => {
    expect(isBuiltForMobile(path)).toBe(false);
  });

  it.each(["/home", "/messages", "/plans", "/muddies", "/events", "/settings"])(
    "reports %s as built",
    (path) => {
      expect(isBuiltForMobile(path)).toBe(true);
    }
  );

  it("covers nested paths under an unbuilt route", () => {
    expect(isBuiltForMobile("/profile-lab/edit")).toBe(false);
    expect(isBuiltForMobile("/profile-lab/people/ama")).toBe(false);
  });

  it("ignores query strings and hashes when deciding", () => {
    expect(isBuiltForMobile("/linkr?tab=new")).toBe(false);
    expect(isBuiltForMobile("/messages?conversation=abc")).toBe(true);
  });

  it("does not gate external links", () => {
    expect(isBuiltForMobile("https://example.com")).toBe(true);
    expect(isBuiltForMobile("mailto:hi@example.com")).toBe(true);
  });

  it("does not mistake a built route for an unbuilt prefix", () => {
    // "/drops" is unbuilt; a hypothetical "/dropsomething" must not be caught
    // by a naive startsWith.
    expect(isBuiltForMobile("/dropsomething")).toBe(true);
  });
});

/**
 * REGRESSION: Next's object destination form must work before Scan can be
 * shared -- components/scan/scan-page.tsx uses
 * href={{ pathname: "/events", query: { event, room } }}.
 */
describe("object-style destinations flatten to a path", () => {
  it("builds the Scan page's exact destination", () => {
    expect(
      urlObjectToPath({ pathname: "/events", query: { event: "e1", room: "r1" } })
    ).toBe("/events?event=e1&room=r1");
  });

  it("handles a pathname with no query", () => {
    expect(urlObjectToPath({ pathname: "/events" })).toBe("/events");
  });

  it("drops undefined and null query values instead of serialising them", () => {
    // "?event=undefined" would be a real bug on the receiving screen.
    expect(
      urlObjectToPath({ pathname: "/events", query: { event: "e1", room: undefined } })
    ).toBe("/events?event=e1");
    expect(urlObjectToPath({ pathname: "/events", query: { room: null } })).toBe("/events");
  });

  it("encodes values that need it", () => {
    expect(urlObjectToPath({ pathname: "/plans", query: { with: "a b&c" } })).toBe(
      "/plans?with=a+b%26c"
    );
  });

  it("keeps numbers and booleans", () => {
    expect(urlObjectToPath({ pathname: "/x", query: { n: 2, ok: true } })).toBe("/x?n=2&ok=true");
  });

  it("supports a hash, with or without the leading #", () => {
    expect(urlObjectToPath({ pathname: "/x", hash: "top" })).toBe("/x#top");
    expect(urlObjectToPath({ pathname: "/x", hash: "#top" })).toBe("/x#top");
  });

  it("still translates a divergent pathname after flattening", () => {
    expect(toMobilePath(urlObjectToPath({ pathname: "/friends", query: { tab: "requests" } }))).toBe(
      "/muddies?tab=requests"
    );
  });
});

describe("non-path hrefs are left completely alone", () => {
  it.each(["https://example.com", "mailto:hi@example.com", "tel:+233000000", "//cdn.example.com/x.png", "#section"])(
    "does not touch %s",
    (href) => {
      expect(toMobilePath(href)).toBe(href);
    }
  );
});
