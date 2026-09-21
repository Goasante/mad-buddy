import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADS-FIRST MONETIZATION INVARIANTS.
 *
 * Linkr and UpFor are now part of the free product. Mad Buddy Access answers a
 * different question: whether advertising may be shown. Routes and actions
 * must not consult entitlement to decide feature availability.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const linkr = read("app/(app)/linkr-actions.ts");
const upfor = read("app/(app)/hangout-actions.ts");
const linkrRoute = read("app/(app)/linkr/page.tsx");
const upforRoute = read("app/(app)/hangout-mode/page.tsx");

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

describe("Linkr and UpFor are not paid surfaces anymore", () => {
  it("the Linkr route has no Access paywall", () => {
    const source = code(linkrRoute);
    expect(source).not.toContain("AccessLocked");
    expect(source).not.toContain("checkAccess");
  });

  it("the UpFor route has no Access paywall", () => {
    const source = code(upforRoute);
    expect(source).not.toContain("AccessLocked");
    expect(source).not.toContain("checkAccess");
  });

  it.each([["Linkr", linkr], ["UpFor", upfor]])("%s actions never consult Access", (_label, source) => {
    expect(code(source)).not.toMatch(/checkAccess|requireAccess|resolveAccessForUser|AccessLocked|access_required/);
    expect(code(source)).not.toContain("@/lib/access/guard");
  });

  it("Linkr does not query entitlement storage directly", () => {
    const source = code(linkr);
    expect(source).not.toContain('from("access_grants")');
    expect(source).not.toContain('from("access_global_windows")');
    expect(source).not.toContain("getCurrentSubscriptionAccess");
  });

  it("UpFor does not query entitlement storage directly", () => {
    const source = code(upfor);
    expect(source).not.toContain('from("access_grants")');
    expect(source).not.toContain('from("access_global_windows")');
    expect(source).not.toContain("getCurrentSubscriptionAccess");
    expect(source).not.toContain("planTierLimitsFor");
  });

  it("existing safety and anti-abuse checks still surround UpFor creation", () => {
    const body = code(actionBody(upfor, "startHangoutAction"));
    expect(body).toContain("getAuthedUserId");
    expect(body).toContain("consumeRateLimit");
    expect(body).toContain("MAX_ACTIVE_UPFORS");
    expect(body).toContain("MAX_UPFOR_CAPACITY");
  });

  it("stranger UpFor discovery still uses the privacy/proximity filter", () => {
    const body = code(actionBody(upfor, "getVisibleHangoutsAction"));
    expect(body).toContain("filterStrangerDiscoverable");
    expect(body).toContain("canViewHangout");
    expect(body).toContain("!friendIds.includes(session.owner_id)");
  });

  it("joining a stranger still re-checks server-side eligibility", () => {
    const body = code(actionBody(upfor, "requestHangoutAction"));
    expect(body).toContain("canStrangerJoinUpFor");
    expect(body).toContain("canViewHangout");
    expect(body).toContain("acceptedCount");
    expect(body).toContain("session.max_participants");
    expect(body).toContain("isHangoutJoinable");
    expect(body).toContain("getAuthedUserId");
    expect(body).toContain("consumeRateLimit");
  });
});

describe("the core product remains independent of advertising entitlement", () => {
  const coreSurfaces = [
    "app/(app)/plans-actions.ts",
    "app/(app)/social-actions.ts",
    "app/(app)/safe-arrival-actions.ts",
    "lib/plans/service.ts",
    "lib/safety/safe-arrival.ts",
    "lib/friends/service.ts"
  ];

  for (const path of coreSurfaces) {
    it(`${path} does not consult the Access compatibility guard`, () => {
      let source: string;
      try {
        source = read(path);
      } catch {
        return;
      }
      expect(code(source)).not.toContain("@/lib/access/guard");
    });
  }
});


describe("Home inline ad placement", () => {
  it("places the one slot after Near and before Trending, outside My Plans", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    const near = home.indexOf("{composition.showNearby ? (");
    const ad = home.indexOf('{composition.showNearby ? <InlineAdSlot placement="home-after-near" /> : null}');
    const trending = home.indexOf("{composition.showTrending ?");
    expect(near).toBeGreaterThan(-1);
    expect(ad).toBeGreaterThan(near);
    expect(home.slice(near, ad).trimEnd()).toMatch(/\) : null\}$/);
    expect(trending).toBeGreaterThan(ad);
    expect(home.match(/<InlineAdSlot/g)).toHaveLength(1);
  });
});
