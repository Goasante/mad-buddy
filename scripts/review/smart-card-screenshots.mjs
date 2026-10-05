import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const server = spawn('npm', ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '3000'], {
  stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }
});
let browser;
try {
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3000/dev/smart-card-review');
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('SmartCard review server did not start');
  await mkdir('artifacts/smart-card', { recursive: true });
  browser = await chromium.launch();
  for (const width of [320, 390, 430, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 }, deviceScaleFactor: 2 });
    await page.goto('http://127.0.0.1:3000/dev/smart-card-review');
    await page.locator('[data-smart-card-id="core_fallback"]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (width >= 640) await page.getByRole('button', { name: '720px', exact: true }).click();
    for (const id of ['core_fallback', 'plan_rsvp', 'muddy_birthday']) {
      const cards = page.locator(`[data-smart-card-id="${id}"]`);
      for (let index = 0; index < await cards.count(); index++) {
        const card = cards.nth(index);
        await card.scrollIntoViewIfNeeded();
        await card.locator('img[data-smart-card-background]').evaluate(image => image.decode());
        await card.screenshot({ path: `artifacts/smart-card/${width}-${id}-${index === 0 ? 'light' : 'dark'}.png` });
      }
    }
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
