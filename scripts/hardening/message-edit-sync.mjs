/**
 * BETA-006 — an edited message must reach the recipient without a reload.
 *
 * Tested AFTER the CSP fix for BETA-002, to answer the specific question:
 * were these the same bug? The messages page subscribes to
 * `postgres_changes` with `event: "*"` (INSERT, UPDATE and DELETE) and
 * refetches through the server action, so if the socket was blocked, edits
 * could not propagate either -- the same single cause, no second mechanism.
 *
 * B keeps the conversation OPEN while A edits. That is the reported scenario
 * and the only one that exercises live delivery; a test that reloads between
 * the edit and the assertion would pass even with the socket dead.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "EditSync123!";
const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Edit`, is_onboarded: true
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

async function makePair(kind, creator, members, directKey = null) {
  const { data, error } = await admin.from("conversations")
    .insert({ conversation_type: kind, created_by: creator, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (error) throw new Error(`conversation: ${error.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert(
    members.map((u) => ({ conversation_id: data.id, user_id: u, role: u === creator ? "owner" : "member", status: "joined" }))
  );
  if (mErr) throw new Error(`members: ${mErr.message}`);
  return data.id;
}

const bodyText = (page) =>
  page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));

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
  const A = await person("edta");
  const B = await person("edtb");
  const [one, two] = [A.id, B.id].sort();
  await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });

  const direct = await makePair("direct", A.id, [A.id, B.id], [A.id, B.id].sort().join(":"));
  const { data: original, error: sErr } = await admin.from("messages").insert({
    conversation_id: direct, sender_id: A.id, message_type: "text",
    text_content: "Hello", client_message_id: crypto.randomUUID()
  }).select("id").maybeSingle();
  if (sErr) throw new Error(`send: ${sErr.message}`);

  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const pageB = await ctxB.newPage();
  if (!(await login(pageB, B.email))) throw new Error("B login failed");

  // B opens the conversation and STAYS there.
  await pageB.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.waitForTimeout(3500);
  await pageB.evaluate(() => {
    const btn = [...document.querySelectorAll("button, a")].find((e) => /edta|Edit/i.test(e.textContent || ""));
    if (btn) btn.click();
  });
  await pageB.waitForTimeout(3500);

  const before = await bodyText(pageB);
  check("B sees the original message", /Hello/.test(before), before.includes("Hello") ? "\"Hello\" rendered" : "not found");

  // ---- A edits, while B is still looking ---------------------------------
  const { error: eErr } = await admin.from("messages")
    .update({ text_content: "Hello there", edited_at: new Date().toISOString() })
    .eq("id", original.id);
  if (eErr) throw new Error(`edit: ${eErr.message}`);

  // Canonical value changed?
  const { data: canon } = await admin.from("messages").select("text_content, edited_at").eq("id", original.id).maybeSingle();
  check("the database holds the edited value",
    canon?.text_content === "Hello there" && Boolean(canon?.edited_at),
    `text="${canon?.text_content}" edited_at=${canon?.edited_at ? "set" : "null"}`);

  // The whole point: B updates WITHOUT reloading.
  await pageB.waitForTimeout(7000);
  const after = await bodyText(pageB);
  check("B sees the EDIT without reloading (realtime UPDATE)",
    /Hello there/.test(after),
    /Hello there/.test(after) ? "live update delivered" : "still stale — BETA-006");

  // And a reload is canonical either way.
  await pageB.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.waitForTimeout(3500);
  await pageB.evaluate(() => {
    const btn = [...document.querySelectorAll("button, a")].find((e) => /edta|Edit/i.test(e.textContent || ""));
    if (btn) btn.click();
  });
  await pageB.waitForTimeout(3000);
  const reloaded = await bodyText(pageB);
  check("after reload the edited value is canonical", /Hello there/.test(reloaded));

  await ctxB.close();
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 190)}`);
  results.push(false);
} finally {
  await browser.close();
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} message edit sync checks passed`);
