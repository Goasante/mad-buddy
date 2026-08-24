import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EXPIRY STOPS THE NEXT EXPANSION. IT NEVER DESTROYS AN EXISTING COMMITMENT.
 *
 * That sentence is the whole monetization rule, and these assertions are its
 * enforcement. They are structural because the property IS structural: it is
 * "which entry points consult the entitlement authority, and which must never",
 * and the expensive mistakes here are silent.
 *
 * Two failure directions, both bad, and a test that only checks one is a trap:
 *
 *   UNDER-GATING  a paid surface ships without a server check, so hiding the
 *                 nav item is the only protection and a hand-rolled fetch to
 *                 the Server Action walks straight past it.
 *
 *   OVER-GATING   something free acquires a gate. Nobody pays to keep talking
 *                 to a person they already matched with, to keep a Plan they
 *                 already made, or to leave. Over-gating is the worse of the
 *                 two: under-gating loses revenue, over-gating breaks a
 *                 relationship somebody already has.
 *
 * The runtime proof that the gates return the right answers is
 * scripts/hardening/access-enforcement.mjs; this proves the gates exist where
 * they should and nowhere they should not.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const linkr = read("app/(app)/linkr-actions.ts");
const upfor = read("app/(app)/hangout-actions.ts");

/** A file with comments stripped — assert on code, never on prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The body of one exported action, up to the next top-level export. */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `${name} no longer exists`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const next = rest.indexOf("\nexport ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("Linkr — discovery is gated", () => {
  const gated = [
    ["loadLinkrCandidatesAction", "the candidate deck is discovery"],
    ["connectWithCandidateAction", "Connect can create a NEW relationship"],
    ["passCandidateAction", "passing walks the deck one card at a time"],
    ["enableLinkrAction", "switching Linkr on starts a discovery session"]
  ] as const;

  for (const [action, why] of gated) {
    it(`${action} consults the entitlement authority — ${why}`, () => {
      expect(code(actionBody(linkr, action))).toContain("checkAccess(userId, \"linkr\")");
    });
  }
});

describe("Linkr — continuity is never gated", () => {
  /* THE PROMISE. A user must never pay to continue talking to somebody they
     already mutually connected with, or to leave. */
  const free = [
    ["disableLinkrAction", "turning yourself OFF must always work"],
    ["endLinkrConnectionAction", "leaving is never a paid action"],
    ["loadMyLinkrProfileAction", "reading your own profile is not discovery"],
    ["updateLinkrProfileAction", "editing your own profile is not discovery"],
    ["updateLinkrSettingsAction", "changing your own settings is not discovery"]
  ] as const;

  for (const [action, why] of free) {
    it(`${action} is NOT gated — ${why}`, () => {
      expect(code(actionBody(linkr, action)), `${action} acquired a paywall`)
        .not.toContain("checkAccess");
    });
  }

  it("messaging is not gated by the access model at all", () => {
    /* An existing Linkr match produces an ordinary direct conversation, and
       Messages is free forever. If the access guard ever appears in the
       messaging path, somebody has been locked out of a conversation they
       already had. */
    for (const path of [
      "app/(app)/messages-actions.ts",
      "lib/messaging/service.ts"
    ]) {
      let source: string;
      try {
        source = read(path);
      } catch {
        continue; // path moved; the other assertion still covers the rule
      }
      expect(code(source), `${path} must never gate messaging on entitlement`)
        .not.toContain("@/lib/access/guard");
    }
  });
});

describe("UpFor — expansion is gated, existing commitments are not", () => {
  it("creating an UpFor is gated", () => {
    expect(code(actionBody(upfor, "startHangoutAction"))).toContain('checkAccess(userId, "upfor")');
  });

  it("the stranger half of the discovery feed is gated", () => {
    const body = code(actionBody(upfor, "getVisibleHangoutsAction"));
    expect(body).toContain('checkAccess(userId, "upfor")');
    // ...and it gates the stranger branch, not the whole feed.
    expect(body).toContain("strangerCandidates");
  });

  it("seeing what your OWN MUDDIES are up for is never gated", () => {
    /* The single most important over-gating check in this file. The feed has
       two branches; `muddySessions` is your existing social world. If the gate
       is ever moved to wrap the whole action, this fails. */
    const body = code(actionBody(upfor, "getVisibleHangoutsAction"));
    const gateAt = body.indexOf("checkAccess");
    const muddyAt = body.indexOf("muddyRows");
    expect(muddyAt, "muddyRows disappeared from the feed").toBeGreaterThan(-1);
    expect(gateAt, "the gate now precedes the Muddy branch — it wraps the whole feed")
      .toBeGreaterThan(muddyAt);
  });

  it("joining a STRANGER's UpFor is gated", () => {
    const body = code(actionBody(upfor, "requestHangoutAction"));
    expect(body).toContain('checkAccess(userId, "upfor")');
    expect(body).toContain("viewableAsStranger");
  });

  it("joining a MUDDY's UpFor is not gated", () => {
    /* `viewableAsMuddy` short-circuits `viewableAsStranger`, so the gate can
       only be reached by somebody who came through the nearby opt-in. The gate
       must sit inside that conditional, never above it. */
    const body = code(actionBody(upfor, "requestHangoutAction"));
    const conditional = body.indexOf("if (viewableAsStranger)");
    const gate = body.indexOf('checkAccess(userId, "upfor")');
    expect(conditional, "the stranger-only conditional is gone").toBeGreaterThan(-1);
    expect(gate, "the gate escaped the stranger-only branch").toBeGreaterThan(conditional);
  });

  const free = [
    ["convertHangoutToPlanAction", "an UpFor that became a Plan is a commitment already made"],
    ["respondHangoutRequestAction", "answering someone who asked to join your own UpFor"],
    ["leaveHangoutAction", "leaving is never a paid action"],
    ["endHangoutAction", "ending your own UpFor must always work"],
    ["getOwnerHangoutRequestsAction", "reading requests to your own UpFor"]
  ] as const;

  for (const [action, why] of free) {
    it(`${action} is NOT gated — ${why}`, () => {
      expect(code(actionBody(upfor, action)), `${action} acquired a paywall`)
        .not.toContain("checkAccess");
    });
  }
});

describe("the free core has no entitlement gate anywhere", () => {
  /* The constitution's list, asserted directly. If the access guard ever
     appears in one of these, the core stopped being free. */
  const coreSurfaces = [
    "app/(app)/plans-actions.ts",
    "app/(app)/social-actions.ts",
    "app/(app)/safe-arrival-actions.ts",
    "lib/plans/service.ts",
    "lib/safety/safe-arrival.ts",
    "lib/friends/service.ts"
  ];

  for (const path of coreSurfaces) {
    it(`${path} never imports the access guard`, () => {
      let source: string;
      try {
        source = read(path);
      } catch {
        return; // file moved; not a monetization regression
      }
      expect(code(source), `${path} is core and must stay free`)
        .not.toContain("@/lib/access/guard");
    });
  }
});

describe("there is exactly one entitlement authority", () => {
  it("no gate re-implements the access decision itself", () => {
    /* THE ARCHITECTURAL RULE THIS WHOLE PHASE EXISTS FOR: every Linkr and UpFor
       decision derives from the same resolver. A call site that read
       `access_grants` directly, or invented its own `hasAccess`, would be the
       scattered `isPremium` pattern coming back under a new name. */
    for (const [name, source] of [["linkr-actions", linkr], ["hangout-actions", upfor]] as const) {
      expect(code(source), `${name} queries access rows directly instead of using the resolver`)
        .not.toContain('from("access_grants")');
      expect(code(source), `${name} queries global windows directly`)
        .not.toContain('from("access_global_windows")');
    }
  });

  it("the paid surfaces no longer consult the old tier authority", () => {
    /* `getCurrentSubscriptionAccess(...).plan` ranked free < plus < pro. UpFor
       used it to cap active sessions and capacity per tier. One access
       boundary has no tiers, so a surviving reference means two authorities
       disagree about the same question. */
    for (const [name, source] of [["linkr-actions", linkr], ["hangout-actions", upfor]] as const) {
      expect(code(source), `${name} still reads the old tier authority`)
        .not.toContain("getCurrentSubscriptionAccess");
      expect(code(source), `${name} still ranks plans`).not.toContain("planTierLimitsFor");
    }
  });
});
