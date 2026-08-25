/**
 * Real local browser journey: Event creation -> Event Linkr -> canonical chat.
 *
 * All product decisions are driven through the UI. The admin client is used
 * only as a test clock (scheduled -> live -> ended) and for postcondition
 * assertions. It refuses any non-local Supabase URL.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "HardeningPass123!";
const ROOT = resolve(process.cwd(), ".hardening", "events-e2e");
const ARTIFACTS = resolve(ROOT, "latest");
const EVENT_COVER = resolve(process.cwd(), "public", "brand", "launch-hero.png");

if (!SUPABASE_URL.includes("127.0.0.1") || !/^http:\/\/(localhost|127\.0\.0\.1):3200$/.test(BASE)) {
  throw new Error("refusing to run the Event E2E journey outside the local runtime");
}
if (!ARTIFACTS.startsWith(resolve(process.cwd(), ".hardening"))) {
  throw new Error("artifact path escaped the workspace");
}

const admin = createClient(SUPABASE_URL, LOCAL_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const checks = [];
const faults = [];
const nowTag = Date.now();
const EVENT_NAME = `Playwright Event ${nowTag}`;
const identities = {
  host: { email: "qa@local.test", displayName: "QA Host" },
  attendeeA: { email: "kofi@local.test", displayName: "Kofi Mensah" },
  attendeeB: { email: "ama@local.test", displayName: "Ama Boateng" },
  outsider: { email: "saa@local.test", displayName: "Saa Owusu" }
};
const USER_IDS = {
  attendeeA: "2a54c81c-acad-4191-b89d-2c427c693c7a",
  attendeeB: "b66cd360-1f24-4b02-9b8c-123b522d0c61"
};

function check(name, ok, detail = "") {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

async function visible(locator, timeout = 1500) {
  return locator.isVisible({ timeout }).catch(() => false);
}

async function screenshot(page, name, fullPage = false) {
  const path = resolve(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path, fullPage });
  console.log(`SHOT  ${path}`);
}

async function dismissIncidentalUi(page) {
  for (const label of [/skip/i, /not now/i, /maybe later/i, /^got it$/i]) {
    const button = page.getByRole("button", { name: label }).first();
    if (await visible(button, 300)) await button.click().catch(() => {});
  }
}

async function setTheme(page, theme) {
  await page.evaluate((next) => {
    localStorage.setItem("mad-buddy-theme-preference", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
  }, theme);
  await page.waitForTimeout(700);
}

async function login(context, identity, label) {
  const page = await context.newPage();
  page.on("pageerror", (error) => faults.push(`${label} pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) faults.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
  await page.goto(`${BASE}/login?next=/events`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // A freshly compiled Next dev route can paint the server-rendered form well
  // before React attaches its submit handler. Clicking during that gap triggers
  // the form's safe native POST fallback and react-hook-form then clears the
  // fields. Wait for the actual React handler so this remains a real UI login.
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    if (!form) return false;
    const propsKey = Object.keys(form).find((key) => key.startsWith("__reactProps$"));
    return Boolean(propsKey && form[propsKey]?.onSubmit);
  }, null, { timeout: 30_000 });
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  await email.fill(identity.email);
  await password.fill(PASSWORD);
  await page.waitForTimeout(100);
  check(`${label} login form retained controlled values`,
    (await email.inputValue()) === identity.email && (await password.inputValue()) === PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  } catch (error) {
    await screenshot(page, `login-failure-${label.toLowerCase().replaceAll(" ", "-")}`);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800);
    const state = `email=${JSON.stringify(await email.inputValue())} passwordLength=${(await password.inputValue()).length}`;
    throw new Error(`${label} login stayed at ${page.url()} (${state}): ${text}`, { cause: error });
  }
  await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissIncidentalUi(page);
  check(`${label} authenticated through the login UI`, new URL(page.url()).pathname === "/events", page.url());
  return page;
}

async function openLinkedEvent(page, eventId) {
  await page.goto(`${BASE}/events?event=${eventId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissIncidentalUi(page);
  const dialog = page.getByRole("dialog").filter({ hasText: EVENT_NAME });
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  return dialog;
}

async function selectGoing(page, eventId, label) {
  const dialog = await openLinkedEvent(page, eventId);
  const going = dialog.getByRole("radio", { name: "Going", exact: true });
  await going.click();
  await page.waitForFunction(
    () => document.querySelector('[role="dialog"] [role="radio"][aria-checked="true"]')?.textContent?.trim() === "Going",
    null,
    { timeout: 15_000 }
  );
  check(`${label} RSVP Going through UI`, await going.getAttribute("aria-checked") === "true");
  return dialog;
}

async function checkIn(page, eventId, label, screenshotName) {
  let dialog = await openLinkedEvent(page, eventId);
  await dialog.getByRole("button", { name: "Check in", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  if (screenshotName) await screenshot(page, screenshotName);
  await dialog.getByRole("button", { name: "Check in", exact: true }).click();
  const success = page.getByRole("dialog").filter({ hasText: "You're checked in" });
  await success.waitFor({ state: "visible", timeout: 20_000 });
  check(`${label} checked in through UI`, await success.getByText("You're checked in.", { exact: true }).isVisible());
  await success.getByRole("button", { name: "Done", exact: true }).click();
  // Check-in can unlock a real achievement. Dismiss that product overlay by
  // its normal UI control so it does not obscure the next Event action.
  const dismissAchievement = page.getByRole("button", { name: "Dismiss", exact: true }).last();
  if (await visible(dismissAchievement, 1000)) await dismissAchievement.click();
  dialog = page.getByRole("dialog").filter({ hasText: EVENT_NAME });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  return dialog;
}

async function consentToEventLinkr(page, dialog, label, consentShot, introShot) {
  await dialog.getByRole("button", { name: "I am open to meeting people", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: `Meet people at ${EVENT_NAME}` });
  await sheet.waitFor({ state: "visible", timeout: 15_000 });
  await screenshot(page, consentShot);
  await sheet.getByRole("button", { name: "I'm open to meeting people", exact: true }).click();
  // The legacy /discover handoff is a server redirect to /linkr. On a fresh
  // Next dev server both routes may compile in series, so allow the same cold
  // start budget used for top-level page loads.
  await page.waitForURL((url) => url.pathname === "/linkr" && Boolean(url.searchParams.get("eventId")), { timeout: 60_000 });
  await page.getByRole("button", { name: "Browse people here", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await screenshot(page, introShot);
  check(`${label} explicitly opted into Event Linkr through UI`, page.url().includes("eventId="));
  await page.getByRole("button", { name: "Browse people here", exact: true }).click();
}

async function sendText(page, text) {
  const field = page.locator('textarea[aria-label^="Message "]');
  await field.waitFor({ state: "visible", timeout: 20_000 });
  await field.fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await messageBubble(page, text).waitFor({ state: "visible", timeout: 20_000 });
}

function messageBubble(page, text) {
  // The responsive conversation rail contains a hidden preview with the same
  // text. Scope assertions to the visible canonical chat bubble itself.
  return page.locator("p.whitespace-pre-wrap").filter({ hasText: text });
}

async function overflowCheck(page, label) {
  const dimensions = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  check(`${label} has no horizontal page overflow`,
    dimensions.scrollWidth <= dimensions.innerWidth && dimensions.bodyScrollWidth <= dimensions.innerWidth,
    JSON.stringify(dimensions));
}

await rm(ARTIFACTS, { recursive: true, force: true });
await mkdir(ARTIFACTS, { recursive: true });

const browser = await chromium.launch();
const contexts = {};

try {
  for (const [key, theme] of [["host", "light"], ["attendeeA", "dark"], ["attendeeB", "light"], ["outsider", "dark"]]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: theme
    });
    await context.addInitScript((preference) => {
      localStorage.setItem("mad-buddy-theme-preference", preference);
    }, theme);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    contexts[key] = context;
  }

  const host = await login(contexts.host, identities.host, "Host");
  const attendeeA = await login(contexts.attendeeA, identities.attendeeA, "Attendee A");
  const attendeeB = await login(contexts.attendeeB, identities.attendeeB, "Attendee B");
  const outsider = await login(contexts.outsider, identities.outsider, "Outsider");

  // Host: real Create Event flow.
  await host.getByRole("button", { name: "Create", exact: true }).click();
  let create = host.getByRole("dialog").filter({ hasText: "Create Event" });
  await create.waitFor({ state: "visible", timeout: 15_000 });
  await screenshot(host, "01-create-event-light-390x844");
  await setTheme(host, "dark");
  await screenshot(host, "02-create-event-dark-390x844");
  await setTheme(host, "light");

  await create.getByRole("radio", { name: /Invited people/ }).click();
  await create.getByRole("checkbox", { name: /Kofi Mensah/ }).waitFor({ state: "visible", timeout: 15_000 });
  await create.getByRole("checkbox", { name: /Kofi Mensah/ }).click();
  await create.getByRole("checkbox", { name: /Ama Boateng/ }).click();
  check("Host selected exactly two invitees in the UI",
    await create.getByRole("checkbox", { checked: true }).count() === 2);
  await create.getByRole("button", { name: "Continue", exact: true }).click();

  create = host.getByRole("dialog").filter({ hasText: "Event basics" });
  await create.waitFor({ state: "visible", timeout: 10_000 });
  // Exercise the real chooser/upload/media-processing path with a repository
  // image that satisfies the Event cover quality gate (1254 x 1254).
  await create.locator('input[type="file"]').setInputFiles(EVENT_COVER);
  await create.locator("img").first().waitFor({ state: "visible", timeout: 15_000 });
  await create.getByLabel("Event name").fill(EVENT_NAME);
  await create.getByLabel("Description").fill("A controlled local Event used to prove the complete Event Linkr journey.");
  await create.getByRole("button", { name: "Continue", exact: true }).click();

  create = host.getByRole("dialog").filter({ hasText: "When & where" });
  await create.waitFor({ state: "visible", timeout: 10_000 });
  const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
  const dateValue = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await create.locator("#event-date").fill(dateValue);
  await create.locator("#event-start").fill("12:00");
  await create.locator("#event-end").fill("15:00");
  await create.getByLabel("Location").fill("Mad Buddy Local Hall");
  await create.getByRole("button", { name: "Continue", exact: true }).click();

  create = host.getByRole("dialog").filter({ hasText: "Review your Event" });
  await create.waitFor({ state: "visible", timeout: 10_000 });
  await screenshot(host, "03-create-review-light-390x844");
  await setTheme(host, "dark");
  await screenshot(host, "04-create-review-dark-390x844");
  await setTheme(host, "light");
  await create.getByRole("button", { name: "Publish event", exact: true }).click();

  const published = host.getByRole("dialog").filter({ hasText: "Event published" });
  const publishFailure = create.getByRole("alert").filter({ hasText: "We couldn't publish your Event" });
  const publishOutcome = await Promise.race([
    published.waitFor({ state: "visible", timeout: 45_000 }).then(() => "published"),
    publishFailure.waitFor({ state: "visible", timeout: 45_000 }).then(() => "failed")
  ]);
  if (publishOutcome === "failed") {
    await screenshot(host, "publish-failure");
    throw new Error(`Event publish failed in the UI: ${(await publishFailure.innerText()).replace(/\s+/g, " ")}`);
  }
  await screenshot(host, "05-published-event-390x844");

  const { data: createdEvent, error: createdError } = await admin.from("events")
    .select("id, status, visibility, starts_at, ends_at")
    .eq("name", EVENT_NAME)
    .maybeSingle();
  check("UI publish created exactly one local Event", !createdError && Boolean(createdEvent?.id), createdError?.message ?? createdEvent?.id);
  check("Published Event retained invite-only audience", createdEvent.visibility === "invite", createdEvent.visibility);
  const eventId = createdEvent.id;

  await published.getByRole("button", { name: "View event", exact: true }).click();
  let hostDetail = host.getByRole("dialog").filter({ hasText: EVENT_NAME });
  await hostDetail.waitFor({ state: "visible", timeout: 15_000 });
  await screenshot(host, "06-event-detail-modal-390x844");
  await host.keyboard.press("Escape");
  await host.getByRole("button", { name: `Open ${EVENT_NAME}`, exact: true }).click();
  hostDetail = host.getByRole("dialog").filter({ hasText: EVENT_NAME });
  await hostDetail.waitFor({ state: "visible", timeout: 10_000 });
  check("Host reopened the published Event from its rendered card", await hostDetail.isVisible());
  await host.keyboard.press("Escape");

  // Outsider: direct-link access fails closed and reveals no Event content.
  await outsider.goto(`${BASE}/events?event=${eventId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await outsider.getByText("We couldn't open this event.", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  check("Outsider cannot open the invite-only Event", !(await outsider.getByText(EVENT_NAME, { exact: true }).isVisible().catch(() => false)));

  await selectGoing(attendeeA, eventId, "Attendee A");
  await screenshot(attendeeA, "07-attendee-a-going-390x844");
  await attendeeA.keyboard.press("Escape");
  await selectGoing(attendeeB, eventId, "Attendee B");
  await attendeeB.keyboard.press("Escape");

  // Test clock: scheduled -> live. No product decision is bypassed.
  const liveStart = new Date(Date.now() - 15 * 60_000).toISOString();
  const liveEnd = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  const { error: liveError } = await admin.from("events").update({
    starts_at: liveStart,
    ends_at: liveEnd,
    status: "active"
  }).eq("id", eventId);
  check("Controlled local Event clock advanced to live", !liveError, liveError?.message ?? "active");

  let detailA = await checkIn(attendeeA, eventId, "Attendee A", "08-live-check-in-a-390x844");
  await screenshot(attendeeA, "09-checked-in-a-390x844");
  let detailB = await checkIn(attendeeB, eventId, "Attendee B", null);
  await screenshot(attendeeB, "10-checked-in-b-390x844");

  await consentToEventLinkr(attendeeA, detailA, "Attendee A", "11-event-linkr-consent-a-390x844", "12-event-linkr-intro-a-390x844");
  await consentToEventLinkr(attendeeB, detailB, "Attendee B", "13-event-linkr-consent-b-390x844", "14-event-linkr-intro-b-390x844");

  // Both are now eligible. Reload A to obtain the server-rendered B candidate.
  await attendeeA.goto(`${BASE}/linkr?eventId=${eventId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await attendeeA.getByRole("button", { name: "Browse people here", exact: true }).click();
  await attendeeA.getByRole("heading", { name: /Ama Boateng/ }).waitFor({ state: "visible", timeout: 20_000 });
  await screenshot(attendeeA, "15-event-linkr-candidate-a-sees-b-390x844");

  // Put B on A's card before the first connect, then prove it does not change.
  await attendeeB.getByRole("heading", { name: /Kofi Mensah/ }).waitFor({ state: "visible", timeout: 20_000 });
  const aConnectWrite = attendeeA.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/linkr" &&
    Boolean(response.request().headers()["next-action"]) &&
    Boolean(response.request().postData()?.includes(USER_IDS.attendeeB))
  );
  await attendeeA.getByRole("button", { name: "Connect", exact: true }).click();
  check("A's Connect Server Action completed through the browser", (await aConnectWrite).ok());
  check("A's one-sided Connect shows no mutual state to A",
    !(await attendeeA.getByRole("dialog", { name: /You clicked/i }).isVisible().catch(() => false)));
  check("B receives no one-sided leak and still sees the ordinary candidate card",
    await attendeeB.getByRole("heading", { name: /Kofi Mensah/ }).isVisible() &&
      !(await attendeeB.getByText("You clicked!", { exact: false }).isVisible().catch(() => false)));
  await screenshot(attendeeB, "16-one-sided-private-b-390x844");

  const bConnectWrite = attendeeB.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/linkr" &&
    Boolean(response.request().headers()["next-action"]) &&
    Boolean(response.request().postData()?.includes(USER_IDS.attendeeA))
  );
  await attendeeB.getByRole("button", { name: "Connect", exact: true }).click();
  check("B's reciprocal Connect Server Action completed through the browser", (await bConnectWrite).ok());
  const matchB = attendeeB.getByRole("dialog", { name: /You clicked/i });
  await matchB.waitFor({ state: "visible", timeout: 20_000 });
  check("Reciprocal Connect renders mutual state to Attendee B", await matchB.getByText(/both want to connect/i).isVisible());
  await matchB.getByRole("button", { name: "Say hi", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await attendeeB.waitForTimeout(2_500);
  await screenshot(attendeeB, "17-mutual-state-b-390x844");

  // The first actor receives the symmetric mutual notification.
  await attendeeA.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await attendeeA.getByText("You clicked!", { exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });
  check("Attendee A receives the mutual state after reciprocity", await attendeeA.getByText("You both want to connect.", { exact: true }).first().isVisible());
  await screenshot(attendeeA, "18-mutual-state-a-notification-390x844");

  // Say hi must land on the canonical conversation id returned by the match.
  await matchB.getByRole("button", { name: "Say hi", exact: true }).click();
  await attendeeB.waitForURL((url) => url.pathname === "/messages" && Boolean(url.searchParams.get("conversation")), { timeout: 60_000 });
  const conversationId = new URL(attendeeB.url()).searchParams.get("conversation");
  check("Say hi opened a canonical conversation id", Boolean(conversationId), attendeeB.url());

  const fromB = `Hello from B ${nowTag}`;
  const fromA = `Hello from A ${nowTag}`;
  await sendText(attendeeB, fromB);
  await attendeeA.goto(`${BASE}/messages?conversation=${conversationId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await messageBubble(attendeeA, fromB).waitFor({ state: "visible", timeout: 20_000 });
  await sendText(attendeeA, fromA);
  await attendeeB.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await messageBubble(attendeeB, fromA).waitFor({ state: "visible", timeout: 20_000 });
  check("Both attendees exchanged messages in the same conversation", true, conversationId);
  await dismissIncidentalUi(attendeeB);
  await screenshot(attendeeB, "19-say-hi-canonical-chat-390x844");

  // Test clock: live -> ended, then verify Event Mode is revoked but social
  // continuity remains.
  const { error: endError } = await admin.from("events").update({
    ends_at: new Date(Date.now() - 60_000).toISOString(),
    status: "ended"
  }).eq("id", eventId);
  check("Controlled local Event clock advanced to ended", !endError, endError?.message ?? "ended");

  await attendeeA.goto(`${BASE}/linkr?eventId=${eventId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("Ended Event removes Event Linkr discovery context",
    !(await attendeeA.getByText(EVENT_NAME, { exact: true }).isVisible().catch(() => false)));

  const { data: connectionRows } = await admin.from("linkr_connections")
    .select("id, conversation_id, ended_at")
    .or(`user_low.eq.2a54c81c-acad-4191-b89d-2c427c693c7a,user_high.eq.2a54c81c-acad-4191-b89d-2c427c693c7a`)
    .is("ended_at", null);
  const surviving = (connectionRows ?? []).find((row) => row.conversation_id === conversationId);
  check("Mutual Linkr relationship survives Event end", Boolean(surviving), conversationId);

  await attendeeA.goto(`${BASE}/messages?conversation=${conversationId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await messageBubble(attendeeA, fromA).waitFor({ state: "visible", timeout: 20_000 });
  await messageBubble(attendeeA, fromB).waitFor({ state: "visible", timeout: 20_000 });
  await attendeeB.goto(`${BASE}/messages?conversation=${conversationId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await messageBubble(attendeeB, fromA).waitFor({ state: "visible", timeout: 20_000 });
  await messageBubble(attendeeB, fromB).waitFor({ state: "visible", timeout: 20_000 });
  check("Canonical conversation and both messages survive Event end", true, conversationId);
  await dismissIncidentalUi(attendeeA);
  await screenshot(attendeeA, "20-chat-survives-event-end-390x844");

  // Required 360/430 overflow checks using the authenticated Host state.
  const hostState = await contexts.host.storageState();
  for (const spec of [
    { width: 360, height: 800, name: "21-create-event-light-360x800" },
    { width: 430, height: 932, name: "22-create-event-light-430x932" }
  ]) {
    const context = await browser.newContext({
      storageState: hostState,
      viewport: { width: spec.width, height: spec.height },
      isMobile: true,
      hasTouch: true,
      colorScheme: "light"
    });
    await context.addInitScript(() => localStorage.setItem("mad-buddy-theme-preference", "light"));
    const page = await context.newPage();
    await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissIncidentalUi(page);
    await overflowCheck(page, `${spec.width}x${spec.height} Events`);
    // A new context can paint the server-rendered button before its React
    // onClick exists. Wait for the actual handler so this viewport check opens
    // the real composer rather than clicking an inert hydration shell.
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Create");
      if (!button) return false;
      const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
      return Boolean(propsKey && button[propsKey]?.onClick);
    }, null, { timeout: 30_000 });
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("dialog", { name: "Create Event" }).waitFor({ state: "visible", timeout: 30_000 });
    await overflowCheck(page, `${spec.width}x${spec.height} Create Event`);
    await screenshot(page, spec.name);
    await context.close();
  }

  check("No browser page errors or HTTP 5xx responses occurred", faults.length === 0, faults.join(" | "));

  const result = {
    eventId,
    eventName: EVENT_NAME,
    conversationId,
    passed: checks.filter(Boolean).length,
    total: checks.length,
    artifacts: ARTIFACTS,
    faults
  };
  await writeFile(resolve(ARTIFACTS, "run-summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`RESULT ${JSON.stringify(result, null, 2)}`);
} finally {
  for (const [name, context] of Object.entries(contexts)) {
    await context.tracing.stop({ path: resolve(ARTIFACTS, `trace-${name}.zip`) }).catch(() => {});
    await context.close().catch(() => {});
  }
  await browser.close();
}
