/**
 * Welcome Access reminders: idempotent, non-spammy, and never wrong.
 *
 * Mirrors the job's queries against real rows (the job is a server-only TS
 * module). The properties under test are the ones that make an interruption
 * defensible:
 *
 *   it fires only at the milestones, not every day
 *   running it twice sends one notification, not two
 *   it never warns somebody whose access is not actually ending
 *
 * That last one is the reminder-side consequence of access sources being
 * independent: a paying customer whose welcome window happens to lapse is not
 * losing anything, and telling them "your access ends tomorrow" would be a lie.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const DAY = 86400000;
const MILESTONES = [
  { key: "welcome_t4", daysRemaining: 4 },
  { key: "welcome_t1", daysRemaining: 1 }
];
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
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Remind`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

async function welcomeGrant(userId, expiresInMs) {
  const { data, error } = await admin.from("access_grants").insert({
    user_id: userId, source: "welcome_access",
    starts_at: new Date(Date.now() - 10 * DAY).toISOString(),
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    reason: "reminder harness"
  }).select("id").maybeSingle();
  if (error) throw new Error(`grant: ${error.message}`);
  return data.id;
}

const daysRemaining = (iso, now) => {
  const ms = Date.parse(iso) - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY);
};

/** The job's logic, mirrored. Returns how many notifications it would send. */
async function runReminders(now = new Date()) {
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() + 4 * DAY).toISOString();
  const { data: grants } = await admin
    .from("access_grants").select("id, user_id, expires_at")
    .eq("source", "welcome_access").is("revoked_at", null)
    .gt("expires_at", nowIso).lte("expires_at", horizon);

  let sent = 0, skippedOther = 0, skippedDupe = 0;
  for (const g of grants ?? []) {
    if (!g.expires_at) continue;
    const milestone = MILESTONES.find((m) => m.daysRemaining === daysRemaining(g.expires_at, now));
    if (!milestone) continue;

    const [{ data: others }, { data: windows }, { data: sub }] = await Promise.all([
      admin.from("access_grants").select("id").eq("user_id", g.user_id)
        .neq("source", "welcome_access").is("revoked_at", null).lte("starts_at", nowIso)
        .or(`expires_at.is.null,expires_at.gt.${g.expires_at}`).limit(1),
      admin.from("access_global_windows").select("id").is("revoked_at", null)
        .lte("starts_at", nowIso).or(`expires_at.is.null,expires_at.gt.${g.expires_at}`).limit(1),
      admin.from("subscriptions").select("id").eq("user_id", g.user_id)
        .in("status", ["active", "trialing"]).limit(1).maybeSingle()
    ]);
    if ((others ?? []).length || (windows ?? []).length || sub) { skippedOther += 1; continue; }

    const { error } = await admin.from("access_reminder_log")
      .insert({ grant_id: g.id, user_id: g.user_id, milestone: milestone.key });
    if (error) { skippedDupe += 1; continue; }
    sent += 1;
  }
  return { sent, skippedOther, skippedDupe };
}

const logCount = async (userId) => {
  const { data } = await admin.from("access_reminder_log").select("id,milestone").eq("user_id", userId);
  return data ?? [];
};

async function cleanup() {
  await admin.from("access_global_windows").delete().like("reason", "reminder harness%");
  for (const id of made) {
    await admin.from("access_reminder_log").delete().eq("user_id", id);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("notifications").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  // ---- only fires at the milestones -------------------------------------
  const day7 = await person("rem7");
  await welcomeGrant(day7, 7 * DAY);
  let run = await runReminders();
  check("7 days out: no reminder (outside the window)",
    (await logCount(day7)).length === 0, "silence for most of the 14 days");

  const day4 = await person("rem4");
  await welcomeGrant(day4, 4 * DAY - 3600000);
  await runReminders();
  const d4 = await logCount(day4);
  check("4 days out: exactly one reminder", d4.length === 1 && d4[0].milestone === "welcome_t4", d4.map(r=>r.milestone).join(","));

  const day3 = await person("rem3");
  await welcomeGrant(day3, 3 * DAY - 3600000);
  await runReminders();
  check("3 days out: NO reminder (day 12 deliberately dropped)",
    (await logCount(day3)).length === 0, "two reminders, not four");

  const day1 = await person("rem1");
  await welcomeGrant(day1, 1 * DAY - 3600000);
  await runReminders();
  const d1 = await logCount(day1);
  check("1 day out: exactly one reminder", d1.length === 1 && d1[0].milestone === "welcome_t1", d1.map(r=>r.milestone).join(","));

  // ---- IDEMPOTENCY ------------------------------------------------------
  const before = (await logCount(day4)).length;
  await runReminders();
  await runReminders();
  await runReminders();
  check("running the job three more times sends nothing new",
    (await logCount(day4)).length === before, "the dedupe ledger holds");

  // ---- overlapping runs, concurrently -----------------------------------
  const conc = await person("remc");
  await welcomeGrant(conc, 4 * DAY - 3600000);
  await Promise.all([runReminders(), runReminders(), runReminders()]);
  check("three CONCURRENT runs send exactly one reminder",
    (await logCount(conc)).length === 1,
    `${(await logCount(conc)).length} rows — a unique constraint, not a check-then-act`);

  // ---- never warn somebody whose access is not ending --------------------
  const paid = await person("remp");
  await welcomeGrant(paid, 4 * DAY - 3600000);
  const { error: agErr } = await admin.from("access_grants").insert({
    user_id: paid, source: "admin_grant",
    starts_at: new Date(Date.now() - DAY).toISOString(),
    expires_at: new Date(Date.now() + 90 * DAY).toISOString(),
    reason: "reminder harness: other access"
  });
  if (agErr) throw new Error(`admin grant: ${agErr.message}`);
  const runPaid = await runReminders();
  check("a user with OTHER access gets no expiry warning",
    (await logCount(paid)).length === 0,
    `their welcome window lapses but their access does not — skipped ${runPaid.skippedOther}`);

  // ---- global promo suppresses the warning too --------------------------
  const glob = await person("remg");
  await welcomeGrant(glob, 4 * DAY - 3600000);
  const { data: win, error: wErr } = await admin.from("access_global_windows").insert({
    created_by: glob, reason: "reminder harness global",
    expires_at: new Date(Date.now() + 60 * DAY).toISOString()
  }).select("id").maybeSingle();
  if (wErr) throw new Error(`window: ${wErr.message}`);
  await runReminders();
  check("during a global promotion, nobody is warned their access is ending",
    (await logCount(glob)).length === 0, "the promotion outlives their window");
  await admin.from("access_global_windows").delete().eq("id", win.id);

  // ---- a revoked grant is never reminded about ---------------------------
  const rev = await person("remr");
  const revId = await welcomeGrant(rev, 4 * DAY - 3600000);
  await admin.from("access_grants").update({ revoked_at: new Date().toISOString(), revoked_by: rev }).eq("id", revId);
  await runReminders();
  check("a revoked welcome grant produces no reminder",
    (await logCount(rev)).length === 0, "revoked_at is honoured");
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 180)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} reminder checks passed`);
