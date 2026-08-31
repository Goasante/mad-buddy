import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { hasReachedFirstValue } from "@/lib/activation/state";

/**
 * Saying something counts. Opening a thread does not.
 *
 * Activation could see a Wave, a Plan and a status, but not the most ordinary
 * way somebody starts -- so a person who said hello and got a reply was still
 * shown a training-wheels Home.
 */

const messaging = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));
const migration = readFileSync(
  "supabase/migrations/20260816120000_first_message_sent_milestone.sql",
  "utf8"
).replace(/\r\n/g, "\n");

/** Every name the milestone check allowed before this change. */
const LEGACY_MILESTONES = [
  "account_created",
  "email_verified",
  "profile_completed",
  "privacy_setup_completed",
  "first_request_sent",
  "first_request_accepted",
  "first_muddy_added",
  "first_status_created",
  "first_wave_sent",
  "first_glow_enabled",
  "first_plan_created"
];

describe("the migration widens without dropping", () => {
  it("adds the new milestone name", () => {
    expect(migration).toContain("'first_message_sent'");
  });

  it.each(LEGACY_MILESTONES)("still allows %s", (name) => {
    // Recreating a CHECK is exactly where a name gets silently lost.
    expect(migration).toContain(`'${name}'`);
  });

  it("leaves the uniqueness constraint alone", () => {
    /* UNIQUE (user_id, milestone) is the idempotency authority that
     * recordMilestone's upsert depends on. */
    expect(migration).not.toContain("activation_milestones_unique");
    expect(migration).not.toContain("drop constraint if exists activation_milestones_unique");
  });

  it("touches only the milestone check", () => {
    expect(migration).toContain("activation_milestones_milestone_check");
    for (const destructive of ["drop table", "delete from", "truncate", "drop column"]) {
      expect(migration.toLowerCase()).not.toContain(destructive);
    }
  });

  it("backfills nothing", () => {
    /* A milestone means "this happened AND we were watching". Inventing rows
     * for messages sent before it existed would be a guess presented as
     * evidence. */
    expect(migration.toLowerCase()).not.toContain("insert into");
    expect(migration.toLowerCase()).not.toContain("update public.activation_milestones");
  });

  it("edits no historical migration", () => {
    const original = readFileSync(
      "supabase/migrations/20260717200000_profiles_onboarding_privacy_setup.sql",
      "utf8"
    );
    // The original stays as it was written: eleven names, no new one.
    expect(original).not.toContain("first_message_sent");
  });
});

describe("the milestone is recorded at the send boundary", () => {
  it("hangs off the canonical sendMessage, not a button", () => {
    expect(messaging).toContain("recordFirstDirectMessageMilestone(admin, userId, parsed.data.conversationId)");
  });

  it("runs only after the message row is confirmed", () => {
    /* Placed after the insert and its duplicate-recovery branch, so a failed
     * send cannot record social value. */
    const send = messaging.slice(
      messaging.indexOf("export async function sendMessage"),
      messaging.indexOf("async function recordFirstDirectMessageMilestone")
    );
    const insertAt = send.indexOf('.from("messages")');
    const failAt = send.indexOf('return { ok: false, message: "Couldn\'t send that message." };');
    const milestoneAt = send.indexOf("recordFirstDirectMessageMilestone(");
    expect(milestoneAt).toBeGreaterThan(insertAt);
    expect(milestoneAt).toBeGreaterThan(failAt);
  });

  it("is not recorded when a conversation is merely opened", () => {
    /* A thread somebody opened and left is not an interaction.
     *
     * MUTATION FOUND THIS GAP: checking only for `recordMilestone` let the
     * helper itself be called from here -- the exact regression this test
     * exists to catch -- because it is a different string. Any milestone
     * recording of any spelling is what must be absent. */
    const open = messaging.slice(
      messaging.indexOf("export async function openDirectConversation"),
      messaging.indexOf("export async function sendMessage")
    );
    expect(open).not.toMatch(/recordMilestone|Milestone\s*\(|first_message_sent/);
  });

  it("is not recorded by the Say hi entry point", () => {
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).not.toContain("first_message_sent");
    expect(home).not.toContain("recordMilestone");
  });
});

describe("direct only, deliberately", () => {
  const start = messaging.indexOf("async function recordFirstDirectMessageMilestone");
  const helper = stripComments(messaging.slice(start, messaging.indexOf("\n}", start) + 2));

  it("checks the conversation type rather than the route", () => {
    /* Plan and Circle messages are user-authored too, but they arrive in a
     * conversation the Plan lifecycle created -- counting them would let first
     * social value be reached by replying to logistics. */
    // Optional chaining: a missing conversation row must also not qualify.
    expect(helper).toContain('conversation?.conversation_type !== "direct"');
    expect(helper).toContain('.select("conversation_type")');
  });

  it("returns without recording for any non-direct conversation", () => {
    /* Anchored to the WRITE, not to a function name. The helper now upserts
     * directly so the error is observable, and searching for the old
     * `recordMilestone` call found nothing -- reporting -1 rather than the
     * ordering it exists to protect. */
    const guard = helper.indexOf('!== "direct"');
    const write = helper.indexOf('milestone: "first_message_sent"');
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  });
});

describe("system and generated messages are excluded structurally", () => {
  it("writes system messages through a different path entirely", () => {
    /* Structural exclusion, not a filter: system rows are inserted by
     * messaging/service.ts and never pass through sendMessage, so there is no
     * branch here that could wrongly count one. */
    const service = readFileSync("lib/messaging/service.ts", "utf8");
    expect(service).toContain('message_type: "system"');
    expect(service).not.toContain("first_message_sent");
  });

  it("never records from the system-message writer", () => {
    const service = readFileSync("lib/messaging/service.ts", "utf8");
    expect(service).not.toContain("recordMilestone");
  });
});

describe("privacy: the milestone knows nothing about the message", () => {
  /* Bounded to the helper ITSELF, not to end-of-file.
   *
   * An open-ended slice swept up persistMentions further down and flagged its
   * `text_content` as a leak here -- a false positive that would have forced
   * unrelated code to avoid a column name to satisfy this test. */
  const helperStart = messaging.indexOf("async function recordFirstDirectMessageMilestone");
  const helper = messaging.slice(helperStart, messaging.indexOf("\n}", helperStart) + 2);

  it("copies no content, media or recipient", () => {
    for (const leak of ["text_content", "parsed.data.text", "mediaId", "media_id", "recipient"]) {
      expect(helper).not.toContain(leak);
    }
  });

  it("passes only the sender and the milestone name", () => {
    /* Written as a direct upsert rather than through recordMilestone, so the
     * error is observable -- recordMilestone discards it and cannot throw,
     * which is why a constraint rejection was invisible. Same table, same
     * conflict target, so idempotency is unchanged. */
    expect(helper).toContain('milestone: "first_message_sent"');
    expect(helper).toContain('onConflict: "user_id,milestone"');
    expect(helper).toContain("user_id: senderId");
  });
});

describe("failure boundary: bookkeeping never breaks messaging", () => {
  const start2 = messaging.indexOf("async function recordFirstDirectMessageMilestone");
  const helper = messaging.slice(start2, messaging.indexOf("\n}", start2) + 2);

  it("swallows its own failure", () => {
    /* The message is already persisted and the caller is about to be told it
     * worked -- which is true. Reporting a send failure because a milestone
     * row did not write would be a lie about the thing they care about. */
    expect(helper).toContain("try {");
    expect(helper).toContain("} catch (error) {");
  });

  it("returns void, so no caller can branch on it", () => {
    expect(helper).toContain("Promise<void>");
  });

  it("cannot change what the sender is told", () => {
    const send = messaging.slice(
      messaging.indexOf("export async function sendMessage"),
      messaging.indexOf("async function recordFirstDirectMessageMilestone")
    );
    // The success return is unconditional on the milestone call.
    expect(send).toContain('return { ok: true, message: "Sent.", messageId: message.id };');
  });
});

describe("idempotency comes from the existing unique constraint", () => {
  it("reuses recordMilestone rather than a second dedupe system", () => {
    const onboarding = readFileSync("lib/onboarding/service.ts", "utf8");
    expect(onboarding).toContain('onConflict: "user_id,milestone"');
    expect(onboarding).toContain("ignoreDuplicates: true");
  });

  it("logs a bookkeeping failure for the server, never the user", () => {
    /* Silence cost a real investigation: the milestone was failing against an
     * environment whose CHECK predates the name, and nothing said so. */
    const at = messaging.indexOf("async function recordFirstDirectMessageMilestone");
    const helper2 = messaging.slice(at, messaging.indexOf("\nexport ", at));
    expect(helper2).toContain("console.warn");
    expect(helper2).toContain("first_message_sent not recorded");
    // Diagnostics must not become a log of who messaged whom.
    for (const leak of ["text", "conversationId", "media"]) {
      expect(helper2).not.toContain(`${leak},`);
    }
  });

  it("adds no dedupe key of its own", () => {
    const start3 = messaging.indexOf("async function recordFirstDirectMessageMilestone");
    const helper = messaging.slice(start3, messaging.indexOf("\n}", start3) + 2);
    for (const banned of ["idempotency_key", "dedupe", "already_recorded", "hasRecorded"]) {
      expect(helper).not.toContain(banned);
    }
  });
});

describe("first value recognises a message", () => {
  const withMuddy = (...extra: string[]) => new Set(["first_muddy_added", ...extra]);

  it("counts a sent direct message", () => {
    expect(hasReachedFirstValue(withMuddy("first_message_sent"))).toBe(true);
  });

  it("still counts a Wave", () => {
    expect(hasReachedFirstValue(withMuddy("first_wave_sent"))).toBe(true);
  });

  it("still counts a Plan", () => {
    expect(hasReachedFirstValue(withMuddy("first_plan_created"))).toBe(true);
  });

  it("still counts a status, unchanged for backward compatibility", () => {
    // Kept deliberately; the reservation about it is recorded, not acted on.
    expect(hasReachedFirstValue(withMuddy("first_status_created"))).toBe(true);
  });

  it("does not count having a Muddy alone", () => {
    expect(hasReachedFirstValue(withMuddy())).toBe(false);
  });

  it("does not count a message without a Muddy", () => {
    expect(hasReachedFirstValue(new Set(["first_message_sent"]))).toBe(false);
  });

  it("does not count setup milestones", () => {
    expect(hasReachedFirstValue(withMuddy("first_glow_enabled", "profile_completed"))).toBe(false);
  });
});

describe("Home matures only after the message, not before", () => {
  it("keeps the focused Home while nothing has been said", async () => {
    const { isEarlyActivation } = await import("@/lib/activation/home-composition");
    expect(
      isEarlyActivation({
        activationState: "no_one_nearby",
        acknowledgingFirstMuddy: false,
        milestones: new Set(["first_muddy_added"]),
        hasSafetyCard: false,
        twoSidedConversationCount: 0,
        planParticipationCount: 0,
        muddyCount: 1,
        nextUnspokenMuddy: null,
        missingProfileItems: [],
        upcomingPlanCount: 0
      })
    ).toBe(true);
  });

  it("reopens Home once a message has been sent", async () => {
    const { isEarlyActivation, composeHome } = await import("@/lib/activation/home-composition");
    const arrived = {
      activationState: "no_one_nearby" as const,
      acknowledgingFirstMuddy: false,
      milestones: new Set(["first_muddy_added", "first_message_sent"]),
      hasSafetyCard: false,
      twoSidedConversationCount: 0,
      planParticipationCount: 0,
      muddyCount: 1,
      nextUnspokenMuddy: null,
      missingProfileItems: [],
      upcomingPlanCount: 0
    };
    /* Activation ENDS, but Home does not open all at once.
     *
     * One message means they have graduated from onboarding, not into the
     * whole product -- so the training-wheel activation gate is closed while
     * maturity stays early_value. Profile campaigning is not what somebody
     * needs immediately after their first hello. */
    expect(isEarlyActivation(arrived)).toBe(false);
    expect(composeHome(arrived).showProfileReminder).toBe(false);
    expect(composeHome(arrived).nextBestAction).toBe("invite_muddy");
  });
});
