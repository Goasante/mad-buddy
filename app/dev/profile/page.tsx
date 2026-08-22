import { notFound } from "next/navigation";
import { ProfilePageContent } from "@/components/profile/profile-page";
import { profileCompletionPercent, remainingCompletionTasks } from "@/lib/profile/rules";

/**
 * The Profile visual-review harness.
 *
 * DEVELOPMENT ONLY (404s in production; /dev is exempt from the login redirect
 * in development only -- see lib/security/route-protection.ts).
 *
 * Same reasoning as the Muddies harness: Profile is auth-gated, and the only
 * Supabase this worktree can reach is PRODUCTION, so seeding a fixture account
 * to take a screenshot would write junk to real infrastructure. This renders
 * the REAL ProfilePageContent with fixture props -- same component, same
 * privacy rules, no database writes.
 *
 * `?state=incomplete` renders the sparse case, so the completion card and the
 * empty showcase can be reviewed without a second harness.
 */

/* Must be dynamic, not force-static: the harness varies on `?state=`, and a
 * force-static page ignores searchParams entirely — every state rendered as
 * the default one. Development-only, so there is nothing to cache anyway. */
export const dynamic = "force-dynamic";

/** Exactly three slots, matching PROFILE_PHOTO_SLOTS. Never the mockup's six. */
const PHOTOS = [
  { id: "p1", position: 0, url: "/visuals/activities/coffee.jpg", visibility: "approved_muddies" as const },
  { id: "p2", position: 1, url: "/visuals/activities/beach.jpg", visibility: "approved_muddies" as const },
  { id: "p3", position: 2, url: "/visuals/activities/concert.jpg", visibility: "only_me" as const }
];

export default async function ProfileHarnessPage({
  searchParams
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { state } = await searchParams;
  const incomplete = state === "incomplete";
  /* `?state=stress` is the hostile-content case: the longest name and bio a
     profile can carry, a full interest set including a legacy value, and a
     full showcase. It is where overflow shows up first. */
  const stress = state === "stress";

  const interests = incomplete
    ? []
    : stress
      ? ["Music", "Coffee", "Food", "Gaming", "Sports", "Fitness", "Movies", "Amapiano"]
      : ["Music", "Coffee", "Photography"];

  const completionInput = {
    hasDisplayName: true,
    hasUsername: true,
    hasPhoto: !incomplete,
    hasBio: !incomplete,
    hasInstitution: !incomplete,
    hasInterests: interests.length > 0,
    hasFirstMuddy: !incomplete
  };

  return (
    <ProfilePageContent
      initialDisplayName={
        stress ? "Bartholomew Maximilian Oppong-Kyekyeku III" : "Arjun Malhotra"
      }
      initialUsername="arjun.madbuddy"
      initialBio={
        incomplete
          ? ""
          : stress
            ? "Explorer, music lover and full-time coffee addict who is always up for meaningful conversations, spontaneous adventures, long walks across campus and finding the one cafe that still has seats at 4pm."
            : "Explorer. Music lover. Coffee addict. Always up for meaningful conversations and new adventures."
      }
      initialMoodStatus={incomplete ? "" : "Up for a jam"}
      initialAvatarUrl={incomplete ? null : "/visuals/activities/coffee.jpg"}
      initialVisibilityStatus="visible"
      identitySummary={null}
      journey={null}
      interests={interests}
      completion={{
        percent: profileCompletionPercent(completionInput),
        tasks: remainingCompletionTasks(completionInput)
      }}
      generalArea={incomplete ? null : "East Legon, Accra"}
      photos={incomplete ? [] : PHOTOS}
      trustedSince={incomplete ? null : "2026-02-01T00:00:00.000Z"}
      trustedStanding={null}
      initialPlan={incomplete ? "free" : "buddy_pro"}
      initialDateOfBirth={incomplete ? "" : "1998-04-12"}
      initialDateOfBirthCanCorrect
      initialBirthdayVisibility="only_me"
      initialAgeVisibility="only_me"
      initialZodiacVisibility="only_me"
      serverBirthdayDayKey="2026-08-22"
    />
  );
}
