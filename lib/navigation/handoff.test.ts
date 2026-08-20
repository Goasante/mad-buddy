import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETURN_PATH,
  isProfileSection,
  isSafeReturnPath,
  profileHandoffHref,
  returnLabel,
  safeReturnPath
} from "@/lib/navigation/handoff";

/**
 * The cross-feature handoff.
 *
 * returnTo arrives in a URL, so every test here treats it as attacker-supplied
 * rather than as something our own link produced.
 */

describe("returnTo is validated, never trusted", () => {
  it("allows the internal destinations a handoff actually uses", () => {
    for (const path of [
      "/linkr",
      "/linkr?eventId=abc",
      "/events",
      "/events?event=123",
      "/plans",
      "/profile",
      "/dashboard"
    ]) {
      expect(isSafeReturnPath(path), path).toBe(true);
    }
  });

  it("refuses anything that leaves the app", () => {
    /* Each of these has shipped as an open redirect in some product: an
     * absolute URL, the scheme-relative form that looks like a path, the
     * backslash variant some parsers normalise, and a javascript: payload. */
    for (const path of [
      "https://evil.example.com",
      "http://evil.example.com",
      "//evil.example.com",
      "/\\evil.example.com",
      "javascript:alert(1)",
      "mailto:someone@example.com"
    ]) {
      expect(isSafeReturnPath(path), path).toBe(false);
    }
  });

  it("refuses a lookalike route that merely shares a prefix", () => {
    // "/linkrevil" starts with "/linkr" and must still be refused.
    expect(isSafeReturnPath("/linkrevil")).toBe(false);
    expect(isSafeReturnPath("/eventsomething")).toBe(false);
    // The boundary forms stay allowed.
    expect(isSafeReturnPath("/linkr/settings")).toBe(true);
  });

  it("refuses traversal, control characters and absurd length", () => {
    expect(isSafeReturnPath("/events/../../etc/passwd")).toBe(false);
    expect(isSafeReturnPath("/events\n/x")).toBe(false);
    expect(isSafeReturnPath(`/events?q=${"x".repeat(600)}`)).toBe(false);
  });

  it("refuses empty and missing values", () => {
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });

  it("falls back rather than failing the page", () => {
    /* A bad returnTo must not be an error: the person still finishes what they
     * came to do and simply lands somewhere sensible. */
    expect(safeReturnPath("https://evil.example.com")).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath(null)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath("/linkr")).toBe("/linkr");
  });
});

describe("the handoff link", () => {
  it("carries section, return and origin", () => {
    const href = profileHandoffHref({ section: "identity", returnTo: "/linkr", origin: "linkr" });
    expect(href).toContain("section=identity");
    expect(href).toContain("returnTo=%2Flinkr");
    expect(href).toContain("from=linkr");
  });

  it("drops an unsafe returnTo instead of embedding it", () => {
    const href = profileHandoffHref({
      section: "identity",
      returnTo: "https://evil.example.com",
      origin: "linkr"
    });
    expect(href).not.toContain("evil.example.com");
    expect(href).toContain("section=identity");
  });

  it("names the sections Profile can open, and rejects the rest", () => {
    expect(isProfileSection("identity")).toBe(true);
    expect(isProfileSection("photos")).toBe(true);
    expect(isProfileSection("nonsense")).toBe(false);
    expect(isProfileSection(null)).toBe(false);
  });

  it("labels the return control by where the person came from", () => {
    expect(returnLabel("linkr")).toBe("Back to Linkr");
    expect(returnLabel("events")).toBe("Back to Events");
    expect(returnLabel(null)).toBe("Go back");
  });
});
