import {
  PlansPageContent,
  type PlanInvitee,
  type PlanSummary,
  type PlanPollSummary
} from "@/components/plans/plans-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/auth";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const { plans, invitees, currentUserId } = await loadPlans();
  return <PlansPageContent initialPlans={plans} invitees={invitees} currentUserId={currentUserId} />;
}

async function loadPlans(): Promise<{
  plans: PlanSummary[];
  invitees: PlanInvitee[];
  currentUserId: string | null;
}> {
  const user = await getCurrentUser();
  const env = getSupabaseServerEnv();
  if (!user || !env.url || !env.serviceRoleKey) {
    return { plans: [], invitees: [], currentUserId: user?.id ?? null };
  }

  const admin = createSupabaseAdminClient();

  // Plans where I'm a (non-removed) participant, plus plans I created.
  const [{ data: myRows }, { data: createdPlans }, invitees] = await Promise.all([
    admin
      .from("plan_participants")
      .select("plan_id, role, rsvp_status")
      .eq("user_id", user.id)
      .neq("rsvp_status", "removed"),
    admin.from("plans").select("id").eq("creator_id", user.id),
    loadMuddies(admin, user.id)
  ]);

  const planIds = [
    ...new Set([
      ...(myRows ?? []).map((row) => row.plan_id),
      ...(createdPlans ?? []).map((row) => row.id)
    ])
  ];
  const myRowByPlan = new Map((myRows ?? []).map((row) => [row.plan_id, row]));

  if (planIds.length === 0) {
    return { plans: [], invitees, currentUserId: user.id };
  }

  const [{ data: planRows }, { data: participantRows }, { data: pollRows }] = await Promise.all([
    admin
      .from("plans")
      .select(
        // end_at and created_at feed planPhase: end_at so a plan stays
        // upcoming until it actually ends, created_at so an undated plan's
        // grace window can be measured.
        "id, creator_id, title, description, plan_type, status, start_at, end_at, created_at, custom_place_text, place_type, category, cover_image_url"
      )
      .in("id", planIds),
    admin
      .from("plan_participants")
      .select("plan_id, user_id, role, rsvp_status")
      .in("plan_id", planIds),
    admin.from("plan_polls").select("id, plan_id, poll_type, question, status").in("plan_id", planIds)
  ]);

  // Names for everyone appearing as a participant.
  const participantIds = [...new Set([
    ...(participantRows ?? []).map((row) => row.user_id),
    ...(planRows ?? []).map((row) => row.creator_id)
  ])];
  const nameById = new Map<string, string>();
  const avatarById = new Map<string, string | null>();
  const planById = await loadEffectivePlansForUsers(admin, participantIds);
  if (participantIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, avatar_url")
      .in("user_id", participantIds);
    for (const profile of profiles ?? []) {
      nameById.set(profile.user_id, profile.full_name?.trim() || "A Muddy");
      avatarById.set(profile.user_id, profile.avatar_url);
    }
  }

  const participantsByPlan = new Map<string, Array<{ name: string; avatarUrl: string | null; rsvp: string; isMe: boolean; plan: "free" | "buddy_plus" | "buddy_pro" }>>();
  for (const row of participantRows ?? []) {
    if (!participantsByPlan.has(row.plan_id)) participantsByPlan.set(row.plan_id, []);
    participantsByPlan.get(row.plan_id)!.push({
      name: row.user_id === user.id ? "You" : nameById.get(row.user_id) ?? "A Muddy",
      avatarUrl: avatarById.get(row.user_id) ?? null,
      rsvp: row.rsvp_status,
      isMe: row.user_id === user.id,
      plan: planById.get(row.user_id) ?? "free"
    });
  }

  // Poll options + vote counts + my votes.
  const pollIds = (pollRows ?? []).map((poll) => poll.id);
  const pollsByPlan = new Map<string, PlanPollSummary[]>();
  if (pollIds.length > 0) {
    const [{ data: optionRows }, { data: voteRows }] = await Promise.all([
      admin.from("plan_poll_options").select("id, poll_id, label, sort_order").in("poll_id", pollIds),
      admin.from("plan_poll_votes").select("poll_id, option_id, user_id").in("poll_id", pollIds)
    ]);
    const voteCount = new Map<string, number>();
    const myVoteByPoll = new Map<string, Set<string>>();
    for (const vote of voteRows ?? []) {
      voteCount.set(vote.option_id, (voteCount.get(vote.option_id) ?? 0) + 1);
      if (vote.user_id === user.id) {
        if (!myVoteByPoll.has(vote.poll_id)) myVoteByPoll.set(vote.poll_id, new Set());
        myVoteByPoll.get(vote.poll_id)!.add(vote.option_id);
      }
    }
    const optionsByPoll = new Map<string, Array<{ id: string; label: string; votes: number; sort: number }>>();
    for (const option of optionRows ?? []) {
      if (!optionsByPoll.has(option.poll_id)) optionsByPoll.set(option.poll_id, []);
      optionsByPoll.get(option.poll_id)!.push({
        id: option.id,
        label: option.label,
        votes: voteCount.get(option.id) ?? 0,
        sort: option.sort_order
      });
    }
    for (const poll of pollRows ?? []) {
      if (!pollsByPlan.has(poll.plan_id)) pollsByPlan.set(poll.plan_id, []);
      pollsByPlan.get(poll.plan_id)!.push({
        id: poll.id,
        question: poll.question,
        status: poll.status,
        myOptionIds: [...(myVoteByPoll.get(poll.id) ?? [])],
        options: (optionsByPoll.get(poll.id) ?? []).sort((a, b) => a.sort - b.sort)
      });
    }
  }

  /* The Plan conversation, gated on real membership -- see the matching block
   * in lib/plans/service.ts for why this reads conversation_members rather than
   * re-deriving the RSVP rule. The CTA must never offer a door the server
   * would close. */
  const planIdsForChat = (planRows ?? []).map((plan) => plan.id);
  const myConversationByPlan = new Map<string, string>();
  if (planIdsForChat.length > 0) {
    const { data: planConversations } = await admin
      .from("conversations")
      .select("id, context_id")
      .eq("context_type", "plan")
      .in("context_id", planIdsForChat);
    const conversationIds = (planConversations ?? []).map((row) => row.id);
    if (conversationIds.length > 0) {
      const { data: myMemberships } = await admin
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", user.id)
        .eq("status", "joined")
        .in("conversation_id", conversationIds);
      const joined = new Set((myMemberships ?? []).map((row) => row.conversation_id));
      for (const row of planConversations ?? []) {
        if (row.context_id && joined.has(row.id)) myConversationByPlan.set(row.context_id, row.id);
      }
    }
  }

  const plans: PlanSummary[] = (planRows ?? []).map((plan) => {
    const myRow = myRowByPlan.get(plan.id);
    const isHost = plan.creator_id === user.id || myRow?.role === "host" || myRow?.role === "co_host";
    const myRsvp = isHost ? "going" : (myRow?.rsvp_status ?? "invited");
    return {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      planType: plan.plan_type,
      status: plan.status,
      startAt: plan.start_at,
      endAt: plan.end_at ?? null,
      createdAt: plan.created_at ?? null,
      placeText: plan.custom_place_text,
      // Cover inputs for the canonical resolver (lib/plans/plan-covers).
      category: plan.category ?? null,
      coverImageUrl: plan.cover_image_url ?? null,
      organiserName: plan.creator_id === user.id ? "You" : nameById.get(plan.creator_id) ?? "A Muddy",
      organiserPlan: planById.get(plan.creator_id) ?? "free",
      isHost,
      myRsvp,
      attendees: participantsByPlan.get(plan.id) ?? [],
      polls: pollsByPlan.get(plan.id) ?? [],
      myConversationId: myConversationByPlan.get(plan.id) ?? null
    };
  });

  return { plans, invitees, currentUserId: user.id };
}

async function loadMuddies(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<PlanInvitee[]> {
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .is("ended_at", null);
  const friendIds = (friendships ?? []).map((friendship) =>
    friendship.user_one_id === userId ? friendship.user_two_id : friendship.user_one_id
  );
  if (friendIds.length === 0) return [];
  const [{ data: profiles }, plans] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", friendIds),
    loadEffectivePlansForUsers(admin, friendIds)
  ]);
  return (profiles ?? []).map((profile) => ({
    id: profile.user_id,
    name: profile.full_name?.trim() || "A Muddy",
    username: profile.username,
    avatarUrl: profile.avatar_url,
    plan: plans.get(profile.user_id) ?? "free"
  }));
}
