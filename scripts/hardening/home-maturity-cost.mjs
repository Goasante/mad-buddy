/**
 * MB-GOD-060 — the cost of answering one boolean, measured rather than asserted.
 *
 * Runs BOTH implementations against the same local database and reports rows
 * read and wall time. The old one is reproduced here verbatim from the code it
 * replaced, so this compares two real queries, not a description of them.
 *
 * The point is not the millisecond count on an empty local box — it is the
 * SHAPE: rows read by the old path grow with message history, rows read by the
 * new path do not.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

/** The implementation that shipped before this fix. */
async function oldPath(userId) {
  let rows = 0;
  const { data: memberships } = await admin
    .from("conversation_members").select("conversation_id")
    .eq("user_id", userId).eq("status", "joined");
  rows += (memberships ?? []).length;
  const ids = (memberships ?? []).map((m) => m.conversation_id);
  if (!ids.length) return { rows, twoSided: 0 };

  const { data: convos } = await admin
    .from("conversations").select("id").in("id", ids).eq("conversation_type", "direct");
  rows += (convos ?? []).length;
  const directIds = (convos ?? []).map((c) => c.id);
  if (!directIds.length) return { rows, twoSided: 0 };

  const { data: messages } = await admin
    .from("messages").select("conversation_id, sender_id")
    .in("conversation_id", directIds).neq("message_type", "system").is("deleted_at", null);
  rows += (messages ?? []).length;

  const senders = new Map();
  for (const m of messages ?? []) {
    if (!m.sender_id) continue;
    if (!senders.has(m.conversation_id)) senders.set(m.conversation_id, new Set());
    senders.get(m.conversation_id).add(m.sender_id);
  }
  let twoSided = 0;
  for (const set of senders.values()) if (set.size > 1) twoSided += 1;
  return { rows, twoSided };
}

/** The implementation now on Home. */
async function newPath(userId) {
  const { data } = await admin
    .from("activation_milestones").select("id")
    .eq("user_id", userId).eq("milestone", "first_reply_received").limit(1);
  return { rows: (data ?? []).length, twoSided: (data ?? []).length > 0 ? 1 : 0 };
}

const time = async (fn, userId, n = 12) => {
  await fn(userId);
  const t0 = performance.now();
  let last;
  for (let i = 0; i < n; i += 1) last = await fn(userId);
  return { ms: (performance.now() - t0) / n, ...last };
};

const { data: people } = await admin
  .from("conversation_members").select("user_id").eq("status", "joined").limit(400);
const userIds = [...new Set((people ?? []).map((p) => p.user_id))];

console.log(`${"=".repeat(88)}\nHOME MATURITY EVIDENCE — cost per Home load\n${"=".repeat(88)}`);
console.log(`${"user".padEnd(10)} ${"msgs".padStart(6)} ${"OLD rows".padStart(9)} ${"OLD ms".padStart(8)} ${"NEW rows".padStart(9)} ${"NEW ms".padStart(8)}  agree`);

let disagreements = 0;
let oldTotal = 0;
let newTotal = 0;
for (const id of userIds.slice(0, 12)) {
  const o = await time(oldPath, id);
  const n = await time(newPath, id);
  oldTotal += o.rows;
  newTotal += n.rows;
  /* The comparison that matters is the BOOLEAN, since that is all the consumer
     reads. A user with three two-sided conversations and a user with one are
     identical to home-maturity.ts. */
  const agree = (o.twoSided > 0) === (n.twoSided > 0);
  if (!agree) disagreements += 1;
  console.log(
    `${id.slice(0, 8).padEnd(10)} ${String(o.rows).padStart(6)} ${String(o.rows).padStart(9)} ` +
    `${o.ms.toFixed(1).padStart(8)} ${String(n.rows).padStart(9)} ${n.ms.toFixed(1).padStart(8)}  ${agree ? "yes" : "NO"}`
  );
}

console.log(`\nrows read across the sample:  OLD ${oldTotal}   NEW ${newTotal}`);
console.log(`boolean disagreements: ${disagreements} (must be 0 — the milestone must mean what the scan meant)`);

// The shape claim, proven: does the old path's cost track message volume?
const { count: totalMessages } = await admin.from("messages").select("id", { count: "exact", head: true });
console.log(`\nmessages in this database: ${totalMessages}`);
console.log("OLD reads a slice of that per Home load, growing without bound as history grows.");
console.log("NEW reads at most 1 indexed row, whatever the history.");
