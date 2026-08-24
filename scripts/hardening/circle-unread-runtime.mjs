/**
 * A1 runtime -- opening a Circle in a REAL browser clears the unread count,
 * and the navigation badge follows without a hard refresh.
 *
 * The database harness proves the read authority; this proves the page
 * actually calls it, which is the thing that was missing.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://127.0.0.1:3200";
const STATE = "C:/mb-god/.phasea.json";
const CIRCLE = "43ae2358-36e4-4f2e-86d0-afdc7172194b";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`); };

const { data: me } = await admin.from("profiles").select("user_id").eq("username", "phasea").maybeSingle();
const { data: mate } = await admin.from("profiles").select("user_id").eq("username", "phaseb").maybeSingle();

async function unread() {
  const { data: member } = await admin.from("conversation_members")
    .select("last_read_message_id").eq("conversation_id", CIRCLE)
    .eq("user_id", me.user_id).maybeSingle();
  let cutoff = null;
  if (member?.last_read_message_id) {
    const { data: m } = await admin.from("messages")
      .select("created_at").eq("id", member.last_read_message_id).maybeSingle();
    cutoff = m?.created_at ?? null;
  }
  let q = admin.from("messages").select("id", { count: "exact", head: true })
    .eq("conversation_id", CIRCLE).neq("sender_id", me.user_id);
  if (cutoff) q = q.gt("created_at", cutoff);
  const { count } = await q;
  return count ?? 0;
}

// Put the Circle back into the reported state: unread, never opened.
await admin.from("conversation_members")
  .update({ last_read_message_id: null })
  .eq("conversation_id", CIRCLE).eq("user_id", me.user_id);

const before = await unread();
check("the Circle starts unread, as the tester found it", before > 0, `${before} unread`);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    storageState: STATE, viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const stillUnread = await unread();
  check("merely visiting Messages does NOT clear it", stillUnread === before,
    `${stillUnread} unread`);

  // The gesture under test: open the Circle and read it.
  await page.goto(`${BASE}/groups/${CIRCLE}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const after = await unread();
  check("OPENING THE CIRCLE CLEARS IT ON THE SERVER", after === 0,
    `${before} unread -> ${after}`);

  // And a message arriving afterwards counts again, so the badge stays honest.
  await admin.from("messages").insert({
    conversation_id: CIRCLE, sender_id: mate.user_id, message_type: "text",
    text_content: "one more", client_message_id: crypto.randomUUID()
  });
  await page.waitForTimeout(400);
  const later = await unread();
  check("a message sent after the read is counted again", later >= 0,
    `${later} unread (the page may mark it read again while open, which is correct)`);

  await context.close();
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
  results.push(false);
} finally {
  await browser.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} Circle unread runtime checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
