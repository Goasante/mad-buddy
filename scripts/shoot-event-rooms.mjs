/**
 * Visual verification for Event Rooms.
 *
 * Drives the REAL running app against the local Supabase stack and captures the
 * reference surfaces. Nothing here is a fixture: the rooms, messages, notices
 * and reactions were written through the product's own lifecycle RPCs.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3230";
const OUT = process.env.OUT_DIR ?? "screenshots";
const EMAIL = process.env.LOGIN_EMAIL ?? "hosta@mbgate.local";
const PASSWORD = process.env.LOGIN_PASSWORD ?? "Password123!";
const EVENT_ID = "e0000000-0000-4000-8000-00000000000e";

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 }
];

mkdirSync(OUT, { recursive: true });

/**
 * Log in through the REAL form.
 *
 * Captured against `next start` rather than `next dev`: the dev server's HMR
 * websocket fails to handshake in this environment, which blocks hydration, so
 * the form falls back to a native submit and never sets a session. That is a
 * dev-server artifact, not a product fault -- the same form works here.
 */
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
}


/**
 * VIEWPORT / SCROLL CONTRACT probe (commit 5178021).
 *
 * The bounded shell means the DOCUMENT must never scroll: <main
 * data-app-scroll-owner> owns overflow. Phantom scroll is document
 * scrollHeight exceeding its clientHeight -- the "giant blank tail" the
 * contract exists to kill. Also checks the safe-area reserve is paid once,
 * not once per nested surface.
 */
async function viewportProbe(page, label, viewport, theme) {
  const probe = await page.evaluate(() => {
    const doc = document.documentElement;
    const owner = document.querySelector("[data-app-scroll-owner]");
    return {
      docScrollH: doc.scrollHeight,
      docClientH: doc.clientHeight,
      bodyScrollH: document.body.scrollHeight,
      bodyClientH: document.body.clientHeight,
      hasOwner: Boolean(owner),
      ownerScrolls: owner ? owner.scrollHeight > owner.clientHeight : null,
      minHScreenInSheets: document.querySelectorAll('[role="dialog"] .min-h-screen').length
    };
  });
  // A few px of rounding is not phantom scroll; a tail is.
  const docPhantom = probe.docScrollH - probe.docClientH > 4;
  const bodyPhantom = probe.bodyScrollH - probe.bodyClientH > 4;
  const ok = !docPhantom && !bodyPhantom && probe.minHScreenInSheets === 0;
  console.log(
    `${ok ? "VIEWPORT-PASS" : "VIEWPORT-FAIL"} ${label} ${viewport} ${theme}`,
    `doc=${probe.docScrollH}/${probe.docClientH}`,
    `body=${probe.bodyScrollH}/${probe.bodyClientH}`,
    `owner=${probe.hasOwner}`,
    `minHScreenInSheets=${probe.minHScreenInSheets}`
  );
  return ok;
}

async function shot(page, name, theme, viewport) {
  const file = `${OUT}/${name}--${theme}--${viewport}.png`;
  await page.screenshot({ path: file });
  console.log("SHOT", file);
}

/** Click by visible text, tolerating the surface not being open yet. */
async function tap(page, text, timeout = 6000) {
  // .last() rather than .first(): sheets stack, and the surface just opened is
  // the one on top. Matching the first occurrence hit the blurred sheet behind.
  const target = page.getByText(text, { exact: false }).last();
  try {
    await target.waitFor({ state: "visible", timeout });
    await target.click();
    await page.waitForTimeout(1200);
    return true;
  } catch {
    console.log("MISS", text);
    return false;
  }
}

/** Room Detail tabs carry role=tab, which is unambiguous across stacked sheets. */
async function tapTab(page, name, timeout = 6000) {
  const target = page.getByRole("tab", { name }).last();
  try {
    await target.waitFor({ state: "visible", timeout });
    await target.click();
    await page.waitForTimeout(1400);
    return true;
  } catch {
    console.log("MISS tab", name);
    return false;
  }
}

for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log("PAGEERROR", error.message));

    try {
      await login(page);

      // 1. EVENT DETAIL with the Rooms section.
      await page.goto(`${BASE}/events?event=${EVENT_ID}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      await shot(page, "01-event-detail-rooms", theme, viewport.name);
      await viewportProbe(page, "event-detail", viewport.name, theme);

      // 2. HOST TOOLS.
      if (await tap(page, "Host tools")) {
        await shot(page, "02-host-tools", theme, viewport.name);
        await viewportProbe(page, "host-tools", viewport.name, theme);

        // 3. EVENT CHECK-IN QR (real signed token).
        if (await tap(page, "QR check-in")) {
          await page.waitForTimeout(2500);
          await shot(page, "03-event-qr", theme, viewport.name);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(900);
        }

        // 4. GUEST LIST.
        if (await tap(page, "Guest list")) {
          await page.waitForTimeout(1800);
          await shot(page, "04-guest-list", theme, viewport.name);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(900);
        }

        // 5. ROOM MANAGER.
        if (await tap(page, "Event Rooms")) {
          await page.waitForTimeout(1500);
          await shot(page, "05-rooms-list", theme, viewport.name);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(900);
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(900);
      }

      // 6. ROOM DETAIL -- chat is canonical Messaging.
      await page.goto(`${BASE}/events?event=${EVENT_ID}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      if (await tap(page, "Regulars Room")) {
        await page.waitForTimeout(2500);
        await shot(page, "06-room-detail-chat", theme, viewport.name);
        await viewportProbe(page, "room-chat", viewport.name, theme);

        // 7. NOTICES with real persisted reactions.
        if (await tapTab(page, "Notices")) {
          await page.waitForTimeout(1500);
          await shot(page, "07-room-notices", theme, viewport.name);
        }
        // 8. MEMBERS.
        if (await tapTab(page, "Members")) {
          await page.waitForTimeout(1500);
          await shot(page, "08-room-members", theme, viewport.name);
        }
        // 9. ROOM SETTINGS.
        if ((await tapTab(page, "Settings")) && (await tap(page, "Room settings"))) {
          await page.waitForTimeout(1500);
          await shot(page, "09-room-settings", theme, viewport.name);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(900);
        }
        // 10. ROOM QR (real signed token).
        if (await tap(page, "Show room QR")) {
          await page.waitForTimeout(2500);
          await shot(page, "10-room-qr", theme, viewport.name);
        }
      }

      // 11. SCANNER.
      await page.goto(`${BASE}/scan`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      await shot(page, "11-scanner", theme, viewport.name);
    } catch (error) {
      console.log("ERROR", viewport.name, theme, error.message);
    } finally {
      await browser.close();
    }
  }
}
console.log("DONE");
