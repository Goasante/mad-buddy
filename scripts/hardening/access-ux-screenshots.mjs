/**
 * Screenshot pass for the Access UX restructure.
 *
 * Runs against the isolated mb-access-ux Supabase stack + a production
 * (`next build && next start`) server, using the seeded cohort from
 * scripts/hardening/seed-access-ux-review.mjs. Saves PNGs under
 * .review-screenshots/ (untracked, not committed).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const PASSWORD = "AccessUxReview123!";
const OUT_DIR = ".review-screenshots";
mkdirSync(OUT_DIR, { recursive: true });

const PERSONAS = [
  { email: "accessuxteam@review.local", key: "team" },
  { email: "accessuxmomo@review.local", key: "momo" },
  { email: "accessuxcard@review.local", key: "card" },
  { email: "accessuxcardcxl@review.local", key: "card-cancelled" },
  { email: "accessuxpastdue@review.local", key: "past-due" },
  { email: "accessuxexpired@review.local", key: "expired" },
  { email: "accessuxnone@review.local", key: "no-access" }
];

const browser = await chromium.launch();

async function sessionFor(persona) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1200);
      await page.fill('input[type="email"]', persona.email);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(1000);
      if (!new URL(page.url()).pathname.startsWith("/login")) {
        const state = await ctx.storageState();
        await ctx.close();
        return { ok: true, state };
      }
    } catch (e) {
      console.log(`  login attempt ${attempt + 1} failed: ${String(e).split("\n")[0].slice(0, 100)}`);
    }
    await ctx.close();
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  return { ok: false, state: null };
}

const shots = [
  { key: "team", width: 390, height: 844, theme: "dark" },
  { key: "no-access", width: 390, height: 844, theme: "dark" },
  { key: "momo", width: 390, height: 844, theme: "dark" },
  { key: "card", width: 390, height: 844, theme: "dark" },
  { key: "card-cancelled", width: 390, height: 844, theme: "dark" },
  { key: "past-due", width: 390, height: 844, theme: "dark" },
  { key: "expired", width: 390, height: 844, theme: "dark" },
  { key: "card", width: 390, height: 844, theme: "light" },
  { key: "team", width: 390, height: 844, theme: "light" },
  { key: "card", width: 320, height: 760, theme: "dark" },
  { key: "momo", width: 320, height: 760, theme: "dark" },
  { key: "no-access", width: 320, height: 760, theme: "dark" },
  { key: "card", width: 430, height: 932, theme: "dark" },
  { key: "momo", width: 430, height: 932, theme: "dark" }
];

const sessions = new Map();
for (const persona of PERSONAS) {
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`signing in: ${persona.key}`);
  const session = await sessionFor(persona);
  if (!session.ok) {
    console.log(`  FAILED to sign in ${persona.key}`);
    continue;
  }
  sessions.set(persona.key, session.state);
  console.log(`  ok`);
}

let n = 0;
for (const shot of shots) {
  const state = sessions.get(shot.key);
  if (!state) {
    console.log(`skip ${shot.key} ${shot.width}x${shot.height} ${shot.theme} — no session`);
    continue;
  }
  const ctx = await browser.newContext({
    storageState: state,
    viewport: { width: shot.width, height: shot.height },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: shot.theme
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/settings/access`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2200);
    const fileName = `${OUT_DIR}/${shot.key}-${shot.width}x${shot.height}-${shot.theme}.png`;
    await page.screenshot({ path: fileName, fullPage: true });
    console.log(`saved ${fileName}`);
    n += 1;
  } catch (e) {
    console.log(`FAILED ${shot.key} ${shot.width}x${shot.height} ${shot.theme}: ${String(e).split("\n")[0].slice(0, 120)}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${n}/${shots.length} screenshots saved to ${OUT_DIR}/`);
