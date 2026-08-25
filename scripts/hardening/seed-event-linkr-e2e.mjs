/**
 * Prepare the four controlled identities for the real Event -> Linkr UI pass.
 * LOCAL SUPABASE ONLY. The Event itself is deliberately NOT seeded: Playwright
 * must create and publish it through the product UI.
 */
import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "HardeningPass123!";
const REASON = "Event Linkr local Playwright fixture";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAf3fJd0AAAAASUVORK5CYII=",
  "base64"
);

if (!URL.includes("127.0.0.1")) throw new Error("refusing to seed a non-local database");
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const people = [
  { role: "Host", email: "qa@local.test", username: "qatester", name: "QA Host", lat: 5.6508, lng: -0.1869 },
  { role: "Attendee A", email: "kofi@local.test", username: "kofim", name: "Kofi Mensah", lat: 5.6510, lng: -0.1868 },
  { role: "Attendee B", email: "ama@local.test", username: "amab", name: "Ama Boateng", lat: 5.6511, lng: -0.1867 },
  { role: "Outsider", email: "saa@local.test", username: "saao", name: "Saa Owusu", lat: 5.6550, lng: -0.1900 }
];

const ids = new Map();
for (const person of people) {
  const { data: profile, error: findError } = await admin
    .from("profiles")
    .select("user_id")
    .eq("username", person.username)
    .maybeSingle();
  if (findError || !profile) throw new Error(`${person.role}: local profile missing`);
  const id = profile.user_id;
  ids.set(person.role, id);

  const { error: passwordError } = await admin.auth.admin.updateUserById(id, {
    password: PASSWORD,
    email_confirm: true
  });
  if (passwordError) throw new Error(`${person.role} auth: ${passwordError.message}`);

  await admin.storage.createBucket("avatars", { public: true }).catch(() => {});
  const objectPath = `${id}/event-linkr-e2e.png`;
  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(objectPath, PNG, { contentType: "image/png", upsert: true });
  if (uploadError) throw new Error(`${person.role} avatar: ${uploadError.message}`);
  const avatarUrl = `${URL}/storage/v1/object/public/avatars/${objectPath}`;

  const { error: profileError } = await admin.from("profiles").update({
    full_name: person.name,
    avatar_url: avatarUrl,
    is_onboarded: true,
    visibility_status: "visible",
    deleted_at: null
  }).eq("user_id", id);
  if (profileError) throw new Error(`${person.role} profile: ${profileError.message}`);

  const { error: birthError } = await admin.from("profile_birth_details").upsert(
    { user_id: id, date_of_birth: "1995-06-15" },
    { onConflict: "user_id" }
  );
  if (birthError) throw new Error(`${person.role} birth date: ${birthError.message}`);

  const { error: locationError } = await admin.from("user_locations").upsert({
    user_id: id,
    latitude: person.lat,
    longitude: person.lng,
    accuracy: 20,
    confidence: "high",
    last_updated: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (locationError) throw new Error(`${person.role} location: ${locationError.message}`);

  const { error: linkrError } = await admin.from("linkr_profiles").upsert({
    user_id: id,
    enabled: person.role !== "Outsider",
    intent: "friends",
    discovery_distance: "around_you",
    require_photos: false,
    only_active_now: false,
    only_new_today: false,
    event_mode_enabled: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (linkrError) throw new Error(`${person.role} Linkr profile: ${linkrError.message}`);

  const { data: activeGrant } = await admin.from("access_grants")
    .select("id")
    .eq("user_id", id)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1)
    .maybeSingle();
  if (!activeGrant) {
    const { error: grantError } = await admin.from("access_grants").insert({
      user_id: id,
      source: "admin_grant",
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      reason: REASON,
      metadata: { local_fixture: true }
    });
    if (grantError) throw new Error(`${person.role} access: ${grantError.message}`);
  }
}

// Repeated local diagnostic runs must not consume the controlled fixture's
// real anti-abuse budget. This is scoped to the four named local users; the
// product rules and every other account remain untouched.
const { error: rateLimitError } = await admin.from("rate_limits")
  .delete()
  .in("user_id", [...ids.values()]);
if (rateLimitError) throw new Error(`local rate-limit reset: ${rateLimitError.message}`);

const attendeeA = ids.get("Attendee A");
const attendeeB = ids.get("Attendee B");
const [low, high] = [attendeeA, attendeeB].sort();

await admin.from("blocked_users").delete()
  .or(`and(blocker_id.eq.${attendeeA},blocked_id.eq.${attendeeB}),and(blocker_id.eq.${attendeeB},blocked_id.eq.${attendeeA})`);
await admin.from("linkr_actions").delete()
  .or(`and(actor_id.eq.${attendeeA},target_id.eq.${attendeeB}),and(actor_id.eq.${attendeeB},target_id.eq.${attendeeA})`);

const { data: oldConnection } = await admin.from("linkr_connections")
  .select("conversation_id")
  .eq("user_low", low)
  .eq("user_high", high)
  .maybeSingle();
await admin.from("linkr_connections").delete().eq("user_low", low).eq("user_high", high);

const directKey = `${low}:${high}`;
const { data: oldConversations } = await admin.from("conversations")
  .select("id")
  .or(`direct_key.eq.${directKey},id.eq.${oldConnection?.conversation_id ?? "00000000-0000-0000-0000-000000000000"}`);
for (const conversation of oldConversations ?? []) {
  await admin.from("messages").delete().eq("conversation_id", conversation.id);
  await admin.from("conversation_members").delete().eq("conversation_id", conversation.id);
  await admin.from("conversations").delete().eq("id", conversation.id);
}

const { data: oldEvents } = await admin.from("events")
  .select("id")
  .ilike("name", "Playwright Event %");
for (const event of oldEvents ?? []) {
  await admin.from("event_linkr_opt_ins").delete().eq("event_id", event.id);
  await admin.from("check_ins").delete().eq("context_id", event.id);
  await admin.from("event_rsvps").delete().eq("event_id", event.id);
  await admin.from("events").delete().eq("id", event.id);
}

console.log(JSON.stringify({
  password: PASSWORD,
  identities: Object.fromEntries(ids),
  clearedTaggedEvents: oldEvents?.length ?? 0,
  clearedAttendeePair: `${low}:${high}`
}, null, 2));
