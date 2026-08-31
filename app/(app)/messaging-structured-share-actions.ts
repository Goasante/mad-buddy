"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { guardAction } from "@/lib/admin/enforcement";
import { deliverNotification } from "@/lib/notifications/server";
import { buildNotificationPreview } from "@/lib/messaging/rules";
import {
  canSendMessage,
  loadCommunicationPreferences,
  resolveConversationAccess
} from "@/lib/messaging/service";
import type {
  StructuredMessagePayload,
  StructuredShareOption
} from "@/lib/messaging/structured-share-v4-types";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { loadUpcomingAgenda } from "@/lib/social/upcoming-agenda";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const common = z.object({
  conversationId: uuid,
  clientMessageId: z.string().min(1).max(64)
});
const placeSchema = common.extend({
  kind: z.literal("place"),
  placeName: z.string().trim().min(1).max(160),
  areaLabel: z.string().trim().max(160).optional(),
  addressLabel: z.string().trim().max(240).optional(),
  placeKind: z.enum(["venue", "area"]).default("venue")
});
const agendaSchema = common.extend({
  kind: z.literal("agenda"),
  refKind: z.enum(["plan", "event"]),
  refId: uuid
});
const sendSchema = z.discriminatedUnion("kind", [placeSchema, agendaSchema]);
const payloadSchema = z.object({ conversationId: uuid, messageId: uuid });

function configured() {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

async function authedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

function fail(message: string) {
  return { ok: false as const, message };
}

function optionFromAgenda(item: Awaited<ReturnType<typeof loadUpcomingAgenda>>["items"][number]): StructuredShareOption {
  if (item.kind === "plan") {
    return {
      kind: "plan",
      id: item.id,
      title: item.title,
      startsAt: item.startsAt,
      locationLabel: item.placeText ?? null,
      contextLabel: "Plan"
    };
  }
  return {
    kind: "event",
    id: item.id,
    title: item.title,
    startsAt: item.startsAt,
    locationLabel: item.locationLabel ?? null,
    contextLabel: "Event"
  };
}

export async function getStructuredShareOptionsAction(conversationId: string): Promise<StructuredShareOption[]> {
  if (!configured() || !uuid.safeParse(conversationId).success) return [];
  const userId = await authedUserId();
  if (!userId) return [];
  const admin = createSupabaseAdminClient();
  const permission = await canSendMessage(admin, userId, conversationId);
  if (!permission.allowed) return [];
  const agenda = await loadUpcomingAgenda(userId, 24);
  return agenda.items.map(optionFromAgenda);
}

async function notifyStructuredMembers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  conversationId: string,
  senderId: string,
  label: string
) {
  const nowIso = new Date().toISOString();
  const [{ data: members }, { data: conversation }, { data: senderProfile }] = await Promise.all([
    admin
      .from("conversation_members")
      .select("user_id, muted_until")
      .eq("conversation_id", conversationId)
      .eq("status", "joined")
      .neq("user_id", senderId),
    admin.from("conversations").select("conversation_type").eq("id", conversationId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("user_id", senderId).maybeSingle()
  ]);
  const isGroup = conversation?.conversation_type === "group";
  const { data: groupSettings } = isGroup
    ? await admin.from("group_settings").select("name").eq("conversation_id", conversationId).maybeSingle()
    : { data: null };
  const senderName = senderProfile?.full_name?.trim() || "A Muddy";
  const recipients = (members ?? []).filter((member) => !member.muted_until || member.muted_until < nowIso);

  await Promise.all(
    recipients.map(async (member) => {
      const prefs = await loadCommunicationPreferences(admin, member.user_id);
      const preview = buildNotificationPreview({
        mode: prefs.notificationPreview,
        senderName,
        messageText: label
      });
      if (!preview) return;
      await deliverNotification(admin, {
        userId: member.user_id,
        senderId,
        priority: "high",
        type: isGroup ? `group:${conversationId}` : `message:${conversationId}`,
        title: isGroup && groupSettings?.name ? `${preview.title} · ${groupSettings.name}` : preview.title,
        message: preview.body
      });
    })
  );
}

async function recordDirectActivation(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  senderId: string,
  conversationId: string
) {
  const { data: conversation } = await admin
    .from("conversations")
    .select("conversation_type")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversation?.conversation_type !== "direct") return;
  await admin
    .from("activation_milestones")
    .upsert(
      { user_id: senderId, milestone: "first_message_sent" },
      { onConflict: "user_id,milestone", ignoreDuplicates: true }
    );
}

export async function sendStructuredChatMessageAction(input: unknown) {
  if (!configured()) return fail("Chats are not configured.");
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return fail("Check what you are sharing and try again.");
  const userId = await authedUserId();
  if (!userId) return fail("Log in first.");

  const rateLimit = await consumeRateLimit({ action: "messages.send", userId });
  if (!rateLimit.allowed) return fail(rateLimitMessage(rateLimit.resetAt));

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "messaging" });
  if (!guard.allowed) return fail(guard.message);
  const permission = await canSendMessage(admin, userId, parsed.data.conversationId);
  if (!permission.allowed) {
    return fail(permission.reason === "posting_restricted" ? "Only admins can post here." : "That conversation is not available.");
  }

  const db = admin as unknown as SupabaseClient;
  const { data: existing } = await db
    .from("messages")
    .select("id, conversation_id, sender_id, message_type")
    .eq("sender_id", userId)
    .eq("client_message_id", parsed.data.clientMessageId)
    .maybeSingle();
  if (existing) {
    return existing.conversation_id === parsed.data.conversationId
      ? { ok: true as const, message: "Sent.", messageId: String(existing.id) }
      : fail("That message retry is no longer valid.");
  }

  let option: StructuredShareOption | null = null;
  if (parsed.data.kind === "agenda") {
    const agendaInput = parsed.data;
    const agenda = await loadUpcomingAgenda(userId, 40);
    option = agenda.items
      .map(optionFromAgenda)
      .find((item) => item.kind === agendaInput.refKind && item.id === agendaInput.refId) ?? null;
    if (!option) return fail("That Plan or Event is no longer available to share.");
  }

  const { data: settings } = await db
    .from("conversation_chat_settings")
    .select("message_lifetime_seconds")
    .eq("conversation_id", parsed.data.conversationId)
    .maybeSingle();
  const lifetime = typeof settings?.message_lifetime_seconds === "number" ? settings.message_lifetime_seconds : null;
  const expiresAt = lifetime ? new Date(Date.now() + lifetime * 1000).toISOString() : null;
  const messageType = parsed.data.kind === "place" ? "place" : "event";

  const { data: message, error: messageError } = await db
    .from("messages")
    .insert({
      conversation_id: parsed.data.conversationId,
      sender_id: userId,
      message_type: messageType,
      text_content: null,
      client_message_id: parsed.data.clientMessageId,
      status: "sent",
      expires_at: expiresAt
    })
    .select("id")
    .single();
  if (messageError || !message) return fail("Could not send that share.");

  let payloadError: { message?: string } | null = null;
  if (parsed.data.kind === "place") {
    const { error } = await db.from("message_places").insert({
      message_id: message.id,
      place_name: parsed.data.placeName,
      area_label: parsed.data.areaLabel?.trim() || null,
      address_label: parsed.data.addressLabel?.trim() || null,
      place_kind: parsed.data.placeKind
    });
    payloadError = error;
  } else {
    const { error } = await db.from("message_event_refs").insert({
      message_id: message.id,
      event_id: parsed.data.refKind === "event" ? parsed.data.refId : null,
      plan_id: parsed.data.refKind === "plan" ? parsed.data.refId : null
    });
    payloadError = error;
  }

  if (payloadError) {
    await db.from("messages").delete().eq("id", message.id).eq("sender_id", userId);
    return fail("Could not finish that share. Try again.");
  }

  const now = new Date().toISOString();
  await Promise.all([
    admin.from("conversations").update({ last_message_at: now, updated_at: now }).eq("id", parsed.data.conversationId),
    admin.from("conversation_members").update({ hidden_at: null, updated_at: now }).eq("conversation_id", parsed.data.conversationId).eq("user_id", userId)
  ]);

  const label = parsed.data.kind === "place"
    ? "Place"
    : option?.kind === "plan"
      ? "Plan"
      : "Event";
  await Promise.allSettled([
    notifyStructuredMembers(admin, parsed.data.conversationId, userId, label),
    recordDirectActivation(admin, userId, parsed.data.conversationId)
  ]);

  return { ok: true as const, message: `${label} shared.`, messageId: String(message.id) };
}

export async function getStructuredMessagePayloadAction(input: unknown): Promise<StructuredMessagePayload | null> {
  if (!configured()) return null;
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return null;
  const userId = await authedUserId();
  if (!userId) return null;
  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, parsed.data.conversationId);
  if (!access.canView || access.status !== "active") return null;

  const db = admin as unknown as SupabaseClient;
  const { data: message } = await db
    .from("messages")
    .select("id, conversation_id, message_type, status, deleted_at, created_at, expires_at, kept_at")
    .eq("id", parsed.data.messageId)
    .eq("conversation_id", parsed.data.conversationId)
    .maybeSingle();
  if (!message || message.deleted_at || message.status === "deleted") return null;
  if (access.historyVisibleFrom && Date.parse(String(message.created_at)) < Date.parse(access.historyVisibleFrom)) return null;
  if (!message.kept_at && message.expires_at && Date.parse(String(message.expires_at)) <= Date.now()) return null;

  if (message.message_type === "contact") {
    const { data } = await db.from("message_contacts").select("display_name, phone, email, organization").eq("message_id", message.id).maybeSingle();
    if (!data) return null;
    return {
      kind: "contact",
      displayName: String(data.display_name),
      phone: typeof data.phone === "string" ? data.phone : null,
      email: typeof data.email === "string" ? data.email : null,
      organization: typeof data.organization === "string" ? data.organization : null
    };
  }

  if (message.message_type === "place") {
    const { data } = await db.from("message_places").select("place_name, area_label, address_label, place_kind").eq("message_id", message.id).maybeSingle();
    if (!data) return null;
    return {
      kind: "place",
      placeName: String(data.place_name),
      areaLabel: typeof data.area_label === "string" ? data.area_label : null,
      addressLabel: typeof data.address_label === "string" ? data.address_label : null,
      placeKind: data.place_kind === "area" ? "area" : "venue"
    };
  }

  if (message.message_type !== "event") return null;
  const { data: ref } = await db.from("message_event_refs").select("event_id, plan_id").eq("message_id", message.id).maybeSingle();
  if (!ref) return null;
  if (ref.plan_id) {
    const { data: plan } = await admin.from("plans").select("id, title, start_at, custom_place_text").eq("id", ref.plan_id).maybeSingle();
    if (!plan) return null;
    return {
      kind: "agenda",
      refKind: "plan",
      refId: plan.id,
      title: plan.title,
      startsAt: plan.start_at,
      locationLabel: plan.custom_place_text
    };
  }
  if (ref.event_id) {
    const { data: event } = await admin.from("events").select("id, name, starts_at, venue_label").eq("id", ref.event_id).maybeSingle();
    if (!event) return null;
    return {
      kind: "agenda",
      refKind: "event",
      refId: event.id,
      title: event.name,
      startsAt: event.starts_at,
      locationLabel: event.venue_label
    };
  }
  return null;
}
