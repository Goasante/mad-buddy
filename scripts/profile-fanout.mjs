#!/usr/bin/env node
/**
 * Exact downstream fan-out for ONE GET /api/profile.
 *
 * Counts at the network boundary by wrapping global fetch, so every PostgREST
 * request, Auth call and RPC is observed no matter which client issues it.
 * This replaces arithmetic assembled from individual loaders -- those mixed
 * loader-local counts with route-global ones and could not be trusted.
 *
 * Local only. Requires a staging-pointed env; makes no hosted app request.
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

const staging = readEnv("C:/mb-load/.env.staging.local");
const ref = new URL(staging.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref === "cabkhxxnrybzhkbtoiiz") { console.error("HARD STOP: production ref"); process.exit(1); }

process.env.NEXT_PUBLIC_SUPABASE_URL = staging.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = staging.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = staging.SUPABASE_SERVICE_ROLE_KEY;

/* ---- instrument the network boundary ---- */
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method ?? (typeof input === "object" ? input.method : null) ?? "GET").toUpperCase();
  const started = performance.now();
  const res = await realFetch(input, init);
  const ms = performance.now() - started;

  const u = new URL(url);
  let kind = "other";
  let target = u.pathname;
  if (u.pathname.startsWith("/rest/v1/rpc/")) kind = method === "GET" ? "rpc_read" : "rpc";
  else if (u.pathname.startsWith("/rest/v1/")) {
    target = u.pathname.replace("/rest/v1/", "");
    const prefer = (init.headers?.Prefer ?? init.headers?.prefer ?? "");
    if (method === "GET") kind = /count=/.test(String(prefer)) || init.method === "HEAD" ? "count" : "select";
    else if (method === "POST") kind = String(prefer).includes("resolution=") ? "upsert" : "insert";
    else if (method === "PATCH") kind = "update";
    else if (method === "DELETE") kind = "delete";
    else if (method === "HEAD") kind = "count";
  } else if (u.pathname.startsWith("/auth/v1/admin")) { kind = "auth_admin"; target = u.pathname.replace("/auth/v1/", ""); }
  else if (u.pathname.startsWith("/auth/v1/")) { kind = "auth"; target = u.pathname.replace("/auth/v1/", ""); }

  calls.push({ kind, method, target: target.split("?")[0], query: u.search.slice(0, 90), ms });
  return res;
};

/* `server-only` is a Next.js runtime guard with no standalone implementation;
   stub it so the real loaders can be imported outside Next. */
import { Module } from "node:module";
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return realResolve.call(this, request, ...rest);
};
import { fileURLToPath } from "node:url";
const STUB = fileURLToPath(new URL("./.stub/server-only.cjs", import.meta.url));

/* ---- resolve a synthetic user, then run the route's own work ---- */
const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(staging.NEXT_PUBLIC_SUPABASE_URL, staging.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const username = process.argv[2] ?? "staging_user_001";
const { data: profile } = await admin.from("profiles").select("user_id").eq("username", username).maybeSingle();
if (!profile) { console.error(`no such synthetic profile: ${username}`); process.exit(1); }
const userId = profile.user_id;

calls.length = 0; // discard setup

const { loadEffectivePlan } = await import("../lib/billing/service.ts");
const { loadProfileIdentitySummary } = await import("../lib/profile/identity-service.ts");
const { loadJourney } = await import("../lib/journey/journey-service.ts");
const { readBuddyScoreSnapshot } = await import("../lib/engagement/buddy-score-service.ts");

const mark = (label) => calls.length ? (calls[calls.length - 1].phase = label) : null;
const tagFrom = (start, label) => { for (let i = start; i < calls.length; i += 1) calls[i].phase ??= label; };

let at = calls.length;
const score = await readBuddyScoreSnapshot(admin, userId);
tagFrom(at, "score");

at = calls.length;
await admin.from("profile_birth_details").select("date_of_birth").eq("user_id", userId).maybeSingle();
tagFrom(at, "birth");

at = calls.length;
await admin.from("profile_field_privacy").select("field_name, visibility").eq("user_id", userId).in("field_name", ["birthday", "age", "zodiac"]);
tagFrom(at, "privacy");

at = calls.length;
await loadEffectivePlan(admin, userId);
tagFrom(at, "plan");

// Mirror the real route: resolve the three shared counts once.
at = calls.length;
const [muddyResult, momentResult, safeArrivalResult] = await Promise.all([
  admin.from("friendships").select("id", { count: "exact", head: true }).or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
  admin.from("moments").select("id", { count: "exact", head: true }).eq("author_id", userId).in("status", ["active", "expired"]),
  admin.from("safe_arrival_sessions").select("id", { count: "exact", head: true }).eq("traveller_id", userId).eq("status", "completed")
]);
tagFrom(at, "shared");
const activity = {
  muddyCount: muddyResult.count ?? 0,
  momentCount: momentResult.count ?? 0,
  completedSafeArrivalCount: safeArrivalResult.count ?? 0
};

at = calls.length;
await loadProfileIdentitySummary(admin, userId, "self", { score, activity });
tagFrom(at, "identity");

at = calls.length;
await loadJourney(admin, userId, new Date(), { score, activity });
tagFrom(at, "journey");

void mark;

/* ---- report ---- */
console.log(`GET /api/profile downstream fan-out  (user ${username})`);
console.log("=".repeat(78));
console.log("phase      kind        method  target");
for (const c of calls) {
  console.log(`${(c.phase ?? "?").padEnd(10)} ${c.kind.padEnd(11)} ${c.method.padEnd(7)} ${c.target}`);
}

const by = (f) => calls.reduce((m, c) => (m[c[f]] = (m[c[f]] ?? 0) + 1, m), {});
console.log("\nBY KIND :", JSON.stringify(by("kind")));
console.log("BY PHASE:", JSON.stringify(by("phase")));

const k = by("kind");
const writes = (k.insert ?? 0) + (k.update ?? 0) + (k.delete ?? 0) + (k.upsert ?? 0) + (k.rpc ?? 0);
console.log("\nTOTALS");
console.log(`  auth              ${k.auth ?? 0}`);
console.log(`  auth_admin        ${k.auth_admin ?? 0}`);
console.log(`  select            ${k.select ?? 0}`);
console.log(`  count/head        ${k.count ?? 0}`);
console.log(`  rpc (read-only)   ${k.rpc_read ?? 0}`);
console.log(`  WRITES            ${writes}`);
console.log(`  other             ${k.other ?? 0}`);
console.log(`  TOTAL             ${calls.length}`);
