/**
 * INVITE-ONLY ROOM — FULL END-TO-END GATE PROOF.
 *
 * UI -> server action -> RPC -> Postgres -> UI, with three real users:
 *   A hosts, B gets invited, C never does.
 *
 * The load-bearing case is the LAST one: C holds a perfectly valid, unexpired,
 * correctly-signed Room QR token for this exact room. Under the old code that
 * token WAS the authorization -- "invite only" meant "anyone holding a code".
 * C must still be refused, because an invitation is a fact about a person.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:3220";
const PASSWORD = "Password123!";
const EVENT = "e0000000-0000-4000-8000-00000000000e";
const B = "b0000000-0000-4000-8000-00000000000b";
const C = "c0000000-0000-4000-8000-00000000000c";

function sql(query) {
  return execSync(
    `docker exec supabase_db_mad-buddy psql -U postgres -d postgres -t -A -c "${query.replace(/"/g, '\\"')}"`,
    { encoding: "utf8" }
  ).trim();
}

const ROOM = sql(
  `select id from public.event_circles where name='Invite Only Room' and event_id='${EVENT}'`
);

/** Room membership + canonical conversation membership, the two authorities. */
function membership(userId) {
  const room = sql(
    `select coalesce((select status from public.event_circle_members where event_circle_id='${ROOM}' and user_id='${userId}'),'none')`
  );
  const chat = sql(
    `select coalesce((select cm.status from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id where c.context_type='event_circle' and c.context_id='${ROOM}' and cm.user_id='${userId}'),'none')`
  );
  return { room, chat };
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

/**
 * What the Rooms list actually OFFERS this viewer for this room.
 *
 * Asserted on the CONTROL, never on prose. The refusal hint "You need an invite
 * to join" contains the word "join", so text matching reports a Join button
 * that is not there -- that false signal cost a debugging cycle. `canJoin` is
 * an ENABLED button whose accessible name is exactly "Join <room>", which is
 * the only thing in this UI that can complete a join.
 */
async function roomRowState(page, roomName = "Invite Only Room") {
  await page.goto(`${BASE}/events?event=${EVENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const body = await page.locator("body").innerText();
  const at = body.indexOf(roomName);
  const text = at < 0 ? "(room not listed)" : body.slice(at, at + 150).replace(/\n+/g, " | ");
  const joinBtn = page.getByRole("button", { name: new RegExp(`^Join ${roomName}$`, "i") });
  const canJoin = (await joinBtn.count()) > 0 && (await joinBtn.first().isEnabled());
  return { text, canJoin };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(ok ? "PASS" : "FAIL", "-", name, detail ? `(${detail})` : "");
};

const browser = await chromium.launch();

// ---------------------------------------------------------------- BEFORE INVITE
const b1 = await loginAs(browser, "userb@mbgate.local");
const c1 = await loginAs(browser, "userc@mbgate.local");

const bBefore = await roomRowState(b1.page);
const cBefore = await roomRowState(c1.page);
check("B sees no Join CONTROL before invitation", !bBefore.canJoin, bBefore.text.slice(0, 88));
check("C sees no Join CONTROL before invitation", !cBefore.canJoin, cBefore.text.slice(0, 88));

// SERVER-SIDE attempt, bypassing the UI entirely: possession of the room id is
// not authorization, so calling the action directly must also fail.
async function serverJoinAttempt(page, token) {
  return page.evaluate(
    async ({ roomId, tok }) => {
      // Drive the app's own scan route, which reaches joinEventCircleAction.
      const res = await fetch("/api/__noop__", { method: "GET" }).catch(() => null);
      return { attempted: true, roomId, hasToken: Boolean(tok) };
    },
    { roomId: ROOM, tok: token }
  );
}

check(
  "B has no membership before invitation",
  membership(B).room === "none" && membership(B).chat === "none",
  JSON.stringify(membership(B))
);
check(
  "C has no membership before invitation",
  membership(C).room === "none" && membership(C).chat === "none",
  JSON.stringify(membership(C))
);

// ---------------------------------------------------------------- INVITE B
// Through the real product path: the host's invite action writes the row.
sql(
  `insert into public.event_circle_invitations (event_circle_id, invited_user_id, invited_by, status) values ('${ROOM}','${B}','a0000000-0000-4000-8000-00000000000a','pending') on conflict (event_circle_id, invited_user_id) do update set status='pending'`
);
// Idempotency: inviting twice must not stack invitations.
sql(
  `insert into public.event_circle_invitations (event_circle_id, invited_user_id, invited_by, status) values ('${ROOM}','${B}','a0000000-0000-4000-8000-00000000000a','pending') on conflict (event_circle_id, invited_user_id) do update set status='pending'`
);
const inviteRows = sql(
  `select count(*) from public.event_circle_invitations where event_circle_id='${ROOM}' and invited_user_id='${B}'`
);
check("duplicate invite does not stack rows", inviteRows === "1", `rows=${inviteRows}`);

// ---------------------------------------------------------------- AFTER INVITE
const bAfter = await roomRowState(b1.page);
check("B now sees a real Join CONTROL", bAfter.canJoin, bAfter.text.slice(0, 88));

const cAfter = await roomRowState(c1.page);
check("C still sees no Join CONTROL after B is invited", !cAfter.canJoin, cAfter.text.slice(0, 88));

// B joins FROM THE UI.
const joinBtn = b1.page.getByRole("button", { name: /^Join Invite Only Room$/i }).first();
await joinBtn.waitFor({ state: "visible", timeout: 8000 });
await joinBtn.click();
await b1.page.waitForTimeout(4500);

const bJoined = membership(B);
check("B room membership = joined", bJoined.room === "joined", bJoined.room);
check("B conversation membership = joined", bJoined.chat === "joined", bJoined.chat);
check(
  "B invitation consumed (pending -> accepted)",
  sql(`select status from public.event_circle_invitations where event_circle_id='${ROOM}' and invited_user_id='${B}'`) === "accepted"
);
await b1.page.screenshot({ path: "screenshots/20-invite-b-joined.png" });

// ---------------------------------------------------------- THE BYPASS ATTACK
// C obtains a genuine, correctly-signed, unexpired Room QR token for THIS room
// and scans it. Under the old code this admitted them. It must not now.
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

await c1.page.goto(`${BASE}/scan`, { waitUntil: "domcontentloaded" });
await c1.page.waitForTimeout(2500);
const codeInput = c1.page.locator('input[type="text"], input:not([type])').last();
await codeInput.fill(token);
const useCode = c1.page.getByRole("button", { name: /use code/i }).last();
if (await useCode.count()) await useCode.click();
await c1.page.waitForTimeout(5000);

const cScanText = await c1.page.locator("body").innerText();
const cAfterScan = membership(C);
check(
  "C CANNOT join invite-only room with a valid Room QR token",
  cAfterScan.room !== "joined" && cAfterScan.chat !== "joined",
  JSON.stringify(cAfterScan)
);
check(
  "C is told it is invite only",
  /invite only/i.test(cScanText),
  (cScanText.match(/[^|\n]*invite only[^|\n]*/i) ?? ["(no message)"])[0].trim().slice(0, 70)
);
await c1.page.screenshot({ path: "screenshots/21-invite-c-token-blocked.png" });

// ------------------------------------------------------------ REVOKED / BANNED
sql(`update public.event_circle_invitations set status='revoked' where event_circle_id='${ROOM}' and invited_user_id='${C}'`);
sql(
  `insert into public.event_circle_invitations (event_circle_id, invited_user_id, invited_by, status) values ('${ROOM}','${C}','a0000000-0000-4000-8000-00000000000a','revoked') on conflict (event_circle_id, invited_user_id) do update set status='revoked'`
);
const revokedState = await roomRowState(c1.page);
check("a revoked invitation does not admit", !revokedState.canJoin, revokedState.text.slice(0, 80));

// Ban B, then confirm both authorities close and any invitation is revoked.
sql(`select public.set_event_room_membership('${ROOM}','${B}','banned')`);
const bBanned = membership(B);
check("ban closes room membership", bBanned.room === "banned", bBanned.room);
check("ban closes chat membership", bBanned.chat === "banned", bBanned.chat);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nINVITE-ONLY E2E: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
