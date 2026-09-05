#!/usr/bin/env node
/**
 * Canonical bootstrap for the DB-backed (`*.local.test.ts`) suites.
 *
 * "Personas seeded" did not mean "local test database ready": after a reset
 * that loaded only the persona seed, 61 `.local` tests failed, and restoring
 * the chats-v4 fixture returned the run to zero. Two half-fixtures with no
 * single entry point is what produced that, so this composes both and then
 * PROVES the resulting shape rather than trusting an exit code.
 *
 * Local only, and it refuses to run anywhere else. It writes test data into a
 * real database; pointed at a remote project it would write into that one.
 *
 * Usage:  npm run seed:local-tests
 *         npm run seed:local-tests -- --verify   (check only, no writes)
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const VERIFY_ONLY = process.argv.includes("--verify");
const PRODUCTION_REF = "cabkhxxnrybzhkbtoiiz";
const STAGING_REF = "ivaydmciwmjdjsrovbqb";

/* ---------------- environment + safety ---------------- */
const env = {};
const envPath = path.join(ROOT, ".env.local");
if (!existsSync(envPath)) {
  console.error("FAIL: .env.local not found. This seeds the LOCAL test database only.");
  process.exit(1);
}
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
let host = "";
try { host = new URL(url).host; } catch { /* handled below */ }

if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
  console.error(`FAIL: refusing to seed a non-local target (host: ${host || "unparseable"}).`);
  process.exit(1);
}
if (!serviceRole) { console.error("FAIL: SUPABASE_SERVICE_ROLE_KEY missing."); process.exit(1); }
for (const [name, ref] of [["production", PRODUCTION_REF], ["staging", STAGING_REF]]) {
  if (url.includes(ref) || serviceRole.includes(ref)) {
    console.error(`FAIL: resolved config references the ${name} project.`);
    process.exit(1);
  }
}
if (existsSync(path.join(ROOT, "supabase", ".temp", "project-ref"))) {
  console.error("FAIL: this repo is linked to a remote Supabase project. Unlink before seeding.");
  process.exit(1);
}
console.log(`target: ${host} (local, unlinked) ${VERIFY_ONLY ? "[verify only]" : ""}`);

const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

/* ---------------- the fixture contract ----------------
   These are the identities and conversations the `.local` suites address by
   constant. If any is missing the suites do not fail honestly -- they fail in
   ways that look like product defects. */
const REQUIRED_PERSONAS = ["qatester", "kofim", "amab"];
const V4_USERS = {
  A: "4a000000-0000-4000-8000-00000000004a",
  B: "4b000000-0000-4000-8000-00000000004b",
  C: "4c000000-0000-4000-8000-00000000004c",
  D: "4d000000-0000-4000-8000-00000000004d"
};
const V4_CONVERSATIONS = {
  direct: "4d1a0000-0000-4000-8000-0000000d1a00",
  group: "4c700000-0000-4000-8000-00000000c700"
};
const V4_EVENT = "4e000000-0000-4000-8000-00000000004e";
/** Linkr addresses its own four identities directly. */
const LINKR_USERS = [
  "0a000000-0000-4000-8000-00000000000a",
  "0b000000-0000-4000-8000-00000000000b",
  "0c000000-0000-4000-8000-00000000000c",
  "0d000000-0000-4000-8000-00000000000d"
];

/* ---------------- seed ---------------- */
function dockerDb() {
  const names = execSync('docker ps --format "{{.Names}}"', { encoding: "utf8" });
  const db = names.split(/\r?\n/).find((n) => /supabase_db/.test(n));
  if (!db) { console.error("FAIL: local Supabase database container is not running."); process.exit(1); }
  return db;
}

if (!VERIFY_ONLY) {
  console.log("\n1/2 personas + relationships");
  execSync("node scripts/hardening/seed-local.mjs", { stdio: "inherit" });

  console.log("\n2/2 chats-v4 fixture (identities, conversations, event room)");
  const container = dockerDb();
  // Piped via stdin rather than a shell redirect: `shell` differs across
  // platforms and /bin/bash does not exist on Windows.
  const fixture = readFileSync(path.join(ROOT, "scripts", "seed-chats-v4-fixture.sql"));
  execSync(`docker exec -i ${container} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1`, {
    input: fixture, stdio: ["pipe", "inherit", "inherit"]
  });

  /* The Linkr suite addresses four identities of its own. This fixture existed
     but was wired into no bootstrap, so that suite's `skipIf(!isLocal)` guard
     had nothing to run against -- and because a missing env made isLocal false,
     all 17 of its tests skipped silently instead of failing. */
  console.log("3/3 linkr fixture (four candidate identities)");
  const linkr = readFileSync(path.join(ROOT, "scripts", "hardening", "linkr-t2-fixtures.sql"));
  execSync(`docker exec -i ${container} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1`, {
    input: linkr, stdio: ["pipe", "inherit", "inherit"]
  });
}

/* ---------------- verify the SHAPE, not the exit code ---------------- */
console.log("\nverifying fixture contract");
const failures = [];
const ok = (label, condition, detail = "") => {
  console.log(`  ${condition ? "ok  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!condition) failures.push(label);
};

const { data: profiles } = await admin.from("profiles").select("user_id, username");
const byName = new Map((profiles ?? []).map((p) => [p.username, p.user_id]));
for (const name of REQUIRED_PERSONAS) ok(`persona ${name}`, byName.has(name));

const { data: authUsers } = await admin.from("profiles").select("user_id").in("user_id", Object.values(V4_USERS));
ok("chats-v4 identities A-D", (authUsers ?? []).length === 4, `${(authUsers ?? []).length}/4`);

const { data: convs } = await admin.from("conversations").select("id, conversation_type").in("id", Object.values(V4_CONVERSATIONS));
ok("fixture conversations (direct, group)", (convs ?? []).length === 2, `${(convs ?? []).length}/2`);

for (const [label, id] of Object.entries(V4_CONVERSATIONS)) {
  const { data: members } = await admin.from("conversation_members").select("user_id, status").eq("conversation_id", id);
  const joined = (members ?? []).filter((m) => m.status === "joined");
  ok(`${label} membership`, joined.length >= 2, `${joined.length} joined`);
  const ids = new Set((members ?? []).map((m) => m.user_id));
  ok(`${label} contains A and B`, ids.has(V4_USERS.A) && ids.has(V4_USERS.B));
}

const { data: room } = await admin.from("events").select("id, status").eq("id", V4_EVENT).maybeSingle();
ok("event-room fixture event", Boolean(room), room ? `status ${room.status}` : "missing");

const { data: linkr } = await admin.from("profiles").select("user_id").in("user_id", LINKR_USERS);
ok("linkr identities", (linkr ?? []).length === LINKR_USERS.length, `${(linkr ?? []).length}/${LINKR_USERS.length}`);

/* Duplicates would make "exactly one" assertions ambiguous. */
const { data: dupes } = await admin.from("conversations").select("id").in("id", Object.values(V4_CONVERSATIONS));
ok("no duplicate fixture conversations", (dupes ?? []).length === new Set((dupes ?? []).map((d) => d.id)).size);

const { count: friendships } = await admin.from("friendships").select("id", { count: "exact", head: true }).is("ended_at", null);
ok("at least one active friendship", (friendships ?? 0) > 0, `${friendships}`);

if (failures.length) {
  console.error(`\nSEED CONTRACT FAILED: ${failures.length} check(s) -> ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nseed contract satisfied. local DB test suites can run.");
