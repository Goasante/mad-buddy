/**
 * Local test fixture for the hardening program. LOCAL SUPABASE ONLY.
 *
 * Creates a small but REPRESENTATIVE cast rather than one lonely account,
 * because most of the defects this program hunts (wrong destination, wrong
 * person's data, membership leaks, empty vs populated states) only appear when
 * more than one user exists and they are related to each other.
 *
 * Users are created with admin.createUser({ email_confirm: true }) — never
 * auth.signUp, which sends a rate-limited confirmation email and produces the
 * "wrong password after signup" failure mode.
 */
import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!URL.includes("127.0.0.1")) throw new Error("refusing to seed a non-local database");

const PASSWORD = "HardeningPass123!";
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

/** The cast. `qa` is the account every probe signs in as. */
const PEOPLE = [
  { email: "qa@local.test",   username: "qatester", full_name: "QA Tester",   bio: "Primary hardening account.", mood_status: "Exploring" },
  { email: "kofi@local.test", username: "kofim",    full_name: "Kofi Mensah", bio: "Muddy of QA.",              mood_status: "Up for food" },
  { email: "ama@local.test",  username: "amab",     full_name: "Ama Boateng", bio: "Muddy of QA.",              mood_status: "Studying" },
  { email: "jojo@local.test", username: "jojoa",    full_name: "Jojo Addo",   bio: "Pending request sender.",   mood_status: "" },
  // Deliberately sparse: proves empty/incomplete-profile states render.
  { email: "saa@local.test",  username: "saao",     full_name: "Saa Owusu",   bio: "",                          mood_status: "" }
];

const ids = {};

for (const person of PEOPLE) {
  const { data, error } = await admin.auth.admin.createUser({
    email: person.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: person.full_name, username: person.username }
  });
  if (error) { console.log(`user ${person.email}: ${error.message}`); continue; }
  ids[person.username] = data.user.id;

  // A trigger may already have inserted the profile row; upsert either way.
  const { error: pErr } = await admin.from("profiles").upsert({
    user_id: data.user.id,
    username: person.username,
    full_name: person.full_name,
    bio: person.bio || null,
    mood_status: person.mood_status || null
  }, { onConflict: "user_id" });
  console.log(`user ${person.email} -> ${data.user.id}${pErr ? ` (profile: ${pErr.message})` : ""}`);
}

/** Friendships are stored one row per pair with user_one_id < user_two_id. */
async function befriend(a, b) {
  if (!ids[a] || !ids[b]) return;
  const [one, two] = [ids[a], ids[b]].sort();
  const { error } = await admin.from("friendships").upsert(
    { user_one_id: one, user_two_id: two, ended_at: null },
    { onConflict: "user_one_id,user_two_id" }
  );
  console.log(`friendship ${a}<->${b}${error ? `: ${error.message}` : " ok"}`);
}

await befriend("qatester", "kofim");
await befriend("qatester", "amab");

console.log("\nsigned-in account: qa@local.test / " + PASSWORD);
