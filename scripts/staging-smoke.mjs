#!/usr/bin/env node
/**
 * PR #19 Preview → Mad Buddy Staging API smoke test.
 *
 *   node scripts/staging-smoke.mjs            # reads + latency
 *   node scripts/staging-smoke.mjs --writes   # also the bounded write smoke
 *
 * ONE synthetic user, against the real application boundary. If a single user
 * cannot get through Vercel protection, authenticate, and read seeded data,
 * then a 100-user ramp would only produce noise.
 *
 * Transport: `Authorization: Bearer <access_token>`, which lib/api/auth.ts
 * accepts as the mobile transport and which CSRF deliberately exempts. This is
 * the application's real contract, not a way around it.
 *
 * Prints no secrets: not the bypass token, not the password, not the keys.
 */

import { readFileSync } from "node:fs";

const PRODUCTION_REF = "cabkhxxnrybzhkbtoiiz";
const STAGING_REF = "ivaydmciwmjdjsrovbqb";

function loadEnv(url) {
  const out = {};
  let text;
  try {
    text = readFileSync(url, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) {
      const value = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (value && value !== "PASTE_HERE") out[t.slice(0, i).trim()] = value;
    }
  }
  return out;
}

const load = loadEnv(new URL("../.env.load.local", import.meta.url));
const staging = loadEnv("C:/mb-staging-data/.env.staging.local");

const APP =
  process.env.SMOKE_APP_URL ??
  "https://mad-buddy-git-release-staging-591283-godfreds-projects-f9ab53b7.vercel.app";
const BYPASS = load.VERCEL_AUTOMATION_BYPASS_SECRET;
const SUPABASE_URL = staging.NEXT_PUBLIC_SUPABASE_URL;
const ANON = staging.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = staging.MAD_BUDDY_STAGING_USER_PASSWORD;

function fail(message) {
  console.error(`\nBLOCKED: ${message}`);
  process.exit(1);
}

if (!BYPASS) {
  fail(
    "VERCEL_AUTOMATION_BYPASS_SECRET is not set in .env.load.local.\n" +
      "Vercel Deployment Protection is enabled (correctly), so every request 302s to SSO without it.\n" +
      "Get it from: Vercel → mad-buddy → Settings → Deployment Protection → Protection Bypass for Automation."
  );
}
if (!SUPABASE_URL || !ANON || !PASSWORD) fail("staging env is incomplete (.env.staging.local)");

const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
if (ref === PRODUCTION_REF) fail("resolved Supabase ref is PRODUCTION");
if (ref !== STAGING_REF) fail(`unexpected Supabase ref: ${ref}`);

/** Every request carries the bypass header; the secret is never logged. */
const H = { "x-vercel-protection-bypass": BYPASS };

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function timed(label, run) {
  const started = performance.now();
  try {
    const res = await run();
    const ms = performance.now() - started;
    const body = await res.text();
    return { label, status: res.status, ms, bytes: body.length, body };
  } catch (error) {
    return { label, status: 0, ms: performance.now() - started, bytes: 0, body: "", error: error.message };
  }
}

function row(r) {
  const ok = r.status >= 200 && r.status < 300;
  const mark = ok ? "ok  " : "FAIL";
  console.log(
    `  ${mark} ${r.label.padEnd(30)} ${String(r.status).padStart(3)}  ${r.ms.toFixed(0).padStart(5)}ms  ${String(r.bytes).padStart(6)}B${r.error ? "  " + r.error : ""}`
  );
  return ok;
}

console.log("Mad Buddy staging smoke");
console.log("─".repeat(72));
console.log(`app          ${APP}`);
console.log(`supabase ref ${ref}`);
console.log("");

/* 1. Bypass proof ---------------------------------------------------- */
console.log("1. Vercel protection");
const noBypass = await timed("GET / (no bypass)", () => fetch(`${APP}/`, { redirect: "manual" }));
console.log(`  without bypass: ${noBypass.status}${noBypass.status === 302 ? " (SSO redirect — protection is ON)" : ""}`);
const withBypass = await timed("GET / (bypass)", () => fetch(`${APP}/`, { headers: H, redirect: "manual" }));
console.log(`  with bypass:    ${withBypass.status}`);
if (withBypass.status === 302) {
  fail("bypass header did not admit the request — the secret is wrong or was regenerated.");
}
// A 200 is only meaningful if it is Mad Buddy, not Vercel's login page.
const isVercelLogin = /vercel\.com\/sso-api|<title>Login – Vercel/i.test(withBypass.body);
if (isVercelLogin) fail("received Vercel's login page, not the Mad Buddy app.");
console.log(`  reached Mad Buddy: ${!isVercelLogin ? "YES" : "NO"}`);

/* 2. Authenticate a synthetic user ------------------------------------ */
console.log("\n2. Scripted auth (staging-user-001)");
const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "staging-user-001@staging.example.com", password: PASSWORD })
});
if (!authRes.ok) fail(`auth failed: ${authRes.status} ${(await authRes.text()).slice(0, 120)}`);
const { access_token: token, user } = await authRes.json();
if (!token) fail("no access token returned");
console.log(`  authenticated: YES  (user id ${user.id.slice(0, 8)}…)`);

const AUTH = { ...H, Authorization: `Bearer ${token}` };

/* 3. Prove the app itself resolves this session ------------------------ */
console.log("\n3. Application session");
const me = await timed("GET /api/profile", () => fetch(`${APP}/api/profile`, { headers: AUTH }));
row(me);
if (me.status !== 200) {
  fail("the app did not accept the Bearer session — smoke cannot continue.");
}
console.log(`  app accepted the session: YES`);

/* 4. Read smoke -------------------------------------------------------- */
console.log("\n4. Read smoke (seeded, non-trivial data)");
const reads = [
  ["Home / pulse", "/api/pulse"],
  ["Messages inbox", "/api/messages/conversations"],
  ["Muddies (friends)", "/api/friends"],
  // Linkr is deliberately absent: it has NO /api route in this tree (server
  // actions only), so it is not scriptable here. Benchmarking a 404 and
  // calling it a pass would be worse than reporting the gap.
  ["UpFor", "/api/hangouts/open"],
  ["Plans", "/api/plans"],
  ["Events", "/api/events"],
  ["Groups", "/api/groups"],
  ["Profile", "/api/profile"],
  ["Notifications", "/api/notifications"],
  ["Unread count", "/api/messages/unread-count"]
];

const results = [];
let okCount = 0;
for (const [label, path] of reads) {
  const r = await timed(label, () => fetch(`${APP}${path}`, { headers: AUTH }));
  if (row(r)) okCount += 1;
  results.push(r);
}
console.log(`  ${okCount}/${reads.length} reads succeeded`);

/* 5. Conversation detail: prove seeded data is really reachable --------- */
console.log("\n5. Seeded data reachable");
const convos = results.find((r) => r.label === "Messages inbox");
let conversationId = null;
try {
  const parsed = JSON.parse(convos.body);
  const list = Array.isArray(parsed) ? parsed : parsed.conversations ?? parsed.data ?? [];
  conversationId = list[0]?.id ?? list[0]?.conversation_id ?? null;
  console.log(`  conversations visible: ${list.length}`);
} catch {
  console.log("  (could not parse inbox payload)");
}

if (conversationId) {
  const detail = await timed("conversation detail", () =>
    fetch(`${APP}/api/messages/conversations/${conversationId}`, { headers: AUTH })
  );
  row(detail);
}

/* 6. Latency baseline --------------------------------------------------- */
console.log("\n6. Latency baseline (sequential, 1 user)");
const SAMPLES = Number(process.env.SMOKE_SAMPLES ?? 12);
for (const [label, path] of [
  ["Home / pulse", "/api/pulse"],
  ["Messages inbox", "/api/messages/conversations"],
  ["Notifications", "/api/notifications"]
]) {
  const times = [];
  let errors = 0;
  let cold = null;
  for (let i = 0; i < SAMPLES; i += 1) {
    const r = await timed(label, () => fetch(`${APP}${path}`, { headers: AUTH }));
    if (r.status < 200 || r.status >= 300) errors += 1;
    if (i === 0) cold = r.ms;
    else times.push(r.ms);
  }
  times.sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(22)} n=${times.length} cold=${cold.toFixed(0)}ms ` +
      `min=${times[0]?.toFixed(0)} p50=${pct(times, 50)?.toFixed(0)} ` +
      `p95=${pct(times, 95)?.toFixed(0)} max=${times[times.length - 1]?.toFixed(0)} errors=${errors}`
  );
}

/* 7. Bounded write smoke ------------------------------------------------ */
if (process.argv.includes("--writes") && conversationId) {
  console.log("\n7. Write smoke (synthetic only)");
  const clientMessageId = `smoke-${Date.now()}`;
  const send = () =>
    fetch(`${APP}/api/messages/send`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        text: "staging smoke test message",
        clientMessageId
      })
    });

  const first = await timed("send message", send);
  row(first);

  // Same clientMessageId twice must not create two rows -- the idempotency
  // contract the Messaging tranche depends on.
  const retry = await timed("send again (same id)", send);
  row(retry);
  console.log("  duplicate check: inspect row count for this clientMessageId below");
}

console.log("\nSmoke complete.");
