import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The first social action, wired to canonical paths.
 *
 * Say hi opens a real conversation and lets the person write their own words.
 * A greeting the app composed and signed with somebody's name is not a
 * greeting -- it is the product talking to itself.
 */

const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
const card = stripComments(readFileSync("components/activation/activation-card.tsx", "utf8"));
const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));

describe("Say hi uses the canonical conversation entry", () => {
  it("resolves the direct conversation through the existing action", () => {
    expect(home).toContain("openDirectConversationAction");
    expect(home).toContain('from "@/app/(app)/messaging-actions"');
  });

  it("opens the resolved thread rather than the inbox", () => {
    /* THIS TEST SHIPPED THE BUG.
     *
     * It asserted the literal string I had written -- `/messages/${id}` --
     * rather than a destination that resolves, so it stayed green while every
     * Say hi landed on the 404. There is no [id] segment under /messages; the
     * inbox reads ?conversation=. Asserting the canonical helper means the
     * test now agrees with the router instead of with the author. */
    expect(home).toContain("router.push(conversationHref(result.conversationId))");
    expect(home).not.toContain("`/messages/");
  });

  it("never auto-sends a message", () => {
    const action = home.slice(
      home.indexOf("function runRelationshipAction"),
      home.indexOf("RSVP from the Home plan stack")
    );
    expect(action).not.toContain("sendMessage");
    expect(action).not.toContain('"Hi"');
    expect(action).not.toContain("quickActionType");
  });

  it("builds no activation-specific chat", () => {
    expect(home).not.toContain("createConversation(");
    expect(home).not.toContain('conversation_type: "direct"');
  });

  it("stays on Home and reports a real failure", () => {
    // Never fake success: no navigation unless a conversation came back.
    const action = home.slice(
      home.indexOf("function runRelationshipAction"),
      home.indexOf("RSVP from the Home plan stack")
    );
    expect(action).toContain("if (!result.ok || !result.conversationId)");
    expect(action).toContain("showPromptFeedback(result.message, true)");
  });
});

describe("Make a Plan uses the canonical entry", () => {
  it("routes to the existing Plan creation screen", () => {
    /* Now carries the Muddy: tapping "Make a Plan" on Kofi and then being
     * asked who it is with was the product forgetting the tap. Same canonical
     * screen and same action -- only the person travels with it. */
    expect(home).toContain("/plans?create=1&with=${encodeURIComponent(muddyId)}");
  });

  it("writes no plan of its own", () => {
    const action = home.slice(
      home.indexOf("function runRelationshipAction"),
      home.indexOf("RSVP from the Home plan stack")
    );
    expect(action).not.toContain('.from("plans")');
    expect(action).not.toContain("create_plan_lifecycle");
  });
});

describe("the card names a person without implying proximity", () => {
  it("renders the real Muddy identity", () => {
    expect(card).toContain("<UserAvatar");
    expect(card).toContain("relationship.displayName");
  });

  it("uses the canonical avatar, which owns the no-photo fallback", () => {
    expect(card).toContain('from "@/components/ui/user-avatar"');
    expect(card).toContain("src={relationship.avatarUrl}");
  });

  it("adds no proximity treatment to the relationship row", () => {
    /* Not a nearby row. A Glow ring or band here would claim a closeness the
     * data never asserts -- NearbyHero owns that, and is not on screen. */
    const row = card.slice(card.indexOf("{relationship ? ("), card.indexOf("One primary."));
    for (const leak of ["GlowAvatar", "proximityLevel", "glowStrength", "band", "Nearby"]) {
      expect(row).not.toContain(leak);
    }
  });

  it("leaks no distance anywhere in the card", () => {
    for (const leak of [" km", "metres", "meters", "miles", "coordinates"]) {
      expect(card).not.toContain(leak);
    }
  });
});

describe("the projection loads only what it needs", () => {
  it("takes identity from the existing Muddies projection", () => {
    expect(projection).toContain("listMuddies");
  });

  it("reads no location for the relationship card", () => {
    const focus = projection.slice(
      projection.indexOf("async function loadRelationshipFocus"),
      projection.indexOf("export async function loadActivationProjection")
    );
    for (const leak of ["latitude", "longitude", "proximity", "user_locations"]) {
      expect(focus).not.toContain(leak);
    }
  });

  it("finds conversations in one batched query, not one per Muddy", () => {
    const focus = projection.slice(
      projection.indexOf("async function loadRelationshipFocus"),
      projection.indexOf("export async function loadActivationProjection")
    );
    expect(focus).toContain("directConversationKey");
    expect(focus).toContain('.in("direct_key"');
  });

  it("uses the canonical Wave cooldown fields", () => {
    // recipient_id / sent_at, matching sendWaveV2Action's own lookup.
    expect(projection).toContain("WAVE_PAIR_COOLDOWN_MS");
    expect(projection).toContain('.in("recipient_id", ids)');
    expect(projection).toContain('.gte("sent_at"');
  });

  it("counts only upcoming, uncancelled shared Plans", () => {
    /* plan_participants carries no time, so membership alone would treat last
     * month's dinner as a reason not to suggest a plan. */
    expect(projection).toContain('.is("plans.cancelled_at", null)');
    expect(projection).toContain('.gte("plans.start_at"');
  });

  it("skips the lookup entirely when the card will not render", () => {
    /* The lookup is now also needed when somebody IS nearby -- the payoff
     * hero uses the same contextual actions. Still skipped entirely for an
     * account with no Muddies, which is the cost this guards. */
    expect(projection).toContain("(muddyCount ?? 0) > 0 ? await loadRelationshipFocus");
  });
});

describe("the guidance system has something stable to point at", () => {
  it("gives the primary action a durable identity", () => {
    // §15: no tooltip, no tour step -- just a name that will not move.
    expect(card).toContain("data-activation-action={primaryActionId}");
  });

  it("implements no coach-mark system yet", () => {
    for (const premature of ["CoachMark", "Tooltip", "TourStep", "spotlight"]) {
      expect(card).not.toContain(premature);
    }
  });
});

describe("accessibility and double-submit", () => {
  it("disables both actions while one is in flight", () => {
    expect(card).toContain("disabled={pending}");
    // Both the primary button and the secondary control.
    expect(card.split("disabled={pending}").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("shows a working state rather than an idle-looking button", () => {
    expect(card).toContain("pendingLabel");
    expect(home).toContain('pendingLabel="Working…"');
  });

  it("guards the handler against a re-entrant tap", () => {
    const action = home.slice(
      home.indexOf("function runRelationshipAction"),
      home.indexOf("RSVP from the Home plan stack")
    );
    expect(action).toContain("if (isPending) return;");
  });

  it("keeps the secondary quieter than the primary", () => {
    // Two equal buttons is the app failing to decide.
    const secondary = card.slice(card.indexOf("onSecondaryAction && secondaryLabel"));
    expect(secondary.slice(0, 400)).toContain("text-muted-foreground");
  });

  it("labels actions with words, never colour alone", () => {
    expect(card).toContain("{secondaryLabel}");
    expect(card).toContain("primaryText");
  });
});

describe("no second implementation of anything", () => {
  it("keeps one contextual decision engine", () => {
    const focus = stripComments(readFileSync("lib/activation/relationship-focus.ts", "utf8"));
    expect(focus).toContain("planActionsForMuddy");
    /* Home may CALL the engine -- the nearby hero needs isNearby: true, which
     * the selector hard-codes false for the quiet-evening card. What matters
     * is that it calls the same one rather than deciding for itself. */
    expect(home).toContain("planActionsForMuddy({");
    expect(home).not.toContain('primary: "wave"');
    expect(home).not.toContain('reason: "');
  });

  it("keeps one visibility mutation and one DM entry", () => {
    expect(home.split("openDirectConversationAction(").length - 1).toBe(1);
  });
});
