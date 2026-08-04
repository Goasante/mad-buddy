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
    const profilePage = readFileSync("components/profile/profile-page.tsx", "utf8");
    expect(profileIdentityAccess("self").showBuddyScoreActivity).toBe(true);
    expect(profileIdentityAccess("approved_muddy").showBuddyScoreActivity).toBe(false);
    expect(profilePage).toContain("Recent score activity");
    expect(profilePage).toContain("identitySummary.buddyScore.recentActivity");
  });
});
