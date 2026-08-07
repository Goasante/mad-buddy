import type { GroupSummary } from "@/lib/groups/types";

/**
 * Group discovery presentation — the decisions, as pure functions.
 *
 * Separate from the card because each of these is a rule rather than layout:
 * "a closed group never offers Join", "activity is derived, never invented",
 * "the same group always looks the same". All three are testable claims, and
 * none would be caught by a render test.
 */

/**
 * Filters that will exist once their data does.
 *
 * Named here so the extension points are explicit and reviewable. Adding one
 * means adding its predicate and a registry entry — no card or rail changes.
 */
export const FUTURE_GROUP_DISCOVERY = [
  "nearby_groups",
  "spark_groups",
  "event_groups",
  "ai_recommendations",
  "plus_discovery"
] as const;

/**
 * A deterministic cover for a group that has no uploaded image.
 *
 * `group_settings.image_media_id` exists in the schema but nothing populates
 * it — there is no group-cover upload flow — so every group would otherwise
 * render an identical grey box. Deriving a gradient from the group's own id
 * means each one looks intentional and distinct, and the SAME group looks the
 * same on every render and every device.
 *
 * Hue only is derived; saturation and lightness are fixed, so no group can
 * come out muddy, neon, or unreadable behind white initials. The second hue is
 * offset rather than random, which keeps every pairing harmonious.
 */
export function groupCoverFor(group: Pick<GroupSummary, "id" | "name">): {
  gradient: string;
  initials: string;
} {
  // FNV-1a over the id: stable across processes, unlike a hash of the object.
  let hash = 0x811c9dc5;
  for (let index = 0; index < group.id.length; index += 1) {
    hash ^= group.id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const hue = hash % 360;
  // A warm-leaning partner hue: close enough to harmonise, far enough to read
  // as a gradient rather than a flat fill.
  const partner = (hue + 38) % 360;

  return {
    gradient: `linear-gradient(135deg, hsl(${hue} 62% 42%), hsl(${partner} 68% 30%))`,
    initials: groupInitials(group.name)
  };
}

/** Up to two initials from the group name, for the generated cover. */
export function groupInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * How recently the group was used, in words.
 *
 * Derived ONLY from `lastMessageAt`, which the projection already carries.
 * Returns null when there is nothing to say — a group with no messages shows
 * no badge rather than a fabricated "New" or "Trending".
 *
 * Thresholds are deliberately coarse. "Active today" and "Active this week"
 * describe a community's rhythm; a precise last-seen time would describe a
 * person's, which is not what a group card is for.
 */
export function groupActivityLabel(lastMessageAt: string | null, nowMs = Date.now()): string | null {
  if (!lastMessageAt) return null;
  const then = Date.parse(lastMessageAt);
  if (Number.isNaN(then)) return null;

  const ageMs = nowMs - then;
  if (ageMs < 0) return null;

  const day = 24 * 60 * 60 * 1000;
  if (ageMs < day) return "Active today";
  if (ageMs < 7 * day) return "Active this week";
  if (ageMs < 30 * day) return "Active this month";
  // Older than a month says nothing useful, and "Active 4 months ago" reads as
  // a warning rather than an invitation.
  return null;
}

export type GroupJoinState = {
  kind: "join" | "joined" | "requested" | "invite_only";
  label: string;
  disabled: boolean;
};

/**
 * What the join control should say and whether it should act.
 *
 * Mirrors what the server will actually do, so the card never offers an action
 * that would be rejected on submit:
 *
 *  - already a member  → "Joined", inert
 *  - invited, not yet joined → "Requested", inert
 *  - join_mode 'closed' → "Invite only", inert
 *  - otherwise → "Join"
 */
export function groupJoinState(group: Pick<GroupSummary, "role" | "joinMode">): GroupJoinState {
  if (group.role) return { kind: "joined", label: "Joined", disabled: true };
  if (group.joinMode === "closed") {
    return { kind: "invite_only", label: "Invite only", disabled: true };
  }
  if (group.joinMode === "invite") {
    // Browsable but not openly joinable: visibility and join mode are separate
    // axes, so a public group may still require an invitation.
    return { kind: "invite_only", label: "Invite only", disabled: true };
  }
  return { kind: "join", label: "Join", disabled: false };
}
