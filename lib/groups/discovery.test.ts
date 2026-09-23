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
const retirement = read("supabase/migrations/20260923152500_groups_messages_only.sql");

const group = (overrides: Partial<GroupSummary> = {}): GroupSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Hiking Buddies",
  description: "Weekend trails",
  imageUrl: null,
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

describe("retired public group discovery", () => {
  it("preserves the historical schema but closes every existing public/open group", () => {
    expect(migration).toContain("visibility text not null default 'private'");
    expect(retirement).toContain("visibility = 'private'");
    expect(retirement).toContain("join_mode = 'invite'");
  });

  it("makes the retirement authoritative at the database boundary", () => {
    expect(retirement).toContain("group_settings_private_only");
    expect(retirement).toContain("check (visibility = 'private')");
    expect(retirement).toContain("group_settings_invite_only");
    expect(retirement).toContain("check (join_mode = 'invite')");
  });

  it("creates web groups as private invite-only conversations", () => {
    const create = actions.slice(actions.indexOf("export async function createGroupAction"));
    expect(create).toContain('visibility: "private"');
    expect(create).toContain('join_mode: "invite"');
    expect(create.slice(0, 3500)).not.toContain("parsed.data.visibility");
    expect(create.slice(0, 3500)).not.toContain("parsed.data.openToJoin");
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

describe("legacy visibility changes cannot resurrect public Groups", () => {
  it("accepts only the group id and always writes the closed state", () => {
    const action = actions.slice(actions.indexOf("export async function setGroupVisibilityAction"));
    expect(action.slice(0, 2200)).toContain('visibility: "private"');
    expect(action.slice(0, 2200)).toContain('join_mode: "invite"');
    expect(action.slice(0, 2200)).not.toContain("parsed.data.visibility");
  });

  it("revalidates Messages rather than the retired discovery surfaces", () => {
    const action = actions.slice(actions.indexOf("export async function setGroupVisibilityAction"));
    expect(action.slice(0, 2600)).toContain('revalidatePath("/messages")');
    expect(action.slice(0, 2600)).not.toContain('revalidatePath("/discover")');
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
