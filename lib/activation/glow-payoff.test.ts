import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Completing Glow setup should feel like something worked.
 *
 * And when a Muddy is genuinely nearby, the person shows up -- not a card
 * describing that a person showed up.
 */

const card = stripComments(readFileSync("components/activation/activation-card.tsx", "utf8"));
const firstMuddy = stripComments(readFileSync("components/activation/first-muddy-card.tsx", "utf8"));
const backend = readFileSync("lib/proximity/backend.ts", "utf8");

const copyFor = (state: string) => {
  const start = card.indexOf(`${state}: {`);
  return card.slice(start, card.indexOf("},", start));
};

describe("location ready, visibility still off", () => {
  const copy = copyFor("visibility_off");

  it("says the setup worked rather than raising a new obstacle", () => {
    expect(copy).toContain("Glow is ready");
  });

  it("asks for the remaining choice, not for location again", () => {
    expect(copy).toContain("Turn on visibility");
    expect(copy).not.toContain("Turn on location");
  });

  it("says the choice is reversible", () => {
    // Somebody deciding to be visible should know they can undo it.
    expect(copy).toMatch(/turn it off again|whenever you like/i);
  });
});

describe("Glow on, nobody nearby — a success, not an error", () => {
  const copy = copyFor("no_one_nearby");

  it("confirms Glow is working", () => {
    expect(copy).toContain("Glow is on");
  });

  it("explains what will happen instead of implying a fault", () => {
    expect(copy).toContain("will appear");
  });

  it("uses none of the failure vocabulary", () => {
    for (const wrong of ["Nothing here", "No results", "Try again", "went wrong", "error"]) {
      expect(copy).not.toContain(wrong);
    }
  });

  it("still offers something to do", () => {
    // An empty proximity list must not leave somebody with nowhere to go.
    expect(copy).toContain("actionLabel:");
    expect(copy).toContain("secondary:");
  });
});

describe("the real nearby moment outranks a card about it", () => {
  it("stands aside when a Muddy is actually nearby", () => {
    // NearbyHero renders the person, their Glow and their band a few lines
    // below. A card above saying "someone's nearby" says it worse.
    expect(card).toContain('if (state === "muddy_nearby") return null;');
  });

  it("keeps the canonical nearby surface on Home", () => {
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).toContain("<NearbyHero");
  });
});

describe("no distance ever reaches the client", () => {
  it("sends a band identifier, never a measurement", () => {
    // The privacy rule is enforced at the schema, not by careful UI copy.
    expect(backend).toContain("proximity_band: z.enum([");
    expect(backend).not.toContain("distance_metres");
    expect(backend).not.toContain("distanceKm");
  });

  it("keeps the activation copy free of measurements", () => {
    for (const leak of [" km", "metres", "meters", "miles", "coordinates", "street"]) {
      expect(card).not.toContain(leak);
      expect(firstMuddy).not.toContain(leak);
    }
  });

  it("uses no map or radar language anywhere in activation", () => {
    for (const forbidden of ["Radar", "radar", "route", "GPS"]) {
      expect(card).not.toContain(forbidden);
      expect(firstMuddy).not.toContain(forbidden);
    }
  });
});

describe("the privacy promise is made once", () => {
  it("does not repeat the exact-location line in the same card", () => {
    /* The explanatory paragraph and the guarantee below it both carried it,
     * which read as the app reassuring itself. The guarantee keeps it. */
    const occurrences = firstMuddy.split("exact location").length - 1;
    expect(occurrences).toBe(1);
  });

  it("still states it explicitly", () => {
    expect(firstMuddy).toContain("Never your exact location");
  });
});
