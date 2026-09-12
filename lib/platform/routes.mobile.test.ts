import { describe, expect, it } from "vitest";
import { toMobilePath } from "./routes.mobile";

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

  it("maps both discovery entry points to the one mobile screen", () => {
    expect(toMobilePath("/discover")).toBe("/socialize");
    expect(toMobilePath("/linkr")).toBe("/socialize");
  });

  it("maps Access/billing to the subscription screen", () => {
    expect(toMobilePath("/settings/access")).toBe("/subscription");
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

describe("non-path hrefs are left completely alone", () => {
  it.each(["https://example.com", "mailto:hi@example.com", "tel:+233000000", "//cdn.example.com/x.png", "#section"])(
    "does not touch %s",
    (href) => {
      expect(toMobilePath(href)).toBe(href);
    }
  );
});
