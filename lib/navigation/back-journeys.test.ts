import { describe, expect, it } from "vitest";

import { cameFromInsideApp, resolveBack } from "@/lib/navigation/entry-origin";

/**
 * What Back does on the journeys people actually take.
 *
 * Behaviour, not source text. Each case builds the entry context a real
 * journey produces, then asks the shared rule what should happen -- so a
 * regression shows up as "UpFor -> Linkr -> Back went Home" rather than as a
 * changed string somewhere.
 *
 * THE DEFECT THESE COVER. Back controls were plain links to an assumed parent,
 * so they ignored where the person came from: Linkr sent you Home instead of
 * to UpFor, and a Settings child sent you to Settings even when you had
 * arrived from Profile by way of somewhere else.
 */

const ORIGIN = "https://mad-buddy.com";

/** A browser that has been navigated within the app `steps` times. */
const inApp = (steps: number, referrer = `${ORIGIN}/dashboard`) => ({
  win: { history: { length: steps }, location: { origin: ORIGIN } } as unknown as Window,
  referrer
});

/** A fresh tab opened straight onto a URL: nothing behind it. */
const coldEntry = {
  win: { history: { length: 1 }, location: { origin: ORIGIN } } as unknown as Window,
  referrer: ""
};

/** Arrived from another site entirely. */
const externalEntry = {
  win: { history: { length: 1 }, location: { origin: ORIGIN } } as unknown as Window,
  referrer: "https://example.com/post"
};

function backFrom(
  entry: { win: Window; referrer: string },
  fallbackHref: string
): "history" | string {
  const decision = resolveBack({
    fromInsideApp: cameFromInsideApp(entry.win, entry.referrer),
    fallbackHref
  });
  return decision.kind === "history" ? "history" : decision.href;
}

describe("real journeys unwind to where the person actually was", () => {
  it("UpFor -> Linkr -> Back returns to UpFor, not Home", () => {
    // The journey the owner reported. Two in-app steps means history exists.
    expect(backFrom(inApp(2, `${ORIGIN}/hangout-mode`), "/dashboard")).toBe("history");
  });

  it("Home -> Muddy profile -> Back returns to Home", () => {
    expect(backFrom(inApp(2, `${ORIGIN}/dashboard`), "/friends")).toBe("history");
  });

  it("Profile -> Settings -> Back returns to Profile", () => {
    expect(backFrom(inApp(2, `${ORIGIN}/profile`), "/settings")).toBe("history");
  });

  it("Settings -> Privacy -> Back returns to Settings", () => {
    // Three steps deep; the Settings child must not skip its own parent.
    expect(backFrom(inApp(3, `${ORIGIN}/settings`), "/settings")).toBe("history");
  });

  it("Plans -> Plan detail -> Back returns to Plans", () => {
    expect(backFrom(inApp(2, `${ORIGIN}/plans`), "/plans")).toBe("history");
  });

  it("Events -> Event detail -> Back returns to Events", () => {
    expect(backFrom(inApp(2, `${ORIGIN}/events`), "/events")).toBe("history");
  });

  it("A -> B -> C -> Back returns to B, never all the way to A", () => {
    // One step of history, whatever the depth: Back is not "go to the root".
    expect(backFrom(inApp(3), "/dashboard")).toBe("history");
  });
});

describe("cold entry falls back to the surface's own parent", () => {
  it("a notification into a Settings child lands on Settings", () => {
    expect(backFrom(coldEntry, "/settings")).toBe("/settings");
  });

  it("a shared link into a Plan lands on Plans", () => {
    expect(backFrom(coldEntry, "/plans")).toBe("/plans");
  });

  it("an external referrer is not treated as in-app history", () => {
    // back() here would return the person to the other website.
    expect(backFrom(externalEntry, "/dashboard")).toBe("/dashboard");
  });

  it("the fallback differs by surface rather than always being Home", () => {
    expect(backFrom(coldEntry, "/friends")).toBe("/friends");
    expect(backFrom(coldEntry, "/events")).toBe("/events");
    expect(backFrom(coldEntry, "/profile")).toBe("/profile");
  });

  it("a look-alike host does not count as our own origin", () => {
    const lookalike = {
      win: { history: { length: 1 }, location: { origin: ORIGIN } } as unknown as Window,
      referrer: "https://mad-buddy.com.evil.test/x"
    };
    expect(backFrom(lookalike, "/dashboard")).toBe("/dashboard");
  });
});

describe("the fallback is never used when history exists", () => {
  it("prefers history even when a fallback is supplied", () => {
    // The original defect stated directly: a parent route that always won.
    for (const fallback of ["/dashboard", "/settings", "/plans", "/friends"]) {
      expect(backFrom(inApp(2), fallback)).toBe("history");
    }
  });
});
