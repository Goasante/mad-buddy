import { NextResponse } from "next/server";
import { guardFeature } from "@/lib/admin/enforcement";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { rankPulseItems, basePriorityFor, type PulseItem } from "@/lib/pulse/ranking";
import { loadNearbyForUser } from "@/lib/proximity/nearby-service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The Pulse aggregation endpoint (spec §10). One authorized, privacy-safe
 * response combining nearby Muddies, pending Waves, pending Pings, and
 * upcoming/invited Plans. Every item is already authorized by the source
 * query (participants-only, recipient-only), no coordinates ever leave the
 * nearby service, and only counts/labels reach the client.
 */
export async function GET() {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const route = "/api/pulse";
  const env = getSupabaseServerEnv();

  if (!env.url || !env.anonKey || !env.serviceRoleKey) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({ action: "friends.nearby", userId: user.id, requestId });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 });
  }

  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const soonIso = new Date(now + 3 * 60 * 60 * 1000).toISOString();

  // The Pulse computes proximity too, so it honours the same kill switch. The
  // rest of the Pulse (waves, pings, plans) still works, degrade, don't fail.
  const proximityAvailable = (await guardFeature(admin, "proximity")).allowed;

  try {
    const [nearby, wavesResult, pingsResult, myParticipantRows] = await Promise.all([
      proximityAvailable ? loadNearbyForUser(admin, user.id) : Promise.resolve([]),
      admin
        .from("waves")
        .select("id, sender_id, sent_at, expires_at")
        .eq("recipient_id", user.id)
        .is("seen_at", null)
        .gt("expires_at", nowIso),
      admin
        .from("meeting_pings")
        .select("id, sender_id, proposed_time, expires_at, created_at")
        .eq("recipient_id", user.id)
        .in("status", ["pending", "seen"])
        .gt("expires_at", nowIso),
      admin
        .from("plan_participants")
        .select("plan_id, rsvp_status")
        .eq("user_id", user.id)
        .neq("rsvp_status", "removed")
    ]);

    // Nearby (only visible, non-hidden cards contribute to the Pulse).
    const visibleNearby = nearby.filter((friend) => friend.proximity_level !== "hidden");
    const items: PulseItem[] = [];

    for (const friend of visibleNearby) {
      items.push({
        id: `proximity:${friend.friend_id}`,
        type: "proximity",
        priority: basePriorityFor("proximity"),
        createdAtMs: now,
        expiresAtMs: null,
        isVeryClose: friend.proximity_level === "very_close",
        data: {
          displayName: friend.display_name,
          proximityLevel: friend.proximity_level,
          freshnessState: friend.freshness_state,
          statusText: friend.status_text
        }
      });
    }

    for (const wave of wavesResult.data ?? []) {
      items.push({
        id: `wave:${wave.id}`,
        type: "wave",
        priority: basePriorityFor("wave"),
        createdAtMs: Date.parse(wave.sent_at),
        expiresAtMs: Date.parse(wave.expires_at),
        unread: true,
        data: { senderId: wave.sender_id }
      });
    }

    for (const ping of pingsResult.data ?? []) {
      items.push({
        id: `meeting_ping:${ping.id}`,
        type: "meeting_ping",
        priority: basePriorityFor("meeting_ping"),
        createdAtMs: Date.parse(ping.created_at),
        expiresAtMs: Date.parse(ping.expires_at),
        unread: true,
        data: { senderId: ping.sender_id, proposedTime: ping.proposed_time }
      });
    }

    // Plans: invites awaiting response + plans starting soon.
    const planIds = (myParticipantRows.data ?? []).map((row) => row.plan_id);
    const rsvpByPlan = new Map((myParticipantRows.data ?? []).map((row) => [row.plan_id, row.rsvp_status]));
    let pendingPlans = 0;
    if (planIds.length > 0) {
      const { data: plans } = await admin
        .from("plans")
        .select("id, title, status, start_at")
        .in("id", planIds)
        .in("status", ["inviting", "polling", "confirmed"]);
      for (const plan of plans ?? []) {
        const myRsvp = rsvpByPlan.get(plan.id);
        const startsMs = plan.start_at ? Date.parse(plan.start_at) : null;
        if (myRsvp === "invited" || myRsvp === "viewed") {
          pendingPlans += 1;
          items.push({
            id: `plan_invite:${plan.id}`,
            type: "plan_invite",
            priority: basePriorityFor("plan_invite"),
            createdAtMs: now,
            expiresAtMs: null,
            unread: true,
            data: { planId: plan.id, title: plan.title }
          });
        } else if (startsMs !== null && startsMs > now && plan.start_at! <= soonIso) {
          items.push({
            id: `plan_starting_soon:${plan.id}`,
            type: "plan_starting_soon",
            priority: basePriorityFor("plan_starting_soon"),
            createdAtMs: now,
            expiresAtMs: startsMs,
            data: { planId: plan.id, title: plan.title, startAt: plan.start_at }
          });
        }
      }
    }

    const ranked = rankPulseItems(items, now);
    const response = {
      summary: {
        nearbyCount: visibleNearby.length,
        unreadWaves: (wavesResult.data ?? []).length,
        pendingPings: (pingsResult.data ?? []).length,
        pendingPlans
      },
      items: ranked,
      generatedAt: nowIso
    };

    logBackendEvent("info", {
      requestId,
      route,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      userId: user.id
    });
    return NextResponse.json(response);
  } catch (error) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: errorType(error)
    });
    return NextResponse.json({ error: "Your Pulse could not be loaded." }, { status: 500 });
  }
}
