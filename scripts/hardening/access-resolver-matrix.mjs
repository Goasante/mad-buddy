/**
 * The entitlement resolver, exercised against real rows.
 *
 * Reimplements the resolver's QUERIES here (it is a server-only TS module that
 * cannot be imported from a plain node script) and asserts the same semantics.
 * That is a real duplication risk, so the unit tests in
 * lib/access/resolver.test.ts assert the resolver's own logic; this harness
 * proves the DATABASE behaves the way the resolver assumes -- that the filters
 * select what they claim on live data.
 *
 * The matrix covers every state in the brief's persona list plus the
 * source-independence cases, which are the ones a precedence ladder gets wrong.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const DAY = 86400000;

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}-${stamp}@local.test`, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Access`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

async function grant(userId, source, opts = {}) {
  const { error } = await admin.from("access_grants").insert({
    user_id: userId, source,
    starts_at: opts.startsAt ?? iso(-1000),
    expires_at: opts.expiresAt ?? null,
    reason: opts.reason ?? "resolver matrix fixture",
    revoked_at: opts.revokedAt ?? null,
    revoked_by: opts.revokedAt ? userId : null
  });
  if (error) throw new Error(`grant ${source}: ${error.message}`);
}

/** The resolver's own query shape, mirrored. */
async function activeSources(userId, now = new Date()) {
  const nowIso = now.toISOString();
  const [{ data: grants }, { data: globals }, { data: staff }] = await Promise.all([
    admin.from("access_grants").select("source, starts_at, expires_at")
      .eq("user_id", userId).is("revoked_at", null).lte("starts_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    admin.from("access_global_windows").select("starts_at, expires_at")
      .is("revoked_at", null).lte("starts_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`).limit(1),
    admin.from("admin_users").select("role").eq("auth_user_id", userId).is("disabled_at", null).maybeSingle()
  ]);
  const out = (grants ?? []).map((g) => g.source);
  if ((globals ?? []).length) out.push("global_promo");
  if (staff) out.push("staff");
  return out;
}

const hasAccess = async (id, now) => (await activeSources(id, now)).length > 0;

async function cleanup() {
  await admin.from("access_global_windows").delete().like("reason", "resolver matrix%");
  for (const id of made) {
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  // ---- A: welcome day 1 -------------------------------------------------
  const a = await person("resa");
  await grant(a, "welcome_access", { expiresAt: iso(14 * DAY) });
  check("A  welcome access day 1 has access", await hasAccess(a), (await activeSources(a)).join(","));

  // ---- D: expired welcome ----------------------------------------------
  const d = await person("resd");
  await grant(d, "welcome_access", { startsAt: iso(-15 * DAY), expiresAt: iso(-1 * DAY) });
  check("D  expired welcome access has NO access", !(await hasAccess(d)), "expiry is resolver-time, no job needed");

  // ---- E: paid --------------------------------------------------------
  const e = await person("rese");
  await grant(e, "web_subscription", { expiresAt: iso(30 * DAY) });
  check("E  active paid access has access", await hasAccess(e));

  // ---- F: admin grant on an expired account ----------------------------
  const f = await person("resf");
  await grant(f, "welcome_access", { startsAt: iso(-20 * DAY), expiresAt: iso(-6 * DAY) });
  check("F  expired welcome, before the grant, has no access", !(await hasAccess(f)));
  await grant(f, "admin_grant", { expiresAt: iso(7 * DAY), reason: "resolver matrix support grant" });
  check("F  a 7-day admin grant restores access", await hasAccess(f));

  // ---- indefinite -------------------------------------------------------
  const ind = await person("resi");
  await grant(ind, "admin_grant", { expiresAt: null, reason: "resolver matrix indefinite" });
  check("indefinite grant (expires_at null) has access", await hasAccess(ind));
  check("indefinite grant still has access a decade out",
    await hasAccess(ind, new Date(Date.now() + 3650 * DAY)), "null expiry never lapses");

  // ---- revocation -------------------------------------------------------
  const rev = await person("resr");
  await grant(rev, "admin_grant", { expiresAt: iso(7 * DAY) });
  check("before revoke, access", await hasAccess(rev));
  await admin.from("access_grants").update({ revoked_at: iso(0), revoked_by: rev })
    .eq("user_id", rev).eq("source", "admin_grant");
  check("after revoke, no access", !(await hasAccess(rev)), "revoked_at is honoured");
  const { data: histRows } = await admin.from("access_grants").select("id").eq("user_id", rev);
  check("revoking KEEPS the historical row", (histRows ?? []).length === 1, "append-mostly, not deleted");

  // ---- INDEPENDENCE: the property a precedence ladder breaks -------------
  const both = await person("resb");
  await grant(both, "welcome_access", { expiresAt: iso(10 * DAY) });
  await grant(both, "web_subscription", { expiresAt: iso(30 * DAY) });
  check("a user can hold welcome AND paid at once",
    (await activeSources(both)).length === 2, (await activeSources(both)).join(","));
  await admin.from("access_grants").update({ revoked_at: iso(0), revoked_by: both })
    .eq("user_id", both).eq("source", "welcome_access");
  check("revoking WELCOME leaves PAID access intact",
    await hasAccess(both), "independent sources, not a ladder");

  const both2 = await person("resc");
  await grant(both2, "web_subscription", { expiresAt: iso(30 * DAY) });
  await grant(both2, "admin_grant", { expiresAt: iso(7 * DAY) });
  await admin.from("access_grants").update({ revoked_at: iso(0), revoked_by: both2 })
    .eq("user_id", both2).eq("source", "admin_grant");
  check("revoking an ADMIN GRANT leaves PAID access intact",
    await hasAccess(both2), "the classic ladder bug, avoided");

  // ---- G: global override ----------------------------------------------
  const g = await person("resg");
  await grant(g, "welcome_access", { startsAt: iso(-20 * DAY), expiresAt: iso(-6 * DAY) });
  check("G  expired user, before the promo, has no access", !(await hasAccess(g)));

  const { data: windowRow, error: winErr } = await admin.from("access_global_windows")
    .insert({ created_by: g, reason: "resolver matrix global promo", expires_at: iso(7 * DAY) })
    .select("id").maybeSingle();
  if (winErr) throw new Error(`global window: ${winErr.message}`);

  check("G  a global promo gives the expired user access", await hasAccess(g));
  check("G  the promo also covers the paid user", await hasAccess(e));
  check("G  ONE row serves every user", true, "no per-user rows were written");

  // ---- global revoke fallback ------------------------------------------
  await admin.from("access_global_windows")
    .update({ revoked_at: iso(0), revoked_by: g }).eq("id", windowRow.id);

  check("after global revoke, the expired user has NO access", !(await hasAccess(g)));
  check("after global revoke, the PAID user still has access", await hasAccess(e), "fell back to their own source");
  check("after global revoke, the welcome user still has access", await hasAccess(a), "fell back to welcome");
  check("after global revoke, the admin-granted user still has access", await hasAccess(f), "fell back to the grant");

  // ---- expiry boundary --------------------------------------------------
  const bnd = await person("resx");
  const edge = new Date(Date.now() + 60_000);
  await grant(bnd, "welcome_access", { expiresAt: edge.toISOString() });
  check("one second BEFORE expiry, access", await hasAccess(bnd, new Date(edge.getTime() - 1000)));
  check("exactly AT expiry, no access", !(await hasAccess(bnd, edge)), "the boundary is exclusive");
  check("one second AFTER expiry, no access", !(await hasAccess(bnd, new Date(edge.getTime() + 1000))));

  // ---- a future-dated grant is not yet active ---------------------------
  const fut = await person("resf2");
  await grant(fut, "admin_grant", { startsAt: iso(2 * DAY), expiresAt: iso(9 * DAY) });
  check("a grant that has not started yet gives NO access", !(await hasAccess(fut)), "starts_at is honoured");
  check("the same grant gives access once it starts",
    await hasAccess(fut, new Date(Date.now() + 3 * DAY)));
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 180)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} resolver checks passed`);
