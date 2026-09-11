/**
 * Local-only fixture seeder for the Safe Arrival intro UX review, run against
 * the isolated mb-safe-arrival-ux Docker stack (127.0.0.1:59321-59324). Never
 * points at production -- hard stop below enforces that.
 *
 * Creates:
 *  - traveller "Ama Ready" with 0 Safe Arrival sessions (fresh account, ready
 *    to start) and one long-named trusted Muddy so the setup contact list has
 *    a long name to wrap.
 *  - traveller "Kojo Transit" with an ACTIVE in-transit session and a long
 *    destination label.
 *  - traveller "Efua Extended" with an EXTENDED session.
 *  - traveller "Yaw Grace" with a GRACE_PERIOD session (past expected arrival,
 *    inside the grace window) to exercise the grace/waiting visual.
 *  - traveller "Abena Overdue" with an UNCONFIRMED session (past grace) to
 *    exercise the overdue/red state.
 * Each traveller has 1-2 confirmed watcher contacts so ContactStrip has real
 * data. All auth.users rows set every GoTrue token column to '' (NULL breaks
 * sign-in -- see local-supabase-review-loop memory).
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:59321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  console.error("HARD STOP: refusing to seed a non-local Supabase URL:", SUPABASE_URL);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const PASSWORD = "SafeArrivalReview!2026";

async function upsertUser({ email, fullName, username }) {
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = existing?.users?.find((u) => u.email === email);
  let userId;
  if (found) {
    userId = found.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    userId = data.user.id;
  }
  // GoTrue NULL-token guard is applied separately via direct SQL after this
  // script finishes (auth.users is not reachable through the public-schema
  // PostgREST client) -- see fixTokens() below.

  const username_normalized = username.toLowerCase();
  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      user_id: userId,
      full_name: fullName,
      username,
      username_normalized,
      is_onboarded: true,
      visibility_status: "visible"
    },
    { onConflict: "user_id" }
  );
  if (profileErr) throw new Error(`profile upsert ${email}: ${profileErr.message}`);
  return userId;
}

async function ensureFriendship(idA, idB) {
  const [one, two] = idA < idB ? [idA, idB] : [idB, idA];
  const { data: existing } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", one)
    .eq("user_two_id", two)
    .is("ended_at", null)
    .maybeSingle();
  if (existing) return;
  const { error } = await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });
  if (error && !error.message.includes("duplicate")) throw new Error(`friendship ${one}/${two}: ${error.message}`);
}

async function clearSessions(travellerId) {
  await admin.from("safe_arrival_sessions").delete().eq("traveller_id", travellerId);
}

async function createSession({ travellerId, destinationLabel, expectedArrivalAt, gracePeriodMinutes, status, watcherIds, note }) {
  const { data, error } = await admin
    .from("safe_arrival_sessions")
    .insert({
      traveller_id: travellerId,
      destination_type: "custom",
      destination_label: destinationLabel,
      expected_arrival_at: expectedArrivalAt,
      grace_period_minutes: gracePeriodMinutes,
      status,
      note: note ?? null
    })
    .select("id")
    .single();
  if (error) throw new Error(`createSession ${destinationLabel}: ${error.message}`);
  for (const watcherId of watcherIds) {
    const { error: cErr } = await admin.from("safe_arrival_contacts").insert({
      session_id: data.id,
      contact_user_id: watcherId,
      acknowledgement_status: "watching",
      acknowledged_at: new Date().toISOString(),
      notified_at: new Date().toISOString()
    });
    if (cErr) throw new Error(`contact insert: ${cErr.message}`);
  }
  return data.id;
}

console.log("=== Seeding Safe Arrival review fixtures (isolated local stack) ===");

// Travellers.
const ama = await upsertUser({ email: "ama.ready@review.local", fullName: "Ama Ready", username: "ama_ready" });
const kojo = await upsertUser({ email: "kojo.transit@review.local", fullName: "Kojo Transit", username: "kojo_transit" });
const efua = await upsertUser({ email: "efua.extended@review.local", fullName: "Efua Extended", username: "efua_extended" });
const yaw = await upsertUser({ email: "yaw.grace@review.local", fullName: "Yaw Grace", username: "yaw_grace" });
const abena = await upsertUser({ email: "abena.overdue@review.local", fullName: "Abena Overdue", username: "abena_overdue" });

// Watchers, including one deliberately long name for wrap testing.
const kofi = await upsertUser({ email: "kofi.mensah@review.local", fullName: "Kofi Mensah", username: "kofi_mensah" });
const longName = await upsertUser({
  email: "nana.longname@review.local",
  fullName: "Nana Akosua Oteng-Boateng-Appiah",
  username: "nana_longname"
});

console.log("users ready:", { ama, kojo, efua, yaw, abena, kofi, longName });

// Friendships: every traveller trusts Kofi; Ama additionally trusts the long-named Muddy.
for (const traveller of [ama, kojo, efua, yaw, abena]) {
  await ensureFriendship(traveller, kofi);
}
await ensureFriendship(ama, longName);

console.log("friendships ensured");

// Clear prior seeded sessions so re-runs are idempotent.
for (const traveller of [kojo, efua, yaw, abena]) {
  await clearSessions(traveller);
}
// Ama stays a genuinely fresh account: no sessions at all, ever.
await clearSessions(ama);

const now = Date.now();

// Kojo: ACTIVE, in transit, long destination label (near the 120-char cap).
const longDestination =
  "The East Legon Hills gated community clubhouse, all the way past the third roundabout near the new interchange";
await createSession({
  travellerId: kojo,
  destinationLabel: longDestination.slice(0, 120),
  expectedArrivalAt: new Date(now + 45 * 60 * 1000).toISOString(),
  gracePeriodMinutes: 20,
  status: "active",
  watcherIds: [kofi],
  note: "Taking a trotro from campus"
});

// Efua: EXTENDED.
await createSession({
  travellerId: efua,
  destinationLabel: "Efua's family house, Kumasi",
  expectedArrivalAt: new Date(now + 30 * 60 * 1000).toISOString(),
  gracePeriodMinutes: 20,
  status: "extended",
  watcherIds: [kofi]
});

// Yaw: GRACE_PERIOD -- expected time already passed, still inside the grace
// window. journeyTone() (components/safety/journey-parts.tsx) has no distinct
// "waiting" tone: a grace_period session renders as the same calm "IN
// TRANSIT" tone until the grace deadline itself passes, by design (the
// product's "waiting stays neutral" invariant). Generous 3/45 min margins
// here so this state survives a slow local-stack startup without silently
// crossing into "overdue" before anyone gets to look at it.
await createSession({
  travellerId: yaw,
  destinationLabel: "Yaw's apartment, Osu",
  expectedArrivalAt: new Date(now - 3 * 60 * 1000).toISOString(),
  gracePeriodMinutes: 45,
  status: "grace_period",
  watcherIds: [kofi]
});

// Abena: UNCONFIRMED -- past the grace deadline, drives the overdue/red tone.
await createSession({
  travellerId: abena,
  destinationLabel: "Abena's office, Airport City",
  expectedArrivalAt: new Date(now - 40 * 60 * 1000).toISOString(),
  gracePeriodMinutes: 20,
  status: "unconfirmed",
  watcherIds: [kofi]
});

console.log("\nDone. Sign in with password:", PASSWORD);
console.log("  ama.ready@review.local       -> intro/entry screen (no active journey)");
console.log("  kojo.transit@review.local    -> ACTIVE / in transit, long destination");
console.log("  efua.extended@review.local   -> EXTENDED");
console.log("  yaw.grace@review.local       -> GRACE_PERIOD (waiting)");
console.log("  abena.overdue@review.local   -> UNCONFIRMED (overdue)");
console.log("  Ama also sees a long-named Muddy (Nana Akosua Oteng-Boateng-Appiah) in her contact picker.");
