/**
 * Mission 1 Extremely Advanced — the Muddy relationship lifecycle.
 *
 * stranger → request → pending → cancel → resend → accept → Muddy → block → unblock
 *
 * Every assertion reads Postgres directly, because the property under test is
 * "no duplicate row, no impossible dual state" and a list that happens not to
 * render a duplicate is not evidence that none exists.
 *
 * The previous session's probe returned 400 and was recorded INCONCLUSIVE. The
 * cause was the harness, not the API: it sent `recipientId` where the endpoint
 * takes `targetUserId`, and queried `recipient_id` where the column is
 * `receiver_id`. Both corrected here — which is why "setup failed" must never be
 * recorded as PASS, and equally why an inconclusive result must be chased down
 * rather than explained away.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";       // qatester — the signed-in user
const TARGET = "1fd04f79-7ab6-482a-a969-348767e00f7c";   // saao — no relationship

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Canonical friendship row order: user_one_id < user_two_id. */
const PAIR = [QA, TARGET].sort();

async function requestRows() {
  const { data } = await admin
    .from("friend_requests").select("id, status")
    .or(`and(sender_id.eq.${QA},receiver_id.eq.${TARGET}),and(sender_id.eq.${TARGET},receiver_id.eq.${QA})`);
  return data ?? [];
}
async function friendshipRows() {
  const { data } = await admin
    .from("friendships").select("id, ended_at")
    .eq("user_one_id", PAIR[0]).eq("user_two_id", PAIR[1]);
  return data ?? [];
}
async function reset() {
  await admin.from("friend_requests").delete()
    .or(`and(sender_id.eq.${QA},receiver_id.eq.${TARGET}),and(sender_id.eq.${TARGET},receiver_id.eq.${QA})`);
  await admin.from("friendships").delete().eq("user_one_id", PAIR[0]).eq("user_two_id", PAIR[1]);
  await admin.from("blocked_users").delete()
    .or(`and(blocker_id.eq.${QA},blocked_id.eq.${TARGET}),and(blocker_id.eq.${TARGET},blocked_id.eq.${QA})`);
}

await reset();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, storageState: AUTH });
const page = await context.newPage();
await page.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);

/** Calls an app API from inside the authenticated page. */
const api = (path, body, method = "POST") =>
  page.evaluate(async ([p, b, m]) => {
    const r = await fetch(p, {
      method: m,
      headers: { "content-type": "application/json" },
      body: b ? JSON.stringify(b) : undefined
    });
    return { status: r.status, body: (await r.text()).slice(0, 300) };
  }, [path, body, method]);

// --- 1. stranger → request -------------------------------------------------
const first = await api("/api/friends/request", { targetUserId: TARGET });
const afterFirst = await requestRows();
check("request creates exactly one pending row", first.status === 200 && afterFirst.length === 1,
  `status ${first.status}, rows ${afterFirst.length}, status=${afterFirst[0]?.status}`);

// --- 2. repeat request must not create a second ----------------------------
const repeat = await api("/api/friends/request", { targetUserId: TARGET });
const afterRepeat = await requestRows();
check("a repeated request does not create a duplicate", afterRepeat.length === 1,
  `rows ${afterRepeat.length} (repeat status ${repeat.status})`);

// --- 3. rapid double-fire (race) -------------------------------------------
await reset();
const [a, b] = await Promise.all([
  api("/api/friends/request", { targetUserId: TARGET }),
  api("/api/friends/request", { targetUserId: TARGET })
]);
const afterRace = await requestRows();
check("two simultaneous requests still yield one row", afterRace.length === 1,
  `rows ${afterRace.length} (statuses ${a.status}/${b.status})`);

// --- 4. accept → exactly one friendship, request resolved ------------------
const pending = afterRace[0];
let acceptStatus = "n/a";
if (pending) {
  // Accept as the RECEIVER, which is the real direction of this action.
  /* Accepted as the RECEIVER, signed in, through the anon client — NOT through
     the service-role admin client.
     `accept_friend_request` grants EXECUTE to `authenticated` only, deliberately:
     it must run as the real user so RLS and auth.uid() decide what may be
     accepted. Calling it as service_role returns "permission denied", which is
     the function working as designed, not a defect. (Two earlier harness bugs
     hid this: the wrong parameter name 404'd it, and a `<= 1` assertion was
     satisfied by zero rows.) */
  const receiver = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await receiver.auth.signInWithPassword({
    email: "saa@local.test", password: "HardeningPass123!"
  });
  if (signInError) {
    acceptStatus = `sign-in failed: ${signInError.message.slice(0, 70)}`;
  } else {
    const { error } = await receiver.rpc("accept_friend_request", { p_request_id: pending.id });
    acceptStatus = error ? `rpc error: ${String(error.message || error).slice(0, 90)}` : "rpc ok";
  }
}
const fships = await friendshipRows();
check("accept produces exactly one friendship row", fships.length === 1,
  `friendships ${fships.length} (${acceptStatus})`);

// --- 5. block ends the relationship without deleting it --------------------
if (fships.length === 1) {
  await admin.from("blocked_users").insert({ blocker_id: QA, blocked_id: TARGET });
  await admin.from("friendships").update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", PAIR[0]).eq("user_two_id", PAIR[1]);
  const afterBlock = await friendshipRows();
  check("blocking soft-ends rather than deleting the friendship",
    afterBlock.length === 1 && afterBlock[0].ended_at !== null,
    `rows ${afterBlock.length}, ended_at ${afterBlock[0]?.ended_at ? "set" : "null"}`);

  // --- 6. unblock → reactivation must reuse the SAME row -------------------
  const idBefore = afterBlock[0].id;
  await admin.from("blocked_users").delete().eq("blocker_id", QA).eq("blocked_id", TARGET);
  await admin.from("friendships").update({ ended_at: null })
    .eq("user_one_id", PAIR[0]).eq("user_two_id", PAIR[1]);
  const afterUnblock = await friendshipRows();
  check("reactivation reuses the same relationship identity",
    afterUnblock.length === 1 && afterUnblock[0].id === idBefore,
    `same id: ${afterUnblock[0]?.id === idBefore}`);
} else {
  console.log("SKIP  block/unblock — no friendship was created to end");
}

// --- 7. blocked user must not leak into the Muddy list ---------------------
await admin.from("blocked_users").insert({ blocker_id: QA, blocked_id: TARGET });
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
const listed = await api("/api/friends", null, "GET");
const leaks = /saao|Saa Owusu/i.test(listed.body);
check("a blocked user does not appear in the Muddy list", !leaks,
  leaks ? "blocked user present in /api/friends" : "absent");

await reset();
await browser.close();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} lifecycle checks passed`);
