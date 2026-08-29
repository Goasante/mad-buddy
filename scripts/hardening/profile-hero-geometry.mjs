/**
 * PROFILE HERO GEOMETRY — measured at runtime, not read off the JSX.
 *
 * The reported defect is that the camera control is partly hidden behind the
 * avatar. Markup alone cannot answer that: what matters is where the boxes
 * actually land once the gradient ring, the border and the Glow have all been
 * applied, and whether any ancestor clips.
 *
 * Reports, per viewport and theme:
 *   - the avatar's painted circle and the camera button's box
 *   - how much of the camera the avatar overlaps, in real pixels
 *   - the camera's touch-target size against the 44px minimum
 *   - every ancestor with a clipping overflow, and whether the camera escapes it
 *
 * Local only.
 */

import fs from "node:fs";
import { chromium } from "playwright";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const BASE = process.env.REVIEW_BASE ?? "http://localhost:3300";
const EMAIL = process.env.REVIEW_EMAIL ?? "a@v4test.local";
const PASSWORD = process.env.REVIEW_PASSWORD ?? "LinkrReview123!";
const OUT = process.env.REVIEW_OUT ?? "C:/tmp/tranche-a";

fs.mkdirSync(OUT, { recursive: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error("REFUSING: not a local Supabase URL:", supabaseUrl);
  process.exit(1);
}
{
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
  // auth.login is rate limited; one login is reused below, but a previous run
  // may have left the counter high.
  await admin.from("rate_limits").delete().eq("action", "auth.login");
}

const VIEWPORTS = {
  "360x640": { width: 360, height: 640 },
  "360x800": { width: 360, height: 800 },
  "390x844": { width: 390, height: 844 },
  "430x932": { width: 430, height: 932 }
};

const browser = await chromium.launch();
const statePath = `${OUT}/session.json`;

{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]', { force: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (new URL(page.url()).pathname.startsWith("/login")) {
    console.error("FAILED to sign in (check the auth.login rate limit).");
    process.exit(1);
  }
  await context.storageState({ path: statePath });
  await context.close();
  console.log("signed in once");
}

/** The geometry that decides whether the camera is usable. */
async function measure(page) {
  return page.evaluate(() => {
    /* The CONTROL, by its own class -- not by aria-label. The avatar's
       full-screen-view button carries a similar label, and querying by label
       matched that 122x122 element first, reporting the wrong geometry. */
    const camera = document.querySelector(".profile-avatar-camera");
    const avatarButton = document.querySelector(".profile-avatar-open");
    if (!camera || !avatarButton) return { found: false };

    // The painted circle is the avatar's image/initials span, not the button.
    const painted = avatarButton.querySelector("span span") ?? avatarButton;
    const c = camera.getBoundingClientRect();
    const a = painted.getBoundingClientRect();

    // How far the camera's centre sits from the avatar's centre, and whether
    // that puts it inside the painted circle.
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    const centreDistance = Math.hypot(cx - ax, cy - ay);
    const avatarRadius = Math.min(a.width, a.height) / 2;

    // Rectangle overlap between the camera and the avatar's painted box.
    const overlapW = Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left));
    const overlapH = Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top));
    const overlapArea = overlapW * overlapH;

    // Any ancestor that clips, and whether the camera fits inside it.
    const clippers = [];
    let node = camera.parentElement;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      const clips = [cs.overflow, cs.overflowX, cs.overflowY].some(
        (v) => v === "hidden" || v === "clip" || v === "auto" || v === "scroll"
      );
      if (clips) {
        const r = node.getBoundingClientRect();
        clippers.push({
          selector: node.className?.toString().slice(0, 60) || node.tagName,
          overflow: cs.overflow,
          cameraEscapes:
            c.right > r.right + 0.5 || c.bottom > r.bottom + 0.5 || c.left < r.left - 0.5 || c.top < r.top - 0.5
        });
      }
      node = node.parentElement;
    }

    // What is actually painted on top at the camera's centre point.
    const topAtCentre = document.elementFromPoint(cx, cy);
    const cameraOnTop = Boolean(topAtCentre && (topAtCentre === camera || camera.contains(topAtCentre)));

    return {
      found: true,
      camera: { w: Math.round(c.width), h: Math.round(c.height) },
      avatar: { w: Math.round(a.width), h: Math.round(a.height) },
      meetsTouchTarget: c.width >= 44 && c.height >= 44,
      overlapPx: Math.round(overlapArea),
      overlapShareOfCamera: Math.round((overlapArea / (c.width * c.height)) * 100),
      cameraCentreInsideAvatar: centreDistance < avatarRadius,
      cameraOnTop,
      topAtCentre: topAtCentre ? topAtCentre.tagName + "." + String(topAtCentre.className).slice(0, 40) : null,
      clippers
    };
  });
}

const report = {};
for (const [label, viewport] of Object.entries(VIEWPORTS)) {
  for (const scheme of ["light", "dark"]) {
    const key = `${label}-${scheme}`;
    const context = await browser.newContext({
      viewport,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      colorScheme: scheme,
      storageState: statePath
    });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2600);
      await page.screenshot({ path: `${OUT}/profile-${key}.png` });
      const info = await measure(page);
      report[key] = info;
      if (!info.found) {
        console.log(`${key}: hero controls not found`);
        continue;
      }
      console.log(`${key}: camera ${info.camera.w}x${info.camera.h}px  target44=${info.meetsTouchTarget}`);
      console.log(
        `   overlap with avatar: ${info.overlapShareOfCamera}% of the button  centreInsideAvatar=${info.cameraCentreInsideAvatar}  onTop=${info.cameraOnTop}`
      );
      const escaping = info.clippers.filter((c) => c.cameraEscapes);
      if (escaping.length) {
        console.log(`   CLIPPED BY: ${escaping.map((c) => c.selector).join(" | ")}`);
      }
    } catch (error) {
      console.log(`${key}: FAILED ${error.message}`);
      report[key] = { error: error.message };
    }
    await context.close();
  }
}

fs.writeFileSync(`${OUT}/profile-hero.json`, JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}/profile-hero.json`);
await browser.close();
