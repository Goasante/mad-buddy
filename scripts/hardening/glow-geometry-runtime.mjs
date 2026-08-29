/**
 * PROXIMITY GLOW — RUNTIME GEOMETRY, on the real surfaces.
 *
 * The device-side report is that the Glow ring sits off-centre against the
 * avatar. A previous measurement of the shared primitive found dx = 0, dy = 0.
 * This widens that check to the thing the earlier one could not rule out: a
 * defect OUTSIDE the primitive, introduced by whatever wraps it on a
 * particular route.
 *
 * For every Glow on Home, Muddies and a Muddy profile it reports:
 *   - the Glow's centre against the avatar's centre (dx, dy)
 *   - whether the avatar box is square
 *   - the parent chain's padding, transform, and flex/grid alignment
 *   - object-position on the image, if any
 *
 * A non-zero dx/dy with a symmetric parent means the primitive. A zero dx/dy
 * with an asymmetric parent means the wrapper. Either way the answer is
 * measured rather than guessed.
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
  // A Glow only renders for a fresh proximity fix.
  await admin
    .from("user_locations")
    .update({ last_updated: new Date().toISOString() })
    .not("user_id", "is", null);
  await admin.from("rate_limits").delete().eq("action", "auth.login");
}

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
}

/** Every Glow on the page, measured against the avatar it wraps. */
async function measureGlows(page) {
  return page.evaluate(() => {
    const results = [];
    for (const glow of document.querySelectorAll(".proximity-glow, [class*='proximity-glow']")) {
      /* THE AVATAR BOX, not the glyph inside it.
         A first pass selected `span span`, which matched the TEXT SPAN holding
         a fallback avatar's initials -- a 7x16 letter box -- and duly reported
         four "non-square avatars" on Home that were nothing of the kind. The
         avatar is the element sized by the Glow, so it is found by its box
         rather than by its contents: an <img>, or the nearest descendant whose
         width matches the Glow's. */
      const candidates = [...glow.querySelectorAll("img, span, div")];
      const glowBox = glow.getBoundingClientRect();
      const avatar =
        glow.querySelector("img") ??
        candidates.find((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && Math.abs(box.width - glowBox.width) < 2;
        });
      if (!avatar) continue;
      const g = glow.getBoundingClientRect();
      const a = avatar.getBoundingClientRect();
      if (g.width === 0 || a.width === 0) continue;

      const parent = glow.parentElement;
      const parentStyle = parent ? getComputedStyle(parent) : null;
      const avatarStyle = getComputedStyle(avatar);

      results.push({
        // The number the whole investigation turns on.
        dx: Math.round((g.left + g.width / 2 - (a.left + a.width / 2)) * 100) / 100,
        dy: Math.round((g.top + g.height / 2 - (a.top + a.height / 2)) * 100) / 100,
        avatarSquare: Math.abs(a.width - a.height) < 0.5,
        avatar: `${Math.round(a.width)}x${Math.round(a.height)}`,
        glow: `${Math.round(g.width)}x${Math.round(g.height)}`,
        // Everything outside the primitive that could shift it.
        parentPadding: parentStyle
          ? `${parentStyle.paddingTop}/${parentStyle.paddingRight}/${parentStyle.paddingBottom}/${parentStyle.paddingLeft}`
          : null,
        parentTransform: parentStyle?.transform ?? null,
        parentAlign: parentStyle ? `${parentStyle.display}|${parentStyle.alignItems}|${parentStyle.justifyContent}` : null,
        glowTransform: getComputedStyle(glow).transform,
        objectPosition: avatarStyle.objectPosition,
        objectFit: avatarStyle.objectFit
      });
    }
    return results;
  });
}

const SURFACES = [
  { name: "home", path: "/dashboard" },
  { name: "muddies", path: "/friends" }
];

const report = {};
let worstDx = 0;
let worstDy = 0;
let asymmetricParents = 0;
let nonSquare = 0;

for (const surface of SURFACES) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    storageState: statePath
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}${surface.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3600);
    await page.screenshot({ path: `${OUT}/glow-${surface.name}.png` });
    const glows = await measureGlows(page);
    report[surface.name] = glows;
    console.log(`\n=== ${surface.name} (${glows.length} glows) ===`);
    for (const glow of glows) {
      worstDx = Math.max(worstDx, Math.abs(glow.dx));
      worstDy = Math.max(worstDy, Math.abs(glow.dy));
      if (!glow.avatarSquare) nonSquare += 1;
      const pads = (glow.parentPadding ?? "").split("/");
      const asymmetric =
        pads.length === 4 && (pads[0] !== pads[2] || pads[1] !== pads[3]);
      if (asymmetric) asymmetricParents += 1;
      console.log(
        `  dx=${glow.dx} dy=${glow.dy} avatar=${glow.avatar} square=${glow.avatarSquare} glow=${glow.glow}`
      );
      console.log(
        `    parent pad=${glow.parentPadding} transform=${glow.parentTransform} align=${glow.parentAlign}`
      );
      if (glow.objectPosition !== "50% 50%") {
        console.log(`    OBJECT-POSITION IS NOT CENTRED: ${glow.objectPosition}`);
      }
    }
  } catch (error) {
    console.log(`${surface.name}: FAILED ${error.message}`);
    report[surface.name] = { error: error.message };
  }
  await context.close();
}

console.log("\n================ VERDICT ================");
console.log(`worst |dx| across every measured Glow: ${worstDx}`);
console.log(`worst |dy| across every measured Glow: ${worstDy}`);
console.log(`non-square avatar boxes:               ${nonSquare}`);
console.log(`parents with asymmetric padding:       ${asymmetricParents}`);
console.log(
  worstDx === 0 && worstDy === 0 && nonSquare === 0
    ? "GLOW DEFECT NOT REPRODUCED — shared geometry verified."
    : "GLOW OFFSET REPRODUCED — see the rows above for the surface and its parent."
);

fs.writeFileSync(`${OUT}/glow-geometry.json`, JSON.stringify(report, null, 2));
await browser.close();
