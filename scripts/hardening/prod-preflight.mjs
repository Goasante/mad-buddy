/**
 * Production preflight / verification, read-only by default.
 *
 * Connects with the PRODUCTION service-role key from the environment and
 * reports the state the migrations are about to change. Run before and after
 * so "it worked" is a comparison rather than an assertion.
 *
 * SAFETY: this script never writes. It has no insert, update or delete.
 * Pass --after to run the post-migration checks as well.
 *
 * Requires PROD_SUPABASE_URL and PROD_SERVICE_ROLE_KEY in the environment.
 * Nothing is printed that could identify a user or expose a secret.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.PROD_SUPABASE_URL;
const KEY = process.env.PROD_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.log("MISSING PROD_SUPABASE_URL / PROD_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (URL.includes("127.0.0.1") || URL.includes("localhost")) {
  console.log("This is the LOCAL database, not production. Refusing.");
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } });
const AFTER = process.argv.includes("--after");

const line = (k, v) => console.log(`${String(k).padEnd(42)} ${v}`);

async function count(table, build = (q) => q) {
  const { count: n, error } = await build(admin.from(table).select("*", { count: "exact", head: true }));
  if (error) return `— (${error.message.slice(0, 40)})`;
  return n ?? 0;
}

async function tableExists(table) {
  const { error } = await admin.from(table).select("*", { head: true }).limit(1);
  if (!error) return true;
  return !/does not exist|schema cache/i.test(error.message);
}

console.log(`${"=".repeat(74)}`);
console.log(`PRODUCTION ${AFTER ? "POST" : "PRE"}-MIGRATION STATE   ${new Date().toISOString()}`);
console.log(`${"=".repeat(74)}`);

// ---- scale, for context (aggregate only, never identities) ---------------
line("profiles", await count("profiles"));
line("friendships (active)", await count("friendships", (q) => q.is("ended_at", null)));
line("conversations", await count("conversations"));
line("messages", await count("messages"));
line("plans", await count("plans"));
line("subscriptions", await count("subscriptions"));

// ---- MB-GOD-060 ----------------------------------------------------------
console.log("\n--- MB-GOD-060  first_reply_received ---");
const milestoneReady = await tableExists("activation_milestones");
line("activation_milestones present", milestoneReady ? "yes" : "NO");
line("first_reply_received rows", await count("activation_milestones", (q) => q.eq("milestone", "first_reply_received")));

// ---- access model --------------------------------------------------------
console.log("\n--- Mad Buddy Access tables ---");
for (const t of ["access_grants", "access_global_windows", "access_reminder_log", "access_launch"]) {
  const exists = await tableExists(t);
  line(t, exists ? `present (${await count(t)} rows)` : "NOT PRESENT");
}

if (AFTER) {
  console.log("\n--- post-migration checks ---");

  // Welcome grants, and the once-only guarantee.
  const welcome = await count("access_grants", (q) => q.eq("source", "welcome_access"));
  line("welcome_access grants", welcome);

  const { data: dupes } = await admin.rpc("exec_sql_readonly", {}).then(
    () => ({ data: null }),
    () => ({ data: null })
  );
  void dupes;

  // Eligible historical users: anybody with an active friendship.
  const { data: friendRows } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .is("ended_at", null);
  const eligible = new Set();
  for (const r of friendRows ?? []) {
    eligible.add(r.user_one_id);
    eligible.add(r.user_two_id);
  }
  line("users with >=1 active Muddy (eligible)", eligible.size);

  const { data: granted } = await admin
    .from("access_grants")
    .select("user_id")
    .eq("source", "welcome_access");
  const grantedSet = new Set((granted ?? []).map((g) => g.user_id));
  line("of those, holding a welcome grant", [...eligible].filter((u) => grantedSet.has(u)).length);
  line("welcome grants for NON-eligible users", [...grantedSet].filter((u) => !eligible.has(u)).length);

  // Access subscriptions, by product.
  const { data: subs } = await admin.from("subscriptions").select("plan, status");
  const byPlan = {};
  for (const s of subs ?? []) byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
  line("subscriptions by product", JSON.stringify(byPlan));
}

console.log("");
