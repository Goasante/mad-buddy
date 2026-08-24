/**
 * A6 runtime -- "Visibility is paused" on Home is actionable, and tapping it
 * resumes visibility through the canonical authority.
 *
 * Checks the outcome in the DATABASE, not just the pixels: the point is that
 * the card resolves the state it reports, not that it looks tappable.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://127.0.0.1:3200";
const STATE = "C:/mb-god/.phasea.json";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`); };

const { data: me } = await admin.from("profiles").select("user_id").eq("username", "phasea").maybeSingle();

async function visibility() {
  const { data } = await admin.from("profiles")
    .select("visibility_status").eq("user_id", me.user_id).maybeSingle();
  return data?.visibility_status ?? null;
}

// Put Home into the reported state.
await admin.from("profiles").update({ visibility_status: "ghost" }).eq("user_id", me.user_id);
check("visibility starts paused, as Home reported it", (await visibility()) === "ghost");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    storageState: STATE, viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    // Home gates the nearby section behind location permission; without this
    // the page never reaches the state that carries the paused card.
    permissions: ["geolocation"],
    geolocation: { latitude: 5.6037, longitude: -0.187 }
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Dismiss the tour if it is running: its card sits over Home.
  const notNow = page.getByRole("button", { name: /not now|skip/i }).first();
  if (await notNow.count()) await notNow.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // Turn Glow on if Home is still offering that gate, so the nearby section
  // renders at all -- the paused card lives inside it.
  const turnOn = page.getByRole("button", { name: /turn on glow/i }).first();
  if (await turnOn.count()) {
    await turnOn.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2500);
    // Re-pause: the point is the PAUSED card, and turning Glow on may clear it.
    await admin.from("profiles").update({ visibility_status: "ghost" }).eq("user_id", me.user_id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const again = page.getByRole("button", { name: /not now|skip/i }).first();
    if (await again.count()) await again.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const paused = page.getByText("Visibility is paused").first();
  const present = (await paused.count()) > 0;
  check("Home says visibility is paused", present);

  if (present) {
    check("and it now offers the way out", (await page.getByText("Tap to resume").count()) > 0,
      "the card names the fix AND offers it");

    // The whole card is the control, not just the words.
    const control = page.locator('[role="button"][aria-label*="Visibility is paused"]').first();
    const isControl = (await control.count()) > 0;
    check("the whole card is the control", isControl,
      isControl ? "role=button with an accessible name" : "no actionable region found");

    if (isControl) {
      const box = await control.boundingBox();
      check("the control is a comfortable touch target",
        box !== null && box.height >= 44,
        box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no box");

      await control.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);

      const after = await visibility();
      check("TAPPING IT RESUMES VISIBILITY", after === "visible", `visibility_status=${after}`);

      // It reflects the new state without a reload.
      await page.waitForTimeout(700);
      const stillPaused = await page.getByText("Visibility is paused").count();
      check("Home stops saying it is paused, without a reload", stillPaused === 0,
        `${stillPaused} paused label(s) remaining`);

      // And it survives a reload -- the server, not local state.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      check("it is still resumed after a reload", (await visibility()) === "visible");
    }
  }
  await context.close();
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
  results.push(false);
} finally {
  await browser.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} Home visibility checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
