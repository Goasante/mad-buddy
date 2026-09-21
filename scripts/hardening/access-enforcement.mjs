/**
 * Ads-first Access proof through the real HTTP stack.
 *
 * The old harness proved that expired Access blocked Linkr/UpFor. The current
 * product contract is the opposite: an expired account keeps the full app and
 * becomes ad-eligible, while an active Access source is ad-free.
 *
 * Run only against a local Supabase stack + local web app. The service-role
 * value must be supplied by the local environment; this file stores no key.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  throw new Error("refusing to run against a non-local database");
}
if (!SERVICE) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the local harness");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "AccessTest123!";
const DAY = 86_400_000;
const results = [];
const made = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function person(tag, grant) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);

  const id = data.user.id;
  const { error: profileError } = await admin.from("profiles").insert({
    user_id: id,
    username: `${tag}${stamp.slice(-7)}`,
    full_name: `${tag} Access`,
    is_onboarded: true
  });
  if (profileError) throw new Error(`${tag} profile: ${profileError.message}`);

  // Account/profile creation can create Welcome Access. Replace it with the
  // exact persona this harness needs rather than stacking an accidental source.
  await admin.from("access_grants").delete().eq("user_id", id);
  if (grant) {
    const { error: grantError } = await admin.from("access_grants").insert({
      user_id: id,
      source: grant.source,
      starts_at: new Date(Date.now() + grant.startsIn).toISOString(),
      expires_at: grant.expiresIn === null ? null : new Date(Date.now() + grant.expiresIn).toISOString(),
      reason: "ads-first runtime proof"
    });
    if (grantError) throw new Error(`${tag} grant: ${grantError.message}`);
  }

  made.push(id);
  return { id, email };
}

async function login(context, email) {
  const page = await context.newPage();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45_000 }).catch(() => {});
    if (!new URL(page.url()).pathname.startsWith("/login")) return page;
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
  }
  throw new Error(`could not sign in as ${email}`);
}

async function textOf(page) {
  return page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
}

async function accessStatus(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/access/status", { cache: "no-store" });
    return { status: response.status, json: await response.json() };
  });
}

async function cleanup() {
  for (const id of made) {
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

const browser = await chromium.launch();

try {
  const active = await person("adfree", {
    source: "admin_grant",
    startsIn: -DAY,
    expiresIn: 7 * DAY
  });
  const expired = await person("adsok", {
    source: "welcome_access",
    startsIn: -20 * DAY,
    expiresIn: -6 * DAY
  });

  for (const [label, persona, expectedAdFree] of [
    ["ACTIVE", active, true],
    ["EXPIRED", expired, false]
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const page = await login(context, persona.email);

    const projection = await accessStatus(page);
    check(`${label}: Access-status endpoint works`, projection.status === 200, `HTTP ${projection.status}`);
    check(
      `${label}: adFree matches canonical Access`,
      projection.json?.adFree === expectedAdFree,
      `adFree=${String(projection.json?.adFree)}`
    );

    for (const [route, surface] of [
      ["/linkr", "Linkr"],
      ["/hangout-mode", "UpFor"]
    ]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1_000);
      const text = await textOf(page);
      check(
        `${label}: ${surface} remains usable regardless of Access`,
        !/needs Mad Buddy Access|Access required|something went wrong|error occurred/i.test(text),
        new URL(page.url()).pathname
      );
    }

    await context.close();
  }
} catch (error) {
  console.log(`\nHARNESS ERROR: ${String(error).split("\n")[0].slice(0, 180)}`);
  results.push(false);
} finally {
  await browser.close();
  await cleanup();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} ads-first Access checks passed`);
if (passed !== results.length) process.exitCode = 1;
