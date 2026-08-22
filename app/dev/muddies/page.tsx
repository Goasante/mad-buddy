import { notFound } from "next/navigation";
import { FriendsPageContent, type UserSummary } from "@/components/friends/friends-page";

/**
 * The Muddies visual-review harness.
 *
 * DEVELOPMENT ONLY (404s in production, same guard and the same /dev auth
 * exemption as the Proximity Glow harness).
 *
 * WHY THIS EXISTS. Muddies is auth-gated and driven by real relationships, so
 * it cannot be screenshotted deterministically -- and the only Supabase this
 * worktree can reach is PRODUCTION, where seeding fixture users to take a
 * screenshot would be writing junk to real infrastructure. This renders the
 * REAL FriendsPageContent with fixture props instead: same component, same
 * Glow, same layout code, no database writes and no test accounts.
 *
 * The proximity signal is fetched client-side from /api/friends/nearby, which
 * returns nothing here; the review script stubs that route so every Glow state
 * can be inspected. Everything else on the page is the production component.
 */

export const dynamic = "force-static";

/**
 * Names are fictional and avatars are absent on purpose -- initials render, so
 * the harness needs no image fixtures and cannot accidentally ship a real
 * person's likeness into the repo.
 */
const MUDDIES: UserSummary[] = [
  { id: "m1", displayName: "Ama Boateng", username: "ama", avatarUrl: null, mutualFriends: 4, status: "friend", note: "", plan: "free", isVerifiedAccount: true },
  { id: "m2", displayName: "Kwesi Mensah", username: "kwesi", avatarUrl: null, mutualFriends: 2, status: "friend", note: "", plan: "buddy_pro" },
  { id: "m3", displayName: "Naa Adjeley Quartey", username: "naa", avatarUrl: null, mutualFriends: 7, status: "friend", note: "", plan: "buddy_plus" },
  { id: "m4", displayName: "Yaw Owusu", username: "yaw", avatarUrl: null, mutualFriends: 1, status: "friend", note: "", plan: "free" },
  { id: "m5", displayName: "Efua Sarpong", username: "efua", avatarUrl: null, mutualFriends: 3, status: "friend", note: "", plan: "free" },
  { id: "m6", displayName: "Kojo Antwi", username: "kojo", avatarUrl: null, mutualFriends: 0, status: "friend", note: "", plan: "free" },
  // Incoming requests, so the Requests tab and its badge have real content.
  { id: "r1", requestId: "req-1", displayName: "Adwoa Nyarko", username: "adwoa", avatarUrl: null, mutualFriends: 5, status: "received", note: "", plan: "free" },
  { id: "r2", requestId: "req-2", displayName: "Kofi Asante", username: "kofi", avatarUrl: null, mutualFriends: 2, status: "received", note: "", plan: "free" }
];

/**
 * Close Friends is NOT listed here: FriendsPageContent always prepends its own
 * protected Close Friends circle from `initialCloseFriendIds`. Supplying one
 * too produced two circles with the same id and a duplicate-key warning.
 */
const CIRCLES = [
  { id: "c-uni", name: "Legon", icon: null, memberIds: ["m2", "m4", "m5"] },
  { id: "c-work", name: "Studio", icon: null, memberIds: ["m1", "m6"] }
];

export default function MuddiesHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <FriendsPageContent
      initialUsers={MUDDIES}
      initialCircles={CIRCLES}
      initialCloseFriendIds={["m1", "m3"]}
    />
  );
}
