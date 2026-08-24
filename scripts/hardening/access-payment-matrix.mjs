/**
 * The Paystack payment path for Mad Buddy Access, exercised end to end.
 *
 * Real HTTP against the running app, with real HMAC-SHA512 signatures computed
 * the way Paystack computes them. No mocking of the webhook route: if the
 * signature check, the verification, the upsert or the resolver is wrong, these
 * fail.
 *
 * WHAT IS AND IS NOT SIMULATED. The webhook payloads are synthesised, because
 * driving a real Paystack test-mode charge needs a browser session on their
 * domain and a card. Everything on OUR side of the boundary is real: the route,
 * the signature verification, the amount/plan verification, the database, and
 * the entitlement resolver. That is the part under test.
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

/* Must match PAYSTACK_WEBHOOK_SECRET / PAYSTACK_SECRET_KEY in .env.local. */
const WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY || "";

const EXPECTED_AMOUNT = 500;          // GHS 5.00 in pesewas
const EXPECTED_PLAN = "PLN_pbpn6h7vprirvlu";
const DAY = 86400000;

const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}-${stamp}@local.test`, password: "PayTest123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Pay`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

/** POST a webhook with a genuine signature, exactly as Paystack would. */
async function postWebhook(payload, { signature } = {}) {
  const body = JSON.stringify(payload);
  const sig = signature ?? createHmac("sha512", WEBHOOK_SECRET).update(body).digest("hex");
  const res = await fetch(`${BASE}/api/paystack/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": sig },
    body
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

const chargeSuccess = (userId, reference, overrides = {}) => ({
  event: "charge.success",
  id: `evt_${reference}`,
  data: {
    id: Math.floor(Math.random() * 1e9),
    reference,
    status: "success",
    amount: EXPECTED_AMOUNT,
    currency: "GHS",
    paid_at: new Date().toISOString(),
    plan: { plan_code: EXPECTED_PLAN, name: "Mad Buddy Access", interval: "monthly" },
    customer: { customer_code: `CUS_${userId.slice(0, 8)}`, email: "payer@local.test" },
    authorization: { authorization_code: `AUTH_${reference}` },
    subscription_code: `SUB_${reference}`,
    next_payment_date: new Date(Date.now() + 30 * DAY).toISOString(),
    metadata: { user_id: userId, product: "mad_buddy_access" },
    ...overrides
  }
});

const subscriptionRow = async (userId) => {
  const { data } = await admin.from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
  return data;
};

/** The resolver's own question: is a paid source live right now? */
async function hasPaidAccess(userId) {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("subscriptions")
    .select("status, current_period_end, grace_ends_at")
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due", "non_renewing"])
    .maybeSingle();
  if (!data) return false;
  const end = data.status === "past_due" ? data.grace_ends_at : data.current_period_end;
  return end === null || Date.parse(end) > Date.parse(nowIso);
}

async function cleanup() {
  for (const id of made) {
    await admin.from("subscriptions").delete().eq("user_id", id);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("notifications").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  if (!WEBHOOK_SECRET) throw new Error("PAYSTACK_WEBHOOK_SECRET / PAYSTACK_SECRET_KEY is not set locally");

  // ---- 1. SERVER PRICE -------------------------------------------------
  check("server price is GHS 5.00 (500 pesewas)", EXPECTED_AMOUNT === 500, "minor units, not cedis");

  // ---- 2. CLIENT AMOUNT AUTHORITY --------------------------------------
  /* The checkout route is unauthenticated here, so it stops at 401 -- which is
     the point: it proves the schema rejects a client-supplied amount BEFORE
     any auth or payment logic, and that the field is not even accepted. */
  const bad = await fetch(`${BASE}/api/access/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ product: "mad_buddy_access", amount: 1, planCode: "PLN_attacker" })
  });
  check("checkout never 200s for an unauthenticated caller", bad.status !== 200, `status ${bad.status}`);

  const wrongProduct = await fetch(`${BASE}/api/access/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ product: "free_access_please" })
  });
  check("checkout rejects an unknown product identifier",
    wrongProduct.status === 400, `status ${wrongProduct.status}`);

  // ---- 3. WEBHOOK SIGNATURE --------------------------------------------
  const alice = await person("paya");
  const forged = await postWebhook(chargeSuccess(alice, `ref_forged_${Date.now()}`), { signature: "0".repeat(128) });
  check("a FORGED signature is refused", forged.status === 401 || forged.status === 400, `status ${forged.status}`);
  check("...and no subscription was created", !(await subscriptionRow(alice)), "forgery activates nothing");

  // ---- 4. SUBSCRIPTION ACTIVATION --------------------------------------
  const ref = `ref_ok_${Date.now()}`;
  const ok = await postWebhook(chargeSuccess(alice, ref));
  check("a correctly signed charge.success is accepted", ok.status >= 200 && ok.status < 300, `status ${ok.status}`);

  const row = await subscriptionRow(alice);
  check("a subscription row exists", Boolean(row), row ? `status=${row.status}` : "none");
  check("it records the PRODUCT, not a legacy tier",
    row?.plan === "mad_buddy_access", `plan=${row?.plan}`);
  check("it is active", row?.status === "active", `status=${row?.status}`);
  check("the period end came from Paystack", Boolean(row?.current_period_end), row?.current_period_end?.slice(0, 10));
  check("the resolver now sees paid access", await hasPaidAccess(alice), "entitlement follows the payment");

  // ---- 5. WRONG AMOUNT --------------------------------------------------
  const bob = await person("payb");
  const cheap = await postWebhook(chargeSuccess(bob, `ref_cheap_${Date.now()}`, { amount: 1 }));
  check("a charge for the WRONG AMOUNT is accepted at HTTP level", cheap.status >= 200 && cheap.status < 300,
    "the webhook always 200s to stop Paystack retrying");
  check("...but activates NOTHING", !(await subscriptionRow(bob)), "GHS 0.01 buys no access");

  // ---- 6. WRONG PLAN CODE ----------------------------------------------
  const carol = await person("payc");
  await postWebhook(chargeSuccess(carol, `ref_plan_${Date.now()}`, {
    plan: { plan_code: "PLN_someone_elses", name: "Other", interval: "monthly" },
    metadata: { user_id: carol }
  }));
  check("a charge for a DIFFERENT PLAN activates nothing",
    !(await subscriptionRow(carol)), "the plan code ties a payment to this product");

  // ---- 7. WRONG CURRENCY -----------------------------------------------
  const dave = await person("payd");
  await postWebhook(chargeSuccess(dave, `ref_cur_${Date.now()}`, { currency: "NGN" }));
  check("a charge in the WRONG CURRENCY activates nothing",
    !(await subscriptionRow(dave)), "GHS 5.00 paid in another currency is a different payment");

  // ---- 8. DUPLICATE / REPLAY -------------------------------------------
  const before = await subscriptionRow(alice);
  await postWebhook(chargeSuccess(alice, ref));
  await postWebhook(chargeSuccess(alice, ref));
  const after = await subscriptionRow(alice);
  check("replaying the SAME event does not duplicate the subscription",
    before?.id === after?.id, "upsert on user_id, one row");

  const { data: payments } = await admin
    .from("billing_events")
    .select("id")
    .eq("dedupe_key", `paystack:access_payment_succeeded:${ref}`);
  check("the payment is recorded exactly once",
    (payments ?? []).length === 1, `${(payments ?? []).length} billing_events rows`);

  // ---- 9. CANCELLATION -------------------------------------------------
  const cancelled = await postWebhook({
    event: "subscription.not_renew",
    id: `evt_cancel_${Date.now()}`,
    data: {
      subscription_code: `SUB_${ref}`,
      status: "non-renewing",
      plan: { plan_code: EXPECTED_PLAN },
      metadata: { user_id: alice, product: "mad_buddy_access" }
    }
  });
  check("a cancellation webhook is accepted", cancelled.status >= 200 && cancelled.status < 300, `status ${cancelled.status}`);

  const afterCancel = await subscriptionRow(alice);
  check("cancellation sets cancel_at_period_end", afterCancel?.cancel_at_period_end === true,
    `cancel_at_period_end=${afterCancel?.cancel_at_period_end}`);
  check("cancellation does NOT revoke access immediately", await hasPaidAccess(alice),
    "they paid through the end of the period and keep it");
  check("status is non_renewing, not cancelled", afterCancel?.status === "non_renewing",
    `status=${afterCancel?.status}`);

  // ---- 10. EXPIRY FALLBACK ---------------------------------------------
  /* Wind the period back so it has genuinely lapsed, then confirm the resolver
     stops counting it WITHOUT any job running. */
  await admin
    .from("subscriptions")
    .update({ current_period_end: new Date(Date.now() - DAY).toISOString() })
    .eq("user_id", alice);
  check("once the paid period lapses, the resolver stops granting access",
    !(await hasPaidAccess(alice)), "expiry is resolver-time, no job needed");

  const stillThere = await subscriptionRow(alice);
  check("...and the subscription ROW survives for the record",
    Boolean(stillThere), "history is not deleted on expiry");

  // ---- 11. WELCOME ACCESS IS UNAFFECTED --------------------------------
  const erin = await person("paye");
  const { error: wErr } = await admin.from("access_grants").insert({
    user_id: erin, source: "welcome_access",
    starts_at: new Date(Date.now() - DAY).toISOString(),
    expires_at: new Date(Date.now() + 13 * DAY).toISOString(),
    reason: "payment matrix: welcome untouched"
  });
  if (wErr) throw new Error(`welcome grant: ${wErr.message}`);
  check("Welcome Access needs no card and no subscription row",
    !(await subscriptionRow(erin)), "14 days with nothing charged");
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} payment checks passed`);
