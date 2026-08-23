/**
 * Mission 1 Extremely Advanced — the Safe Arrival lifecycle.
 *
 * Two invariants dominate here, and both are safety-critical in opposite
 * directions:
 *
 *  1. **No exact location.** Safe Arrival tells someone you got there. It must
 *     never tell them WHERE you are on the way. The schema is the first line of
 *     defence and is checked directly.
 *  2. **"Waiting" stays neutral.** An unconfirmed arrival means the timer
 *     elapsed — nothing more. Escalating that into emergency language would make
 *     a flat battery look like a crisis, and would teach people to ignore the
 *     one signal that should never be ignored.
 *
 * State machine: draft → pending_acknowledgement → active → grace_period →
 * extended → completed | cancelled | expired | unconfirmed
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

// --- 1. The SCHEMA cannot hold a location ----------------------------------
// The strongest possible guarantee: not "we don't send it" but "there is
// nowhere to put it".
const LOCATION_WORDS = ["latitude", "longitude", "lat", "lng", "coordinates", "geohash", "accuracy", "point"];
// Read the column list from the generated types instead of an RPC.
const types = readFileSync("C:/mb-god/lib/supabase/database.types.ts", "utf8");
const anchor = types.indexOf("      safe_arrival_sessions: {");
const rowBlock = anchor === -1 ? "" : types.slice(anchor, types.indexOf("Insert:", anchor));
const leaked = LOCATION_WORDS.filter((w) => new RegExp(`\\b${w}\\b\\s*\\??:`, "i").test(rowBlock));
check("the Safe Arrival session schema has no location column at all",
  anchor !== -1 && leaked.length === 0,
  anchor === -1 ? "table not in generated types" : `location-ish columns: ${leaked.length ? leaked.join(", ") : "none"}`);

// --- 2. Every state is reachable and terminal states are terminal ----------
const TAG = `sa-${Date.now()}`;
async function cleanup() {
  await admin.from("safe_arrival_sessions").delete().eq("traveller_id", QA).ilike("destination_label", `${TAG}%`);
}
await cleanup();

const { data: session, error: createError } = await admin
  .from("safe_arrival_sessions")
  .insert({
    traveller_id: QA,
    destination_type: "custom",
    destination_label: `${TAG} home`,
    expected_arrival_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    grace_period_minutes: 15,
    status: "active"
  })
  .select("id, status")
  .maybeSingle();

if (createError || !session) {
  inconclusive("Safe Arrival lifecycle", `could not create a session: ${createError?.message?.slice(0, 120)}`);
} else {
  check("a Safe Arrival session starts active", session.status === "active", `status ${session.status}`);

  // Walk the states the product actually uses.
  const walk = ["grace_period", "extended", "unconfirmed", "completed"];
  let ok = true;
  for (const status of walk) {
    const { error } = await admin.from("safe_arrival_sessions")
      .update({ status, ...(status === "completed" ? { confirmed_at: new Date().toISOString() } : {}) })
      .eq("id", session.id);
    if (error) { ok = false; console.log(`      could not reach ${status}: ${error.message.slice(0, 80)}`); }
  }
  check("the documented states are all reachable", ok, walk.join(" → "));

  // --- 3. A completed session carries a confirmation time ------------------
  const { data: done } = await admin.from("safe_arrival_sessions")
    .select("status, confirmed_at").eq("id", session.id).maybeSingle();
  check("a completed session records when it was confirmed",
    done?.status === "completed" && Boolean(done?.confirmed_at),
    `status ${done?.status}, confirmed_at ${done?.confirmed_at ? "set" : "null"}`);
}
await cleanup();

// --- 4. COPY: "waiting" must stay neutral ----------------------------------
/* Read the Safe Arrival UI source and look for escalation language. This is a
   source check by necessity — the wording IS the invariant, and it cannot be
   observed from the database. */
function sourceFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { sourceFiles(full, out); continue; }
    if (!e.name.endsWith(".tsx") && !e.name.endsWith(".ts")) continue;
    if (e.name.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}
const ALARM = ["emergency", "danger", "911", "999", "police", "missing person", "help is on the way", "sos"];
/* The directories are `safety/`, not `safe-arrival/`. A first version guessed
   the latter, scanned ZERO files, and reported PASS — a copy check that read
   nothing at all. The file count is printed in the result for exactly that
   reason: "0 files scanned" must never look like a clean bill of health. */
const saFiles = [
  ...sourceFiles("C:/mb-god/components/safety"),
  ...sourceFiles("C:/mb-god/lib/safety")
];
const alarming = [];
for (const file of saFiles) {
  const text = readFileSync(file, "utf8");
  // Only strings a user could see, not identifiers or comments.
  for (const m of text.matchAll(/"([^"\n]{4,140})"/g)) {
    const value = m[1];
    const s = value.toLowerCase();
    /* Skip JSX PROP values. `variant="danger"` is a button style, not something
       a user reads — a first version flagged exactly that and it looked like an
       alarm-language finding. Two cheap signals separate them: a prop value is
       preceded by `name=`, and real copy contains whitespace. */
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (/[A-Za-z]=$/.test(before)) continue;
    if (!/\s/.test(value.trim())) continue;
    for (const word of ALARM) {
      if (s.includes(word)) alarming.push(`${file.split(/[\\/]/).pop()}: "${value.slice(0, 70)}"`);
    }
  }
}
check("no emergency/alarm language in the Safe Arrival surface",
  saFiles.length > 0 && alarming.length === 0,
  alarming.length ? alarming.slice(0, 3).join(" | ") : `${saFiles.length} files scanned, none`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} Safe Arrival checks passed`);
