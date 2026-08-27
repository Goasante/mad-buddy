import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.HOME_NEAR_REVIEW_URL ?? "http://127.0.0.1:3107/dev/near-surface";
const outputDir = join(process.cwd(), "tmp", "home-near-glow-review");
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 }
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const measurements = [];

try {
  for (const viewport of viewports) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport,
        colorScheme: theme,
        reducedMotion: "reduce",
        deviceScaleFactor: 1
      });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
      await page.screenshot({
        path: join(outputDir, `${viewport.width}x${viewport.height}-${theme}.png`),
        fullPage: false
      });

      if (theme === "light") {
        const after = await measure(page);

        if (viewport.width === 390) {
          await page.addStyleTag({
            content: `
              .near-strip .proximity-glow__ring {
                width: var(--glow-ring) !important;
                height: var(--glow-ring) !important;
              }
              .near-strip .proximity-glow__ring2 {
                width: var(--glow-outer) !important;
                height: var(--glow-outer) !important;
              }
              .near-strip .proximity-glow__core {
                box-shadow:
                  0 0 8px rgb(var(--glow-highlight) / 0.95),
                  0 0 var(--glow-blur) rgb(var(--glow-brand) / 0.75),
                  0 0 calc(var(--glow-blur) * 2.1) rgb(var(--glow-brand) / 0.34) !important;
              }
            `
          });
          const before = await measure(page);
          await page.screenshot({
            path: join(outputDir, "390x844-before-light.png"),
            fullPage: false
          });
          measurements.push({ viewport, before, after });
        } else {
          measurements.push({ viewport, after });
        }
      }

      await context.close();
    }
  }
} finally {
  await browser.close();
}

await writeFile(join(outputDir, "measurements.json"), JSON.stringify(measurements, null, 2));
console.log(JSON.stringify({ outputDir, measurements }, null, 2));

async function measure(page) {
  return page.locator(".proximity-glow").evaluateAll((glows) =>
    glows.map((glow) => {
      const round = (value) => Math.round(value * 100) / 100;
      const subject = glow.querySelector(".proximity-glow__subject");
      const core = glow.querySelector(".proximity-glow__core");
      const ring = glow.querySelector(".proximity-glow__ring");
      const ring2 = glow.querySelector(".proximity-glow__ring2");
      const strip = glow.closest("[data-near-strip]");
      if (!subject || !core || !ring || !strip) throw new Error("Incomplete Glow review DOM");

      const avatarBox = subject.getBoundingClientRect();
      const coreBox = core.getBoundingClientRect();
      const ringBox = ring.getBoundingClientRect();
      const ring2Box = ring2?.getBoundingClientRect() ?? null;
      const stripBox = strip.getBoundingClientRect();
      const ringStyle = getComputedStyle(ring);
      const coreStyle = getComputedStyle(core);
      const border = Number.parseFloat(ringStyle.borderLeftWidth) || 0;
      const coreBorder = Number.parseFloat(coreStyle.borderLeftWidth) || 0;

      const centre = (box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      const avatarCentre = centre(avatarBox);
      const ringCentre = centre(ringBox);
      const coreCentre = centre(coreBox);

      return {
        level: glow.getAttribute("data-level"),
        avatarPx: round(avatarBox.width),
        primaryRingGapPx: round((ringBox.width - 2 * border - avatarBox.width) / 2),
        innerCoreGapPx: round((coreBox.width - 2 * coreBorder - avatarBox.width) / 2),
        centreErrorPx: {
          ringX: round(Math.abs(ringCentre.x - avatarCentre.x)),
          ringY: round(Math.abs(ringCentre.y - avatarCentre.y)),
          coreX: round(Math.abs(coreCentre.x - avatarCentre.x)),
          coreY: round(Math.abs(coreCentre.y - avatarCentre.y))
        },
        circularErrorPx: {
          ring: round(Math.abs(ringBox.width - ringBox.height)),
          core: round(Math.abs(coreBox.width - coreBox.height)),
          ring2: ring2Box ? round(Math.abs(ring2Box.width - ring2Box.height)) : null
        },
        ring2ClearancePx: ring2Box
          ? {
              left: round(ring2Box.left - stripBox.left),
              right: round(stripBox.right - ring2Box.right),
              top: round(ring2Box.top - stripBox.top),
              bottom: round(stripBox.bottom - ring2Box.bottom)
            }
          : null
      };
    })
  );
}
