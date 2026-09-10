/**
 * Visual + interaction regression check for the Quick Actions launcher and
 * the UpFor hero background, exercising real pointer drag/snap/persistence
 * behaviour that unit tests cannot cover without a browser.
 *
 * Run against a DEV server (the /dev/upfor-cards fixture route is compiled
 * out of production builds): `npx next dev -p 3108`, then
 * `node scripts/quick-actions-visual.mjs`.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.env.QA_CHECK_URL ?? 'http://localhost:3108/dev/upfor-cards';
await fs.mkdir('screenshots/quick-actions', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
let failures = 0;

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
  if (!condition) failures++;
}

// --- Default position, header removal, hero background, sheet open -------
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((t) => localStorage.setItem('mad-buddy-theme', t), theme);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate((t) => { document.documentElement.classList.toggle('dark', t === 'dark'); document.documentElement.dataset.theme = t; }, theme);
  await page.evaluate(() => localStorage.removeItem('mad-buddy-quick-actions-position'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.upfor-card').first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/quick-actions/${theme}-default.png` });

  const metrics = await page.evaluate(() => {
    const header = document.querySelector('.upfor-header, header');
    const headerHasQA = header ? header.querySelector('.quick-actions-trigger') !== null : null;
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    const trigger = document.querySelector('.quick-actions-trigger').getBoundingClientRect();
    const navRect = nav ? nav.getBoundingClientRect() : null;
    return {
      headerHasQA,
      overlapsNav: navRect ? trigger.bottom > navRect.top : false,
      triggerVisible: trigger.width > 0 && trigger.height > 0
    };
  });
  check(`${theme}: no Quick Actions trigger in the header`, metrics.headerHasQA === false);
  check(`${theme}: launcher clears the bottom navigation`, !metrics.overlapsNav);
  check(`${theme}: launcher renders visibly`, metrics.triggerVisible);
  check(`${theme}: zero page errors on load`, errors.length === 0);

  await page.locator('.quick-actions-trigger').click();
  const sheetOpened = await page.locator('.quick-actions-sheet-list').count().then((n) => n > 0).catch(() => false);
  check(`${theme}: tapping the trigger opens the destinations sheet`, sheetOpened);
  await page.screenshot({ path: `screenshots/quick-actions/${theme}-sheet.png` });
  await page.close();
}

// --- Drag, edge-snap, tap-vs-drag distinction, persistence ---------------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem('mad-buddy-quick-actions-position'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.upfor-card').first().waitFor();
  await page.waitForTimeout(300);

  // Tiny jitter counts as a tap.
  const box1 = await page.locator('.quick-actions-trigger').boundingBox();
  await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
  await page.mouse.down();
  await page.mouse.move(box1.x + box1.width / 2 + 2, box1.y + box1.height / 2 + 1, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const openedByTap = await page.evaluate(() => document.querySelector('.quick-actions').dataset.open);
  check('a tiny jitter is treated as a tap and opens the sheet', openedByTap === 'true');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // A real drag moves it to the opposite edge and does not open the sheet.
  const box2 = await page.locator('.quick-actions-trigger').boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x - 250, box2.y + 40, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterDrag = await page.evaluate(() => {
    const c = document.querySelector('.quick-actions');
    return { edge: c.dataset.edge, open: c.dataset.open };
  });
  check('a real drag does not open the sheet', afterDrag.open === 'false');
  check('a real drag snaps to the left edge', afterDrag.edge === 'left');

  const stored = await page.evaluate(() => localStorage.getItem('mad-buddy-quick-actions-position'));
  check('the dragged position is saved to localStorage', Boolean(stored));

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.upfor-card').first().waitFor();
  await page.waitForTimeout(300);
  const afterReload = await page.evaluate(() => document.querySelector('.quick-actions').dataset.edge);
  check('the position restores after a reload', afterReload === 'left');

  await page.close();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
