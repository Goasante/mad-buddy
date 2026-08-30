import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Message sharing must not learn about UpFor.
 *
 * WE BROKE THIS ONCE. Widening `UpcomingAgendaItem` with an `upfor` variant so
 * Home could reuse it immediately failed to compile in
 * messaging-structured-share-actions, because that shared type is the contract
 * for "things you can send into a chat" -- not a Home presentation model.
 *
 * Home therefore composes its own union. These tests keep the two apart, so a
 * future convenience cannot quietly make an UpFor shareable.
 */
describe("the shared agenda contract stays free of UpFor", () => {
  const projection = read("lib/social/upcoming-agenda-projection.ts");

  it("has exactly the two variants message sharing understands", () => {
    expect(projection).toContain("export type UpcomingAgendaItem = PlanAgendaItem | EventAgendaItem;");
  });

  it("declares no upfor variant", () => {
    expect(projection).not.toMatch(/kind: "upfor"/);
    expect(projection).not.toContain("UpForAgendaItem");
  });

  it("keeps the share action ignorant of UpFor", () => {
    const share = read("app/(app)/messaging-structured-share-actions.ts");
    expect(share).not.toMatch(/upfor/i);
    expect(share).not.toContain("hangout_sessions");
  });
});

describe("Home's union is separate, and is where UpFor lives", () => {
  const comingUp = read("lib/social/coming-up.ts");

  it("composes the shared agenda rather than replacing or widening it", () => {
    expect(comingUp).toContain('kind: "agenda"');
    expect(comingUp).toContain('kind: "upfor"');
    expect(comingUp).toContain("UpcomingAgendaItem");
  });

  it("is not imported by message sharing", () => {
    const share = read("app/(app)/messaging-structured-share-actions.ts");
    expect(share).not.toContain("coming-up");
  });
});
