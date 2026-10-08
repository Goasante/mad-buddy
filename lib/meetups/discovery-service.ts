import "server-only";

import { after } from "next/server";
import { optionalFeatureEnabled, FEATURE_LOCK_MESSAGE } from "@/lib/features/availability-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { guardAction } from "@/lib/admin/enforcement";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { deliverNotification } from "@/lib/notifications/server";
import { isValidTimeZone } from "@/lib/time/timezone";
import { isFutureMeetupTime } from "@/lib/meetups/scheduling";
import { processMeetupNotifications } from "@/lib/meetups/notifications";
import {
  meetupDiscoveryCommandSchema,
  meetupDiscoveryCreateSchema,
  meetupDiscoveryHubSchema,
  type MeetupDiscoveryHub
} from "@/lib/meetups/discovery";

type RpcResult = { data: unknown; error: { message?: string } | null };
type LooseRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<RpcResult>;
};

function asLooseRpc(client: ReturnType<typeof createSupabaseAdminClient>): LooseRpcClient {
  return client as unknown as LooseRpcClient;
}

const ERROR_COPY: Record<string, string> = {
  MEETUP_LIMIT: "You already have three open listings. Close one before creating another.",
  DISCOVERY_LOCATION_REQUIRED: "Turn on Glow and refresh your location before meeting new people nearby.",
  DISCOVERY_NOT_NEARBY: "This listing is no longer nearby or available to you.",
  DISCOVERY_FULL: "This listing has reached its response limit.",
  DISCOVERY_CLOSED: "This listing is no longer accepting people.",
  DISCOVERY_REFRESH_LIMIT: "This listing has already been refreshed twice.",
  DISCOVERY_TITLE: "Keep the title short — five words or fewer.",
  DISCOVERY_CHANGED: "That response changed. Refresh and try again.",
  DISCOVERY_DECLINED: "The creator has already passed on your request for this listing.",
  DISCOVERY_ACCESS: "Only the creator can edit this listing.",
  DISCOVERY_REQUEST_EXPIRED: "The meetup has started or the host ended the listing. This request can no longer be accepted.",
  MEETUP_TIME: "Choose a time at least one minute from now. Later today is fine."
};

function commandError(message?: string) {
  return ERROR_COPY[message ?? ""] ?? "Could not update this listing. Refresh and try again.";
}

function emptyHub(): MeetupDiscoveryHub {
  return { nearby: [], mine: [], activeSlots: 0, maxActiveSlots: 3 };
}

function parseHub(value: unknown): MeetupDiscoveryHub {
  const parsed = meetupDiscoveryHubSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyHub();
}

export async function loadMeetupDiscoveryHub(userId: string): Promise<MeetupDiscoveryHub> {
  if (!(await optionalFeatureEnabled("meet_up"))) return emptyHub();
  const client = createSupabaseAdminClient();
  const rpc = asLooseRpc(client);
  await rpc.rpc("expire_meetup_discoveries_server");
  const result = await rpc.rpc("list_meetup_discoveries_server", { p_actor_id: userId });
  if (result.error) return emptyHub();
  return parseHub(result.data);
}

export async function createMeetupDiscovery(userId: string, input: unknown) {
  if (!(await optionalFeatureEnabled("meet_up"))) return { ok: false, message: FEATURE_LOCK_MESSAGE };
  const parsed = meetupDiscoveryCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the listing details." };
  }
  if (!isValidTimeZone(parsed.data.timezone)) return { ok: false, message: "Choose a valid timezone." };
  if (!isFutureMeetupTime(parsed.data.startsAt)) {
    return { ok: false, message: ERROR_COPY.MEETUP_TIME };
  }

  const client = createSupabaseAdminClient();
  const guard = await guardAction(client, { userId, surface: "plans" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const rate = await consumeRateLimit({ action: "meetups.create", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const result = await asLooseRpc(client).rpc("create_meetup_discovery_server", {
    p_actor_id: userId,
    p_input: parsed.data
  });
  if (result.error) return { ok: false, message: commandError(result.error.message) };
  const data = result.data as { id?: unknown } | null;
  if (typeof data?.id !== "string") {
    return { ok: false, message: "The listing was created but could not be reopened." };
  }
  after(async () => {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(client, userId, "open_to_meetups");
  });
  return { ok: true, message: "Your nearby listing is live.", discoveryId: data.id };
}

export async function updateMeetupDiscovery(userId: string, input: unknown) {
  if (!(await optionalFeatureEnabled("meet_up"))) return { ok: false, message: FEATURE_LOCK_MESSAGE };
  const parsed = meetupDiscoveryCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That listing update could not be read." };
  if (parsed.data.action === "edit") {
    if (!isValidTimeZone(parsed.data.timezone)) return { ok: false, message: "Choose a valid timezone." };
    if (!isFutureMeetupTime(parsed.data.startsAt)) return { ok: false, message: ERROR_COPY.MEETUP_TIME };
  }

  const client = createSupabaseAdminClient();
  const guard = await guardAction(client, { userId, surface: "plans" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const rate = await consumeRateLimit({ action: "meetups.update", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const before = parsed.data.action === "interest" || parsed.data.action === "edit" ? await loadMeetupDiscoveryHub(userId) : null;
  const itemBefore = before?.nearby.find((item) => item.id === parsed.data.id) ?? null;
  const ownItemBefore = before?.mine.find((item) => item.id === parsed.data.id) ?? null;

  const result = await asLooseRpc(client).rpc(parsed.data.action === "edit" ? "edit_meetup_discovery_server" : "meetup_discovery_command_server", {
    p_actor_id: userId,
    ...(parsed.data.action === "edit" ? {} : { p_action: parsed.data.action }),
    p_input: parsed.data
  });
  if (result.error) return { ok: false, message: commandError(result.error.message) };

  const data = (result.data && typeof result.data === "object" ? result.data : {}) as {
    meetupId?: unknown;
    conversationId?: unknown;
    changed?: unknown;
    timeChanged?: unknown;
  };
  const meetupId = typeof data.meetupId === "string" ? data.meetupId : undefined;
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : undefined;

  if (parsed.data.action === "edit" && data.changed === true && ownItemBefore) {
    const { requestKey, id } = parsed.data;
    after(async () => {
      for (const person of ownItemBefore.interestedPeople) {
        if (person.status !== "pending" && person.status !== "accepted") continue;
        // Accepted people get the canonical reschedule notification instead.
        if (person.status === "accepted" && data.timeChanged === true) continue;
        await deliverNotification(client, {
          userId: person.userId, senderId: userId,
          type: person.status === "accepted" && meetupId ? `meetup:${meetupId}` : `meetup_discovery:${id}`,
          title: "Meetup listing updated", message: "The creator updated the listing. Open it to review the details.",
          dedupeKey: `meetup-discovery-edited:${id}:${requestKey}:${person.userId}`
        });
      }
      if (data.timeChanged === true) await processMeetupNotifications(client);
    });
  }

  if (parsed.data.action === "interest" && itemBefore) {
    after(async () => {
      await deliverNotification(client, {
        userId: itemBefore.creatorId,
        type: `meetup_discovery:${itemBefore.id}`,
        title: "Someone is interested",
        message: `Someone nearby is interested in “${itemBefore.title}”.`,
        senderId: userId,
        dedupeKey: `meetup-discovery-interest:${itemBefore.id}:${userId}`
      });
    });
  }

  if (parsed.data.action === "decide" && parsed.data.response === "accepted" && meetupId) {
    const acceptedUserId = parsed.data.userId;
    const discoveryId = parsed.data.id;
    after(async () => {
      await deliverNotification(client, {
        userId: acceptedUserId,
        type: `meetup:${meetupId}`,
        title: "You matched for a Meetup",
        message: "You’ve been accepted. Open the Meetup to coordinate.",
        priority: "high",
        senderId: userId,
        dedupeKey: `meetup-discovery-accepted:${discoveryId}:${acceptedUserId}`
      });
    });
  }

  const message =
    parsed.data.action === "edit" ? "Listing updated."
      : parsed.data.action === "interest" ? "Interested sent."
      : parsed.data.action === "withdraw" ? "Your interest was withdrawn."
        : parsed.data.action === "refresh" ? "Listing refreshed."
          : parsed.data.action === "close" ? "Listing closed."
            : parsed.data.response === "accepted" ? "Accepted. Your Meetup and chat are ready."
              : "Declined. A response slot is open again.";

  return { ok: true, message, meetupId, conversationId };
}
