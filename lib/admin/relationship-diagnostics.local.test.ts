import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { explainMessagingEligibility, findRelationshipIssues } from "@/lib/admin/relationship-diagnostics";
import { USERS } from "@/lib/test/acting-user";

/**
 * The pure diagnostics, checked against real rows.
 *
 * The unit tests prove the decisions given a shape. This proves the shape is
 * the one the database actually produces -- which is where the earlier block
 * defect lived: the logic was reasonable, but it assumed a blocked pair still
 * had a live friendship to intersect, and blocking ends the friendship.
 */

try {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local: the isLocal guard below skips the suite.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = isLocal ? describe : describe.skip;
const DB_TIMEOUT = 30_000;

const ALICE = USERS.B;
const BOB = USERS.C;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;

const low = ALICE < BOB ? ALICE : BOB;
const high = ALICE < BOB ? BOB : ALICE;

async function clearBlocks() {
  await admin.from("blocked_users").delete().or(`blocker_id.eq.${ALICE},blocker_id.eq.${BOB}`);
}

async function clearRequests() {
  await admin
    .from("friend_requests")
    .delete()
    .or(
      `and(sender_id.eq.${ALICE},receiver_id.eq.${BOB}),and(sender_id.eq.${BOB},receiver_id.eq.${ALICE})`
    );
}

async function makeFriends() {
  const { data: existing } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .maybeSingle();
  if (existing) {
    await admin.from("friendships").update({ ended_at: null }).eq("id", existing.id);
    return;
  }
  await admin.from("friendships").insert({ user_one_id: low, user_two_id: high });
}

/** Builds the diagnostic view for one pair from the real rows. */
async function readPair(userId: string, otherId: string) {
  const [lowId, highId] = userId < otherId ? [userId, otherId] : [otherId, userId];
  const [{ data: friendship }, { data: blocks }, { data: requests }] = await Promise.all([
    admin
      .from("friendships")
      .select("ended_at")
      .eq("user_one_id", lowId)
      .eq("user_two_id", highId)
      .maybeSingle(),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`),
    admin
      .from("friend_requests")
      .select("sender_id")
      .eq("status", "pending")
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${userId})`)
  ]);

  const senders = new Set((requests ?? []).map((r: { sender_id: string }) => r.sender_id));
  return {
    otherUserId: otherId,
    friendshipRowExists: Boolean(friendship),
    friendshipLive: Boolean(friendship) && friendship.ended_at === null,
    blocksThem: (blocks ?? []).some((b: { blocker_id: string }) => b.blocker_id === userId),
    blockedByThem: (blocks ?? []).some((b: { blocker_id: string }) => b.blocker_id === otherId),
    pendingRequest: senders.size > 0,
    pendingBothDirections: senders.size === 2
  };
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
});

beforeEach(async () => {
  if (!isLocal) return;
  await clearBlocks();
  await clearRequests();
  await makeFriends();
});

afterAll(async () => {
  if (!isLocal) return;
  await clearBlocks();
  await clearRequests();
  await makeFriends();
});

describeLocal("the shape the database really produces", () => {
  it(
    "blocking ends the friendship, so a blocked pair has NO live friendship",
    async () => {
      /* The assumption that broke the first verifier, pinned as a fact. */
      await admin.from("blocked_users").insert({ blocker_id: ALICE, blocked_id: BOB });
      await admin
        .from("friendships")
        .update({ ended_at: new Date().toISOString() })
        .eq("user_one_id", low)
        .eq("user_two_id", high)
        .is("ended_at", null);

      const view = await readPair(ALICE, BOB);

      expect(view.blocksThem).toBe(true);
      expect(view.friendshipLive).toBe(false);
      expect(view.friendshipRowExists).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "and is still explained as BLOCKED, not as a lapsed friendship",
    async () => {
      await admin.from("blocked_users").insert({ blocker_id: ALICE, blocked_id: BOB });
      await admin
        .from("friendships")
        .update({ ended_at: new Date().toISOString() })
        .eq("user_one_id", low)
        .eq("user_two_id", high)
        .is("ended_at", null);

      const result = explainMessagingEligibility(await readPair(ALICE, BOB));

      expect(result.outcome).toBe("blocked_by_product_rule");
      expect(result.rule).toMatch(/block outranks/i);
    },
    DB_TIMEOUT
  );

  it(
    "reads the block identically from the blocked side",
    async () => {
      await admin.from("blocked_users").insert({ blocker_id: ALICE, blocked_id: BOB });

      const view = await readPair(BOB, ALICE);

      expect(view.blockedByThem).toBe(true);
      expect(explainMessagingEligibility(view).outcome).toBe("blocked_by_product_rule");
    },
    DB_TIMEOUT
  );
});

describeLocal("real drift is detected from real rows", () => {
  it(
    "the database REFUSES to create a pending request between live Muddies",
    async () => {
      /* Why this diagnostic is legacy-only. `prevent_pending_request_for_
         existing_friendship` raises `users_are_already_friends`, so the drift
         cannot be produced any more -- which is worth pinning, because a
         future reader would otherwise assume the detector is dead code. */
      const { error } = await admin.from("friend_requests").insert({
        sender_id: ALICE,
        receiver_id: BOB,
        status: "pending",
        context_type: "friend"
      });

      expect(error).not.toBeNull();
      expect(error.message).toMatch(/users_are_already_friends/i);
      expect(findRelationshipIssues([await readPair(ALICE, BOB)])).toEqual([]);
    },
    DB_TIMEOUT
  );

  it(
    "a pending request DOES survive once the pair are no longer Muddies, and is not drift",
    async () => {
      /* The same row is legitimate the moment the friendship ends: this is how
         two people become Muddies again, so it must never be reported as
         something to repair. */
      await admin
        .from("friendships")
        .update({ ended_at: new Date().toISOString() })
        .eq("user_one_id", low)
        .eq("user_two_id", high)
        .is("ended_at", null);

      const { error } = await admin.from("friend_requests").insert({
        sender_id: ALICE,
        receiver_id: BOB,
        status: "pending",
        context_type: "friend"
      });
      expect(error).toBeNull();

      const view = await readPair(ALICE, BOB);
      expect(view.pendingRequest).toBe(true);
      expect(findRelationshipIssues([view])).toEqual([]);
    },
    DB_TIMEOUT
  );

  it(
    "but a pending request for a BLOCKED pair is real drift Admin may settle",
    async () => {
      await admin
        .from("friendships")
        .update({ ended_at: new Date().toISOString() })
        .eq("user_one_id", low)
        .eq("user_two_id", high)
        .is("ended_at", null);
      await admin.from("friend_requests").insert({
        sender_id: ALICE,
        receiver_id: BOB,
        status: "pending",
        context_type: "friend"
      });
      await admin.from("blocked_users").insert({ blocker_id: BOB, blocked_id: ALICE });

      const issues = findRelationshipIssues([await readPair(ALICE, BOB)]);

      expect(issues).toHaveLength(1);
      expect(issues[0].kind).toBe("pending_request_while_blocked");
      expect(issues[0].repairable).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "a healthy pair with no pending request produces no issue",
    async () => {
      expect(findRelationshipIssues([await readPair(ALICE, BOB)])).toEqual([]);
    },
    DB_TIMEOUT
  );

  it(
    "current unblocked Muddies are permitted to message",
    async () => {
      expect(explainMessagingEligibility(await readPair(ALICE, BOB)).outcome).toBe("fixed");
    },
    DB_TIMEOUT
  );
});
