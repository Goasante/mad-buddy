/**
 * The gates, exercised through the real HTTP stack as real logged-in users.
 *
 * lib/access/enforcement.test.ts proves the gates EXIST where they should.
 * This proves they ANSWER correctly: that an expired account is refused
 * discovery and still keeps everything it already had.
 *
 * Server Actions are not addressable by URL, so this drives the browser: log
 * in, visit the surface, and read what the page actually renders. That is also
 * the honest test -- it exercises the same path a person does.
 *
 * PERSONAS are created by writing access_grants directly, which is legitimate
 * here: the grant table IS the product state, and the welcome trigger is
 * separately proven by welcome-access-trigger.mjs. Nothing fabricates a state
 * the product cannot reach.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "AccessTest123!";
const DAY = 86400000;
const results = [];
const made = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag, grants = []) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Gate`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  for (const g of grants) {
    const { error: gErr } = await admin.from("access_grants").insert({
      user_id: id, source: g.source,
      starts_at: new Date(Date.now() + (g.startsIn ?? -1000)).toISOString(),
      expires_at: g.expiresIn === null ? null : new Date(Date.now() + g.expiresIn).toISOString(),
      reason: "access enforcement harness"
    });
    if (gErr) throw new Error(`${tag} grant: ${gErr.message}`);
  }
  made.push(id);
  return { id, email };
}

/**
 * Sign in, waiting for the navigation and retrying on the way.
 *
 * A fixed sleep was not enough: the local GoTrue slows to seconds per request
 * under repeated browser sign-ins, and a probe that runs while the page is
 * still /login reads the login form as the app -- reporting "not locked" for an
 * expired account and "core is broken" for a working one. The same accounts
 * authenticate in ~120ms through the API, so this covers a known harness limit
 * rather than a product failure.
 */
async function login(ctx, email) {
  const page = await ctx.newPage();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (!new URL(page.url()).pathname.startsWith("/login")) return page;
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw new Error(`could not sign in as ${email}`);
}

/** Everything the page renders, including text the layout has parked off-screen. */
const textOf = (page) =>
  page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));

async function cleanup() {
  for (const id of made) {
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

const browser = await chromium.launch();

try {
  const active = await person("gact", [{ source: "welcome_access", expiresIn: 10 * DAY }]);
  const expired = await person("gexp", [
    { source: "welcome_access", startsIn: -20 * DAY, expiresIn: -6 * DAY }
  ]);

  // ---- ACTIVE ACCESS ----------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await login(ctx, active.email);
    await page.goto(`${BASE}/linkr`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    const t = await textOf(page);
    check("ACTIVE: Linkr does not show the locked state",
      !/needs Mad Buddy Access/i.test(t), "discovery available");
    await ctx.close();
  }

  // ---- EXPIRED ----------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await login(ctx, expired.email);

    // The paid surfaces are LOCKED but still reachable and still in the nav.
    await page.goto(`${BASE}/linkr`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    const linkrText = await textOf(page);
    check("EXPIRED: /linkr still loads (never a redirect or an error page)",
      !/something went wrong|error occurred/i.test(linkrText),
      new URL(page.url()).pathname);
    /* Asserted against what the PAGE renders, not the guard's return message.
       The guard's string is for Server Action results; the route renders
       <AccessLocked>, whose copy is deliberately fuller. An earlier version of
       this check looked for the guard string and failed on a page that was
       correct -- the same mistake as testing the error text instead of the
       screen. */
    check("EXPIRED: Linkr says what stays free",
      /Mad Buddy itself stays free/i.test(linkrText)
        && /Messages and every conversation you already have/i.test(linkrText),
      "the copy never implies all of Mad Buddy expired");

    check("EXPIRED: Linkr promises existing connections survive",
      /stays exactly where it is/i.test(linkrText), "continuity stated on the lock itself");

    check("EXPIRED: Linkr states no payment was taken",
      /never added a payment method/i.test(linkrText), "nothing was charged, said plainly");

    /* NO DARK PATTERNS, asserted rather than trusted. */
    const darkPatterns = [
      [/\d+\s*(people|others|muddies)\s*(are\s*)?(waiting|nearby right now)/i, "fabricated demand"],
      [/only\s*\d+\s*(spots?|places?)\s*(left|remaining)/i, "fake scarcity"],
      [/hurry|act now|last chance|don't miss out/i, "manufactured urgency"],
      [/your friends will miss you|you'll lose your friends/i, "guilt copy"],
      [/upgrade your account/i, "tier language"]
    ];
    const found = darkPatterns.filter(([re]) => re.test(linkrText)).map(([, name]) => name);
    check("EXPIRED: the lock uses no dark patterns",
      found.length === 0, found.length ? found.join(", ") : "no urgency, scarcity, guilt or fake demand");

    const navText = await page.evaluate(() => {
      const nav = document.querySelector("nav, [role=navigation], footer");
      return (nav?.textContent || document.body.textContent || "").replace(/\s+/g, " ");
    });
    check("EXPIRED: Linkr and UpFor stay VISIBLE in navigation",
      /Linkr/i.test(navText) && /UpFor/i.test(navText),
      "locked, not hidden");

    // The free core is untouched.
    const core = [
      ["/dashboard", "Home"],
      ["/friends", "Muddies"],
      ["/messages", "Messages"],
      ["/plans", "Plans"],
      ["/events", "Events"],
      ["/safe-arrival", "Safe Arrival"]
    ];
    for (const [route, label] of core) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2200);
      const t = await textOf(page);
      const broken = /something went wrong|error occurred|failed to load/i.test(t);
      const paywalled = /needs Mad Buddy Access/i.test(t);
      check(`EXPIRED: ${label} is still free and working`,
        !broken && !paywalled,
        broken ? "ERROR PAGE" : paywalled ? "PAYWALLED — core must stay free" : "ok");
    }
    await ctx.close();
  }

  // ---- CONTINUITY: expired, but with an existing Muddy -------------------
  {
    const withMuddy = await person("gmud", [
      { source: "welcome_access", startsIn: -20 * DAY, expiresIn: -6 * DAY }
    ]);
    const friend = await person("gfrn");
    const [one, two] = [withMuddy.id, friend.id].sort();
    // The welcome trigger fires here, so remove the grant it creates: this
    // persona must stay EXPIRED to test continuity after expiry.
    const { error: fErr } = await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });
    if (fErr) throw new Error(`friendship: ${fErr.message}`);
    await admin.from("access_grants").delete().eq("user_id", withMuddy.id).eq("source", "welcome_access");
    await admin.from("access_grants").insert({
      user_id: withMuddy.id, source: "welcome_access",
      starts_at: new Date(Date.now() - 20 * DAY).toISOString(),
      expires_at: new Date(Date.now() - 6 * DAY).toISOString(),
      reason: "access enforcement harness: expired"
    });

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await login(ctx, withMuddy.email);

    await page.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);
    const friendsText = await textOf(page);
    check("CONTINUITY: an expired account still sees its Muddy",
      /gfrn/i.test(friendsText) || /Gate/i.test(friendsText),
      "existing relationships survive expiry");

    await page.goto(`${BASE}/hangout-mode`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);
    const upforText = await textOf(page);
    check("CONTINUITY: UpFor loads for an expired account (feed of own Muddies stays)",
      !/something went wrong|error occurred/i.test(upforText),
      new URL(page.url()).pathname);
    await ctx.close();
  }
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 180)}`);
  results.push(false);
} finally {
  await browser.close();
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} enforcement checks passed`);
