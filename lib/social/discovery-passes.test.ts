import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * Guards for the Linkr pass gesture.
 *
 * A left swipe is the easiest interaction in the product to get wrong: the
 * obvious implementations are "block them" or "record it and rank them lower",
 * and both are harmful. These assert the shape that keeps it a private,
 * reversible, expiring preference.
 */

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const migration = read("supabase/migrations/20260808120000_discovery_passes.sql");
const actions = stripComments(read("app/(app)/social-actions.ts"));
const projection = stripComments(read("lib/social/socialize-mobile.ts"));
const deck = stripComments(read("components/socialize/swipe-deck.tsx"));

describe("a pass is private to the person who made it", () => {
  it("has no policy keyed on the passed user, so nobody can query who passed on them", () => {
    const policies = migration.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(4);
    for (const policy of policies) {
      // Every policy scopes to the AUTHOR of the pass. A policy keyed on
      // passed_user_id would make "who passed on me" answerable.
      expect(policy).toContain("auth.uid() = user_id");
      expect(policy).not.toMatch(/auth\.uid\(\)\s*=\s*passed_user_id/);
    }
  });

  it("never notifies the person passed on", () => {
    const pass = actions.slice(actions.indexOf("export async function passPersonAction"));
    const body = pass.slice(0, pass.indexOf("export async function undoPassAction"));
    expect(body).not.toContain("deliverNotification");
    expect(body).not.toContain("emitLifeEvent");
  });

  it("emits no domain event about the passed user", () => {
    // domain_events is queryable and retained. An event naming the person
    // passed on would reconstruct exactly the record the policies withhold.
    expect(actions).not.toMatch(/domain_events[\s\S]{0,200}passed_user_id/);
  });
});

describe("a pass is not a block", () => {
  it("writes to its own table rather than blocked_users", () => {
    const pass = actions.slice(actions.indexOf("export async function passPersonAction"));
    const body = pass.slice(0, pass.indexOf("export async function undoPassAction"));
    expect(body).toContain('from("discovery_passes")');
    expect(body).not.toContain("blocked_users");
  });

  it("is one-directional: passing on someone does not hide the viewer from them", () => {
    // The projection filters `passed_user_id` for THIS viewer only. A mutual
    // filter would make a private preference visible as a disappearance.
    expect(projection).toContain('.eq("user_id", userId)');
    expect(projection).not.toMatch(/discovery_passes[\s\S]{0,300}\.eq\("passed_user_id", userId\)/);
  });

  it("keeps blocking available as its own action", () => {
    // The deck's dismissal must not replace or absorb blocking.
    expect(deck).not.toContain("blockUserAction");
  });
});

describe("a pass expires", () => {
  it("defaults to a finite window rather than forever", () => {
    expect(migration).toMatch(/expires_at[\s\S]{0,120}interval '30 days'/);
  });

  it("is filtered on read, so expiry holds even if no cleanup job runs", () => {
    expect(projection).toMatch(/discovery_passes[\s\S]{0,300}\.gt\("expires_at"/);
  });

  it("refreshes rather than duplicating when someone is passed on twice", () => {
    expect(migration).toContain("unique (user_id, passed_user_id)");
    expect(actions).toContain('onConflict: "user_id,passed_user_id"');
  });
});

describe("a pass is reversible", () => {
  it("can be deleted by its author", () => {
    expect(migration).toMatch(/for delete using \(auth\.uid\(\) = user_id\)/);
  });

  it("scopes the undo to the caller's own row", () => {
    const undo = actions.slice(actions.indexOf("export async function undoPassAction"));
    expect(undo).toContain('.eq("user_id", userId)');
  });
});

describe("the deck never invents data about a person", () => {
  it("shows no age, occupation or verification tick", () => {
    // None of these exist in the projection. Rendering them would be stating
    // something untrue about a real person.
    expect(deck).not.toMatch(/\bage\b/i);
    expect(deck).not.toMatch(/occupation|job title|headline/i);
    expect(deck).not.toMatch(/verified|verification/i);
  });

  it("shows proximity as a phrase, never an exact distance", () => {
    // Exact distances from several vantage points reconstruct a location.
    expect(deck).toContain("PROXIMITY_LABEL");
    expect(deck).not.toMatch(/km away|miles away|approxDistance/);
  });

  it("carries membership only through the canonical badge", () => {
    expect(deck).toContain("PremiumPlanBadge");
  });
});

describe("swiping is an enhancement, not the only route", () => {
  it("ships keyboard-reachable buttons for every gesture", () => {
    expect(deck).toContain("linkr-deck-action-pass");
    expect(deck).toContain("linkr-deck-action-wave");
    expect(deck).toContain("linkr-deck-action-undo");
    // Real buttons, so they are focusable and announced.
    expect((deck.match(/<button/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("labels every control", () => {
    const labels = deck.match(/aria-label=/g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });

  it("hides stacked cards from screen readers so the deck announces once", () => {
    expect(deck).toContain("aria-hidden={!isTop}");
  });

  it("never fires a wave the server would reject", () => {
    expect(deck).toContain("canWave");
  });
});
