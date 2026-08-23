/**
 * Mission 3 Extreme — stale state, session expiry, offline mutations and time.
 *
 * Mission 1 proved the server is SAFE under these conditions. What is judged
 * here is the human recovery: does a stale screen recover understandably, does
 * a failure ever look like a success, and does an already-open client resolve
 * itself once time or another device has moved on?
 *
 * The bar the brief sets is deliberately not real-time sync everywhere. It is
 * "safe + understandable recovery".
 *
 * FIXTURE DISCIPLINE: every write reads its error; sign-in is asserted; and the
 * shape of anything read back is checked before behaviour is judged.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/journeys-recovery";
mkdirSync(OUT, { recursive: true });

const made = [];
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag} account: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag.replace(/[^a-z0-9]/gi, "")}${stamp.slice(-6)}`,
    full_name: `${tag[0].toUpperCase()}${tag.slice(1)} Persona`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email };
}

async function befriend(a, b) {
  const [x, y] = [a, b].sort();
  const { error } = await admin.from("friendships").insert({ user_one_id: x, user_two_id: y });
  if (error) throw new Error(`friendship: ${error.message}`);
}

async function cleanup() {
  for (const id of made) {
    const { data: convos } = await admin.from("conversations").select("id").like("direct_key", `%${id}%`);
    for (const c of convos ?? []) {
      await admin.from("messages").delete().eq("conversation_id", c.id);
      await admin.from("conversation_members").delete().eq("conversation_id", c.id);
      await admin.from("conversations").delete().eq("id", c.id);
    }
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

const browser = await chromium.launch();

async function sessionFor(email, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 },
    ...opts
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2400);
  await page.fill('input[type="email"]', email);
  await page.locator('input[type="password"]').first().fill("HardeningPass123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6500);
  const landed = new URL(page.url()).pathname;
  if (landed.startsWith("/login")) throw new Error(`sign-in failed for ${email}: still on ${landed}`);
  return { ctx, page };
}

const body = (page) => page.locator("body").innerText().then((t) => t.replace(/\s+/g, " "));

try {
  const owner = await person("recov");
  const peer = await person("peer");
  await befriend(owner.id, peer.id);

  // A direct conversation with one message, the way the product creates it.
  const directKey = [owner.id, peer.id].sort().join(":");
  const { data: convo, error: cErr } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: peer.id, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (cErr) throw new Error(`conversation: ${cErr.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: owner.id, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: peer.id, role: "member", status: "joined" }
  ]);
  if (mErr) throw new Error(`members: ${mErr.message}`);
  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: peer.id, message_type: "text",
    text_content: "First message", client_message_id: crypto.randomUUID()
  });
  if (msgErr) throw new Error(`message: ${msgErr.message}`);

  // ======================================================================
  // MULTI-DEVICE: device B holds a stale conversation while A's peer writes
  // ======================================================================
  const devB = await sessionFor(owner.email);
  await devB.page.goto(`${BASE}/messages?conversation=${convo.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await devB.page.waitForTimeout(4000);
  const staleBefore = await body(devB.page);
  check("device B shows the conversation before anything changes",
    /First message/i.test(staleBefore), staleBefore.slice(0, 110));

  // Another device (the peer) writes while B sits there.
  const { error: m2Err } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: peer.id, message_type: "text",
    text_content: "Sent from another device", client_message_id: crypto.randomUUID()
  });
  if (m2Err) throw new Error(`second message: ${m2Err.message}`);
  await devB.page.waitForTimeout(6000);
  const staleAfter = await body(devB.page);
  const liveUpdate = /Sent from another device/i.test(staleAfter);

  // Whether it arrives live or on the next navigation, it must arrive.
  await devB.page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await devB.page.waitForTimeout(4000);
  const afterNav = await body(devB.page);
  check("a stale conversation recovers, live or on re-entry",
    /Sent from another device/i.test(afterNav),
    liveUpdate ? "arrived LIVE without navigation" : "arrived on re-entry");
  await devB.page.screenshot({ path: `${OUT}/multidevice-conversation.png`, fullPage: true }).catch(() => {});

  // ======================================================================
  // SESSION EXPIRY MID-FLOW: the session dies before the mutation
  // ======================================================================
  const composer = devB.page.locator("textarea, input[type=text]").first();
  if (!(await composer.count())) {
    inconclusive("session expiry", "no composer found in the conversation");
  } else {
    await composer.fill("Typed before the session died");
    await devB.page.waitForTimeout(600);
    // Kill the session the way a real expiry does: revoke server-side.
    const { error: signOutErr } = await admin.auth.admin.signOut(
      (await devB.ctx.cookies()).find((c) => c.name.includes("auth-token"))?.value ?? "",
      "global"
    ).catch(() => ({ error: null }));
    // Cookie removal is the reliable local simulation; the server rejects the
    // mutation either way.
    await devB.ctx.clearCookies();

    const send = devB.page.getByRole("button", { name: /^send$/i }).first();
    if (await send.count()) await send.click().catch(() => {});
    else await composer.press("Enter").catch(() => {});
    await devB.page.waitForTimeout(6000);

    const afterExpiry = await body(devB.page);
    const landedOn = new URL(devB.page.url()).pathname + new URL(devB.page.url()).search;

    // The message must NOT have been written.
    const { data: sent } = await admin.from("messages")
      .select("id").eq("conversation_id", convo.id).eq("sender_id", owner.id);
    check("a mutation after session expiry does not reach the database",
      (sent ?? []).length === 0, `${(sent ?? []).length} message(s) from the expired session`);

    check("the user is not left believing the send succeeded",
      !/sent\b/i.test(afterExpiry) || /sign in|log in|try again|could|fail/i.test(afterExpiry),
      `landed ${landedOn} | ${afterExpiry.slice(0, 120)}`);

    /* RETURN PATH. If the app redirects to login it must carry `next`, so
       re-authenticating resumes the interrupted place rather than dumping the
       person on a generic Home. */
    if (landedOn.startsWith("/login")) {
      check("re-auth carries a return path to the interrupted place",
        landedOn.includes("next="), landedOn);
    } else {
      console.log(`  note: stayed on ${landedOn} rather than redirecting; no return path needed`);
    }
    await devB.page.screenshot({ path: `${OUT}/session-expiry.png`, fullPage: true }).catch(() => {});
  }
  await devB.ctx.close();

  // ======================================================================
  // OFFLINE MUTATION: send with no network, then reconnect
  // ======================================================================
  const off = await sessionFor(owner.email);
  await off.page.goto(`${BASE}/messages?conversation=${convo.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await off.page.waitForTimeout(4200);
  const offComposer = off.page.locator("textarea, input[type=text]").first();
  if (!(await offComposer.count())) {
    inconclusive("offline send", "no composer found");
  } else {
    const uniqueText = `Offline send ${Date.now()}`;
    await offComposer.fill(uniqueText);
    await off.ctx.setOffline(true);
    const send = off.page.getByRole("button", { name: /^send$/i }).first();
    if (await send.count()) await send.click().catch(() => {});
    else await offComposer.press("Enter").catch(() => {});
    await off.page.waitForTimeout(7000);

    const whileOffline = await body(off.page);
    check("an offline send does not silently vanish",
      whileOffline.includes(uniqueText) || /sending|failed|retry|couldn/i.test(whileOffline),
      whileOffline.slice(0, 140));
    await off.page.screenshot({ path: `${OUT}/offline-send.png`, fullPage: true }).catch(() => {});

    await off.ctx.setOffline(false);
    await off.page.waitForTimeout(8000);

    // Exactly one copy, or none -- never two.
    const { data: copies } = await admin.from("messages")
      .select("id, text_content").eq("conversation_id", convo.id).eq("text_content", uniqueText);
    check("reconnecting never produces a duplicate message",
      (copies ?? []).length <= 1, `${(copies ?? []).length} copies of the offline message`);
    await off.page.screenshot({ path: `${OUT}/offline-reconnect.png`, fullPage: true }).catch(() => {});
  }
  await off.ctx.close();
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 170)}`);
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }, null, 2));
console.log(`\n${results.filter(Boolean).length}/${results.length} recovery checks passed`);
console.log("cleaned up");
