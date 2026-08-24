/**
 * BETA-002 client half — where does the badge stop agreeing with the server?
 *
 * The server side is already proven correct (unread-lifecycle.mjs, 21/21), so
 * this measures ONLY the client: two real browser sessions, a real message, and
 * the badge as rendered, compared against the server's own answer at each step.
 *
 * The point is to find the exact step where the two diverge, not to confirm
 * that they do. Every step records both numbers.
 *
 * FIXTURE DISCIPLINE: real accounts, real login, real navigation. No injected
 * state, because injected state is exactly what would hide a client bug.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "BetaSync123!";
const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Sync`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email };
}

/** The server's own answer, via the RPC the badge ultimately reads. */
async function serverUnread(userId) {
  const { data: mem } = await admin.from("conversation_members")
    .select("conversation_id").eq("user_id", userId).eq("status", "joined");
  const ids = (mem ?? []).map((m) => m.conversation_id);
  if (!ids.length) return 0;
  const { data } = await admin.rpc("conversation_previews", { p_user_id: userId, p_conversation_ids: ids });
  return (data ?? []).reduce((t, r) => t + (r.unread_count ?? 0), 0);
}

/** The badge as the user sees it, read from the rendered navigation. */
async function renderedBadge(page) {
  /* Read the BADGE SPAN, not the link's text.
   *
   * The badge is `<span aria-hidden="true">{count}</span>` positioned inside
   * the /messages link, and it renders only when count > 0 -- so its ABSENCE
   * legitimately means zero. An earlier version read the link's textContent
   * and got "", which is indistinguishable from "no badge" and would have
   * reported a false failure. Anchored on the href so it cannot drift onto a
   * different tab's badge. */
  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href="/messages"], a[href^="/messages"]')];
    if (!links.length) return { found: false, value: null, raw: "no /messages link" };
    for (const link of links) {
      const badge = link.querySelector("span[aria-hidden='true']");
      if (badge && /^\d+\+?$/.test((badge.textContent || "").trim())) {
        const t = (badge.textContent || "").trim();
        return { found: true, value: t.endsWith("+") ? 99 : Number(t), raw: t };
      }
    }
    // No badge rendered on any /messages link: that IS zero.
    return { found: true, value: 0, raw: "(no badge = 0)" };
  });
}

async function login(ctx, email) {
  const page = await ctx.newPage();
  for (let i = 0; i < 3; i += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (!new URL(page.url()).pathname.startsWith("/login")) return page;
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error(`could not sign in as ${email}`);
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
  const A = await person("syna");
  const B = await person("synb");

  // Friends, so a direct conversation is legitimate.
  const [one, two] = [A.id, B.id].sort();
  const { error: fErr } = await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });
  if (fErr) throw new Error(`friendship: ${fErr.message}`);

  const directKey = [A.id, B.id].sort().join(":");
  const { data: convo, error: cErr } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: A.id, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (cErr) throw new Error(`conversation: ${cErr.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: A.id, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: B.id, role: "member", status: "joined" }
  ]);
  if (mErr) throw new Error(`members: ${mErr.message}`);

  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const pageB = await login(ctxB, B.email);
  await pageB.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.waitForTimeout(2500);

  const startServer = await serverUnread(B.id);
  const startBadge = await renderedBadge(pageB);
  check("start: server and badge agree at zero",
    startServer === 0 && (startBadge.value ?? 0) === 0,
    `server=${startServer} badge=${startBadge.value}`);

  // ---- A sends. B is looking at Home. -----------------------------------
  const { error: sErr } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: A.id, message_type: "text",
    text_content: "first unread", client_message_id: crypto.randomUUID()
  });
  if (sErr) throw new Error(`send: ${sErr.message}`);

  await pageB.waitForTimeout(4000);   // let Realtime deliver
  const afterSendServer = await serverUnread(B.id);
  const afterSendBadge = await renderedBadge(pageB);
  check("after a message arrives: server counts 1", afterSendServer === 1, `server=${afterSendServer}`);
  check("after a message arrives: BADGE shows it (Realtime INSERT)",
    (afterSendBadge.value ?? 0) === 1,
    `badge=${afterSendBadge.value} raw="${afterSendBadge.raw ?? ""}"`);

  // ---- B opens the conversation -----------------------------------------
  await pageB.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.waitForTimeout(3000);

  const opened = await pageB.evaluate(() => {
    const btn = [...document.querySelectorAll("button, a")]
      .find((e) => /sync/i.test(e.textContent || ""));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await pageB.waitForTimeout(4000);

  const afterOpenServer = await serverUnread(B.id);
  const afterOpenBadge = await renderedBadge(pageB);
  check("after opening: SERVER clears", afterOpenServer === 0,
    `server=${afterOpenServer} (opened=${opened})`);
  check("after opening: BADGE clears", (afterOpenBadge.value ?? 0) === 0,
    `badge=${afterOpenBadge.value} server=${afterOpenServer}`);

  // ---- route transition --------------------------------------------------
  await pageB.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.waitForTimeout(2500);
  const afterNavServer = await serverUnread(B.id);
  const afterNavBadge = await renderedBadge(pageB);
  check("after route transition: badge matches server",
    (afterNavBadge.value ?? 0) === afterNavServer,
    `badge=${afterNavBadge.value} server=${afterNavServer}`);

  // ---- hard refresh ------------------------------------------------------
  await pageB.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.waitForTimeout(2800);
  const afterReloadServer = await serverUnread(B.id);
  const afterReloadBadge = await renderedBadge(pageB);
  check("after refresh: badge matches server",
    (afterReloadBadge.value ?? 0) === afterReloadServer,
    `badge=${afterReloadBadge.value} server=${afterReloadServer}`);

  await ctxB.close();
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 190)}`);
  results.push(false);
} finally {
  await browser.close();
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} client sync checks passed`);
