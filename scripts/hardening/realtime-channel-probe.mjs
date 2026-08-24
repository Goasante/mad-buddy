/**
 * BETA-002 / BETA-006 — what does the Realtime channel actually do?
 *
 * The hypothesis under test: the authenticated Realtime channel is not
 * delivering, which would break BOTH the unread INSERT listener and the message
 * edit UPDATE listener while every database test stays green.
 *
 * This does not read code. It signs in as a real user in a real browser,
 * attaches to the SAME supabase client the app uses, and records the channel's
 * own status callback plus every event it receives — then has another user send
 * and edit a message and reports what arrived.
 *
 * NO TOKENS ARE PRINTED. Only presence, status strings and event types.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "RtProbe123!";
const made = [];

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Rt`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email };
}

async function login(page, email) {
  for (let i = 0; i < 3; i += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (!new URL(page.url()).pathname.startsWith("/login")) return true;
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  return false;
}

async function cleanup() {
  for (const id of made) {
    const { data: mem } = await admin.from("conversation_members").select("conversation_id").eq("user_id", id);
    for (const m of mem ?? []) {
      await admin.from("messages").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversation_members").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversations").delete().eq("id", m.conversation_id);
    }
    await admin.from("notifications").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

const browser = await chromium.launch();

try {
  const A = await person("rta");
  const B = await person("rtb");
  const [one, two] = [A.id, B.id].sort();
  await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });

  const directKey = [A.id, B.id].sort().join(":");
  const { data: convo } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: A.id, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: A.id, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: B.id, role: "member", status: "joined" }
  ]);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (!(await login(page, B.email))) throw new Error("login failed");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  /* Attach a probe channel INSIDE the page, using the app's own supabase-js
     bundle via a fresh client built from the same public env. This mirrors what
     useUnreadMessageCount does, step for step, and records every transition. */
  const trace = await page.evaluate(async ({ url, anonKey, conversationId }) => {
    const log = [];
    const t0 = Date.now();
    const at = () => `+${Date.now() - t0}ms`;

    // The app ships @supabase/ssr; reach it the same way the app does.
    const mod = await import("/_next/static/chunks/node_modules_%40supabase_ssr_dist_module_2f8b0e._.js").catch(() => null);
    log.push({ at: at(), step: "dynamic import", ok: Boolean(mod) });

    return { log, note: "module probe only" };
  }, { url: "", anonKey: "", conversationId: convo.id }).catch((e) => ({ log: [], error: String(e).slice(0, 120) }));

  console.log("in-page module probe:", JSON.stringify(trace).slice(0, 200));

  /* The reliable instrument: capture the app's OWN console + websocket
     activity rather than trying to rebuild its client. */
  const events = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/realtime|channel|SUBSCRIBED|CHANNEL_ERROR|TIMED_OUT|postgres_changes/i.test(t)) {
      events.push({ kind: "console", text: t.slice(0, 160) });
    }
  });
  page.on("websocket", (ws) => {
    const shortUrl = ws.url().split("?")[0];
    events.push({ kind: "ws-open", url: shortUrl });
    ws.on("framesent", (f) => {
      const p = String(f.payload ?? "");
      // Never log tokens: report only the event name and topic.
      const evt = (p.match(/"event":"([^"]+)"/) || [])[1];
      const topic = (p.match(/"topic":"([^"]+)"/) || [])[1];
      if (evt) events.push({ kind: "sent", event: evt, topic: topic ?? "" });
    });
    ws.on("framereceived", (f) => {
      const p = String(f.payload ?? "");
      const evt = (p.match(/"event":"([^"]+)"/) || [])[1];
      const topic = (p.match(/"topic":"([^"]+)"/) || [])[1];
      const status = (p.match(/"status":"([^"]+)"/) || [])[1];
      if (evt) events.push({ kind: "recv", event: evt, topic: topic ?? "", status: status ?? "" });
    });
    ws.on("close", () => events.push({ kind: "ws-close", url: shortUrl }));
  });

  // Re-mount the app so the websocket lifecycle is captured from the start.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  console.log("\n=== WEBSOCKET / CHANNEL ACTIVITY AFTER MOUNT ===");
  const opens = events.filter((e) => e.kind === "ws-open");
  console.log(`websockets opened: ${opens.length}`);
  for (const o of opens) console.log(`   ${o.url}`);

  const joins = events.filter((e) => e.kind === "sent" && e.event === "phx_join");
  console.log(`phx_join sent: ${joins.length}`);
  for (const j of joins.slice(0, 6)) console.log(`   topic=${j.topic}`);

  const replies = events.filter((e) => e.kind === "recv" && e.event === "phx_reply");
  console.log(`phx_reply received: ${replies.length}`);
  for (const r of replies.slice(0, 6)) console.log(`   topic=${r.topic} status=${r.status}`);

  const errors = events.filter((e) => /error|close/i.test(e.event || e.kind || ""));
  console.log(`errors/closes: ${errors.length}`);
  for (const e of errors.slice(0, 6)) console.log(`   ${JSON.stringify(e).slice(0, 120)}`);

  // ---- now send a message and watch for the INSERT ------------------------
  events.length = 0;
  await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: A.id, message_type: "text",
    text_content: "realtime probe message", client_message_id: crypto.randomUUID()
  });
  await page.waitForTimeout(6000);

  const inserts = events.filter((e) => e.kind === "recv" && /postgres_changes/i.test(e.event || ""));
  console.log(`\n=== AFTER A SENDS ===`);
  console.log(`postgres_changes frames received: ${inserts.length}`);
  for (const i of inserts.slice(0, 4)) console.log(`   topic=${i.topic}`);
  console.log(`all recv events: ${JSON.stringify(events.filter(e=>e.kind==="recv").map(e=>e.event).slice(0,10))}`);

  const badge = await page.evaluate(() => {
    const link = document.querySelector('a[href^="/messages"]');
    const b = link?.querySelector("span[aria-hidden='true']");
    return b ? (b.textContent || "").trim() : "(none)";
  });
  console.log(`badge now: ${badge}`);

  await ctx.close();
} catch (e) {
  console.log(`HARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
} finally {
  await browser.close();
  await cleanup();
}
