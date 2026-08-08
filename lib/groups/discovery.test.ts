import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FUTURE_GROUP_DISCOVERY,
  groupActivityLabel,
  groupCoverFor,
  groupInitials,
  groupJoinState
} from "@/lib/groups/discovery";
import type { GroupSummary } from "@/lib/groups/types";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Groups discovery.
 *
 * The rules worth testing: a card never offers a join the server would reject,
 * activity is derived rather than invented, and the generated cover is stable
 * per group. None of these would surface in a render test.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const card = stripComments(read("components/socialize/socialize-group-card.tsx"));
const rails = stripComments(read("components/socialize/discovery-rails.tsx"));
const actions = stripComments(read("app/(app)/group-actions.ts"));
const migration = read("supabase/migrations/20260807180000_public_group_discovery.sql");

const group = (overrides: Partial<GroupSummary> = {}): GroupSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Hiking Buddies",
  description: "Weekend trails",
  memberCount: 12,
  role: null,
  joinMode: "link",
  visibility: "public",
  lastMessageAt: null,
  lastMessagePreview: null,
  ...overrides
});

// ---------------------------------------------------------------------------
// Generated cover
// ---------------------------------------------------------------------------

describe("generated cover", () => {
  it("is stable for the same group", () => {
    // The same group must look identical on every render and every device.
    expect(groupCoverFor(group()).gradient).toBe(groupCoverFor(group()).gradient);
  });

  it("differs between groups", () => {
    const a = groupCoverFor(group({ id: "aaaaaaaa-1111-4111-8111-111111111111" }));
    const b = groupCoverFor(group({ id: "bbbbbbbb-2222-4222-8222-222222222222" }));
    expect(a.gradient).not.toBe(b.gradient);
  });

  it("derives hue only, so no group can render unreadable", () => {
    // Saturation and lightness are fixed; a random one could produce a neon or
    // near-white cover that white initials disappear into.
    for (const id of ["a", "bb", "ccc", "dddd", "eeeee"]) {
      const { gradient } = groupCoverFor(group({ id }));
      expect(gradient).toContain("62% 42%");
      expect(gradient).toContain("68% 30%");
    }
  });

  it("takes up to two initials", () => {
    expect(groupInitials("Hiking Buddies")).toBe("HB");
    expect(groupInitials("Coffee")).toBe("CO");
    expect(groupInitials("  Beach   Volleyball Club ")).toBe("BV");
  });

  it("never renders empty for a nameless group", () => {
    expect(groupInitials("   ")).toBe("•");
  });

  it("uses no grey placeholder", () => {
    // Scoped to the COVER. The skeleton legitimately uses a neutral fill —
    // that is a loading placeholder, not a group rendering as a grey box.
    const cover = card.slice(card.indexOf("<Link"), card.indexOf("</Link>"));
    expect(cover).toContain("cover.gradient");
    expect(cover).not.toContain("bg-secondary");
  });
});

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

describe("activity", () => {
  const now = Date.UTC(2026, 7, 7, 12, 0, 0);
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

  it("reads today, this week and this month", () => {
    expect(groupActivityLabel(hoursAgo(3), now)).toBe("Active today");
    expect(groupActivityLabel(hoursAgo(72), now)).toBe("Active this week");
    expect(groupActivityLabel(hoursAgo(24 * 20), now)).toBe("Active this month");
  });

  it("says nothing rather than inventing activity", () => {
    // A group with no messages, or one quiet for months, shows no badge —
    // never a fabricated "New" or "Trending".
    expect(groupActivityLabel(null, now)).toBeNull();
    expect(groupActivityLabel(hoursAgo(24 * 200), now)).toBeNull();
  });

  it("ignores an unparseable or future timestamp", () => {
    expect(groupActivityLabel("not-a-date", now)).toBeNull();
    expect(groupActivityLabel(new Date(now + 60_000).toISOString(), now)).toBeNull();
  });

  it("invents no engagement metric anywhere on the card", () => {
    for (const banned of ["trending", "popular", "score", "rank", "engagement"]) {
      expect(card.toLowerCase(), `the card must not show ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Join state
// ---------------------------------------------------------------------------

describe("join state", () => {
  it("offers Join for a link-joinable group", () => {
    expect(groupJoinState(group())).toEqual({ kind: "join", label: "Join", disabled: false });
  });

  it("shows Joined and stays inert for a member", () => {
    expect(groupJoinState(group({ role: "member" }))).toEqual({
      kind: "joined",
      label: "Joined",
      disabled: true
    });
  });

  it("NEVER offers Join on a closed group", () => {
    // The server would reject it, so the card must not present it.
    const state = groupJoinState(group({ joinMode: "closed" }));
    expect(state.disabled).toBe(true);
    expect(state.label).toBe("Invite only");
  });

  it("treats a public invite-only group as browsable but not joinable", () => {
    // Visibility and join mode are separate axes on purpose.
    const state = groupJoinState(group({ visibility: "public", joinMode: "invite" }));
    expect(state.kind).toBe("invite_only");
    expect(state.disabled).toBe(true);
  });

  it("reuses the canonical join action", () => {
    expect(stripComments(read("components/socialize/socialize-page.tsx"))).toContain(
      "joinDiscoverableGroupAction(group.id)"
    );
  });
});

// ---------------------------------------------------------------------------
// Visibility model
// ---------------------------------------------------------------------------

describe("public group discovery", () => {
  it("adds visibility as its own axis, separate from join_mode", () => {
    expect(migration).toContain("visibility text not null default 'private'");
    expect(migration).toContain("check (visibility in ('private', 'public'))");
  });

  it("DEFAULTS TO PRIVATE, so no existing group is retroactively exposed", () => {
    // Members of existing groups never consented to being listed publicly.
    expect(migration).toContain("default 'private'");
    expect(migration).not.toContain("default 'public'");
  });

  it("only exposes active groups to signed-in users", () => {
    const policy = migration.slice(migration.indexOf('create policy "public groups discoverable"'));
    expect(policy).toContain("auth.uid() is not null");
    expect(policy).toContain("c.status = 'active'");
  });

  it("grants no membership, history or member list", () => {
    // The discovery policy touches group_settings only.
    const policy = migration.slice(migration.indexOf('create policy "public groups discoverable"'));
    const body = policy.slice(0, policy.indexOf(";"));
    expect(body).not.toContain("messages");
    expect(body).not.toContain("conversation_members");
  });

  it("leaves the existing member policy untouched", () => {
    expect(migration).not.toContain('drop policy "group settings visible to members"');
  });

  it("keeps the friend-link path so nothing discoverable disappears", () => {
    expect(actions).toContain("publicIds.has(row.id) || (row.created_by && friendIds.has(row.created_by))");
  });

  it("adds no duplicate query — discovery reuses summariesFor", () => {
    expect(actions).toContain("discoverableGroups = await summariesFor(admin, eligibleIds)");
  });
});

// ---------------------------------------------------------------------------
// Card and rail
// ---------------------------------------------------------------------------

describe("group card", () => {
  it("is memoised, so a keystroke does not re-render the rail", () => {
    expect(card).toContain("memo(GroupCard)");
  });

  it("hides a description that does not exist", () => {
    expect(card).toContain("group.description ? (");
  });

  it("ships a card-shaped skeleton", () => {
    expect(card).toContain("SocializeGroupCardSkeleton");
    expect(card).toContain('aspect-[16/10] w-full animate-pulse');
  });

  it("keeps the CTA at a 44px target", () => {
    expect(card).toContain("min-h-[44px]");
  });

  it("carries an accessible name with the member count", () => {
    expect(card).toContain('aria-label={`${group.name},');
  });

  it("respects reduced motion", () => {
    expect(card).toContain("motion-reduce:transition-none");
    expect(card).toContain("motion-reduce:group-hover:scale-100");
  });

  it("reserves future discovery without exposing it", () => {
    for (const reserved of FUTURE_GROUP_DISCOVERY) {
      expect(card).not.toContain(reserved);
      expect(rails).not.toContain(reserved);
    }
    expect(FUTURE_GROUP_DISCOVERY).toContain("nearby_groups");
  });

  it("offers a way forward when the rail is empty", () => {
    // An empty rail is an invitation, not a dead end — and it names the usual
    // CAUSE. Groups default to private, so someone who already has groups is
    // far more often one toggle away than one group away, and copy that only
    // says "create one" reads to them as a broken feature.
    expect(rails).toContain("No groups to discover yet");
    expect(rails).toContain("Groups are private unless someone lists them");
    expect(rails).toContain("My groups");
  });
});

describe("changing visibility after creation", () => {
  const page = stripComments(read("components/groups/group-detail-page.tsx"));

  it("is OWNER only", () => {
    // Admins manage people and content; listing a group publicly is a
    // decision about every member's exposure, so it belongs to the one
    // person accountable for the group.
    expect(actions).toContain('membership.role !== "owner"');
    expect(page).toContain('group.role === "owner" ? (');
  });

  it("fails neutrally for anyone else", () => {
    // Never confirm a group exists to someone who is not its owner.
    const action = actions.slice(actions.indexOf("export async function setGroupVisibilityAction"));
    expect(action.slice(0, 1600)).toContain("That change isn't available.");
  });

  it("leaves join_mode alone", () => {
    // Visibility and joining are separate axes: making a group findable must
    // not silently make it openly joinable.
    const action = actions.slice(actions.indexOf("export async function setGroupVisibilityAction"));
    expect(action.slice(0, 1800)).not.toContain("join_mode");
  });

  it("says so when a public group still needs an invitation", () => {
    expect(page).toContain("People can find this group but still need an invitation to join.");
  });

  it("tells non-owners the state without offering the control", () => {
    expect(page).toContain("This group is private. Only invited people can find it.");
  });

  it("revalidates every surface the change affects", () => {
    const action = actions.slice(actions.indexOf("export async function setGroupVisibilityAction"));
    expect(action.slice(0, 2200)).toContain('revalidatePath("/discover")');
  });
});

describe("repository hygiene", () => {
  it("ignores downloaded binaries and dev logs", () => {
    // A 40MB installer in git is a cost every clone pays forever.
    const ignore = read(".gitignore");
    expect(ignore).toContain("assets/*.exe");
    expect(ignore).toContain(".stage*-dev.log");
  });
});
