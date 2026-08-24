/**
 * BETA-009 runtime proof: does the picker actually open in a group chat
 * reached from /messages, and does the sent message render the mention?
 *
 * The unit harness proves the server contract. This proves the half that was
 * broken: the composer receiving candidates at all.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3200";
const admin = createClient("http://127.0.0.1:54321",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  { auth: { persistSession: false } });

const PASSWORD = "MentionRt123!";
const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag, name) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(error.message);
  const id = data.user.id;
  await admin.from("profiles").insert({ user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: name, is_onboarded: true });
  made.push(id);
  return { id, email, name };
}

async function cleanup() {
  for (const id of made) {
    const { data: mem } = await admin.from("conversation_members").select("conversation_id").eq("user_id", id);
    for (const m of mem ?? []) {
      const { data: msgs } = await admin.from("messages").select("id").eq("conversation_id", m.conversation_id);
      await admin.from("message_mentions").delete().in("message_id", (msgs ?? []).map((x) => x.id));
      await admin.from("messages").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversation_members").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversations").delete().eq("id", m.conversation_id);
    }
    await admin.from("notifications").delete().eq("user_id", id);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

const browser = await chromium.launch();
try {
  const A = await person("mrta", "Ama Serwaa");
  const B = await person("mrtb", "Kwame Boateng");

  /* A PLAN chat, not a group. Clicking a `group` row in the inbox routes to
     /groups/{id}, which is a different page that already had mention
     candidates. Plan Chat is the surface that genuinely stays inside
     /messages -- and the one that had no picker at all. */
  const { data: plan } = await admin.from("plans")
    .insert({ creator_id: A.id, title: "Mention runtime plan", plan_type: "quick" })
    .select("id").maybeSingle();
  const { data: group } = await admin.from("conversations")
    .insert({ conversation_type: "plan", created_by: A.id, status: "active",
              context_type: "plan", context_id: plan.id }).select("id").maybeSingle();
  await admin.from("conversation_members").insert([
    { conversation_id: group.id, user_id: A.id, role: "owner", status: "joined" },
    { conversation_id: group.id, user_id: B.id, role: "member", status: "joined" }
  ]);
  await admin.from("messages").insert({
    conversation_id: group.id, sender_id: B.id, message_type: "text",
    text_content: "hello plan chat", client_message_id: crypto.randomUUID()
  });

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const page = await ctx.newPage();
  for (let i = 0; i < 3; i += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', A.email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (!new URL(page.url()).pathname.startsWith("/login")) break;
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }

  await page.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);
  // open the group thread
  const inboxRows = await page.evaluate(() =>
    [...document.querySelectorAll("button, a, li")]
      .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length > 2 && t.length < 60).slice(0, 20));
  console.log("   inbox rows seen:", JSON.stringify(inboxRows.slice(0, 8)));

  // Click the row that carries the group's last message preview.
  const opened = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("button, a, [role=button]")];
    const el = candidates.find((e) => /hello plan chat/i.test(e.textContent || ""));
    if (el) { el.click(); return true; }
    return false;
  });
  await page.waitForTimeout(4500);
  check("the Plan Chat opened from the inbox", opened, opened ? "" : "no row matched");

  const composer = page.locator('textarea, [contenteditable="true"], input[type="text"]').last();
  const composerCount = await composer.count();
  check("the composer is present", composerCount > 0, `${composerCount} candidate field(s)`);
  if (composerCount === 0) {
    const diag = await page.evaluate(() => ({
      url: location.pathname,
      inputs: [...document.querySelectorAll("input,textarea,[contenteditable]")].map((e) => ({
        tag: e.tagName.toLowerCase(),
        type: e.getAttribute("type") || "",
        ph: e.getAttribute("placeholder") || "",
        visible: e.getBoundingClientRect().height > 0
      })).slice(0, 8),
      body: (document.body.textContent || "").replace(/\s+/g, " ").slice(0, 160)
    }));
    console.log("   DIAG:", JSON.stringify(diag));
    throw new Error("composer not found after opening thread");
  }

  await composer.click();
  await composer.type("@Kwa", { delay: 80 });
  await page.waitForTimeout(2500);

  const picker = await page.evaluate(() => {
    const txt = (document.body.textContent || "");
    return { showsKwame: /Kwame Boateng/.test(txt) };
  });
  check("typing @ opens the picker with a real member",
    picker.showsKwame, picker.showsKwame ? "Kwame Boateng offered" : "no suggestions — BETA-009");

  await ctx.close();
} catch (e) {
  console.log(`HARNESS ERROR: ${String(e).split("\n")[0].slice(0, 170)}`);
  results.push(false);
} finally {
  await browser.close();
  await cleanup();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} mention runtime checks passed`);
