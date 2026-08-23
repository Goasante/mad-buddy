/**
 * Fixtures for the four remaining detail surfaces.
 *
 * Conversation, Plan detail, Plan Chat and Event detail are all reached by
 * query parameter over a list surface, so crawling them needs a REAL id of each
 * kind. Crawling `?conversation=` with no conversation would exercise the empty
 * state and prove nothing about the detail view.
 *
 * Prints the ids so the crawler can be pointed at them. Idempotent: re-running
 * reuses what already exists rather than piling up fixtures.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to seed a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";
const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a";
const AMA = "b66cd360-1f24-4b02-9b8c-123b522d0c61";
const TAG = "detail-fixture";

/** A direct conversation between QA and KOFI, with a couple of messages. */
async function directConversation() {
  /* THE CANONICAL KEY, not a readable tag.
   *
   * `direct_key` is not a label -- lib/messaging/rules.ts builds it as
   * `[a, b].sort().join(":")` and mobile.ts:731 derives the OTHER participant
   * by splitting it on ":". A fixture keyed "detail-fixture" therefore has no
   * derivable peer, and the conversation list correctly falls back to
   * "A Muddy" for a person whose name is sitting in the database.
   *
   * That cost this program a false finding: the list looked like it had lost
   * the ability to name a direct conversation. The app was right; the fixture
   * was malformed. Seed data must obey the same invariants as real data, or it
   * measures the seed rather than the product. */
  const directKey = [QA, KOFI].sort().join(":");

  const { data: existing } = await admin.from("conversations")
    .select("id").eq("direct_key", directKey).maybeSingle();
  if (existing) return existing.id;

  const { data: convo, error } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: QA, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (error) throw new Error(`conversation: ${error.message}`);

  await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: QA, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: KOFI, role: "member", status: "joined" }
  ]);
  await admin.from("messages").insert([
    { conversation_id: convo.id, sender_id: KOFI, message_type: "text",
      text_content: "Are we still on for later?", client_message_id: crypto.randomUUID() },
    { conversation_id: convo.id, sender_id: QA, message_type: "text",
      text_content: "Yes — see you at seven.", client_message_id: crypto.randomUUID() }
  ]);
  return convo.id;
}

/** A Plan with participants, which also gives us its Plan Chat. */
async function planWithChat() {
  const { data: existing } = await admin.from("plans")
    .select("id").ilike("title", `${TAG}%`).maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: QA,
    p_request_key: crypto.randomUUID(),
    p_title: `${TAG} dinner`,
    p_description: "Fixture Plan for the detail-surface crawl.",
    p_plan_type: "scheduled",
    p_start_at: new Date(Date.now() + 2 * 3600e3).toISOString(),
    p_end_at: new Date(Date.now() + 4 * 3600e3).toISOString(),
    p_timezone: "Africa/Accra",
    p_rsvp_deadline: null,
    p_place_type: "custom",
    p_custom_place_text: "The usual place",
    p_reminder_minutes: 30,
    p_category: null,
    p_invitee_ids: [KOFI, AMA],
    p_initial_going_ids: [],
    p_source_hangout_id: null,
    p_effective_max_active_plans: 10,
    p_effective_max_participants: 20
  });
  if (error) throw new Error(`plan: ${error.message}`);
  const planId = Array.isArray(data) ? data[0]?.plan_id ?? data[0]?.id : data?.plan_id ?? data?.id;

  // Accept, so the Plan Chat has more than its host in it.
  await admin.rpc("set_plan_participant_rsvp", { p_actor_id: KOFI, p_plan_id: planId, p_status: "going" });
  await admin.rpc("reconcile_plan_conversation_members", { p_plan_id: planId });
  return planId;
}

/** A live, public Event hosted by QA. */
async function liveEvent() {
  const { data: existing } = await admin.from("events")
    .select("id").ilike("name", `${TAG}%`).maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await admin.from("events").insert({
    host_id: QA,
    name: `${TAG} launch night`,
    description: "Fixture Event for the detail-surface crawl.",
    venue_label: "The usual place",
    starts_at: new Date(Date.now() - 3600e3).toISOString(),
    ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
    visibility: "public",
    status: "active"
  }).select("id").maybeSingle();
  if (error) throw new Error(`event: ${error.message}`);

  await admin.from("event_rsvps").insert([
    { event_id: data.id, user_id: KOFI, status: "going" },
    { event_id: data.id, user_id: AMA, status: "going" }
  ]);
  return data.id;
}

const conversationId = await directConversation();
const planId = await planWithChat();
const eventId = await liveEvent();

const { data: planChat } = await admin.from("conversations")
  .select("id").eq("context_type", "plan").eq("context_id", planId).maybeSingle();

console.log(JSON.stringify({
  conversationId,
  planId,
  planChatId: planChat?.id ?? null,
  eventId
}, null, 2));
