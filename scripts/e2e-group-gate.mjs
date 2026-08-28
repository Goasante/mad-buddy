/**
 * GROUP-MEMBERS ROOM — FULL END-TO-END GATE PROOF.
 *
 * This is the gate that was WIDE OPEN before this tranche: join_mode
 * 'community' had no branch in the resolver and fell through to `allowed`, so a
 * Room advertising "Group members" admitted the entire internet.
 *
 * The authority under test is live Group membership --
 *   conversations.conversation_type = 'group'
 *   conversation_members.status = 'joined'
 * -- evaluated server-side at join time, never cached and never client-supplied.
 * So the decisive cases are the ones where membership CHANGES: leaving the
 * Group must end eligibility on the next attempt, with no sweep.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:3220";
const PASSWORD = "Password123!";
const EVENT = "e0000000-0000-4000-8000-00000000000e";
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const C = "c0000000-0000-4000-8000-00000000000c";
const GROUP = "60000000-0000-4000-8000-000000000060"; // Rooftop Regulars
const OTHER_GROUP = "61000000-0000-4000-8000-000000000061"; // Other Crew
const ROOM_NAME = "Regulars Room";

function sql(query) {
  return execSync(
    `docker exec supabase_db_mad-buddy psql -U postgres -d postgres -t -A -c "${query.replace(/"/g, '\\"')}"`,
    { encoding: "utf8" }
  ).trim();
}

const ROOM = sql(`select id from public.event_circles where name='${ROOM_NAME}' and event_id='${EVENT}'`);

function membership(userId) {
  const room = sql(
    `select coalesce((select status from public.event_circle_members where event_circle_id='${ROOM}' and user_id='${userId}'),'none')`
  );
  const chat = sql(
    `select coalesce((select cm.status from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id where c.context_type='event_circle' and c.context_id='${ROOM}' and cm.user_id='${userId}'),'none')`
  );
  return { room, chat };
}

/** Put a user back to "never touched this room", so each case starts clean. */
function resetRoomMembership(userId) {
  sql(`delete from public.event_circle_members where event_circle_id='${ROOM}' and user_id='${userId}'`);
  sql(
    `delete from public.conversation_members cm using public.conversations c where c.id=cm.conversation_id and c.context_type='event_circle' and c.context_id='${ROOM}' and cm.user_id='${userId}'`
  );
}

async function loginAs(browser, email) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4500);
  return { context, page };
}

/** Assert on the CONTROL, never on prose -- refusal hints contain "join". */
async function roomRowState(page) {
  await page.goto(`${BASE}/events?event=${EVENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const body = await page.locator("body").innerText();
  const at = body.indexOf(ROOM_NAME);
  const text = at < 0 ? "(room not listed)" : body.slice(at, at + 150).replace(/\n+/g, " | ");
  const joinBtn = page.getByRole("button", { name: new RegExp(`^Join ${ROOM_NAME}$`, "i") });
  const canJoin = (await joinBtn.count()) > 0 && (await joinBtn.first().isEnabled());
  return { text, canJoin, joinBtn };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(ok ? "PASS" : "FAIL", "-", name, detail ? `(${detail})` : "");
};

// The Room must store a REAL group target server-side, not a client claim.
check(
  "room stores the real Group target server-side",
  sql(`select group_conversation_id from public.event_circle_group_targets where event_circle_id='${ROOM}'`) === GROUP,
  `target=${sql(`select group_conversation_id from public.event_circle_group_targets where event_circle_id='${ROOM}'`)}`
);

resetRoomMembership(B);
resetRoomMembership(C);

const browser = await chromium.launch();
const b1 = await loginAs(browser, "userb@mbgate.local");
const c1 = await loginAs(browser, "userc@mbgate.local");

// ------------------------------------------------- C: NOT IN THE TARGETED GROUP
check(
  "C is genuinely not in the targeted Group",
  sql(`select count(*) from public.conversation_members where conversation_id='${GROUP}' and user_id='${C}' and status='joined'`) === "0"
);
const cState = await roomRowState(c1.page);
check("C sees no Join CONTROL (non-member)", !cState.canJoin, cState.text.slice(0, 88));

// SERVER GATE: C scans a genuine, correctly-signed Room QR for this room. A
// token must not substitute for Group membership.
const token = execSync(
  `node --experimental-strip-types -e "import('./lib/events/qr.ts').then(m=>{console.log(m.createEventToken({contextId:'${ROOM}',purpose:'circle_join',expiresAtMs:Date.now()+300000}, process.env.SUPABASE_SERVICE_ROLE_KEY))})"`,
  {
    encoding: "utf8",
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
    }
  }
).trim();

async function scanAs(page, code) {
  await page.goto(`${BASE}/scan`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator('input[type="text"], input:not([type])').last().fill(code);
  const useCode = page.getByRole("button", { name: /use code/i }).last();
  if (await useCode.count()) await useCode.click();
  await page.waitForTimeout(5000);
  return page.locator("body").innerText();
}

const cScan = await scanAs(c1.page, token);
const cAfter = membership(C);
check(
  "C SERVER-side join refused despite a valid Room QR",
  cAfter.room !== "joined" && cAfter.chat !== "joined",
  JSON.stringify(cAfter)
);
check(
  "C is told it is for selected groups",
  /selected groups/i.test(cScan),
  (cScan.match(/[^|\n]*selected groups[^|\n]*/i) ?? ["(no message)"])[0].trim().slice(0, 70)
);
await c1.page.screenshot({ path: "screenshots/22-group-c-blocked.png" });

// ------------------------------------------------------ B: IN THE TARGETED GROUP
check(
  "B is genuinely a joined member of the targeted Group",
  sql(`select count(*) from public.conversation_members where conversation_id='${GROUP}' and user_id='${B}' and status='joined'`) === "1"
);
const bState = await roomRowState(b1.page);
check("B sees a real Join CONTROL (group member)", bState.canJoin, bState.text.slice(0, 88));

if (bState.canJoin) {
  await bState.joinBtn.first().click();
  await b1.page.waitForTimeout(4500);
}
const bJoined = membership(B);
check("B room membership = joined", bJoined.room === "joined", bJoined.room);
check("B conversation membership = joined", bJoined.chat === "joined", bJoined.chat);
await b1.page.screenshot({ path: "screenshots/23-group-b-joined.png" });

// ------------------------------------------- LEFT THE GROUP => LOSES ELIGIBILITY
// The decisive test that membership is read LIVE rather than cached at join.
resetRoomMembership(B);
sql(`update public.conversation_members set status='left' where conversation_id='${GROUP}' and user_id='${B}'`);
const bLeft = await roomRowState(b1.page);
check("B loses the Join CONTROL after leaving the Group", !bLeft.canJoin, bLeft.text.slice(0, 88));
const bLeftScan = await scanAs(b1.page, token);
check(
  "B server-refused after leaving the Group, even with a valid token",
  membership(B).room !== "joined",
  JSON.stringify(membership(B))
);

// ------------------------------------------------------------- REMOVED MEMBER
sql(`update public.conversation_members set status='removed' where conversation_id='${GROUP}' and user_id='${B}'`);
check("a removed Group member is refused", !(await roomRowState(b1.page)).canJoin);

// ----------------------------------------------------------------- WRONG GROUP
// Point the Room at a Group B is not in. Membership of SOME group is not enough.
sql(`update public.conversation_members set status='joined' where conversation_id='${GROUP}' and user_id='${B}'`);
sql(`update public.event_circle_group_targets set group_conversation_id='${OTHER_GROUP}' where event_circle_id='${ROOM}'`);
const bWrong = await roomRowState(b1.page);
check("membership of a DIFFERENT group does not admit", !bWrong.canJoin, bWrong.text.slice(0, 88));

// ------------------------------------------------------------ MISSING TARGET
// A group-gated Room with no targets must admit NOBODY, not everybody.
sql(`delete from public.event_circle_group_targets where event_circle_id='${ROOM}'`);
const bNoTarget = await roomRowState(b1.page);
check("a group-gated room with no targets admits nobody", !bNoTarget.canJoin, bNoTarget.text.slice(0, 88));
const noTargetScan = await scanAs(b1.page, token);
check(
  "server refuses join when the room has no group targets",
  membership(B).room !== "joined",
  JSON.stringify(membership(B))
);

// Restore the fixture.
sql(
  `insert into public.event_circle_group_targets (event_circle_id, group_conversation_id) values ('${ROOM}','${GROUP}') on conflict do nothing`
);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nGROUP-MEMBERS E2E: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
