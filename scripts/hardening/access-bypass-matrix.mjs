/**
 * ENTITLEMENT BYPASS MATRIX — attacking the access model as a user would.
 *
 * Every check here is an ATTACK, run as the `authenticated` role through RLS,
 * the way a hostile client with a real session reaches the database. The
 * service-role client is used only to build fixtures and to verify outcomes.
 *
 * The single property under test: a user may READ their access and may never
 * WRITE it. If any of these succeeds, the entitlement model is decorative.
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const CONTAINER = "supabase_db_mad-buddy";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const DAY = 86400000;
const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

/**
 * Run SQL and return stdout AND stderr together.
 *
 * `raise notice` goes to STDERR, not stdout. An earlier version read only
 * stdout and reported "no result parsed" for every probe -- which defaulted to
 * `denied: true` and made every attack LOOK refused whether it was or not. A
 * bypass harness that passes when it cannot see the answer is worse than no
 * harness, so the streams are merged and a missing result is now a failure.
 */
/** Runs SQL and returns stdout + stderr, so NOTICE output is visible. */
function runCapturing(sql) {
  /* spawnSync, not execFileSync: psql EXITS ZERO here, so execFileSync never
     throws and its stderr -- where every `raise notice` lands -- was being
     discarded. spawnSync hands back both streams unconditionally. */
  const r = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q", "-A", "-t"],
    { input: sql, encoding: "utf8", maxBuffer: 1 << 24 }
  );
  return `${r.stdout ?? ""}
${r.stderr ?? ""}`;
}

/**
 * Run SQL as a real authenticated user through RLS, and report whether it was
 * DENIED. A statement that changes zero rows counts as denied: RLS silently
 * filters rather than erroring on UPDATE, and "changed nothing" is the
 * outcome that matters.
 */
function attack(userId, sql) {
  const out = runCapturing(`
do $$
declare v_msg text; v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','${userId}','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    ${sql}
    get diagnostics v_rows = row_count;
    raise notice 'RESULT|allowed|%', v_rows;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    raise notice 'RESULT|denied|%', left(replace(v_msg, '|', ' '), 60);
  end;
  reset role;
end $$;`);
  const m = out.match(/RESULT\|(allowed|denied)\|(.*)/);
  /* NOT parsing a result is a HARNESS FAILURE, never a pass. Defaulting to
     "denied" here would make an unreadable probe indistinguishable from a
     refused attack. */
  if (!m) return { denied: false, detail: "HARNESS: no result parsed" };
  if (m[1] === "denied") return { denied: true, detail: m[2].trim() };
  const rows = Number(m[2].trim());
  return { denied: rows === 0, detail: rows === 0 ? "0 rows changed" : `${rows} ROWS CHANGED` };
}

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}-${stamp}@local.test`, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Bypass`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

const hasAccess = async (id) => {
  const nowIso = new Date().toISOString();
  const { data } = await admin.from("access_grants").select("id").eq("user_id", id)
    .is("revoked_at", null).lte("starts_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  return (data ?? []).length > 0;
};

async function cleanup() {
  await admin.from("access_global_windows").delete().like("reason", "bypass harness%");
  for (const id of made) {
    await admin.from("access_reminder_log").delete().eq("user_id", id);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("subscriptions").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  const attacker = await person("bypa");
  const victim = await person("bypv");

  // The attacker starts with an EXPIRED welcome window.
  const { data: expiredGrant, error: gErr } = await admin.from("access_grants").insert({
    user_id: attacker, source: "welcome_access",
    starts_at: new Date(Date.now() - 20 * DAY).toISOString(),
    expires_at: new Date(Date.now() - 6 * DAY).toISOString(),
    reason: "bypass harness expired"
  }).select("id").maybeSingle();
  if (gErr) throw new Error(`grant: ${gErr.message}`);

  check("baseline: the attacker starts with NO access", !(await hasAccess(attacker)));

  // ---- 1. self-grant ----------------------------------------------------
  let r = attack(attacker, `insert into public.access_grants (user_id, source, expires_at, reason)
      values ('${attacker}', 'admin_grant', now() + interval '1 year', 'self granted');`);
  check("cannot INSERT a grant for themselves", r.denied, r.detail);

  r = attack(attacker, `insert into public.access_grants (user_id, source, expires_at, reason)
      values ('${attacker}', 'welcome_access', now() + interval '14 days', 'second welcome');`);
  check("cannot INSERT a second welcome window", r.denied, r.detail);

  // ---- 2. extend their own expiry --------------------------------------
  r = attack(attacker, `update public.access_grants set expires_at = now() + interval '1 year'
      where id = '${expiredGrant.id}';`);
  check("cannot UPDATE their own expires_at", r.denied, r.detail);
  check("...and the expiry really is unchanged", !(await hasAccess(attacker)), "still expired");

  // ---- 3. un-revoke ------------------------------------------------------
  const { data: revoked } = await admin.from("access_grants").insert({
    user_id: attacker, source: "admin_grant",
    expires_at: new Date(Date.now() + 30 * DAY).toISOString(),
    revoked_at: new Date().toISOString(), revoked_by: attacker,
    reason: "bypass harness revoked"
  }).select("id").maybeSingle();
  r = attack(attacker, `update public.access_grants set revoked_at = null, revoked_by = null
      where id = '${revoked.id}';`);
  check("cannot un-revoke a revoked grant", r.denied, r.detail);

  // ---- 4. delete an inconvenient record ---------------------------------
  r = attack(attacker, `delete from public.access_grants where id = '${expiredGrant.id}';`);
  check("cannot DELETE their own expired grant", r.denied, r.detail);

  // ---- 5. grant themselves via someone else's row -----------------------
  r = attack(attacker, `insert into public.access_grants (user_id, source, expires_at, reason)
      values ('${victim}', 'admin_grant', now() + interval '1 year', 'granting a stranger');`);
  check("cannot grant access to ANOTHER user", r.denied, r.detail);

  // ---- 6. open a global promotion ---------------------------------------
  r = attack(attacker, `insert into public.access_global_windows (created_by, reason, expires_at)
      values ('${attacker}', 'bypass harness self promo', now() + interval '1 year');`);
  check("cannot open a global promotion", r.denied, r.detail);

  // ---- 7. claim a paid subscription -------------------------------------
  r = attack(attacker, `insert into public.subscriptions (user_id, plan, status, provider, current_period_end)
      values ('${attacker}', 'buddy_pro', 'active', 'paystack', now() + interval '1 year');`);
  check("cannot fabricate a paid subscription", r.denied, r.detail);

  r = attack(attacker, `update public.subscriptions set status = 'active'
      where user_id = '${attacker}';`);
  check("cannot flip a subscription to active", r.denied, r.detail);

  // ---- 8. forge the launch record ---------------------------------------
  r = attack(attacker, `insert into public.access_launch (launched_at, welcome_days, note)
      values (now(), 365, 'forged launch');`);
  check("cannot forge the monetization launch record", r.denied, r.detail);

  // ---- 9. call the privileged functions directly ------------------------
  r = attack(attacker, `perform public.launch_welcome_access_for_existing_users();`);
  check("cannot call the launch backfill function", r.denied, r.detail);

  r = attack(attacker, `perform public.start_welcome_access();`);
  check("cannot call the welcome-access trigger function", r.denied, r.detail);

  // ---- 10. forge a reminder record to suppress warnings ------------------
  r = attack(attacker, `insert into public.access_reminder_log (grant_id, user_id, milestone)
      values ('${expiredGrant.id}', '${attacker}', 'welcome_t1');`);
  check("cannot write the reminder ledger", r.denied, r.detail);

  // ---- 11. read someone else's access -----------------------------------
  const out = runCapturing(`
do $$
declare v_n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','${attacker}','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into v_n from public.access_grants where user_id = '${victim}';
  raise notice 'RESULT|allowed|%', v_n;
  reset role;
end $$;`);
  const seen = Number((out.match(/RESULT\|allowed\|(\d+)/) ?? [])[1] ?? -1);
  check("cannot READ another user's grants", seen === 0, `saw ${seen} rows`);

  // ---- 12. after every attack, still no access --------------------------
  check("AFTER ALL ATTACKS: the attacker still has no access",
    !(await hasAccess(attacker)), "the model held");

  // ---- 13. anonymous ----------------------------------------------------
  const anon = runCapturing(`
do $$
declare v_n integer; v_msg text;
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role','anon', true);
  begin
    select count(*) into v_n from public.access_grants;
    raise notice 'RESULT|allowed|%', v_n;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    raise notice 'RESULT|denied|%', left(v_msg, 40);
  end;
  reset role;
end $$;`);
  const anonRows = Number((anon.match(/RESULT\|allowed\|(\d+)/) ?? [])[1] ?? 0);
  check("a signed-out client sees no grants at all", anonRows === 0, `${anonRows} rows`);
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 180)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} bypass attempts correctly refused`);
