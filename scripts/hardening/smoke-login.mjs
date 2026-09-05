/** Sign in the smoke personas through the real login form. Local only. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync("C:/mb-profile-perf-p1/.env.local", "utf8").split(/\r?\n/)) {
  const s = l.trim(); if (!s || s.startsWith("#")) continue;
  const i = s.indexOf("="); if (i > 0) env[s.slice(0, i)] = s.slice(i + 1);
}
if (!/127\.0\.0\.1|localhost/.test(env.NEXT_PUBLIC_SUPABASE_URL || "")) { console.error("HARD STOP"); process.exit(1); }

const PEOPLE = [
  { tag: "qa", email: "qa@local.test" },
  { tag: "kofi", email: "kofi@local.test" },
  { tag: "ama", email: "ama@local.test" }
];

const browser = await chromium.launch({ headless: true });
for (const who of PEOPLE) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true,
    baseURL: "http://127.0.0.1:3000"
  });
  const p = await ctx.newPage();
  await p.goto("/login", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(900);
  await p.locator("input[type='email'],input[name='email']").first().fill(who.email);
  const pw = p.locator("input[type='password'],input[name='password']").first();
  await pw.fill("HardeningPass123!");
  // Submit via the form rather than the button: an OAuth control overlays it
  // at this viewport and intercepts the click.
  await pw.press("Enter");
  await p.waitForTimeout(4000);
  const landed = p.url().replace("http://127.0.0.1:3000", "");
  const ok = !/\/login/.test(p.url());
  console.log(`${who.tag.padEnd(5)} ${ok ? "SIGNED IN" : "FAILED"}  ${landed}`);
  if (ok) await ctx.storageState({ path: `C:/mb-profile-perf-p1/.d2/auth-${who.tag}.json` });
  await ctx.close();
}
await browser.close();
