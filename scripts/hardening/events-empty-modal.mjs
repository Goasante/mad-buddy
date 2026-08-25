/**
 * EVENTS EMPTY MODAL -- owner + independent developer evidence.
 *
 * Reported: interaction on Events -> backdrop/blur appears -> a modal IS
 * present -> the modal body is EMPTY. That is a different defect from the
 * stranded scrim previously diagnosed, and it supersedes it.
 *
 * The invariant under test, stated as the owner did:
 *
 *   IF a modal is open THEN its body must contain real content, a loading
 *   state, or an explicit error state. NEVER open with an empty body.
 *
 * Runs against whatever BASE_URL is given so the same probe can be pointed at
 * production and at a local build.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const STATE = process.env.STATE_FILE ?? null;
const EMAIL = process.env.TEST_EMAIL ?? "qa@local.test";
const PASSWORD = process.env.TEST_PASSWORD ?? "HardeningPass123!";
const TARGET_EVENT_ID = process.env.TARGET_EVENT_ID ?? null;
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`); };

if (!STATE && !/^http:\/\/(localhost|127\.0\.0\.1):3200$/.test(BASE)) {
  throw new Error("refusing to authenticate the controlled test account outside the local runtime");
}

/**
 * Measures every open dialog: is there a backdrop, and does the dialog have
 * any meaningful content in it?
 *
 * "Meaningful" deliberately excludes the modal's own chrome -- the close
 * button and the visually-hidden title exist even when the body renders
 * nothing, so counting them would hide exactly the defect being looked for.
 */
const MODAL_PROBE = `(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  const vw = innerWidth, vh = innerHeight;

  let backdrops = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.8 || r.height < vh * 0.8) continue;
    const dims = cs.backdropFilter !== "none" || cs.filter.includes("blur");
    const m = cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/);
    const alpha = m ? (m[1].split(",").map(Number)[3] ?? 1) : 0;
    if (dims || alpha > 0.05) backdrops++;
  }

  const report = dialogs.map((d) => {
    const clone = d.cloneNode(true);
    // Drop the modal's own furniture before judging emptiness.
    clone.querySelectorAll('[aria-label="Close"], .sr-only, [data-modal-chrome]').forEach((n) => n.remove());
    const text = (clone.textContent || "").replace(/\\s+/g, " ").trim();
    const controls = d.querySelectorAll('button:not([aria-label="Close"]), a, input, textarea, select').length;
    const imgs = d.querySelectorAll("img, svg, canvas, video").length;
    const r = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    const overlay = document.querySelector('.modal-drop-overlay[data-state="open"]');
    const overlayZ = overlay ? Number.parseInt(getComputedStyle(overlay).zIndex, 10) : null;
    const dialogZ = Number.parseInt(cs.zIndex, 10);
    const busy = d.getAttribute("aria-busy") === "true";
    const hasSkeleton = d.querySelector('[data-loading], .animate-pulse, [role="status"], [aria-live]') !== null;
    return {
      textLen: text.length,
      text: text.slice(0, 80),
      controls, imgs, busy, hasSkeleton,
      owner: d.getAttribute("data-modal-owner"),
      w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.x), y: Math.round(r.y), bottom: Math.round(r.bottom),
      display: cs.display, visibility: cs.visibility, opacity: Number(cs.opacity),
      transform: cs.transform, pointerEvents: cs.pointerEvents,
      overlayZ, dialogZ,
      visible: r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 &&
        r.left < innerWidth && r.top < innerHeight && cs.display !== "none" &&
        cs.visibility !== "hidden" && Number(cs.opacity) > 0,
      aboveOverlay: overlayZ === null || (Number.isFinite(dialogZ) && dialogZ > overlayZ),
      // The defect: a real, visible panel whose body says and offers nothing.
      empty: r.width > 40 && r.height > 40 && text.length < 3 && controls === 0 && imgs <= 1 && !busy && !hasSkeleton
    };
  });
  return { backdrops, dialogs: report, bodyPointer: getComputedStyle(document.body).pointerEvents };
})()`;

async function assertModalSane(page, label) {
  const s = await page.evaluate(MODAL_PROBE);
  const emptyOnes = s.dialogs.filter((d) => d.empty);
  check(`${label}: no open modal has an empty body`, emptyOnes.length === 0,
    s.dialogs.length === 0
      ? `no dialog (backdrops=${s.backdrops})`
      : `${s.dialogs.length} dialog(s): ` + JSON.stringify(s.dialogs.map((d) => ({ t: d.textLen, c: d.controls, empty: d.empty }))));
  check(`${label}: no backdrop without a dialog`,
    !(s.backdrops > 0 && s.dialogs.length === 0),
      `backdrops=${s.backdrops} dialogs=${s.dialogs.length}`);
  check(`${label}: every open dialog is visible, on-screen, and above its overlay`,
    s.dialogs.every((dialog) => dialog.visible && dialog.aboveOverlay),
    JSON.stringify(s.dialogs.map((dialog) => ({ owner: dialog.owner, rect: [dialog.x, dialog.y, dialog.w, dialog.h], visible: dialog.visible, overlayZ: dialog.overlayZ, dialogZ: dialog.dialogZ }))));
  // Radix locks the body while a dialog is open, which is correct. The defect
  // is a body left locked with NO dialog on screen -- that is the stranded,
  // unusable page. Only assert it when nothing is open.
  if (s.dialogs.length === 0) {
    check(`${label}: the page accepts input once nothing is open`,
      s.bodyPointer !== "none", `body pointer-events=${s.bodyPointer}`);
  }
  return s;
}

async function inspectOpenDialog(page, label) {
  const report = await page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"][data-state="open"]');
    const overlay = document.querySelector('.modal-drop-overlay[data-state="open"]');
    if (!(dialog instanceof HTMLElement)) return null;
    const style = getComputedStyle(dialog);
    const rect = dialog.getBoundingClientRect();
    const overlayStyle = overlay instanceof HTMLElement ? getComputedStyle(overlay) : null;
    return {
      outerHTML: dialog.outerHTML,
      textContent: dialog.textContent,
      childElementCount: dialog.childElementCount,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      viewport: { width: innerWidth, height: innerHeight },
      computed: {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        width: style.width,
        height: style.height,
        zIndex: style.zIndex,
        transform: style.transform,
        pointerEvents: style.pointerEvents,
        overflow: style.overflow,
        animationName: style.animationName,
        animationPlayState: style.animationPlayState
      },
      overlay: overlayStyle ? { zIndex: overlayStyle.zIndex, opacity: overlayStyle.opacity, pointerEvents: overlayStyle.pointerEvents } : null,
      children: [...dialog.children].map((child) => {
        const childStyle = getComputedStyle(child);
        const childRect = child.getBoundingClientRect();
        return {
          tag: child.tagName,
          text: child.textContent,
          childElementCount: child.childElementCount,
          rect: { x: childRect.x, y: childRect.y, width: childRect.width, height: childRect.height },
          display: childStyle.display,
          visibility: childStyle.visibility,
          opacity: childStyle.opacity,
          zIndex: childStyle.zIndex,
          transform: childStyle.transform,
          pointerEvents: childStyle.pointerEvents,
          overflow: childStyle.overflow
        };
      })
    };
  });
  console.log(`DIALOG INSPECTION ${label}\n${JSON.stringify(report, null, 2)}`);
  return report;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    ...(STATE ? { storageState: STATE } : {}),
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark"
  });
  const page = await context.newPage();

  if (!STATE) {
    await page.goto(`${BASE}/login?next=/events`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => {
      const form = document.querySelector("form");
      if (!form) return false;
      const key = Object.keys(form).find((entry) => entry.startsWith("__reactProps$"));
      return Boolean(key && form[key]?.onSubmit);
    }, null, { timeout: 60_000 });
    await page.getByLabel("Email address").fill(EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
  }

  await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const vw = await page.evaluate("innerWidth");
  check("viewport is the phone width under test", vw === 390, `innerWidth=${vw}`);
  const signedIn = !new URL(page.url()).pathname.startsWith("/login");
  check("the Events page is reachable (signed in)", signedIn, page.url());

  if (signedIn) {
    await assertModalSane(page, "events settled");

    if (TARGET_EVENT_ID) {
      await page.goto(`${BASE}/events?event=${TARGET_EVENT_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector('div[role="dialog"][data-state="open"]', { timeout: 30_000 });
      await page.waitForTimeout(500);
      await inspectOpenDialog(page, "direct Event detail open");
      await assertModalSane(page, "direct Event detail open");

      const detail = page.locator('[data-modal-owner="EventDetailModal"]');
      const updatesButton = detail.getByRole("button", { name: "Updates", exact: true });
      if (await updatesButton.count()) {
        await updatesButton.click();
        await page.locator('[data-modal-owner="EventUpdatesModal"]').waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForTimeout(300);
        await assertModalSane(page, "Updates open");
        await page.keyboard.press("Escape");
        await page.locator('[data-modal-owner="EventUpdatesModal"]').waitFor({ state: "detached", timeout: 10_000 });
      }

      const adminsButton = detail.getByRole("button", { name: "Event admins", exact: true });
      if (await adminsButton.count()) {
        await adminsButton.click();
        await page.locator('[data-modal-owner="EventAdminsModal"]').waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForTimeout(300);
        await assertModalSane(page, "Event admins open");
        await page.keyboard.press("Escape");
        await page.locator('[data-modal-owner="EventAdminsModal"]').waitFor({ state: "detached", timeout: 10_000 });
      }

      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(500);
      await assertModalSane(page, "browser Back after Event detail");
      await page.goto(`${BASE}/events?event=${TARGET_EVENT_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.locator('[data-modal-owner="EventDetailModal"]').waitFor({ state: "visible", timeout: 30_000 });
      await assertModalSane(page, "Event detail reopened");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      await page.goto(`${BASE}/events?event=${TARGET_EVENT_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(80);
      await page.keyboard.press("Escape");
      await page.goto(`${BASE}/events?event=${TARGET_EVENT_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.locator('[data-modal-owner="EventDetailModal"]').waitFor({ state: "visible", timeout: 30_000 });
      await assertModalSane(page, "rapid open-close-open");
      await page.keyboard.press("Escape");
      await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(700);
    }

    // ---- tap an event card -> the detail modal must have content ----------
    // The real trigger: EventCard renders button[aria-label="Open <name>"].
    // A generic row selector clicks things that are not cards, and a tap that
    // opens nothing would then be scored as "no empty modal" -- a pass that
    // measured nothing.
    const cards = page.locator(
      'button[aria-label^="Open "]:not([aria-label="Open Next.js Dev Tools"]):not([aria-label="Open quick actions"])'
    );
    const cardCount = await cards.count();
    if (!TARGET_EVENT_ID) {
      check("there is at least one event to open", cardCount > 0, `${cardCount} candidate row(s)`);
    }

    if (cardCount > 0) {
      for (let i = 0; i < Math.min(cardCount, 3); i++) {
        const label = await cards.nth(i).getAttribute("aria-label");
        await cards.nth(i).click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1100);
        await inspectOpenDialog(page, `after tapping "${label}"`);
        const s = await assertModalSane(page, `after tapping "${label}"`);
        // Tapping a card MUST open something. Without this, a tap that did
        // nothing would silently score as a pass.
        check(`tapping "${label}" actually opens a modal`, s.dialogs.length > 0,
          `${s.dialogs.length} dialog(s), backdrops=${s.backdrops}`);
        if (s.dialogs.length > 0) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }
      }
    }

    // ---- the reported gesture: open, close, back, reopen ------------------
    await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const first = cards.first();
    if (await first.count()) {
      await first.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(700);
      await assertModalSane(page, "after browser-back");
      await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
      await first.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(900);
      await assertModalSane(page, "after reopening");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    // ---- THE SUB-SHEET SEQUENCE ------------------------------------------
    // Open an Event, open its Updates sheet, close the detail sheet, then open
    // a DIFFERENT Event. Before the fix the Updates flag survived, so the new
    // Event opened with the previous Event's hideTitle sheet over data that
    // had just been cleared -- a panel with nothing in it.
    if (cardCount > 1) {
      await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      await cards.nth(0).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const updates = page.getByRole("button", { name: /updates/i }).first();
      if (await updates.count()) {
        await updates.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
        await assertModalSane(page, "updates sheet open");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
      await cards.nth(1).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1100);
      await assertModalSane(page, "after opening a DIFFERENT event");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    // ---- rapid tapping, mid-transition -----------------------------------
    for (let i = 0; i < 4; i++) {
      await first.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(80);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(900);
    await assertModalSane(page, "after rapid open/close");

    // ---- a deep link to an event that does not exist ----------------------
    await page.goto(`${BASE}/events?event=00000000-0000-4000-8000-000000000000`,
      { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const missing = await assertModalSane(page, "deep link to a missing event");
    check("a missing event does not leave an open shell",
      missing.dialogs.filter((d) => d.empty).length === 0,
      "it must say something, or not open at all");

    // ---- a slow network must show a loading surface, not an empty modal ---
    await context.route("**/*", async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    if (await first.count()) {
      await first.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(250);   // deliberately BEFORE the payload lands
      await assertModalSane(page, "slow network, immediately after tap");
      await page.waitForTimeout(2500);
      await assertModalSane(page, "slow network, after settling");
    }
    await context.unroute("**/*");
  }

  // NEGATIVE CONTROL: the probe must detect a genuinely empty modal.
  await page.evaluate(`(() => {
    const o = document.createElement("div");
    o.className = "modal-drop-overlay";
    o.dataset.state = "open";
    o.style.cssText = "position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45)";
    document.body.appendChild(o);
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    d.dataset.state = "open";
    d.style.cssText = "position:fixed;left:20px;top:20px;width:300px;height:200px;background:#222";
    document.body.appendChild(d);
  })()`);
  const control = await page.evaluate(MODAL_PROBE);
  check("NEGATIVE CONTROL: the probe detects a genuinely empty modal",
    control.dialogs.some((d) => d.empty),
    "if this fails, every check above measured nothing");
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
  results.push(false);
} finally {
  await browser.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} Events modal checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
