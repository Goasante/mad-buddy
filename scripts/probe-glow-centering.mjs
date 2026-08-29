/**
 * Measure real Glow-vs-avatar centering on the surfaces the owner reported.
 *
 * Measures the RENDERED boxes rather than reading CSS: the question is whether
 * the avatar's centre coincides with the glow ring's centre on each surface,
 * and a stylesheet can look correct while a wrapper shifts one of them.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3330";

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', "a@v4test.local");
  await page.fill('input[type="password"]', "Password123!");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await login(page);

for (const [name, route] of [
  ["home", "/dashboard"],
  ["muddies", "/friends"],
  ["profile", "/profile"]
]) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const found = await page.evaluate(() => {
    const out = [];
    // Every glow wrapper on the page, whichever primitive drew it.
    const wrappers = document.querySelectorAll(".proximity-glow, .proximity-halo");
    for (const wrapper of Array.from(wrappers).slice(0, 6)) {
      // The avatar is the wrapper's non-decorative subject.
      const avatar =
        wrapper.querySelector(".proximity-glow__subject > *") ??
        wrapper.querySelector('[role="img"] > *') ??
        wrapper.firstElementChild;
      if (!avatar) continue;
      const w = wrapper.getBoundingClientRect();
      const a = avatar.getBoundingClientRect();
      if (a.width === 0) continue;
      out.push({
        dx: Math.round((w.left + w.width / 2) - (a.left + a.width / 2)),
        dy: Math.round((w.top + w.height / 2) - (a.top + a.height / 2)),
        wrapper: [Math.round(w.width), Math.round(w.height)],
        avatar: [Math.round(a.width), Math.round(a.height)],
        // A non-square avatar box is itself a defect: the image would be
        // squashed inside a circular mask.
        square: Math.abs(a.width - a.height) <= 1
      });
    }
    return out;
  });

  console.log(`${name}: ${found.length} glow avatars`);
  for (const f of found) {
    const centered = Math.abs(f.dx) <= 1 && Math.abs(f.dy) <= 1;
    console.log(
      `  ${centered ? "CENTERED" : "OFF-CENTER"} dx=${f.dx} dy=${f.dy} wrapper=${f.wrapper} avatar=${f.avatar} square=${f.square}`
    );
  }
}

await browser.close();
