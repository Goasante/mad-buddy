/**
 * Authenticated viewport / scroll geometry audit.
 *
 * Repository truth supplies the route inventory. Every static route is checked
 * at 390x844 in light and dark; representative route families are additionally
 * checked at 360x640, 360x800 and 430x932. Dynamic detail routes are resolved
 * from links visible to the authenticated account, so the harness never
 * hard-codes production identifiers.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";

// Worktrees may intentionally share dependencies with another checkout. ESM
// package resolution does not follow every Windows junction arrangement, so a
// caller can point resolution at an installed project without changing what is
// audited: MB_PLAYWRIGHT_ROOT=C:\\path\\with\\node_modules.
const require = createRequire(join(process.env.MB_PLAYWRIGHT_ROOT || process.cwd(), "package.json"));
const { chromium } = require("playwright");

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || join(process.cwd(), ".artifacts", "auth-local.json");
const OUT = process.env.MB_VIEWPORT_OUT || join(process.cwd(), ".artifacts", "viewport-scroll");
const ROUTE_ROOT = join(process.cwd(), "app", "(app)");
const TOLERANCE = 3;
const routeOverrides = JSON.parse(process.env.MB_ROUTE_OVERRIDES || "{}");

mkdirSync(join(OUT, "screenshots"), { recursive: true });

function authenticatedRoutes() {
  const routes = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const path = relative(ROUTE_ROOT, directory).split(sep).filter(Boolean).join("/");
        routes.push(`/${path}`);
      }
    }
  };
  walk(ROUTE_ROOT);
  return routes.sort();
}

const inventory = authenticatedRoutes();
const requestedRoutes = (process.env.MB_ROUTES || "")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const routeTemplates = requestedRoutes.length
  ? inventory.filter((route) => requestedRoutes.includes(route))
  : inventory;

function routePattern(template) {
  return new RegExp(`^${template.replace(/\[.*?\]/g, "[^/?#]+")}(?:[?#]|$)`);
}

async function resolveRoute(page, template) {
  if (routeOverrides[template]) return routeOverrides[template];
  if (!template.includes("[")) return template;
  const parent = template.slice(0, template.indexOf("/[")) || "/dashboard";
  await page.goto(`${BASE}${parent}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_500);
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href")).filter(Boolean)
  );
  return hrefs.find((href) => routePattern(template).test(href))?.split(/[?#]/)[0] ?? null;
}

const representative = new Set([
  "/dashboard", "/friends", "/friends/[username]", "/linkr", "/hangout-mode",
  "/messages", "/plans", "/events", "/groups", "/groups/[id]", "/profile",
  "/settings", "/settings/appearance/wallpaper", "/safe-arrival", "/scan"
]);

const extraViewports = process.env.MB_PRIMARY_VIEWPORT_ONLY === "1" ? [] : [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 430, height: 932 }
];

const geometry = () => {
  const owner = document.querySelector("[data-app-scroll-owner]");
  if (!(owner instanceof HTMLElement)) {
    return { problems: ["missing [data-app-scroll-owner]"] };
  }

  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  };

  const fixedAtEdge = (selector, edge) => {
    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || getComputedStyle(element).position !== "fixed") continue;
      const rect = element.getBoundingClientRect();
      if (edge === "top" && rect.top <= 1) return element;
      if (edge === "bottom" && Math.abs(rect.bottom - innerHeight) <= 2) return element;
    }
    return null;
  };

  const meaningfulEnd = () => {
    const ownerRect = owner.getBoundingClientRect();
    let end = 0;
    for (const element of owner.querySelectorAll("button, a[href], input, textarea, select, img, video, h1, h2, h3, p, li, article, section")) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      if (style.position === "fixed" || style.position === "absolute") continue;
      const rect = element.getBoundingClientRect();
      end = Math.max(end, rect.bottom - ownerRect.top + owner.scrollTop);
    }
    return end;
  };

  const ownerStyle = getComputedStyle(owner);
  const header = fixedAtEdge("header", "top");
  const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
  const navVisible = nav instanceof HTMLElement && visible(nav);
  const headerRect = header?.getBoundingClientRect() ?? null;
  const navRect = navVisible ? nav.getBoundingClientRect() : null;
  const initial = {
    scrollTop: owner.scrollTop,
    clientHeight: owner.clientHeight,
    scrollHeight: owner.scrollHeight,
    paddingTop: parseFloat(ownerStyle.paddingTop) || 0,
    paddingBottom: parseFloat(ownerStyle.paddingBottom) || 0,
    contentEnd: meaningfulEnd(),
    headerTop: headerRect?.top ?? null,
    headerBottom: headerRect?.bottom ?? null,
    navTop: navRect?.top ?? null,
    navBottom: navRect?.bottom ?? null
  };

  const problems = [];
  const documentOverflow = Math.max(
    document.documentElement.scrollHeight - document.documentElement.clientHeight,
    document.body.scrollHeight - innerHeight
  );
  if (documentOverflow > 2) problems.push(`document owns ${Math.round(documentOverflow)}px vertical overflow`);
  if (!/(auto|scroll)/.test(ownerStyle.overflowY)) problems.push(`main overflow-y is ${ownerStyle.overflowY}`);

  return { initial, problems, navVisible, documentOverflow };
};

async function inspect(page) {
  const top = await page.evaluate(geometry);
  if (!top.initial) return top;

  await page.evaluate(() => {
    const owner = document.querySelector("[data-app-scroll-owner]");
    if (owner instanceof HTMLElement) owner.scrollTop = owner.scrollHeight;
  });
  await page.waitForTimeout(120);

  const bottom = await page.evaluate(() => {
    const owner = document.querySelector("[data-app-scroll-owner]");
    if (!(owner instanceof HTMLElement)) return null;
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
    };
    const header = [...document.querySelectorAll("header")].find((element) =>
      visible(element) && getComputedStyle(element).position === "fixed" && element.getBoundingClientRect().top <= 1
    );
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    const ownerRect = owner.getBoundingClientRect();
    let contentEnd = 0;
    for (const element of owner.querySelectorAll("button, a[href], input, textarea, select, img, video, h1, h2, h3, p, li, article, section")) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      if (style.position === "fixed" || style.position === "absolute") continue;
      const rect = element.getBoundingClientRect();
      contentEnd = Math.max(contentEnd, rect.bottom - ownerRect.top + owner.scrollTop);
    }
    return {
      scrollTop: owner.scrollTop,
      maxScroll: owner.scrollHeight - owner.clientHeight,
      contentEnd,
      headerTop: header?.getBoundingClientRect().top ?? null,
      headerBottom: header?.getBoundingClientRect().bottom ?? null,
      navTop: nav && visible(nav) ? nav.getBoundingClientRect().top : null,
      navBottom: nav && visible(nav) ? nav.getBoundingClientRect().bottom : null
    };
  });

  const problems = [...top.problems];
  if (bottom) {
    /* Measure against the content extent captured at scrollTop=0. Sticky and
       conditionally visible controls can otherwise leave the bottom sample
       with a smaller visible-element set and manufacture a false tail. */
    const tail = top.initial.scrollHeight - top.initial.contentEnd;
    /* A short page naturally has unused room between its last element and the
       viewport floor. That is not a scroll tail because it cannot be scrolled
       into. Tail analysis applies only when this owner genuinely overflows. */
    if (bottom.maxScroll > TOLERANCE && tail > top.initial.paddingBottom + 48) {
      problems.push(`unexplained bottom tail ${Math.round(tail)}px (padding ${Math.round(top.initial.paddingBottom)}px)`);
    }
    if (Math.abs(bottom.scrollTop - bottom.maxScroll) > TOLERANCE) {
      problems.push("final content cannot reach the end of the scroll owner");
    }
    if (top.initial.headerTop !== null && Math.abs((bottom.headerTop ?? 999) - top.initial.headerTop) > 1) {
      problems.push("fixed header moved while content scrolled");
    }
    if (top.initial.navBottom !== null && Math.abs((bottom.navBottom ?? 999) - top.initial.navBottom) > 1) {
      problems.push("bottom navigation moved while content scrolled");
    }
  }

  await page.evaluate(() => {
    const owner = document.querySelector("[data-app-scroll-owner]");
    if (owner instanceof HTMLElement) owner.scrollTop = 0;
    window.scrollTo(0, 100);
  });
  const windowScroll = await page.evaluate(() => window.scrollY);
  if (windowScroll > TOLERANCE) problems.push(`window accepted ${Math.round(windowScroll)}px scroll`);

  return { ...top, bottom, problems, fits: top.initial.scrollHeight <= top.initial.clientHeight + TOLERANCE };
}

const browser = await chromium.launch();
const resolverContext = await browser.newContext({ storageState: AUTH, viewport: { width: 390, height: 844 } });
const resolverPage = await resolverContext.newPage();
const resolvedRoutes = [];
for (const template of routeTemplates) {
  resolvedRoutes.push({ template, route: await resolveRoute(resolverPage, template) });
}
await resolverContext.close();

const unresolved = resolvedRoutes.filter((entry) => !entry.route);
const cases = [
  ...["light", "dark"].flatMap((theme) =>
    resolvedRoutes.filter((entry) => entry.route).map((entry) => ({ ...entry, theme, viewport: { width: 390, height: 844 } }))
  ),
  ...extraViewports.flatMap((viewport) =>
    ["light", "dark"].flatMap((theme) =>
      resolvedRoutes
        .filter((entry) => entry.route && representative.has(entry.template))
        .map((entry) => ({ ...entry, theme, viewport }))
    )
  )
];

const rows = [];
for (const auditCase of cases) {
  const context = await browser.newContext({
    storageState: AUTH,
    viewport: auditCase.viewport,
    colorScheme: auditCase.theme,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const row = { ...auditCase, size: `${auditCase.viewport.width}x${auditCase.viewport.height}` };
  delete row.viewport;
  try {
    await page.goto(`${BASE}${auditCase.route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_600);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dismiss = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
      if (!(await dismiss.count())) break;
      await dismiss.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    row.finalUrl = new URL(page.url()).pathname;
    const screenshotName = `${auditCase.template.replace(/[^a-z0-9]+/gi, "_")}_${row.size}_${auditCase.theme}`;
    await page.screenshot({
      path: join(OUT, "screenshots", `${screenshotName}_top.png`),
      fullPage: false
    });
    Object.assign(row, await inspect(page));
    row.status = row.problems.length ? "FAIL" : "PASS";
    await page.evaluate(() => {
      const owner = document.querySelector("[data-app-scroll-owner]");
      if (owner instanceof HTMLElement) owner.scrollTop = owner.scrollHeight;
    });
    await page.waitForTimeout(120);
    await page.screenshot({
      path: join(OUT, "screenshots", `${screenshotName}_bottom.png`),
      fullPage: false
    });
    row.screenshots = {
      top: `screenshots/${screenshotName}_top.png`,
      bottom: `screenshots/${screenshotName}_bottom.png`
    };
  } catch (error) {
    row.status = "ERROR";
    row.problems = [String(error).split("\n")[0]];
  }
  rows.push(row);
  await context.close();
}

await browser.close();

const routeSummary = routeTemplates.map((template) => {
  const audited = rows.filter((row) => row.template === template);
  const resolved = resolvedRoutes.find((entry) => entry.template === template)?.route ?? null;
  return {
    template,
    resolved,
    status: !resolved ? "NOT CHECKED" : audited.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    checks: audited.length,
    failures: audited.flatMap((row) => row.problems.map((problem) => `${row.size} ${row.theme}: ${problem}`))
  };
});

writeFileSync(join(OUT, "report.json"), JSON.stringify({ inventory, routeTemplates, resolvedRoutes, rows, routeSummary }, null, 2));
const markdown = [
  "# App-wide viewport / scroll runtime matrix",
  "",
  `Generated against ${BASE}.`,
  "",
  "| Route | Runtime route | Status | Checks |",
  "|---|---|---:|---:|",
  ...routeSummary.map((row) => `| \`${row.template}\` | \`${row.resolved ?? "unresolved"}\` | ${row.status} | ${row.checks} |`),
  "",
  `Authenticated routes found: ${routeTemplates.length}`,
  `Authenticated routes audited: ${routeSummary.filter((row) => row.status !== "NOT CHECKED").length}`,
  `Not checked: ${unresolved.length}`,
  `Geometry failures: ${rows.filter((row) => row.status !== "PASS").length}`
].join("\n");
writeFileSync(join(OUT, "matrix.md"), `${markdown}\n`);

console.log(markdown);
for (const row of rows.filter((entry) => entry.status !== "PASS")) {
  console.log(`\n${row.size} ${row.theme} ${row.template} -> ${row.route}`);
  for (const problem of row.problems) console.log(`  - ${problem}`);
}

if (unresolved.length || rows.some((row) => row.status !== "PASS")) process.exitCode = 1;
