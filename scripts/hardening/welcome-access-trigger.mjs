/**
 * Welcome Access starts once, at first_muddy_added, and cannot be restarted.
 *
 * The whole anti-abuse story rests on one partial unique index, so it is worth
 * attacking directly rather than asserting. These checks try to get a second
 * welcome window the ways a real user could: make another Muddy, end and
 * remake the same friendship, and (the DB-level version of "reinstall") insert
 * a second grant row by hand.
 *
 * FIXTURE DISCIPLINE: every write reads its error. `profiles_username_format`
 * rejects hyphens. auth.users rows are left behind deliberately -- deleting one
 * cascades an UPDATE that nulls `domain_events.actor_id`, and domain_events is
 * append-only by design.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}-${stamp}@local.test`, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Welcome`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

const grants = async (id) => {
  const { data, error } = await admin.from("access_grants")
    .select("id,source,starts_at,expires_at,revoked_at").eq("user_id", id).eq("source", "welcome_access");
  if (error) throw new Error(`read grants: ${error.message}`);
  return data ?? [];
};

/** Friendships are keyed on an ordered pair. */
async function befriend(a, b) {
  const [one, two] = [a, b].sort();
  const { error } = await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });
  if (error) throw new Error(`befriend: ${error.message}`);
  return [one, two];
}

async function cleanup() {
  for (const id of made) {
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  const alice = await person("wela");
  const bob = await person("welb");
  const carol = await person("welc");

  check("a brand-new account has NO welcome access",
    (await grants(alice)).length === 0 && (await grants(bob)).length === 0,
    "the clock does not start at signup");

  // --- first muddy -------------------------------------------------------
  const [one, two] = await befriend(alice, bob);
  const aliceGrants = await grants(alice);
  const bobGrants = await grants(bob);

  check("the first Muddy starts welcome access for BOTH people",
    aliceGrants.length === 1 && bobGrants.length === 1,
    `alice=${aliceGrants.length} bob=${bobGrants.length}`);

  const g = aliceGrants[0];
  const days = g ? (new Date(g.expires_at) - new Date(g.starts_at)) / 86400000 : 0;
  check("the window is exactly 14 days", Math.abs(days - 14) < 0.01, `${days.toFixed(3)} days`);

  const firstExpiry = g?.expires_at;

  // --- a SECOND muddy must not restart or extend it -----------------------
  await befriend(alice, carol);
  const after = await grants(alice);
  check("a second Muddy does not create a second welcome window",
    after.length === 1, `${after.length} rows`);
  check("a second Muddy does not extend the original window",
    after[0]?.expires_at === firstExpiry, "same expiry");

  // --- end the friendship and remake it ("delete and re-add") -------------
  await admin.from("friendships").update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", one).eq("user_two_id", two);
  await admin.from("friendships").update({ ended_at: null })
    .eq("user_one_id", one).eq("user_two_id", two);
  const afterReactivate = await grants(alice);
  check("ending and remaking a friendship does not restart the clock",
    afterReactivate.length === 1 && afterReactivate[0].expires_at === firstExpiry,
    "reactivation reuses the row, welcome window untouched");

  // --- the direct attack: insert a second welcome grant -------------------
  const { error: dupErr } = await admin.from("access_grants").insert({
    user_id: alice, source: "welcome_access",
    starts_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    reason: "attempted second welcome"
  });
  check("the database REFUSES a second welcome grant, even from service_role",
    Boolean(dupErr), dupErr ? dupErr.message.slice(0, 58) : "IT WAS ACCEPTED");

  // --- an ended friendship alone must not start a clock -------------------
  const dave = await person("weld");
  const erin = await person("wele");
  const [d1, d2] = [dave, erin].sort();
  const { error: endedErr } = await admin.from("friendships")
    .insert({ user_one_id: d1, user_two_id: d2, ended_at: new Date().toISOString() });
  if (endedErr) throw new Error(`ended friendship: ${endedErr.message}`);
  check("an already-ended friendship does not start welcome access",
    (await grants(dave)).length === 0, "not a Muddy, no clock");

  // --- other sources are unaffected by the welcome index ------------------
  const { error: grantErr } = await admin.from("access_grants").insert({
    user_id: alice, source: "admin_grant",
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    reason: "harness: grants coexist"
  });
  check("a user can hold an admin grant AND welcome access at once",
    !grantErr, grantErr ? grantErr.message.slice(0, 58) : "independent sources coexist");
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 170)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} welcome-access checks passed`);
