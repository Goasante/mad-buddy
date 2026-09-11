/**
 * Mad Buddy Access UX review cohort — isolated local stack only.
 *
 * Adapted from scripts/hardening/seed-monetization-review.mjs for the
 * ui/access-billing-restructure pass. Covers every entitlement state that
 * actually exists in the schema/resolver (lib/access/resolver.ts,
 * lib/access/paystack.ts): team/staff, active Mobile Money, active card
 * (auto-renewing), card cancelled-but-active, past_due (payment retry
 * grace), expired welcome, and no access.
 *
 * IDEMPOTENT. Re-running refreshes the cohort without duplicating it.
 *
 * SAFETY: refuses to run against anything but 127.0.0.1, and the URL/key
 * below point at the mb-access-ux isolated stack (project_id "mb-access-ux",
 * api port 60321 -- see supabase/config.toml) — NOT the shared 54321 stack
 * other worktrees use, and NOT the 583xx/593xx bands used by other
 * worktrees' stacks. 59521 was originally chosen but Windows reserves the
 * entire 59428-59527 TCP range on this machine (netsh interface ipv4 show
 * excludedportrange), so the stack was moved to 60321-60324.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:60321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "AccessUxReview123!";
const DAY = 86400000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const COHORT = [
  {
    key: "team", name: "Staff Access-Team", username: "accessuxteam",
    kind: "staff",
    expect: "Team member. Access active, no payment required, status card must not read as checkout."
  },
  {
    key: "momo", name: "Momo Access-Active", username: "accessuxmomo",
    kind: "subscription",
    subscription: {
      plan: "mad_buddy_access", status: "non_renewing", provider: "paystack",
      current_period_start: iso(-10 * DAY), current_period_end: iso(20 * DAY),
      cancel_at_period_end: true, paystack_subscription_code: null
    },
    expect: "Active Mobile Money. Valid-until date, 'Paid with Mobile Money', no auto-renew claim."
  },
  {
    key: "card", name: "Card Access-Active", username: "accessuxcard",
    kind: "subscription",
    subscription: {
      plan: "mad_buddy_access", status: "active", provider: "paystack",
      current_period_start: iso(-5 * DAY), current_period_end: iso(25 * DAY),
      cancel_at_period_end: false,
      paystack_subscription_code: "SUB_accessux_card_demo",
      paystack_customer_code: "CUS_accessux_card_demo"
    },
    expect: "Active card. Renews-on date, auto-renew clear, manage/cancel action shown, no fabricated card digits."
  },
  {
    key: "cardcancelled", name: "Card Access-Cancelled", username: "accessuxcardcxl",
    kind: "subscription",
    subscription: {
      plan: "mad_buddy_access", status: "non_renewing", provider: "paystack",
      current_period_start: iso(-20 * DAY), current_period_end: iso(10 * DAY),
      cancel_at_period_end: true,
      paystack_subscription_code: "SUB_accessux_cardcxl_demo",
      paystack_customer_code: "CUS_accessux_cardcxl_demo"
    },
    expect: "Card, renewal turned off. Still active until period end. Distinct from Mobile Money copy."
  },
  {
    key: "pastdue", name: "Card Access-PastDue", username: "accessuxpastdue",
    kind: "subscription",
    subscription: {
      plan: "mad_buddy_access", status: "past_due", provider: "paystack",
      current_period_start: iso(-33 * DAY), current_period_end: iso(-3 * DAY),
      grace_ends_at: iso(4 * DAY),
      cancel_at_period_end: false,
      paystack_subscription_code: "SUB_accessux_pastdue_demo",
      paystack_customer_code: "CUS_accessux_pastdue_demo"
    },
    expect: "Payment retry in progress. Access still live inside the grace window (resolver: effectiveEnd = grace_ends_at)."
  },
  {
    key: "expired", name: "Welcome Access-Expired", username: "accessuxexpired",
    kind: "grant",
    grants: [{ source: "welcome_access", startsIn: -20 * DAY, expiresIn: -6 * DAY }],
    expect: "Expired welcome access. Locked, but Always Yours content stays visible — not a hard paywall."
  },
  {
    key: "none", name: "Access-None", username: "accessuxnone",
    kind: "grant",
    grants: [],
    expect: "Never had access. Payment chooser prominent, price GHS 4.99/30 days clear."
  }
];

const made = new Map();

async function ensurePerson(spec) {
  const email = `${spec.username}@review.local`;

  const { data: existingProfile } = await admin
    .from("profiles").select("user_id").eq("username", spec.username).maybeSingle();

  let user = null;
  if (existingProfile) {
    const { data } = await admin.auth.admin.getUserById(existingProfile.user_id);
    user = data?.user ?? null;
  }

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true
    });
    if (error) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      user = (list?.users ?? []).find((u) => u.email === email) ?? null;
      if (!user) throw new Error(`${spec.key}: ${error.message}`);
      const { error: pwErr } = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
      if (pwErr) throw new Error(`${spec.key} password: ${pwErr.message}`);
    } else {
      user = data.user;
    }
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
    if (error) throw new Error(`${spec.key} password: ${error.message}`);
  }

  const { error: pErr } = await admin.from("profiles").upsert(
    { user_id: user.id, username: spec.username, full_name: spec.name, is_onboarded: true },
    { onConflict: "user_id" }
  );
  if (pErr) throw new Error(`${spec.key} profile: ${pErr.message}`);

  // Rewrite this account's state so re-running is deterministic.
  await admin.from("access_reminder_log").delete().eq("user_id", user.id);
  await admin.from("access_grants").delete().eq("user_id", user.id);
  await admin.from("subscriptions").delete().eq("user_id", user.id);
  await admin.from("admin_users").delete().eq("auth_user_id", user.id);

  if (spec.kind === "staff") {
    const { error } = await admin.from("admin_users").insert({
      email, auth_user_id: user.id, role: "support"
    });
    if (error) throw new Error(`${spec.key} admin_users: ${error.message}`);
  }

  if (spec.kind === "subscription") {
    const { error } = await admin.from("subscriptions").insert({
      user_id: user.id, ...spec.subscription
    });
    if (error) throw new Error(`${spec.key} subscription: ${error.message}`);
  }

  if (spec.kind === "grant") {
    for (const g of spec.grants) {
      const { error } = await admin.from("access_grants").insert({
        user_id: user.id, source: g.source,
        starts_at: iso(g.startsIn),
        expires_at: g.expiresIn === null ? null : iso(g.expiresIn),
        reason: "Access UX review cohort"
      });
      if (error) throw new Error(`${spec.key} grant ${g.source}: ${error.message}`);
    }
  }

  made.set(spec.key, { id: user.id, email, spec });
  return user.id;
}

for (const spec of COHORT) await ensurePerson(spec);

console.log(`${"=".repeat(94)}`);
console.log("MAD BUDDY ACCESS UX REVIEW COHORT (isolated stack, port 60321)");
console.log(`${"=".repeat(94)}`);
console.log(`All accounts: password  ${PASSWORD}   sign in at http://localhost:3200/login\n`);

for (const spec of COHORT) {
  const entry = made.get(spec.key);
  console.log(`${spec.name}`);
  console.log(`  email    ${entry.email}`);
  console.log(`  expect   ${spec.expect}`);
  console.log(`  inspect  /settings/access`);
  console.log("");
}
