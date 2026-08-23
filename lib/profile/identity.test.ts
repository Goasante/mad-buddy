import { describe, expect, it } from "vitest";
import { profileCompletion, profileIdentityAccess } from "@/lib/profile/identity";
import { readFileSync } from "node:fs";

describe("profile identity projection", () => {
  it("keeps exact score and activity private to the profile owner", () => {
    expect(profileIdentityAccess("self")).toEqual({
      showBuddyScore: true,
      showExactBuddyScore: true,
      showBuddyScoreActivity: true,
      showAchievements: true,
      showActivity: true
    });
  });

  it("shows approved Muddies only safe score and achievement identity", () => {
    expect(profileIdentityAccess("approved_muddy")).toEqual({
      showBuddyScore: true,
      showExactBuddyScore: false,
      showBuddyScoreActivity: false,
      showAchievements: true,
      showActivity: false
    });
  });

  it("shows strangers only the reputation level", () => {
    expect(profileIdentityAccess("stranger")).toEqual({
      showBuddyScore: true,
      showExactBuddyScore: false,
      showBuddyScoreActivity: false,
      showAchievements: false,
      showActivity: false
    });
  });

  it("reuses the existing three-part profile completion model", () => {
    expect(profileCompletion({ avatarUrl: "/avatar.webp", bio: "Hello", moodStatus: "Open" })).toEqual({ completed: 3, total: 3, percent: 100 });
    expect(profileCompletion({ avatarUrl: null, bio: "", moodStatus: "Open" })).toEqual({ completed: 1, total: 3, percent: 33 });
  });

  it("renders recent score activity only on the owner identity surface", () => {
    /* The privacy invariant is unchanged and is the point of this test: recent
     * score activity is visible to the OWNER and to nobody else, not even an
     * approved Muddy. */
    expect(profileIdentityAccess("self").showBuddyScoreActivity).toBe(true);
    expect(profileIdentityAccess("approved_muddy").showBuddyScoreActivity).toBe(false);

    /* WHERE it renders moved (MB-GOD-013). Profile used to carry a second copy
     * of the Buddy Score card; that duplicate was removed and /buddy-score —
     * an owner-only route that already rendered it in more detail — is now the
     * single surface for it. Profile must NOT show it, so the two assertions
     * are inverted rather than deleted: the projection flag alone would still
     * pass if a future change re-rendered the activity somewhere it should not
     * appear. */
    const profilePage = readFileSync("components/profile/profile-page.tsx", "utf8");
    expect(profilePage).not.toContain("Recent score activity");
    expect(profilePage).not.toContain("identitySummary.buddyScore.recentActivity");

    const buddyScorePage = readFileSync("components/buddy-score/buddy-score-page.tsx", "utf8");
    expect(buddyScorePage).toContain("Recent score activity");
    expect(buddyScorePage).toContain("score.recentActivity");
  });
});
