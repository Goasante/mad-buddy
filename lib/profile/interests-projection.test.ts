import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("lib/profile/service.ts", "utf8");
const linkrService = readFileSync("lib/linkr/profile-service.ts", "utf8");
const muddyView = readFileSync("components/friends/muddy-profile-page.tsx", "utf8");
const selfPage = readFileSync("app/(app)/profile/page.tsx", "utf8");

describe("interests stay inside their audience", () => {
  it("narrows interests by field privacy for a non-self viewer", () => {
    // The projection returns null rather than an empty list when hidden, so a
    // viewer cannot tell "none" from "not allowed".
    expect(service).toContain('interests: can("interests") ? (interests ?? []).map((row) => row.interest) : null');
  });

  it("keeps profile interests out of the Linkr stranger projection", () => {
    // Linkr has its own table and its own free-text vocabulary. Reading
    // user_interests here would push profile identity to strangers.
    expect(linkrService).toContain('linkr_interests');
    expect(linkrService).not.toContain('user_interests');
  });

  it("gives the owner their own interests unnarrowed", () => {
    // You always see your whole profile; privacy narrows other viewers.
    expect(selfPage).toContain('.from("user_interests").select("interest").eq("user_id", user.id)');
  });
});

describe("general_area is profile information, not location", () => {
  it("is read from the profiles row, never from a GPS or presence source", () => {
    expect(selfPage).toContain("general_area");
    expect(selfPage).not.toMatch(/latitude|longitude|coords|geolocation/i);
  });

  it("is gated by resolveFieldVisibility for other viewers", () => {
    expect(service).toContain('generalArea: can("general_area")');
  });
});

describe("self-only surfaces stay off the Muddy view", () => {
  it("does not render the owner's completion, interests editor or settings", () => {
    for (const selfOnly of [
      "ProfileCompletionCard",
      "ProfileInterestsCard",
      "Ghost Mode",
      "Devices & sessions"
    ]) {
      expect(muddyView).not.toContain(selfOnly);
    }
  });

  it("renders a Muddy's interests from the projected fields, not a direct query", () => {
    expect(muddyView).toContain("fields?.interests?.length");
    expect(muddyView).not.toContain('from("user_interests")');
  });
});
