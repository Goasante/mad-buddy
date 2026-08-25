import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { validateAudienceRequirements } from "@/lib/events/mobile";
import { boundingBox, EVENT_LOCAL_DISCOVERY_MAX_METERS } from "@/lib/events/nearby";

/**
 * The audience decision, end to end.
 *
 * Creation used to hardcode `community`, so the one choice that governs who
 * can find an Event was never asked. These tests pin that it is now asked, that
 * the answer points at something real, and that the server insists rather than
 * trusting the form.
 */

const selector = stripComments(readFileSync("components/events/audience-selector.tsx", "utf8"));
const page = stripComments(readFileSync("components/events/events-page.tsx", "utf8"));
const service = stripComments(readFileSync("lib/events/mobile.ts", "utf8"));
const options = stripComments(readFileSync("lib/events/audience-options.ts", "utf8"));
const nearby = stripComments(readFileSync("lib/events/nearby.ts", "utf8"));

describe("an audience has to point at something real", () => {
  it("refuses an invited Event with nobody invited", () => {
    // Private to nobody is not private; it is unreachable.
    expect(
      validateAudienceRequirements({ visibility: "invite", targetCount: 0, hasLocation: false })
    ).toMatchObject({ ok: false });
  });

  it("accepts an invited Event once people are chosen", () => {
    expect(
      validateAudienceRequirements({ visibility: "invite", targetCount: 3, hasLocation: false })
    ).toEqual({ ok: true });
  });

  it("refuses a community Event with no Circle", () => {
    expect(
      validateAudienceRequirements({ visibility: "community", targetCount: 0, hasLocation: false })
    ).toMatchObject({ ok: false });
  });

  it("refuses a Nearby Event with no geography", () => {
    // Nobody can find it, which is the one thing the audience promised.
    expect(
      validateAudienceRequirements({ visibility: "nearby", targetCount: 0, hasLocation: false })
    ).toMatchObject({ ok: false });
  });

  it("accepts a Nearby Event once an area is set", () => {
    expect(
      validateAudienceRequirements({ visibility: "nearby", targetCount: 0, hasLocation: true })
    ).toEqual({ ok: true });
  });

  it("asks nothing extra of link or public Events", () => {
    for (const visibility of ["link", "public"]) {
      expect(
        validateAudienceRequirements({ visibility, targetCount: 0, hasLocation: false }),
        visibility
      ).toEqual({ ok: true });
    }
  });
});

describe("creation asks the question", () => {
  it("offers all five audiences", () => {
    for (const id of ["invite", "link", "community", "nearby", "public"]) {
      expect(selector, id).toContain(`id: "${id}"`);
    }
  });

  it("phrases it as a question about people, not a setting", () => {
    expect(selector).toContain("Who should know about this event?");
    // And says the choice is not yet final, so it reads as a question rather
    // than a commitment.
    expect(selector).toContain("You can change this anytime before publishing.");
    expect(selector).not.toContain("Visibility type");
  });

  it("changes the form with the answer", () => {
    // Showing all three pickers at once would ask for three things when only
    // one matters.
    expect(selector).toContain('value.visibility === "invite" ?');
    expect(selector).toContain('value.visibility === "community" ?');
    expect(selector).toContain('value.visibility === "nearby" ?');
  });

  it("clears targets when the audience changes", () => {
    // Carrying a wedding guest list into a Public Event would attach people to
    // something nobody asked them about.
    expect(selector).toContain("onChange({ visibility, targetIds: [], location: value.location });");
  });

  it("sends the choice to the server rather than defaulting silently", () => {
    expect(page).toContain("visibility: input.audience.visibility");
    expect(page).toContain("audienceTargetIds: input.audience.targetIds");
  });

  it("resets the audience between Events", () => {
    expect(page).toContain('setAudience({ visibility: "public", targetIds: [], location: null });');
  });
});

describe("invitees come from real relationships", () => {
  it("never offers a global user search", () => {
    // A private Event must not become a way to enumerate arbitrary accounts.
    expect(options).toContain('.from("friendships")');
    expect(options).not.toContain("ilike");
  });

  it("removes anyone on either side of a block", () => {
    expect(options).toContain('.from("blocked_users")');
    expect(options).toContain("blocked.has(id)");
  });

  it("re-filters invitee ids on the server at write time", () => {
    // The client list is a suggestion; the server decides what is stored.
    expect(service).toContain("batchEligibleMuddyIds(admin, userId, targetIds)");
  });

  it("only offers Circles the creator actually joined", () => {
    expect(options).toContain('.eq("status", "joined")');
    expect(options).toContain('.eq("conversation_type", "group")');
  });

  it("re-validates community ids on the server before create or edit", () => {
    expect(service).toContain("eligibleCommunityTargetIds(admin, userId, targetIds)");
    expect(service).toContain('.eq("user_id", userId)');
    expect(service).toContain('.eq("status", "joined")');
    expect(service).toContain('.eq("conversation_type", "group")');
    expect(service).toContain("targetCount: allowedTargetIds.length");
  });
});

describe("Nearby uses Event geography, not Muddy proximity", () => {
  it("reaches 5km, and is never silently widened", () => {
    /* SUPERSEDED POLICY (4K). This asserted 25km, on the theory that people
     * cross a city for a programme. True, but it made "Near you" meaningless:
     * it returned everything in Greater Accra, so a phrase promising proximity
     * described a list unrelated to where the viewer was standing.
     *
     * 5km is the canonical maximum. Sparse inventory inside it means FEWER
     * Events or an honest empty state -- never a quiet expansion outward. A
     * Public Event beyond it can still be found through ordinary Public
     * discovery; it just is not "Near you". */
    expect(EVENT_LOCAL_DISCOVERY_MAX_METERS).toBe(5_000);
  });

  it("does not import the proximity engine", () => {
    expect(nearby).not.toContain("lib/proximity");
    expect(nearby).not.toContain("proximityBand");
  });

  it("prefilters with a box before measuring exactly", () => {
    const box = boundingBox(5.6, -0.19, EVENT_LOCAL_DISCOVERY_MAX_METERS);
    expect(box.maxLat).toBeGreaterThan(5.6);
    expect(box.minLat).toBeLessThan(5.6);
    expect(box.maxLon).toBeGreaterThan(-0.19);
  });

  it("guards the longitude cosine so a polar viewer cannot explode the box", () => {
    const polar = boundingBox(89.9, 0, EVENT_LOCAL_DISCOVERY_MAX_METERS);
    expect(Number.isFinite(polar.minLon)).toBe(true);
    expect(Number.isFinite(polar.maxLon)).toBe(true);
  });

  it("applies feed visibility so proximity is not a second way in", () => {
    expect(nearby).toContain("isDiscoverableInFeed(");
  });

  it("excludes blocked hosts", () => {
    expect(nearby).toContain("batchBlockedIds(");
  });

  it("excludes cancelled, draft and finished Events", () => {
    expect(nearby).toContain('.in("status", ["scheduled", "active"])');
    expect(nearby).toContain('.gte("ends_at", nowIso)');
  });

  it("never returns a distance or a coordinate to the caller", () => {
    /* Bounded to the type BODY. A fixed character slice ran past the closing
     * brace into listNearbyEvents, where latitude legitimately appears -- the
     * coordinates are used server-side and discarded, which is the point. */
    const start = nearby.indexOf("export type NearbyEvent");
    const view = nearby.slice(start, nearby.indexOf("};", start));
    expect(view).not.toContain("latitude");
    expect(view).not.toContain("longitude");
    expect(view).not.toContain("distance");
  });
});
