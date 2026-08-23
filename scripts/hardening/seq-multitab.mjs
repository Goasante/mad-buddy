/**
 * Mission 1 Extremely Advanced — multi-tab / stale-state behaviour.
 *
 * The shape under test throughout:
 *   TAB A opens a resource → TAB B mutates or removes it → TAB A acts on stale state
 *
 * What must never happen: a duplicate row, a false success, an impossible state,
 * or a UI the user cannot recover from. A clean rejection IS a pass — the point
 * is that the second tab's stale view cannot corrupt anything.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";
const TARGET = "1fd04f79-7ab6-482a-a969-348767e00f7c";

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, storageState: AUTH
});

const call = (page, path, body, method = "POST") =>
  page.evaluate(async ([p, b, m]) => {
    const r = await fetch(p, {
      method: m,
      headers: { "content-type": "application/json" },
      body: b ? JSON.stringify(b) : undefined
    });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  }, [path, body, method]);

async function reset() {
  /* Clear the rate-limit counters too.
     The friend-request endpoint is rate limited (correctly), and a preceding
     lifecycle run consumes the quota — after which every request in this file
     returns 400 "Too many attempts" and the checks measure the limiter rather
     than the concurrency behaviour they are written for. This is a HARNESS
     concern only: the limiter itself is a feature and is left intact. */
  await admin.from("rate_limits").delete().eq("user_id", QA);
  await admin.from("friend_requests").delete()
    .or(`and(sender_id.eq.${QA},receiver_id.eq.${TARGET}),and(sender_id.eq.${TARGET},receiver_id.eq.${QA})`);
  const pair = [QA, TARGET].sort();
  await admin.from("friendships").delete().eq("user_one_id", pair[0]).eq("user_two_id", pair[1]);
  await admin.from("blocked_users").delete()
    .or(`and(blocker_id.eq.${QA},blocked_id.eq.${TARGET}),and(blocker_id.eq.${TARGET},blocked_id.eq.${QA})`);
}
await reset();

// --- 1. Two tabs, same action, at the same moment --------------------------
const tabA = await context.newPage();
const tabB = await context.newPage();
await tabA.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
await tabB.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
await tabA.waitForTimeout(1200);

const [ra, rb] = await Promise.all([
  call(tabA, "/api/friends/request", { targetUserId: TARGET }),
  call(tabB, "/api/friends/request", { targetUserId: TARGET })
]);
const { data: rows } = await admin.from("friend_requests").select("id")
  .eq("sender_id", QA).eq("receiver_id", TARGET);
check("same request fired from two tabs creates one row", (rows ?? []).length === 1,
  `rows ${(rows ?? []).length} (statuses ${ra.status}/${rb.status})`);

// --- 2. Tab A holds a stale view; tab B removes the resource ---------------
// Tab A loaded the pending request. Tab B (here, the server) deletes it.
// Tab A then acts on something that no longer exists.
await admin.from("friend_requests").delete().eq("sender_id", QA).eq("receiver_id", TARGET);
const staleAct = await call(tabA, "/api/friends/request", { targetUserId: TARGET });
const { data: afterStale } = await admin.from("friend_requests").select("id")
  .eq("sender_id", QA).eq("receiver_id", TARGET);
check("acting on a deleted resource does not create a broken duplicate",
  (afterStale ?? []).length <= 1,
  `rows ${(afterStale ?? []).length} (status ${staleAct.status})`);

// --- 3. Blocked in one tab, acting from the other --------------------------
await reset();
await admin.from("blocked_users").insert({ blocker_id: TARGET, blocked_id: QA });
const blockedAct = await call(tabA, "/api/friends/request", { targetUserId: TARGET });
const { data: afterBlocked } = await admin.from("friend_requests").select("id")
  .eq("sender_id", QA).eq("receiver_id", TARGET);
check("a request to someone who blocked you is refused",
  (afterBlocked ?? []).length === 0,
  `rows ${(afterBlocked ?? []).length} (status ${blockedAct.status})`);
await admin.from("blocked_users").delete().eq("blocker_id", TARGET).eq("blocked_id", QA);

// --- 4. Stale UI must not leave a permanent spinner -----------------------
await tabA.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await tabA.waitForTimeout(2500);
const text = await tabA.locator("body").innerText();
const stuck = /loading…|loading\.\.\.|saving…|saving\.\.\.|opening…/i.test(text);
check("no permanent loading state after a stale interaction", !stuck,
  stuck ? "a loading state persisted" : "clean");

// --- 5. Signing out in one tab must not leave data readable in the other ---
const anon = await browser.newContext({ viewport: { width: 393, height: 852 } });
const guest = await anon.newPage();
const res = await guest.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
const landed = new URL(guest.url()).pathname;
check("a session-less tab cannot read an authenticated surface",
  landed.startsWith("/login"),
  `landed on ${landed} (status ${res?.status()})`);
await anon.close();

await reset();
await browser.close();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} multi-tab checks passed`);
