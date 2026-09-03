#!/usr/bin/env node
/**
 * Mad Buddy staging load ramp: 10 -> 25 -> 50 -> 75 -> 100 concurrent users.
 *
 *   node scripts/staging-load.mjs --stage 10 --warmup 45 --duration 180
 *   node scripts/staging-load.mjs --stage 100 --warmup 60 --duration 240
 *
 * This SIMULATES PEOPLE, not a flood. Every virtual user authenticates as a
 * distinct synthetic account, ramps in gradually, and pauses 0.8-3.0s between
 * actions. A zero-delay loop would measure how fast Node can spin, not whether
 * Mad Buddy can serve 100 people.
 *
 * Auth setup is measured and reported SEPARATELY from the steady-state
 * workload, so login cost never masquerades as Home/Messaging latency.
 *
 * Prints no secrets.
 */

import { readFileSync } from "node:fs";
import os from "node:os";

const PRODUCTION_REF = "cabkhxxnrybzhkbtoiiz";
const STAGING_REF = "ivaydmciwmjdjsrovbqb";

function loadEnv(file) {
  const out = {};
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) {
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (v && v !== "PASTE_HERE") out[t.slice(0, i).trim()] = v;
    }
  }
  return out;
}

const HERE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const load = loadEnv(`${HERE}/.env.load.local`);
const staging = loadEnv(`${HERE}/.env.staging.local`);

const APP = "https://mad-buddy-git-release-staging-591283-godfreds-projects-f9ab53b7.vercel.app";
const BYPASS = load.VERCEL_AUTOMATION_BYPASS_SECRET;
const SUPABASE_URL = staging.NEXT_PUBLIC_SUPABASE_URL;
const ANON = staging.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = staging.MAD_BUDDY_STAGING_USER_PASSWORD;

const die = (m) => { console.error(`BLOCKED: ${m}`); process.exit(1); };
if (!BYPASS) die("VERCEL_AUTOMATION_BYPASS_SECRET missing");
if (!SUPABASE_URL || !ANON || !PASSWORD) die("staging env incomplete");

const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
if (ref === PRODUCTION_REF) die("resolved Supabase ref is PRODUCTION");
if (ref !== STAGING_REF) die(`unexpected ref ${ref}`);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
};

const STAGE = arg("stage", 10);
const WARMUP_S = arg("warmup", 45);
const DURATION_S = arg("duration", 180);
const RAMP_S = arg("ramp", Math.max(10, Math.round(STAGE * 0.6)));

/* ---------------- workload mix ----------------
 * Linkr has NO /api route (server actions only), so its 10 users are
 * redistributed to real boundaries rather than benchmarking a fake path.
 * /api/pulse is cookie-only; Bearer traffic would score 401s, so Home is
 * represented by other genuine read paths and Pulse is left unexercised.
 */
const PROFILES = [
  { name: "home_reads",    weight: 25, actions: ["profile", "friends", "unread"] },
  { name: "messages_read", weight: 20, actions: ["inbox", "conversation"] },
  { name: "message_send",  weight: 10, actions: ["inbox", "send"] },
  { name: "upfor",         weight: 13, actions: ["upfor"] },
  { name: "plans",         weight: 12, actions: ["plans"] },
  { name: "notifications", weight: 10, actions: ["notifications", "unread"] },
  { name: "events",        weight:  5, actions: ["events"] },
  { name: "groups",        weight:  5, actions: ["groups"] }
];

const ROUTES = {
  profile:      { path: () => "/api/profile" },
  friends:      { path: () => "/api/friends" },
  inbox:        { path: () => "/api/messages/conversations" },
  conversation: { path: (u) => `/api/messages/conversations/${u.conversationId}` },
  upfor:        { path: () => "/api/hangouts/open" },
  plans:        { path: () => "/api/plans" },
  events:       { path: () => "/api/events" },
  groups:       { path: () => "/api/groups" },
  notifications:{ path: () => "/api/notifications" },
  unread:       { path: () => "/api/messages/unread-count" },
  send:         { path: () => "/api/messages/send", method: "POST" }
};

/* ---------------- metrics ---------------- */
const stats = new Map(); // route -> {times[], ok, c4, c5, timeouts, bytes}
function record(route, ms, status, bytes, timedOut) {
  if (!stats.has(route)) stats.set(route, { times: [], ok: 0, c4: 0, c5: 0, timeouts: 0, bytes: 0 });
  const s = stats.get(route);
  s.times.push(ms);
  s.bytes += bytes;
  if (timedOut) s.timeouts += 1;
  else if (status >= 500) s.c5 += 1;
  else if (status >= 400) s.c4 += 1;
  else s.ok += 1;
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

let measuring = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);

/* ---------------- virtual user ---------------- */
async function authenticate(index) {
  const email = `staging-user-${String(index).padStart(3, "0")}@staging.example.com`;
  const started = performance.now();
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  if (!r.ok) throw new Error(`auth ${index}: ${r.status}`);
  const { access_token, user } = await r.json();
  return { index, token: access_token, userId: user.id, authMs: performance.now() - started };
}

async function call(user, action) {
  const spec = ROUTES[action];
  if (action === "conversation" && !user.conversationId) return;

  const headers = {
    "x-vercel-protection-bypass": BYPASS,
    Authorization: `Bearer ${user.token}`
  };
  let body;
  const method = spec.method ?? "GET";
  if (method === "POST") {
    if (!user.conversationId) return;
    headers["Content-Type"] = "application/json";
    user.sendSeq = (user.sendSeq ?? 0) + 1;
    const id = `load-${STAGE}-u${user.index}-${user.sendSeq}`;
    user.sentIds.push(id);
    body = JSON.stringify({ conversationId: user.conversationId, text: `load test ${id}`, clientMessageId: id });
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${APP}${spec.path(user)}`, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    const ms = performance.now() - started;
    if (measuring) record(action, ms, res.status, text.length, false);
    if (action === "inbox" && !user.conversationId) {
      try {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : parsed.conversations ?? parsed.data ?? [];
        user.conversationId = list[0]?.id ?? list[0]?.conversation_id ?? null;
      } catch { /* leave unset */ }
    }
  } catch (error) {
    const ms = performance.now() - started;
    if (measuring) record(action, ms, 0, 0, error.name === "AbortError");
  } finally {
    clearTimeout(timer);
  }
}

async function runUser(user, profile, stopAt) {
  // Seed the conversation id once so `conversation` and `send` have a target.
  await call(user, "inbox");
  let i = 0;
  while (Date.now() < stopAt) {
    const action = profile.actions[i % profile.actions.length];
    i += 1;
    await call(user, action);
    // Think time: real people pause between taps.
    await sleep(jitter(profile.name === "message_send" ? 500 : 800, 3000));
  }
}

/* ---------------- main ---------------- */
console.log(`STAGE ${STAGE} users | ramp ${RAMP_S}s | warmup ${WARMUP_S}s | measured ${DURATION_S}s`);
console.log(`target ${APP}`);
console.log(`supabase ref ${ref}`);

const assignments = [];
{
  const pool = [];
  for (const p of PROFILES) for (let i = 0; i < p.weight; i += 1) pool.push(p);
  for (let i = 0; i < STAGE; i += 1) assignments.push(pool[Math.floor((i * pool.length) / STAGE)]);

  // The seeder gives conversations to users 001-005 only. A sender assigned to
  // any other account would silently skip every send, so the message_send
  // profile is pinned to accounts that actually have a thread. Without this the
  // integrity check would pass by writing nothing at all.
  const sendProfile = PROFILES.find((p) => p.name === "message_send");
  const senders = assignments.reduce((n, p) => n + (p === sendProfile ? 1 : 0), 0);
  const withThreads = [0, 1, 2, 3, 4].filter((i) => i < STAGE);
  for (const [slot, idx] of withThreads.slice(0, senders).entries()) {
    const displaced = assignments[idx];
    assignments[idx] = sendProfile;
    // Give the displaced profile to a sender slot elsewhere so the mix holds.
    const victim = assignments.findIndex((p, j) => p === sendProfile && !withThreads.includes(j));
    if (victim !== -1) assignments[victim] = displaced;
    void slot;
  }
}

console.log("\nauthenticating…");
const authStart = performance.now();
const users = [];
for (let i = 1; i <= STAGE; i += 1) {
  try {
    const u = await authenticate(i);
    u.sentIds = [];
    users.push(u);
  } catch (e) {
    console.error("  auth failed:", e.message);
  }
}
const authTotal = performance.now() - authStart;
const authTimes = users.map((u) => u.authMs).sort((a, b) => a - b);
console.log(`  ${users.length}/${STAGE} authenticated in ${(authTotal / 1000).toFixed(1)}s ` +
  `(per-user p50 ${pct(authTimes, 50).toFixed(0)}ms p95 ${pct(authTimes, 95).toFixed(0)}ms)`);
if (users.length < STAGE) console.log(`  WARNING: ${STAGE - users.length} users failed to authenticate`);

const cpuBefore = process.cpuUsage();
const wallBefore = performance.now();

console.log(`\nramping in over ${RAMP_S}s, then ${WARMUP_S}s warm-up (not measured)…`);
const stopAt = Date.now() + (RAMP_S + WARMUP_S + DURATION_S) * 1000;
const runners = users.map(async (user, i) => {
  await sleep((i / users.length) * RAMP_S * 1000);
  return runUser(user, assignments[i], stopAt);
});

setTimeout(() => {
  measuring = true;
  console.log(`\n[${new Date().toISOString().slice(11, 19)}] MEASURING for ${DURATION_S}s…`);
}, (RAMP_S + WARMUP_S) * 1000);

const measureStart = Date.now() + (RAMP_S + WARMUP_S) * 1000;
await Promise.all(runners);
measuring = false;

const measuredSeconds = (Date.now() - measureStart) / 1000;
const cpu = process.cpuUsage(cpuBefore);
const wall = performance.now() - wallBefore;

/* ---------------- report ---------------- */
console.log("\n" + "=".repeat(78));
console.log(`STAGE ${STAGE} RESULTS  (measured ${measuredSeconds.toFixed(0)}s)`);
console.log("=".repeat(78));
console.log("route            reqs    p50     p90     p95     p99     max   4xx  5xx  t/o");

let total = 0, ok = 0, c4 = 0, c5 = 0, to = 0;
const allTimes = [];
for (const [route, s] of [...stats].sort()) {
  const t = [...s.times].sort((a, b) => a - b);
  allTimes.push(...t);
  total += t.length; ok += s.ok; c4 += s.c4; c5 += s.c5; to += s.timeouts;
  console.log(
    `${route.padEnd(15)} ${String(t.length).padStart(5)} ` +
    `${pct(t,50).toFixed(0).padStart(6)}ms${pct(t,90).toFixed(0).padStart(6)}ms` +
    `${pct(t,95).toFixed(0).padStart(6)}ms${pct(t,99).toFixed(0).padStart(6)}ms` +
    `${Math.max(...t,0).toFixed(0).padStart(6)}ms ${String(s.c4).padStart(4)} ${String(s.c5).padStart(4)} ${String(s.timeouts).padStart(4)}`
  );
}

allTimes.sort((a, b) => a - b);
const rps = total / Math.max(1, measuredSeconds);
console.log("-".repeat(78));
console.log(`TOTAL requests ${total} | ${rps.toFixed(1)} req/s | success ${((ok/Math.max(1,total))*100).toFixed(2)}%`);
console.log(`GLOBAL p50 ${pct(allTimes,50).toFixed(0)}ms  p95 ${pct(allTimes,95).toFixed(0)}ms  p99 ${pct(allTimes,99).toFixed(0)}ms  max ${Math.max(...allTimes,0).toFixed(0)}ms`);
console.log(`4xx ${c4} (${((c4/Math.max(1,total))*100).toFixed(2)}%) | 5xx ${c5} (${((c5/Math.max(1,total))*100).toFixed(2)}%) | timeouts ${to}`);

// Generator saturation: if the laptop is pegged, we measured the laptop.
const cpuPct = ((cpu.user + cpu.system) / 1000 / wall) * 100 / os.cpus().length;
console.log(`\nGENERATOR cpu ${cpuPct.toFixed(1)}% of ${os.cpus().length} cores | rss ${(process.memoryUsage().rss/1048576).toFixed(0)}MB | free ram ${(os.freemem()/1073741824).toFixed(1)}GB`);
if (cpuPct > 70) console.log("  WARNING: generator CPU high -- latency may reflect the client, not the server.");

// Message ids for the integrity check.
const sent = users.flatMap((u) => u.sentIds);
if (sent.length) {
  console.log(`\nMESSAGE SENDS attempted ids: ${sent.length} (prefix load-${STAGE}-)`);
}
