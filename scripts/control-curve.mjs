#!/usr/bin/env node
/**
 * Three-route control curve: cheap -> medium -> heavy, at 1/5/10/25 users.
 *
 *   node scripts/control-curve.mjs <appUrl> <route> <concurrency> [seconds]
 *
 * Captures BOTH client wall time and the route's own Server-Timing, then
 * computes `outside_server` PER REQUEST before percentiling. Subtracting one
 * aggregate p95 from another would invent a number that no single request ever
 * experienced.
 *
 * That difference is the whole point: if wall explodes while server total stays
 * flat, the wait is outside measured application execution (queueing/platform).
 * If server total itself explodes, downstream app work is degrading.
 */

import { readFileSync } from "node:fs";

const readEnv = (p) => {
  const o = {};
  let t;
  try { t = readFileSync(p, "utf8"); } catch { return o; }
  for (const l of t.split(/\r?\n/)) {
    const s = l.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i > 0) {
      const v = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (v && v !== "PASTE_HERE") o[s.slice(0, i).trim()] = v;
    }
  }
  return o;
};

const load = readEnv("C:/mb-load/.env.load.local");
const staging = readEnv("C:/mb-load/.env.staging.local");

const APP = process.argv[2];
const ROUTE = process.argv[3];
const USERS = Number(process.argv[4] ?? 1);
const SECONDS = Number(process.argv[5] ?? 90);
const WARMUP = Number(process.argv[6] ?? 30);

const ROUTES = {
  unread: "/api/messages/unread-count",
  messages: "/api/messages/conversations",
  profile: "/api/profile"
};
const PATH = ROUTES[ROUTE];
if (!APP || !PATH) {
  console.error("usage: control-curve.mjs <appUrl> <unread|messages|profile> <users> [seconds] [warmup]");
  process.exit(1);
}

const ref = new URL(staging.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref === "cabkhxxnrybzhkbtoiiz") { console.error("HARD STOP: production ref"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);
const pct = (arr, q) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((q / 100) * a.length))];
};

// Authenticate distinct synthetic users BEFORE measuring: login cost is setup,
// not route latency. The route's own resolveApiUser stays included, because
// that is real per-request cost.
const tokens = [];
for (let i = 1; i <= USERS; i += 1) {
  const email = `staging-user-${String(i).padStart(3, "0")}@staging.example.com`;
  const r = await fetch(`${staging.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: staging.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: staging.MAD_BUDDY_STAGING_USER_PASSWORD })
  });
  if (!r.ok) { console.error(`auth ${i} failed: ${r.status}`); continue; }
  tokens.push((await r.json()).access_token);
}

const samples = [];
let measuring = false;
let errors = 0;
let timeouts = 0;
const statuses = {};

async function worker(token) {
  const headers = {
    "x-vercel-protection-bypass": load.VERCEL_AUTOMATION_BYPASS_SECRET,
    Authorization: `Bearer ${token}`
  };
  while (Date.now() < stopAt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const started = performance.now();
    try {
      const res = await fetch(`${APP}${PATH}`, { headers, signal: controller.signal });
      const wall = performance.now() - started;
      await res.text();
      const st = res.headers.get("server-timing") ?? "";
      const get = (k) => {
        const m = new RegExp(`${k};dur=([\\d.]+)`).exec(st);
        return m ? Number(m[1]) : null;
      };
      if (measuring) {
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        if (res.status >= 400) errors += 1;
        const total = get("total");
        samples.push({
          wall,
          total,
          auth: get("auth"),
          work: get("work") ?? (total !== null ? total - (get("auth") ?? 0) : null),
          // Per-request difference, computed here and percentiled later.
          outside: total !== null ? wall - total : null
        });
      }
    } catch (e) {
      if (measuring) { timeouts += 1; errors += 1; }
      void e;
    } finally {
      clearTimeout(timer);
    }
    await sleep(jitter(800, 3000));
  }
}

const stopAt = Date.now() + (WARMUP + SECONDS) * 1000;
setTimeout(() => { measuring = true; }, WARMUP * 1000);

const begun = Date.now();
await Promise.all(tokens.map((t, i) => sleep((i / Math.max(1, tokens.length)) * 5000).then(() => worker(t))));

const measuredSec = (Date.now() - begun - WARMUP * 1000) / 1000;
const col = (k) => samples.map((s) => s[k]).filter((v) => v !== null && v !== undefined);

const wall = col("wall"), total = col("total"), auth = col("auth"), work = col("work"), outside = col("outside");
console.log(`\nROUTE=${ROUTE} USERS=${USERS} measured=${measuredSec.toFixed(0)}s n=${samples.length}`);
console.log(`  CLIENT   p50 ${pct(wall,50).toFixed(0)} p95 ${pct(wall,95).toFixed(0)} p99 ${pct(wall,99).toFixed(0)}`);
console.log(`  SERVER   p50 ${pct(total,50).toFixed(0)} p95 ${pct(total,95).toFixed(0)} p99 ${pct(total,99).toFixed(0)}`);
console.log(`  AUTH     p50 ${pct(auth,50).toFixed(0)} p95 ${pct(auth,95).toFixed(0)}`);
console.log(`  WORK     p50 ${pct(work,50).toFixed(0)} p95 ${pct(work,95).toFixed(0)}`);
console.log(`  OUTSIDE  p50 ${pct(outside,50).toFixed(0)} p95 ${pct(outside,95).toFixed(0)}`);
console.log(`  rps ${(samples.length / Math.max(1, measuredSec)).toFixed(2)} | errors ${errors} | timeouts ${timeouts} | statuses ${JSON.stringify(statuses)}`);
