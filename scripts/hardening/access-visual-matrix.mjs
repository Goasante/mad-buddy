/**
 * Runtime review of every access state, on real phones, in both themes.
 *
 * Two jobs at once:
 *
 *   BEHAVIOUR  each review persona shows what its description claims. A cohort
 *              whose accounts do not match their documented state is worse than
 *              no cohort -- the owner would review the wrong thing.
 *
 *   LAYOUT     no horizontal scroll, no content escaping the viewport, no
 *              paywall obscuring the bottom navigation, and no giant
 *              interstitial dominating the free app.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const PASSWORD = "AccessReview123!";
const SIZES = [[360, 800], [390, 844], [430, 932]];

const PERSONAS = [
  { email: "accessday1@review.local", label: "welcome day 1", locked: false, mustSay: [], mustNotSay: [/has ended/i] },
  { email: "accessday10@review.local", label: "4 days left", locked: false, mustSay: [], mustNotSay: [/has ended/i] },
  { email: "accessday13@review.local", label: "ends tomorrow", locked: false, mustSay: [], mustNotSay: [/has ended/i] },
  { email: "accessexpired@review.local", label: "expired", locked: true, mustSay: [/Welcome Access has ended/i], mustNotSay: [] },
  { email: "accesspaid@review.local", label: "paid", locked: false, mustSay: [], mustNotSay: [/has ended/i, /Welcome Access/i] },
  { email: "accessgranted@review.local", label: "admin grant", locked: false, mustSay: [], mustNotSay: [/has ended/i] },
  { email: "accessindef@review.local", label: "indefinite", locked: false, mustSay: [], mustNotSay: [/has ended/i] },
  { email: "accessnone@review.local", label: "never had access", locked: true, mustSay: [/needs Mad Buddy Access/i], mustNotSay: [/has ended/i] }
];

/* Every dark pattern the constitution names, as a detector. */
const DARK_PATTERNS = [
  [/\d+\s*(people|others|muddies)\s*(are\s*)?(waiting|nearby right now)/i, "fabricated demand"],
  [/only\s*\d+\s*(spots?|places?)\s*(left|remaining)/i, "fake scarcity"],
  [/hurry|act now|last chance|don't miss out|expires in \d+:\d+/i, "manufactured urgency"],
  [/friends will miss you|you'll lose your friends/i, "guilt copy"],
  [/upgrade your account|go pro|go premium|buddy plus|buddy pro/i, "legacy tier language"]
];

const LAYOUT = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const problems = [];

  if (document.documentElement.scrollWidth > vw + 1) {
    problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
  }

  /* DECORATIVE LAYERS ARE NOT CONTENT ESCAPING.
   *
   * This design uses deliberately oversized aria-hidden gradient blobs
   * (`w-[min(60rem,120vw)]`) positioned outside the viewport inside a clipping
   * ancestor. They are wider than the screen ON PURPOSE and clip correctly --
   * `document.scrollWidth` equals the viewport width, so nothing actually
   * scrolls.
   *
   * An earlier version of this check called `cs.getAttribute(...)` on a
   * CSSStyleDeclaration, which has no such method, so the aria-hidden filter
   * silently never ran and every route on every viewport reported the same
   * anonymous DIV. `aria-hidden` belongs to the ELEMENT, not its style. */
  for (const el of document.querySelectorAll("main *, section *")) {
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (el.closest("[aria-hidden=true]")) continue;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.left < -1 || r.right > vw + 1) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 34);
      problems.push(`escapes horizontally: ${t || el.tagName}`);
    }
  }

  /* THE PAYWALL MUST NOT OBSCURE NAVIGATION. Somebody who has just been told
     a feature is locked has to be able to walk away to the free product. */
  const nav = document.querySelector("nav, [role=navigation]");
  if (nav) {
    const nr = nav.getBoundingClientRect();
    if (nr.height > 4) {
      for (const el of document.querySelectorAll("main section, [class*=access], [class*=locked]")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        const r = el.getBoundingClientRect();
        const overlaps = r.bottom > nr.top + 2 && r.top < nr.bottom - 2;
        if (overlaps && Number(cs.zIndex || 0) >= Number(getComputedStyle(nav).zIndex || 0)) {
          problems.push("a locked-state panel covers the bottom navigation");
        }
      }
    }
  }

  /* AND IT MUST NOT DOMINATE. A lock taller than ~1.6 screens on a phone is an
     interstitial, not an explanation. */
  const lock = [...document.querySelectorAll("section")].find((s) =>
    /needs Mad Buddy Access|Welcome Access has ended/i.test(s.textContent || "")
  );
  if (lock) {
    const h = lock.getBoundingClientRect().height;
    if (h > vh * 1.6) problems.push(`locked panel is ${(h / vh).toFixed(2)} screens tall`);
  }

  return { problems: [...new Set(problems)].slice(0, 5) };
};

const browser = await chromium.launch();
const results = [];
const check = (n, ok, d) => { results.push(ok); if (!ok) console.log(`FAIL  ${n}${d ? `  — ${d}` : ""}`); };

/**
 * Sign in ONCE per persona and reuse the session across every viewport/theme.
 *
 * The first version logged in for each of the 48 combinations. The local GoTrue
 * saturated -- auth requests climbed to 0.4-1.2s each and later personas timed
 * out on /login, producing 20 FALSE failures against accounts whose credentials
 * were provably fine. Authenticating once per persona is both faster and
 * honest: the thing under test is the rendered access state, not the login
 * form, which has its own coverage.
 */
async function sessionFor(persona) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.fill('input[type="email"]', persona.email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const ok = !new URL(page.url()).pathname.startsWith("/login");
  const state = ok ? await ctx.storageState() : null;
  await ctx.close();
  return { ok, state };
}

for (const persona of PERSONAS) {
  /* A short pause between persona logins. The local GoTrue is single-instance
     and was taking 0.4-1.2s per auth request under back-to-back sign-ins,
     which timed out later personas and produced false failures. */
  await new Promise((r) => setTimeout(r, 2500));
  const session = await sessionFor(persona);
  if (!session.ok) {
    check(`${persona.label}: login`, false, "could not sign in");
    continue;
  }

  for (const [w, h] of SIZES) {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({
        storageState: session.state,
        viewport: { width: w, height: h }, isMobile: true, hasTouch: true,
        deviceScaleFactor: 2, colorScheme: theme
      });
      const page = await ctx.newPage();
      try {

        for (const route of ["/linkr", "/hangout-mode", "/settings/access"]) {
          await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForTimeout(2400);
          /* VISIBLE TEXT ONLY.
           *
           * `document.body.textContent` includes <script> contents, and Next.js
           * serializes the RSC payload into inline scripts -- which carries
           * tour-registry metadata mentioning "Buddy Plus" and "Buddy Pro".
           * That made the dark-pattern detector report legacy tier language on
           * EVERY route for EVERY persona against a page whose visible copy was
           * completely clean. Scripts, styles and templates are excluded. */
          const text = await page.evaluate(() => {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
              acceptNode: (node) =>
                node.parentElement?.closest("script,style,template")
                  ? NodeFilter.FILTER_REJECT
                  : NodeFilter.FILTER_ACCEPT
            });
            const parts = [];
            let n;
            while ((n = walk.nextNode())) parts.push(n.textContent || "");
            return parts.join(" ").replace(/\s+/g, " ");
          });
          const tag = `${persona.label} ${w}x${h} ${theme} ${route}`;

          check(`${tag}: renders`, !/something went wrong|error occurred/i.test(text), "error page");

          const dark = DARK_PATTERNS.filter(([re]) => re.test(text)).map(([, n]) => n);
          check(`${tag}: no dark patterns`, dark.length === 0, dark.join(", "));

          if (route === "/linkr") {
            const isLocked = /needs Mad Buddy Access|Welcome Access has ended/i.test(text);
            check(`${tag}: lock state matches the persona`, isLocked === persona.locked,
              `locked=${isLocked}, expected ${persona.locked}`);
            for (const re of persona.mustSay) {
              check(`${tag}: says ${re}`, re.test(text), "missing expected copy");
            }
            for (const re of persona.mustNotSay) {
              check(`${tag}: does NOT say ${re}`, !re.test(text), "unexpected copy");
            }
            if (isLocked) {
              check(`${tag}: names what stays free`, /stays free/i.test(text), "no reassurance");
            }
          }

          const { problems } = await page.evaluate(LAYOUT);
          check(`${tag}: layout`, problems.length === 0, problems.join("; "));
        }
      } catch (e) {
        check(`${persona.label} ${w}x${h} ${theme}`, false, String(e).split("\n")[0].slice(0, 90));
      }
      await ctx.close();
    }
  }
}
await browser.close();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} visual + behaviour checks passed`);
console.log(`${PERSONAS.length} personas x ${SIZES.length} viewports x 2 themes x 3 routes`);
